import fs from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());
// --- Types ---
interface BenchmarkItem {
  id: number;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  expected_answer: string;
  relevant_article: string;
}

interface BenchmarkResult extends BenchmarkItem {
  actual_answer: string;
  score: 'correct' | 'partial' | 'incorrect';
  evaluation_reason: string;
  response_time_ms: number;
}

// --- Configuration ---
const INPUT_FILE = path.join(process.cwd(), 'benchmark_testset.json');
const OUTPUT_FILE = path.join(process.cwd(), 'benchmark_result.json');
const CHAT_API_URL = 'http://localhost:3000/api/chat';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DELAY_MS = 3000;

// Set up tracking
const results: BenchmarkResult[] = [];
let totalResponseTime = 0;
const categoryStats: Record<string, { total: number; correct: number; partial: number; incorrect: number }> = {
  '근로소득공제': { total: 0, correct: 0, partial: 0, incorrect: 0 },
  '인적공제': { total: 0, correct: 0, partial: 0, incorrect: 0 },
  '세율·산출세액': { total: 0, correct: 0, partial: 0, incorrect: 0 },
  '세액공제': { total: 0, correct: 0, partial: 0, incorrect: 0 },
  '종합소득·사업소득': { total: 0, correct: 0, partial: 0, incorrect: 0 },
  '기타소득·퇴직소득': { total: 0, correct: 0, partial: 0, incorrect: 0 },
  '비과세소득': { total: 0, correct: 0, partial: 0, incorrect: 0 },
};

// --- Helpers ---
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callChatbotAPI(question: string): Promise<{ answer: string; timeMs: number }> {
  let attempt = 0;
  const maxAttempts = 5;
  const start = Date.now();

  while (attempt < maxAttempts) {
    try {
      const res = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          sessionId: 'benchmark-session',
          history: []
        }),
      });
      
      if (!res.ok) {
        const errText = await res.text();
        return { answer: `[API Error] ${res.status} ${errText}`, timeMs: Date.now() - start };
      }
      
      const data = await res.json();
      const answer = data.content || '';

      // Check if we hit the fallback response indicating a rate limit in the Next.js API
      if (answer.includes('허용된 사용량') || answer.includes('초과하여')) {
        console.log(`    ⏳ Chatbot API Rate Limited (Attempt ${attempt + 1}/${maxAttempts}). Waiting 30s...`);
        await delay(30000);
        attempt++;
        continue;
      }

      return { answer, timeMs: Date.now() - start };
    } catch (e: any) {
      return { answer: `[Fetch Error] ${e.message}`, timeMs: Date.now() - start };
    }
  }
  return { answer: `[Fetch Error] API Rate limited after ${maxAttempts} attempts.`, timeMs: Date.now() - start };
}

async function evaluateAnswerWithGemini(
  question: string, 
  expected: string, 
  relevant_article: string, 
  actual: string
): Promise<{ score: 'correct' | 'partial' | 'incorrect', reason: string }> {
  if (!GEMINI_API_KEY) {
    // Basic fallback evaluation if no API key
    return { score: 'partial', reason: 'No Gemini API key provided for evaluation.' };
  }

  const prompt = `당신은 대한민국 세무 상담 챗봇의 답변을 평가하는 자동화된 채점관입니다.
다음 문제, 예상 정답(모범 답안), 그리고 챗봇의 실제 답변을 비교하여 채점하십시오.

[채점 기준]
1. 핵심 수치(금액, 퍼센트, 조건 등)가 정확한가?
2. 인용한 조문 번호(예: 제47조)가 일치하거나 적절한가? (예상 정답에 조문이 있으면 실제 답변에도 유사한 근거가 있어야 함)
- correct: 핵심 수치가 완벽히 일치하고 조문 근거도 타당함
- partial: 방향성은 맞으나 일부 세부 수치가 틀렸거나, 조문 인용이 누락/틀림
- incorrect: 완전히 엉뚱한 답변이거나 산출세액, 공제액이 심각하게 틀림

문제: ${question}
예상 정답: ${expected} (관련조문: ${relevant_article})
실제 답변:
${actual}

아래 JSON 형식으로만 평가 결과를 출력하십시오. 마크다운 백틱은 생략하세요.
{
  "score": "correct" 또는 "partial" 또는 "incorrect",
  "reason": "해당 점수를 부여한 간략한 이유"
}`;

  const models = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    let lastError = '';
    
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          })
        });

        if (res.status === 429) {
          lastError = `Rate limit (429) on ${model}`;
          console.log(`    ⏳ Evaluation API Rate Limited (429) on ${model}. Waiting 30s before retrying...`);
          await delay(30000);
          continue; // Try next model or retry after wait
        }

        if (!res.ok) {
          const errText = await res.text();
          lastError = `Status ${res.status} on ${model}: ${errText.substring(0, 50)}`;
          continue; // Try next model
        }

        const data = await res.json();
        const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const result = JSON.parse(textOutput);
        return { 
          score: result.score || 'incorrect', 
          reason: result.reason || 'No reason provided' 
        };
      } catch (e: any) {
        lastError = `Error on ${model}: ${e.message}`;
        continue; // Try next model
      }
    }

    // If we get here, all models in the list failed
    const waitTime = 30000 + attempt * 15000; // Progressive backoff: 30s, 45s, 60s
    console.log(`    ⏳ All evaluation models failed (${lastError}). Retrying entire set in ${(waitTime / 1000)}s... (Attempt ${attempt + 1}/${maxAttempts})`);
    await delay(waitTime);
    attempt++;
  }

  return { score: 'incorrect', reason: `Evaluation API failed on all models after ${maxAttempts} attempts` };
}

