import { NextRequest, NextResponse } from 'next/server';
import { searchTaxLaw, TaxLawMatch } from '@/lib/pinecone/client';
import { generateTaxAnswer, extractTaxParameters } from '@/lib/gemini/client';
import { calculateIncomeTax } from '@/lib/tax-calculator';
import { db } from '@/lib/supabase/db';

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
    // Keep only the last 4 messages to prevent token limit exhaustion (Sliding Window)
    const history = (body.history || []).slice(-4);

    if (!message) {
      return NextResponse.json({ error: '메시지가 누락되었습니다.' }, { status: 400 });
    }

    if (!sessionId) {
      return NextResponse.json({ error: '세션 ID가 누락되었습니다.' }, { status: 400 });
    }

    console.log(`Processing chat for session ${sessionId}, query: "${message.substring(0, 30)}..."`);

    // 1. Parameter Extraction for Tax Calculation
    let calcResultString = '';
    let hasCalculation = false;
    
    try {
      // Optimize: Only call parameter extraction if query contains numbers or tax calculation keywords
      const calcKeywords = ['원', '만원', '연봉', '월급', '급여', '소득', '수입', '계산', '공제'];
      const mightNeedCalculation = calcKeywords.some(k => message.includes(k)) || /\d/.test(message);
      
      if (mightNeedCalculation) {
        const extractedParams = await extractTaxParameters(message);
        if (extractedParams.isTaxCalculation && extractedParams.annualSalary && extractedParams.annualSalary > 0) {
        hasCalculation = true;
        
        // Calculate taxes using our module
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
        
        // Format calculation result
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
        }
      }
    } catch (e) {
      console.error('Failed to extract parameters or calculate tax:', e);
    }

    // 2. Vector Search (Pinecone RAG)
    // Even if we have a calculation, we still search to pull relevant legal clauses (like 제47조 근로소득공제, 제50조 기본공제 등)
    let searchResults: TaxLawMatch[] = [];
    try {
      // Formulate a clean search query
      const searchQuery = hasCalculation ? '근로소득공제 인적공제 기본공제 세율 구간 소득세' : message;
      searchResults = await searchTaxLaw(searchQuery, 4);
    } catch (e) {
      console.error('Vector search failed:', e);
    }

    // 3. Gemini LLM Generation
    const response = await generateTaxAnswer(message, searchResults, history, calcResultString);

    // 4. Save to Database (unified wrapper with automatic local DB fallback)
    const cleanUserMessage = anonymizeText(message);
    const cleanAssistantMessage = anonymizeText(response.content);
    await db.saveChat(sessionId, cleanUserMessage, cleanAssistantMessage, response.citations);

    return NextResponse.json({
      content: response.content,
      citations: response.citations
    });

  } catch (error: any) {
    console.error('API Error:', error);
    
    // Check if it's a rate limit or quota error
    if (error.message && (error.message.includes('429') || error.message.includes('Too Many Requests') || error.message.includes('Quota'))) {
      const fallbackContent = '현재 AI 모델의 일일 허용된 사용량(요청 한도 및 토큰)을 초과하여 답변을 생성할 수 없습니다. 잠시 후(또는 내일) 다시 시도해주세요.';
      
      // We must save this to the DB, otherwise frontend's fetchSessions will wipe the chat!
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
