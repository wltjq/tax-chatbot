import fs from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());
const RESULT_FILE = path.join(process.cwd(), 'benchmark_result.json');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

interface BenchmarkResult {
  id: number;
  category: string;
  difficulty: string;
  question: string;
  expected_answer: string;
  relevant_article: string;
  actual_answer: string;
  score: 'correct' | 'partial' | 'incorrect';
  evaluation_reason: string;
  response_time_ms: number;
}

async function analyzePatternsWithGemini(category: string, errorReasons: string[]): Promise<string[]> {
  if (!GEMINI_API_KEY) {
    return ['패턴 분석 불가 (GEMINI_API_KEY 없음)'];
  }

  const prompt = `당신은 세무 챗봇의 오답(틀린 이유) 목록을 분석하여 주요 오답 패턴을 찾아내는 데이터 분석가입니다.
분석 대상 카테고리: [${category}]
총 오답/부분정답 수: ${errorReasons.length}건

아래는 각 문항별로 채점관이 남긴 감점 사유(평가 이유)입니다.
${errorReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

이 사유들을 분석하여, 가장 빈번하게 발생한 오답 패턴(유형) 2~3가지를 추출하고 각각 몇 건 정도 해당하는지 분류해주세요.
반드시 아래와 같은 형태의 순수 텍스트 배열 형식(JSON 아님, 줄바꿈으로 구분)으로만 답변해 주세요. (마크다운 생략)
예시:
- 한도 계산 오류: 7건
- 조문 번호 불일치: 4건
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1
        }
      })
    });
    
    if (!res.ok) return ['- 분석 API 호출 실패'];
    
    const data = await res.json();
    const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Split by newline and clean up
    return textOutput.split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && line.startsWith('-'));
  } catch (e: any) {
    return [`- 분석 중 오류 발생: ${e.message}`];
  }
}

async function runAnalysis() {
  console.log('🔍 오답 분석 리포트 생성을 시작합니다...\n');

  if (!fs.existsSync(RESULT_FILE)) {
    console.error(`❌ 결과 파일을 찾을 수 없습니다: ${RESULT_FILE}`);
    console.error('먼저 runBenchmark.ts를 실행하여 결과를 생성해주세요.');
    process.exit(1);
  }

  const rawData = fs.readFileSync(RESULT_FILE, 'utf-8');
  let results: BenchmarkResult[] = [];
  try {
    results = JSON.parse(rawData);
  } catch (e) {
    console.error('결과 파일 JSON 파싱 오류:', e);
    process.exit(1);
  }

  // Filter errors (incorrect or partial)
  const errors = results.filter(r => r.score === 'incorrect' || r.score === 'partial');
  
  if (errors.length === 0) {
    console.log('🎉 축하합니다! 모든 테스트 케이스가 정답(correct)입니다. 오답이 없습니다.');
    return;
  }

  // Group by category
  const errorsByCategory: Record<string, string[]> = {};
  errors.forEach(err => {
    if (!errorsByCategory[err.category]) {
      errorsByCategory[err.category] = [];
    }
    // Include both the expected answer and the AI reason for better pattern matching context
    errorsByCategory[err.category].push(err.evaluation_reason);
  });

  console.log('❌ 오답 패턴 분석\n');

  const categoryErrorCounts = Object.keys(errorsByCategory).map(cat => ({
    category: cat,
    count: errorsByCategory[cat].length
  }));

  // Sort by highest error count first
  categoryErrorCounts.sort((a, b) => b.count - a.count);

  for (const item of categoryErrorCounts) {
    const { category, count } = item;
    const reasons = errorsByCategory[category];
    
    console.log(`[${category}] ${count}건 오답`);
    
    // Analyze patterns using Gemini
    const patterns = await analyzePatternsWithGemini(category, reasons);
    patterns.forEach(p => console.log(`  ${p}`));
    console.log('');
  }

  // Print Top 3 Recommendations
  console.log('====================================');
  console.log('💡 개선 우선순위 Top 3 카테고리');
  
  const top3 = categoryErrorCounts.slice(0, 3);
  top3.forEach((item, idx) => {
    console.log(`${idx + 1}. ${item.category} (${item.count}건 오류)`);
  });
  console.log('====================================\n');
}

runAnalysis().catch(console.error);
