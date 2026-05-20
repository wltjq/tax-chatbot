import { TaxLawMatch } from '../pinecone/client';

const geminiApiKey = process.env.GEMINI_API_KEY || '';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

export interface Citation {
  article: string;
  content: string;
  isExpanded?: boolean;
}

export interface TaxAnswerResponse {
  content: string;
  citations: Citation[];
}

/**
 * Helper to fetch from Gemini with multiple model fallbacks and retries
 */
async function fetchGeminiWithFallback(bodyPayload: any): Promise<Response | null> {
  const fallbackModels = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest'
  ];

  let response: Response | null = null;
  const maxRetries = 2; // Reduced per model to prevent huge delays if multiple models fail
  let retryDelay = 2000;
  let hasQuotaError = false;

  for (const currentModel of fallbackModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${geminiApiKey}`;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });

        if (response.ok) {
          return response; // Success!
        }

        // If status is 503 (Service Unavailable) or 429 (Rate Limit / Quota Exceeded)
        if (response.status === 503 || response.status === 429) {
          if (response.status === 429) hasQuotaError = true;
          if (attempt === maxRetries - 1) break; // Exhausted retries for this model
          const waitTime = retryDelay * Math.pow(2, attempt) + Math.random() * 1000;
          console.warn(`Gemini API (${currentModel}) returned ${response.status}. Retrying in ${(waitTime / 1000).toFixed(1)}s (Attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          break; // For other errors (400, 403, 404), do not retry, just move to next model
        }
      } catch (e) {
        if (attempt === maxRetries - 1) break;
        const waitTime = retryDelay * Math.pow(2, attempt);
        console.warn(`Fetch to Gemini (${currentModel}) failed: ${e}. Retrying in ${(waitTime / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    console.warn(`Model ${currentModel} failed or exhausted retries. Failing over to next model...`);
  }

  // If we reach here, ALL models in the fallback array have failed.
  // If at least one model failed due to Quota/Rate Limit, prioritize returning that error 
  // so our graceful "Token Exceeded" logic triggers instead of a 404 or 500 error.
  if (hasQuotaError && response && response.status !== 429) {
    throw new Error('429 Quota Exceeded on one or more models (Too Many Requests)');
  }

  return response;
}

/**
 * Calls Gemini LLM to generate an answer based on RAG context articles.
 */
export async function generateTaxAnswer(
  query: string,
  contextArticles: TaxLawMatch[],
  history: ChatHistoryMessage[],
  calculationResult?: string // Optional string describing calculations performed
): Promise<TaxAnswerResponse> {
  if (!geminiApiKey || geminiApiKey.startsWith('your_')) {
    throw new Error('GEMINI_API_KEY is not set. Please set it in .env.local');
  }

  // Build the system prompt
  const systemInstruction = `당신은 대한민국 소득세법에 기반한 전문 AI 세무 상담사입니다.
[기본 규칙]
1. 반드시 제공된 소득세법 조문(Context)만을 근거로 답변하십시오.
2. 소득세법 조문에서 근거를 찾을 수 없는 경우, 환각 오류를 최소화하기 위해 "제시된 소득세법 조문에서 질문과 관련된 내용을 찾을 수 없습니다." 라고 명확히 답변하고 추가적인 상상이나 허위 사실을 제공하지 마십시오.
3. 비전문가도 쉽게 이해할 수 있도록 친절하고 평이한 한국어 경어체로 서술하십시오.
4. 답변 본문에는 핵심 내용마다 참조한 조문 번호(예: 소득세법 제12조)를 명확히 명시하십시오.
5. 계산 모듈의 실행 결과(Calculation Result)가 입력으로 주어지면, 해당 계산 결과를 상세한 산출 과정과 함께 답변에 포함시켜 설명해주십시오.
6. 답변을 위해 참조한 조문들을 citations 배열에 모두 추출하여 구조화해주십시오. 각 조문의 본문을 임의로 단축하지 말고 최대한 조문 내용을 보존하십시오.

[답변 작성 규칙]
1. 반드시 마크다운 형식을 사용하세요.
2. 각 단계는 번호 목록으로 구분하고 줄바꿈을 충분히 활용하세요.
3. 계산 결과는 반드시 표(table)로 정리하세요.
4. 아래 이모티콘을 항목 성격에 맞게 적극 활용하세요:
   - 🧮 계산 단계
   - 📋 최종 결과 요약
   - ⚠️ 주의사항 또는 한계
   - ✅ 정확한 항목
   - 📖 법령 근거
5. 문단과 문단 사이는 반드시 빈 줄로 구분하세요.`;

  // Format context articles
  const contextStr = contextArticles.length > 0 
    ? contextArticles.map(a => `[조문] ${a.article} (${a.title})\n${a.content}`).join('\n\n')
    : '제공된 조문 없음';

  // Format calculation result
  const calcStr = calculationResult ? `\n\n[세금 계산 연산 결과]\n${calculationResult}` : '';

  // Formulate the user message containing context and the current query
  const userMessageContent = `---
[Context 소득세법 조문]
${contextStr}${calcStr}
---
[사용자 질문]
${query}`;

  // Map history to Gemini API format
  // Gemini expects: { role: 'user' | 'model', parts: [{ text: string }] }
  const apiContents = [];

  // Add system instruction as part of system instruction or prepend it to the first message if systemInstruction is not supported.
  // Note: generateContent accepts systemInstruction as a top-level parameter. We will pass it as a parameter.
  
  // Add history
  for (const msg of history) {
    let msgText = msg.content;
    if (msg.role === 'assistant') {
      try {
        msgText = JSON.stringify({
          content: msg.content,
          citations: msg.citations || []
        });
      } catch (e) {
        msgText = JSON.stringify({ content: msg.content, citations: [] });
      }
    }
    apiContents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msgText }]
    });
  }

  // Add current query
  apiContents.push({
    role: 'user',
    parts: [{ text: userMessageContent }]
  });

  const bodyPayload = {
    contents: apiContents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          content: {
            type: 'STRING',
            description: '사용자에게 보여줄 완성된 한국어 세무 답변 텍스트'
          },
          citations: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                article: {
                  type: 'STRING',
                  description: '참조한 법률 및 조문 기호 (예: 소득세법 제12조)'
                },
                content: {
                  type: 'STRING',
                  description: '해당 조문의 실제 내용 텍스트'
                }
              },
              required: ['article', 'content']
            },
            description: '답변을 구성하는 데 실질적으로 인용된 소득세법 조문들의 리스트'
          }
        },
        required: ['content', 'citations']
      }
    }
  };

  const response = await fetchGeminiWithFallback(bodyPayload);

  if (!response || !response.ok) {
    const errText = response ? await response.text() : 'No response from server';
    throw new Error(`Gemini LLM request failed: ${response ? response.statusText : 'Fetch Error'}. Details: ${errText}`);
  }

  const result: any = await response.json();
  
  try {
    const textOutput = result.candidates[0].content.parts[0].text;
    const parsed: TaxAnswerResponse = JSON.parse(textOutput);
    return parsed;
  } catch (error) {
    console.error('Failed to parse Gemini structured output, falling back to plaintext parsing:', error);
    // Fallback if model failed to return schema-conforming JSON
    const textOutput = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      content: textOutput || '답변을 생성하는 중에 오류가 발생했습니다.',
      citations: contextArticles.map(a => ({ article: a.article, content: a.content }))
    };
  }
}

export interface ExtractedTaxParams {
  isTaxCalculation: boolean;
  annualSalary?: number;
  hasSpouse?: boolean;
  numberOfDependents?: number;
  numberOfElderly?: number;
  numberOfDisabled?: number;
  isSingleParent?: boolean;
  isFemaleHeadOfHouseholdWithLowIncome?: boolean;
}

/**
 * Extracts tax calculation parameters from a user query.
 */
export async function extractTaxParameters(query: string): Promise<ExtractedTaxParams> {
  if (!geminiApiKey || geminiApiKey.startsWith('your_')) {
    return { isTaxCalculation: false };
  }

  const systemInstruction = `사용자의 질문에서 소득세 계산(연봉, 월급, 소득세액, 공제 등)을 수행하기 위한 수치적/조건적 파라미터를 추출하십시오.
만약 질문이 구체적인 소득세 계산 요구가 아니거나 계산에 필요한 정보가 아예 없는 경우(예: 단순 법률 해석 질문)에는 isTaxCalculation을 false로 반환하십시오.
단, 질문에 '월급 300만원', '연봉 5000' 등 소득액만 주어지고 계산해달라는 뉘앙스가 있으면 isTaxCalculation을 true로 하고 해당 값을 추출하십시오.`;

  const bodyPayload = {
    contents: [{ role: 'user', parts: [{ text: query }] }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          isTaxCalculation: {
            type: 'BOOLEAN',
            description: '질문이 소득세나 공제액 계산을 요구하는지 여부'
          },
          annualSalary: {
            type: 'NUMBER',
            description: '연봉 또는 총급여액 (원 단위). 질문에 월급(예: 300만원)이 주어지면 12를 곱해 연봉(36000000)으로 변환해 적어주십시오. 만원 단위인 경우 원 단위로 환산하십시오.'
          },
          hasSpouse: {
            type: 'BOOLEAN',
            description: '배우자 공제 대상 여부 (배우자가 있다는 언급이 있으면 true)'
          },
          numberOfDependents: {
            type: 'NUMBER',
            description: '본인 및 배우자를 제외한 부양가족 수 (예: 자녀 2명 -> 2)'
          },
          numberOfElderly: {
            type: 'NUMBER',
            description: '만 70세 이상인 경로우대 부양가족 수'
          },
          numberOfDisabled: {
            type: 'NUMBER',
            description: '장애인인 부양가족 수'
          },
          isSingleParent: {
            type: 'BOOLEAN',
            description: '한부모 공제 대상 여부'
          },
          isFemaleHeadOfHouseholdWithLowIncome: {
            type: 'BOOLEAN',
            description: '여성이면서 종합소득 3천만원 이하의 세대주 또는 배우자 있는 여성 (부녀자 공제 대상 여부)'
          }
        },
        required: ['isTaxCalculation']
      }
    }
  };

  try {
    const response = await fetchGeminiWithFallback(bodyPayload);

    if (!response.ok) {
      return { isTaxCalculation: false };
    }

    const result: any = await response.json();
    const textOutput = result.candidates[0].content.parts[0].text;
    return JSON.parse(textOutput);
  } catch (e) {
    console.error('Error extracting tax parameters:', e);
    return { isTaxCalculation: false };
  }
}
