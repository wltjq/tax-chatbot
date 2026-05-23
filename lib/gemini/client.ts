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
async function fetchGeminiWithFallback(bodyPayload: any, preferredModels?: string[]): Promise<Response | null> {
  const fallbackModels = preferredModels || [
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-2.5-flash'
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
1. 세무, 세금과 완전히 무관한 질문(예: 일상 대화, 프로그래밍, 요리 등)에는 "해당 질문은 세무 상담 범위를 벗어납니다."라고만 답변하고 다른 내용은 작성하지 마십시오.
2. 질문에 대한 근거를 제공된 소득세법 조문(Context)에서 찾을 수 있는 경우, 해당 조문에 기반하여 상세히 답변하고 반드시 참조한 조문 번호를 명시하십시오.
3. 제공된 조문에서 근거를 찾을 수 없지만 질문이 세무(예: 종합소득세 신고 기간, 홈택스 이용법 등)와 관련된 경우, 당신의 자체 지식으로 답변하되 반드시 아래의 [Fallback 답변 형식]을 엄격히 준수하여 답변의 출처가 법령 RAG가 아님을 명확히 하십시오.
4. 비전문가도 쉽게 이해할 수 있도록 친절하고 평이한 한국어 경어체로 서술하십시오.
5. 계산 모듈의 실행 결과(Calculation Result)가 입력으로 주어지면, 해당 계산 결과를 상세한 산출 과정과 함께 표(table)로 정리하여 답변에 포함시켜 설명해주십시오.
6. 답변을 위해 조문을 참조한 경우에만 citations 배열에 조문들을 추출하여 구조화해주십시오. 자체 지식으로 Fallback 답변을 작성한 경우 citations는 빈 배열([])로 반환하십시오.

[Fallback 답변 형식] (조문에서 근거를 찾지 못한 경우 반드시 아래 템플릿 사용)
---
⚠️ 소득세법 조문에서 직접적인 근거를 찾지 못했습니다.

[일반 세무 안내]
(당신의 자체 지식을 활용한 세무 안내 작성)

📌 정확한 절차 및 최신 정보는 국세청 홈택스를 반드시 확인하세요.
---

[답변 작성 규칙]
1. 반드시 마크다운 형식을 사용하세요.
2. 각 단계는 번호 목록으로 구분하고 줄바꿈을 충분히 활용하세요.
3. 아래 이모티콘을 항목 성격에 맞게 적극 활용하세요:
   - 🧮 계산 단계
   - 📋 최종 결과 요약
   - ⚠️ 주의사항 또는 한계
   - ✅ 정확한 항목
   - 📖 법령 근거
4. 문단과 문단 사이는 반드시 빈 줄로 구분하세요.`;

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
  
  // Sanitize history to ensure strict user -> model sequence
  const sanitizedHistory = [];
  let expectedRole = 'user';
  for (const msg of history) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (role === expectedRole) {
      sanitizedHistory.push(msg);
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    }
  }
  if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === 'user') {
    sanitizedHistory.pop();
  }

  for (const msg of sanitizedHistory) {
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
      },
      maxOutputTokens: 1000,
      temperature: 0.1
    }
  };

  // generateTaxAnswer prefers gemini-flash-latest to maximize output quality and splits rate limit with parameters extraction
  const response = await fetchGeminiWithFallback(bodyPayload, ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']);

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
      },
      maxOutputTokens: 200,
      temperature: 0.1
    }
  };

  try {
    const response = await fetchGeminiWithFallback(bodyPayload, ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash']);

    if (!response || !response.ok) {
      return { isTaxCalculation: false };
    }

    const result: any = await response.json();
    try {
      const textOutput = result.candidates[0].content.parts[0].text;
      return JSON.parse(textOutput);
    } catch (parseError) {
      console.error('Failed to parse tax parameters from Gemini:', parseError);
      return { isTaxCalculation: false };
    }
  } catch (e) {
    console.error('Error extracting tax parameters:', e);
    return { isTaxCalculation: false };
  }
}

/**
 * Helper to extract citations from generated text by matching with input context articles
 */
export function extractCitationsFromText(text: string, contextArticles: TaxLawMatch[]): Citation[] {
  if (text.includes('소득세법 조문에서 직접적인 근거를 찾지 못했습니다')) {
    return [];
  }
  return contextArticles
    .filter(a => {
      const cleanArticle = a.article.replace(/\s+/g, '');
      const cleanText = text.replace(/\s+/g, '');
      
      // Match "제47조" or "47조"
      const numMatch = a.article.match(/\d+/);
      const numOnly = numMatch ? numMatch[0] : '';
      
      return cleanText.includes(cleanArticle) || (numOnly && cleanText.includes(numOnly + '조'));
    })
    .map(a => ({
      article: a.article,
      content: a.content
    }));
}

/**
 * Generates a streaming tax answer from Gemini
 */
export async function* generateTaxAnswerStream(
  query: string,
  contextArticles: TaxLawMatch[],
  history: ChatHistoryMessage[],
  calculationResult?: string
): AsyncGenerator<string, void, unknown> {
  if (!geminiApiKey || geminiApiKey.startsWith('your_')) {
    throw new Error('GEMINI_API_KEY is not set. Please set it in .env.local');
  }

  const systemInstruction = `당신은 대한민국 소득세법에 기반한 전문 AI 세무 상담사입니다.
[기본 규칙]
1. 세무, 세금과 완전히 무관한 질문(예: 일상 대화, 프로그래밍, 요리 등)에는 "해당 질문은 세무 상담 범위를 벗어납니다."라고만 답변하고 다른 내용은 작성하지 마십시오.
2. 질문에 대한 근거를 제공된 소득세법 조문(Context)에서 찾을 수 있는 경우, 해당 조문에 기반하여 상세히 답변하고 반드시 참조한 조문 번호를 명시하십시오.
3. 제공된 조문에서 근거를 찾을 수 없지만 질문이 세무(예: 종합소득세 신고 기간, 홈택스 이용법 등)와 관련된 경우, 당신의 자체 지식으로 답변하되 반드시 아래의 [Fallback 답변 형식]을 엄격히 준수하여 답변의 출처가 법령 RAG가 아님을 명확히 하십시오.
4. 비전문가도 쉽게 이해할 수 있도록 친절하고 평이한 한국어 경어체로 서술하십시오.
5. 계산 모듈의 실행 결과(Calculation Result)가 입력으로 주어지면, 해당 계산 결과를 상세한 산출 과정과 함께 표(table)로 정리하여 답변에 포함시켜 설명해주십시오.
6. 답변을 위해 조문을 참조한 경우, 텍스트 중간이나 끝에 인용한 조문명(예: 소득세법 제47조)을 반드시 명시하십시오.

[Fallback 답변 형식] (조문에서 근거를 찾지 못한 경우 반드시 아래 템플릿 사용)
---
⚠️ 소득세법 조문에서 직접적인 근거를 찾지 못했습니다.

[일반 세무 안내]
(당신의 자체 지식을 활용한 세무 안내 작성)

📌 정확한 절차 및 최신 정보는 국세청 홈택스를 반드시 확인하세요.
---

[답변 작성 규칙]
1. 반드시 마크다운 형식을 사용하세요.
2. 각 단계는 번호 목록으로 구분하고 줄바꿈을 충분히 활용하세요.
3. 아래 이모티콘을 항목 성격에 맞게 적극 활용하세요:
   - 🧮 계산 단계
   - 📋 최종 결과 요약
   - ⚠️ 주의사항 또는 한계
   - ✅ 정확한 항목
   - 📖 법령 근거
4. 문단과 문단 사이는 반드시 빈 줄로 구분하세요.`;

  const contextStr = contextArticles.length > 0 
    ? contextArticles.map(a => `[조문] ${a.article} (${a.title})\n${a.content}`).join('\n\n')
    : '제공된 조문 없음';

  const calcStr = calculationResult ? `\n\n[세금 계산 연산 결과]\n${calculationResult}` : '';

  const userMessageContent = `---
[Context 소득세법 조문]
${contextStr}${calcStr}
---
[사용자 질문]
${query}`;

  const apiContents = [];
  
  // Sanitize history to ensure strict user -> model sequence
  const sanitizedHistory = [];
  let expectedRole = 'user';
  for (const msg of history) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (role === expectedRole) {
      sanitizedHistory.push(msg);
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    }
  }
  if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === 'user') {
    sanitizedHistory.pop();
  }

  for (const msg of sanitizedHistory) {
    let msgText = msg.content;
    apiContents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msgText }]
    });
  }

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
      maxOutputTokens: 1000,
      temperature: 0.1
    }
  };

  const fallbackModels = [
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-2.5-flash'
  ];

  let response: Response | null = null;
  const maxRetries = 2;
  const retryDelay = 2000;

  for (const currentModel of fallbackModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:streamGenerateContent?key=${geminiApiKey}`;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });

        if (response.ok) {
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('Response body reader is not available');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            let braceCount = 0;
            let inString = false;
            let escapeNext = false;
            let startIdx = -1;
            let lastEndIdx = 0;

            for (let i = 0; i < buffer.length; i++) {
              const char = buffer[i];

              if (escapeNext) {
                escapeNext = false;
                continue;
              }

              if (char === '\\') {
                escapeNext = true;
                continue;
              }

              if (char === '"') {
                inString = !inString;
                continue;
              }

              if (!inString) {
                if (char === '{') {
                  if (braceCount === 0) {
                    startIdx = i;
                  }
                  braceCount++;
                } else if (char === '}') {
                  braceCount--;
                  if (braceCount === 0 && startIdx !== -1) {
                    const jsonStr = buffer.slice(startIdx, i + 1);
                    try {
                      const parsed = JSON.parse(jsonStr);
                      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                      if (text) {
                        yield text;
                      }
                    } catch (e) {
                      // skip parsing errors on incomplete chunks
                    }
                    lastEndIdx = i + 1;
                    startIdx = -1;
                  }
                }
              }
            }
            buffer = buffer.slice(lastEndIdx);
          }
          return;
        }

        if (response.status === 503 || response.status === 429) {
          if (attempt === maxRetries - 1) break;
          const waitTime = retryDelay * Math.pow(2, attempt) + Math.random() * 1000;
          console.warn(`Gemini stream API (${currentModel}) returned ${response.status}. Retrying in ${(waitTime / 1000).toFixed(1)}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          break;
        }
      } catch (e) {
        if (attempt === maxRetries - 1) break;
        const waitTime = retryDelay * Math.pow(2, attempt);
        console.warn(`Fetch stream to Gemini (${currentModel}) failed: ${e}. Retrying in ${(waitTime / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    console.warn(`Model ${currentModel} failed or exhausted retries for stream. Failing over...`);
  }

  throw new Error('All Gemini models failed to generate content stream.');
}