// --- Main Runner ---
async function runBenchmark() {
  console.log('🚀 챗봇 정확도 벤치마크 테스트 시작...');
  
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ 파일을 찾을 수 없습니다: ${INPUT_FILE}`);
    process.exit(1);
  }

  // Pre-flight check: Ensure Next.js server is running
  try {
    const check = await fetch(CHAT_API_URL, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ping', sessionId: 'ping', history: [] }) 
    });
    if (!check.ok && check.status !== 400 && check.status !== 500) {
      throw new Error(`Unexpected status ${check.status}`);
    }
  } catch (e: any) {
    if (e.message.includes('fetch failed') || e.code === 'ECONNREFUSED') {
      console.error('\n❌ 로컬 챗봇 API 서버에 연결할 수 없습니다. (http://localhost:3000)');
      console.error('💡 다른 터미널을 열고 `npm run dev` 를 실행하여 Next.js 서버를 먼저 켜주세요.\n');
      process.exit(1);
    }
  }

  const rawData = fs.readFileSync(INPUT_FILE, 'utf-8');
  const testset: BenchmarkItem[] = JSON.parse(rawData).slice(0, 100);
  const testsetIds = new Set(testset.map(item => item.id));
  
  // Load existing results to support resuming from previous interruption
  const completedIds = new Set<number>();
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const existingData = fs.readFileSync(OUTPUT_FILE, 'utf-8');
      const parsed = JSON.parse(existingData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach((r: BenchmarkResult) => {
          if (testsetIds.has(r.id)) {
            results.push(r);
            completedIds.add(r.id);
            totalResponseTime += r.response_time_ms;
            
            const cat = r.category;
            if (categoryStats[cat]) {
              categoryStats[cat].total++;
              categoryStats[cat][r.score]++;
            } else {
              categoryStats[cat] = {
                total: 1,
                correct: r.score === 'correct' ? 1 : 0,
                partial: r.score === 'partial' ? 1 : 0,
                incorrect: r.score === 'incorrect' ? 1 : 0
              };
            }
          }
        });
        console.log(`ℹ️ 기존 결과 파일에서 완료된 항목 ${completedIds.size}개를 발견했습니다. 이어서 진행합니다.\n`);
      }
    } catch (e) {
      console.warn('⚠️ 기존 결과 파일을 읽는 중 오류가 발생하여 처음부터 시작합니다.\n');
    }
  }

  console.log(`총 ${testset.length}개의 테스트 항목 중 ${testset.length - completedIds.size}개를 실행합니다.\n`);

  for (let i = 0; i < testset.length; i++) {
    const item = testset[i];
    
    // Skip already completed items
    if (completedIds.has(item.id)) {
      continue;
    }

    console.log(`[ ${i + 1} / ${testset.length} ] ${item.category} - ${item.difficulty}`);
    
    // 1. 챗봇 답변 가져오기
    const { answer, timeMs } = await callChatbotAPI(item.question);
    totalResponseTime += timeMs;
    
    // 2. 답변 평가하기
    const evalResult = await evaluateAnswerWithGemini(item.question, item.expected_answer, item.relevant_article, answer);
    
    // 3. 통계 업데이트
    const cat = item.category;
    if (categoryStats[cat]) {
      categoryStats[cat].total++;
      categoryStats[cat][evalResult.score]++;
    } else {
      categoryStats[cat] = { total: 1, correct: evalResult.score === 'correct' ? 1 : 0, partial: evalResult.score === 'partial' ? 1 : 0, incorrect: evalResult.score === 'incorrect' ? 1 : 0 };
    }

    // 4. 결과 저장
    results.push({
      ...item,
      actual_answer: answer,
      score: evalResult.score as any,
      evaluation_reason: evalResult.reason,
      response_time_ms: timeMs
    });

    console.log(`  ⏱ ${(timeMs / 1000).toFixed(2)}s | 🎯 ${evalResult.score.toUpperCase()} | ${evalResult.reason.substring(0, 50)}...`);
    
    // 실시간 증분 저장 (Incremental Save)
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
    
    // API 과부하 방지 딜레이
    if (i < testset.length - 1) {
      await delay(DELAY_MS);
    }
  }

  // --- 결과 출력 ---
  console.log('\\n====================================');
  console.log('📊 카테고리별 정확도');
  
  let totalCorrect = 0;
  
  Object.keys(categoryStats).forEach(cat => {
    const stat = categoryStats[cat];
    if (stat.total === 0) return;
    
    const accuracy = Math.round((stat.correct / stat.total) * 100);
    let icon = '❌';
    if (accuracy >= 85) icon = '✅';
    else if (accuracy >= 70) icon = '⚠️';
    
    totalCorrect += stat.correct;
    
    // Pad category string for alignment
    const paddedCat = (cat + '                ').substring(0, 15);
    console.log(`${paddedCat}: ${stat.correct}/${stat.total} (${accuracy}%) ${icon}`);
  });

  const overallAccuracy = Math.round((totalCorrect / testset.length) * 100);
  const avgResponseTime = (totalResponseTime / testset.length / 1000).toFixed(2);
  
  console.log('\n====================================');
  console.log(`전체 평균: ${overallAccuracy}% (목표: 85%)`);
  console.log(`⏱ 평균 응답시간: ${avgResponseTime}s (목표: 3초 이내)`);
  console.log('====================================\n');

  // 5. 파일 저장
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`💾 평가 결과가 저장되었습니다: ${OUTPUT_FILE}`);
}

runBenchmark().catch(console.error);
