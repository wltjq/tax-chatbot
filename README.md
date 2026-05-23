# 🏛️ 대한민국 소득세법 AI 세무 챗봇 (Tax Chatbot)

> 사용자의 소득 수준과 가족 구성을 분석하여 예상 근로소득세를 계산하고,  
> 대한민국 소득세법(RAG)을 기반으로 전문적인 세무 상담을 제공하는 AI 챗봇입니다.

---

## ✨ 주요 기능 (Key Features)

### 🧮 정밀한 세액 계산 엔진
연봉, 부양가족 수 등을 입력받아 근로소득공제, 기본공제, 추가공제(경로우대, 장애인, 한부모, 부녀자) 및  
**근로소득세액공제 하한선 규정 완벽 반영**을 단계별로 자동 계산합니다.

### 🔍 지식 기반 RAG (검색 증강 생성)
사용자의 질문과 가장 연관성 높은 실제 소득세법 조문을 **Pinecone Vector DB**에서 검색한 뒤,  
LLM이 이를 근거로 환각(Hallucination) 없는 정확한 답변을 생성합니다.

### 🔄 멀티 모델 자동 우회 (Waterfall Fallback)
Google Gemini API의 호출 한도(Rate Limit) 초과 시, 서버가 다운되지 않고  
사전에 정의된 다음 순위의 모델로 자동 우회하여 **무중단 서비스**를 제공합니다.

```
gemini-2.5-flash → gemini-2.5-pro → gemini-1.5-pro
```

### 🛡️ 하이브리드 데이터베이스
**Supabase**를 메인 대화 기록 DB로 사용하며,  
연결 실패 시 로컬 파일(JSON) DB로 자동 전환되는 안전장치를 갖추고 있습니다.

### 🔒 개인정보 자동 마스킹
대화 기록을 DB에 저장하기 전 주민등록번호, 전화번호 등  
민감한 개인정보(PII)를 자동으로 마스킹 처리하여 보안성을 높였습니다.

---

## 🛠️ 기술 스택 (Tech Stack)

| 영역 | 기술 |
|------|------|
| **Frontend** | Next.js 14, React, TailwindCSS, Lucide (Icons) |
| **Backend** | Next.js API Routes (Serverless) |
| **AI & RAG** | Google Gemini API (2.5/1.5), Pinecone (Vector DB), LangChain |
| **Database** | Supabase (PostgreSQL), Local File-based Fallback DB |

---

## ⚙️ 환경 변수 설정 (.env.local)

프로젝트 루트 디렉토리에 `.env.local` 파일을 생성하고 아래 값들을 채워주세요.

```env
# Gemini LLM & Embeddings API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Pinecone Vector DB API Key
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX=tax-law-index

# Supabase (Optional: 없으면 자동으로 Local DB를 사용합니다)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## 🚀 시작하기 (Getting Started)

### 1. 패키지 설치
```bash
npm install
```

### 2. 세법 데이터베이스 인덱싱 (최초 1회 필수)
> ⚠️ **주의**: 이 단계를 건너뛰면 Pinecone 데이터베이스가 비어있게 되어 챗봇이 세법 조문을 찾지 못하며, 정상적인 근거 기반 답변 생성이 불가능합니다! 반드시 실행해 주세요.

```bash
npm run index
```

### 3. 개발 서버 실행
```bash
npm run dev
```

### 4. 브라우저 접속
`http://localhost:3000` 에 접속하여 챗봇을 사용합니다.

---

## 🧠 아키텍처 주요 로직

| 파일 | 설명 |
|------|------|
| `lib/gemini/client.ts` | 멀티 모델 Fallback 및 재시도 로직이 포함된 LLM 코어 모듈 |
| `lib/tax-calculator/index.ts` | 소득세법 제59조 등 예외 규정을 포함한 정밀 소득세 계산 모듈 |
| `lib/pinecone/client.ts` | 세법 조문 Vector Search 엔진 |
| `app/api/chat/route.ts` | 프롬프트 조립 및 RAG 파이프라인 통합 라우트 |

---

## 📋 주요 세법 반영 내역

- ✅ 소득세법 제47조 (근로소득공제)
- ✅ 소득세법 제59조 제2항 제2호 (근로소득세액공제 + **66만원 하한선 단서조항**)
- ✅ 소득세법 제59조의4 (표준세액공제)
- ✅ 누진세율 구조 (종합소득세 일반 세율표)

---

> ⚠️ 본 상담 결과는 참고용이며 실제 법적 효력은 세무사와 상담하시기 바랍니다.
