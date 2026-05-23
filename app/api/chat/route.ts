import { NextRequest, NextResponse } from 'next/server';
import { searchTaxLaw, TaxLawMatch } from '@/lib/pinecone/client';
import { generateTaxAnswer, extractTaxParameters, generateTaxAnswerStream, extractCitationsFromText } from '@/lib/gemini/client';
import { calculateIncomeTax } from '@/lib/tax-calculator';
import { db } from '@/lib/supabase/db';
import fs from 'fs';
import path from 'path';

// Anonymize sensitive PII (Resident numbers, Phone numbers) before saving to DB
function anonymizeText(text: string): string {
  if (!text) return text;
  let clean = text;
  // Mask Resident Registration Numbers (주민등록번호): e.g., 900101-1234567 -> 900101-*******
  clean = clean.replace(/\b(\d{6})[-_]?[1-48]\d{6}\b/g, '$1-*******');
  clean = clean.replace(/\b(\d{6})[-_]?\d{7}\b/g, '$1-*******');
  // Mask Phone numbers: e.g., 010-1234-5678 -> 010-XXXX-XXXX
  clean = clean.replace(/\b010[-_]?\d{3,4}[-_]?\d{4}\b/g, '010-XXXX-XXXX');
  return clean;
}

export async function POST(req: NextRequest) {
  let message = '';
  let sessionId = '';
  
  try {
    const body = await req.json();
    message = body.message;
    sessionId = body.sessionId;
    const history = (body.history || []).slice(-4);
    const isStream = !!body.stream;

    if (!message) {
      return NextResponse.json({ error: '메시지가 누락되었습니다.' }, { status: 400 });
    }

    if (!sessionId) {
      return NextResponse.json({ error: '세션 ID가 누락되었습니다.' }, { status: 400 });
    }

    console.log(`Processing chat for session ${sessionId}, query: "${message.substring(0, 30)}..." (stream: ${isStream})`);

    const totalStart = Date.now();
    let pineconeDuration = 0;
    let geminiParamDuration = 0;
    let geminiGenDuration = 0;

    // 1 & 2. Run Pinecone search and Gemini parameter extraction in parallel using Promise.all
    const parallelStart = Date.now();
    const [extractedParams, searchResults] = await Promise.all([
      (async () => {
        const paramStart = Date.now();
        try {
          const calcKeywords = ['원', '만원', '연봉', '월급', '급여', '소득', '수입', '계산', '공제'];
          const mightNeedCalculation = calcKeywords.some(k => message.includes(k)) || /\d/.test(message);
          if (mightNeedCalculation) {
            const params = await extractTaxParameters(message);
            geminiParamDuration = Date.now() - paramStart;
            return params;
          }
        } catch (e) {
          console.error('Failed to extract parameters:', e);
        }
        return { isTaxCalculation: false };
      })(),
      (async () => {
        const pineconeStart = Date.now();
        try {
          console.time('[1] Pinecone 검색');
          // Pinecone top-k search with limit = 3
          const results = await searchTaxLaw(message, 3);
          console.timeEnd('[1] Pinecone 검색');
          pineconeDuration = Date.now() - pineconeStart;
          return results;
        } catch (e) {
          console.timeEnd('[1] Pinecone 검색');
          console.error('Vector search failed:', e);
          return [];
        }
      })()
    ]);

    const parallelDuration = Date.now() - parallelStart;

    // 3. Tax calculation logic if required
    let calcResultString = '';
    if (extractedParams.isTaxCalculation && extractedParams.annualSalary && extractedParams.annualSalary > 0) {
      try {
        const taxInput = {
          annualSalary: extractedParams.annualSalary,
          hasSpouse: !!extractedParams.hasSpouse,
          numberOfDependents: extractedParams.numberOfDependents || 0,
          numberOfElderly: extractedParams.numberOfElderly || 0,
          numberOfDisabled: extractedParams.numberOfDisabled || 0,
          isSingleParent: !!extractedParams.isSingleParent,
          isFemaleHeadOfHouseholdWithLowIncome: !!extractedParams.isFemaleHeadOfHouseholdWithLowIncome
        };
        const result = calculateIncomeTax(taxInput);
        
        calcResultString = `
[세금 계산서 요약]
- 연간 총급여액(연봉): ${result.annualSalary.toLocaleString()}원
- 근로소득공제액: ${result.earnedIncomeDeduction.toLocaleString()}원
- 근로소득금액: ${result.earnedIncomeAmount.toLocaleString()}원
- 인적공제 합계: ${result.personalDeduction.toLocaleString()}원
  * 기본공제: 본인 1,500,000원${result.basicDeductionDetail.spouse > 0 ? ' + 배우자 1,500,000원' : ''}${result.basicDeductionDetail.dependents > 0 ? ` + 부양가족 ${result.basicDeductionDetail.dependents.toLocaleString()}원` : ''} (합계 ${result.basicDeductionDetail.total.toLocaleString()}원)
  * 추가공제: 경로우대 ${result.additionalDeductionDetail.elderly.toLocaleString()}원 + 장애인 ${result.additionalDeductionDetail.disabled.toLocaleString()}원 + 한부모 ${result.additionalDeductionDetail.singleParent.toLocaleString()}원 + 부녀자 ${result.additionalDeductionDetail.femaleHead.toLocaleString()}원 (합계 ${result.additionalDeductionDetail.total.toLocaleString()}원)
- 과세표준 (근로소득금액 - 인적공제): ${result.taxableIncome.toLocaleString()}원
- 산출세액 (과세표준 * 적용세율): ${result.calculatedTax.toLocaleString()}원
  * 적용 최고 한계세율 구간: ${result.bracketRate}%
- 근로소득세액공제: ${result.earnedIncomeTaxCredit.toLocaleString()}원
- 표준세액공제 적용: ${result.standardTaxCredit.toLocaleString()}원
- 최종 예상 납부세액: ${result.estimatedTaxPayable.toLocaleString()}원
`;
        console.log('Tax calculation performed successfully.');
      } catch (calcErr) {
        console.error('Error computing tax details:', calcErr);
      }
    }

    // 4. Return Streaming or Standard Response
    if (isStream) {
      const responseStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let fullText = '';
          const geminiStart = Date.now();

          try {
            console.time('[2] Gemini 응답');
            const stream = generateTaxAnswerStream(message, searchResults, history, calcResultString);

            for await (const chunk of stream) {
              fullText += chunk;
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'content',
                delta: chunk
              }) + '\n'));
            }
            console.timeEnd('[2] Gemini 응답');

            geminiGenDuration = Date.now() - geminiStart;
            const finalCitations = extractCitationsFromText(fullText, searchResults);

            controller.enqueue(encoder.encode(JSON.stringify({
              type: 'done',
              citations: finalCitations
            }) + '\n'));

            // Save to DB asynchronously
            const cleanUserMessage = anonymizeText(message);
            const cleanAssistantMessage = anonymizeText(fullText);
            await db.saveChat(sessionId, cleanUserMessage, cleanAssistantMessage, finalCitations);

            const totalDuration = Date.now() - totalStart;
            const logMsg = `\n====================================\n` +
              `[RAG Pipeline Durations - Stream Mode]\n` +
              `[1] Pinecone Search: ${pineconeDuration}ms (top-k: 3)\n` +
              `[2] Gemini Parameter Extraction: ${geminiParamDuration}ms\n` +
              `[3] Parallel Operations Total: ${parallelDuration}ms\n` +
              `[4] Gemini Response Generation: ${geminiGenDuration}ms\n` +
              `[5] Overall: ${totalDuration}ms\n` +
              `====================================\n`;
            console.log(logMsg);
            try {
              fs.appendFileSync(path.join(process.cwd(), 'pipeline_durations.log'), logMsg, 'utf-8');
            } catch (e) {
              console.error('Failed to write duration log file:', e);
            }

          } catch (streamErr: any) {
            console.error('Error during streaming generation:', streamErr);
            
            if (streamErr.message && (streamErr.message.includes('429') || streamErr.message.includes('All Gemini models failed') || streamErr.message.includes('Quota'))) {
              const fallbackContent = '현재 AI 모델의 일일 허용된 사용량(요청 한도 및 토큰)을 초과하여 답변을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.';
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'content',
                delta: fallbackContent
              }) + '\n'));
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'done',
                citations: []
              }) + '\n'));
              
              try {
                const cleanUserMessage = anonymizeText(message);
                await db.saveChat(sessionId, cleanUserMessage, fallbackContent, []);
              } catch (dbErr) {}
            } else {
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'error',
                message: streamErr.message || 'Streaming failed.'
              }) + '\n'));
            }
          } finally {
            controller.close();
          }
        }
      });

      return new Response(responseStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive'
        }
      });
    } else {
      // Standard non-streaming response for benchmark tests
      const geminiStart = Date.now();
      console.time('[2] Gemini 응답');
      const response = await generateTaxAnswer(message, searchResults, history, calcResultString);
      console.timeEnd('[2] Gemini 응답');
      geminiGenDuration = Date.now() - geminiStart;

      const cleanUserMessage = anonymizeText(message);
      const cleanAssistantMessage = anonymizeText(response.content);
      await db.saveChat(sessionId, cleanUserMessage, cleanAssistantMessage, response.citations);

      const totalDuration = Date.now() - totalStart;
      const logMsg = `\n====================================\n` +
        `[RAG Pipeline Durations - Non-Stream Mode]\n` +
        `[1] Pinecone Search: ${pineconeDuration}ms (top-k: 3)\n` +
        `[2] Gemini Parameter Extraction: ${geminiParamDuration}ms\n` +
        `[3] Parallel Operations Total: ${parallelDuration}ms\n` +
        `[4] Gemini Response Generation: ${geminiGenDuration}ms\n` +
        `[5] Overall: ${totalDuration}ms\n` +
        `====================================\n`;
      console.log(logMsg);
      try {
        fs.appendFileSync(path.join(process.cwd(), 'pipeline_durations.log'), logMsg, 'utf-8');
      } catch (e) {
        console.error('Failed to write duration log file:', e);
      }

      return NextResponse.json({
        content: response.content,
        citations: response.citations
      });
    }

  } catch (error: any) {
    console.error('API Error:', error);
    
    // Check if it's a rate limit or quota error
    if (error.message && (error.message.includes('429') || error.message.includes('Too Many Requests') || error.message.includes('Quota'))) {
      const fallbackContent = '현재 AI 모델의 일일 허용된 사용량(요청 한도 및 토큰)을 초과하여 답변을 생성할 수 없습니다. 잠시 후(또는 내일) 다시 시도해주세요.';
      try {
        const cleanUserMessage = anonymizeText(message);
        await db.saveChat(sessionId, cleanUserMessage, fallbackContent, []);
      } catch (dbErr) {
        console.error('Failed to save fallback chat to DB:', dbErr);
      }

      return NextResponse.json({
        content: fallbackContent,
        citations: []
      });
    }

    return NextResponse.json(
      { error: '세무 상담 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
