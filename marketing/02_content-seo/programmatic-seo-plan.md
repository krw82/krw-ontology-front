# KRW Ontology 프로그래매틱 SEO 전략

*작성일: 2026-05-23*
*목표: 회사별 랜딩페이지와 질문 템플릿 페이지를 대량 생성하여 롱테일 키워드 트래픽 확보*

---

## 1. 프로그래매틱 SEO 개요

### 1.1 전략 요약

KRW Ontology의 프로그래매틱 SEO는 두 가지 페이지 유형에 집중합니다:

1. **회사별 랜딩페이지** (`/companies/[ticker]`) — 각 상장 기업별 고유 랜딩
2. **질문 템플릿 페이지** (`/questions/[topic]`) — 분석 주제별 질문 가이드

이 두 유형을 자동 생성하여 1,000개 이상의 SEO 페이지를 확보합니다.

### 1.2 기대 효과

| 지표 | 6개월 | 12개월 |
|------|-------|--------|
| 총 페이지 수 | 200-500 | 1,000+ |
| 롱테일 키워드 노출 | 500+ | 2,000+ |
| 월 유기 트래픽 (프로그래매틱) | 500 | 3,000+ |
| 회사 페이지 → 가입 전환 | 2% | 3% |

---

## 2. 회사별 랜딩페이지

### 2.1 데이터 소스 및 생성 로직

**필요 데이터:**
```typescript
interface CompanyPageData {
  ticker: string           // "AAPL"
  name: string             // "Apple Inc."
  nameKo: string           // "애플"
  sector: string           // "Technology"
  industry: string         // "Consumer Electronics"
  description: string      // 회사 설명 (1-2문장)
  latestFiling: {
    type: "10-K" | "10-Q"
    period: string         // "2025-12-28"
    fiscalYear: number
  }
  highlights: {
    revenue: string         // "최근 연간 매출: $391B"
    segments: string[]      // ["iPhone", "Services", "Mac", ...]
    topRisks: string[]      // ["공급망 리스크", "규제 리스크", ...]
  }
  competitors: {
    ticker: string
    name: string
  }[]
  questionTemplates: QuestionTemplate[]
}
```

**생성 트리거:**
- 온톨로지 인덱스에 새 회사가 추가될 때 자동 생성
- 새 10-K/10-Q가 인덱싱될 때 페이지 업데이트
- 최소 데이터 기준 충족 시에만 공개 (회사명, 최신 공시, 세그먼트 정보)

### 2.2 페이지 콘텐츠 템플릿

```markdown
---
title: "{nameKo} ({ticker}) 공시 분석 — KRW Ontology"
description: "{nameKo} SEC 공시 기반 AI 분석. 원문 근거와 함께 매출 동인, 리스크, 세그먼트를 분석하세요."
canonical: "https://krwontology.com/companies/{ticker}"
---

<!-- 브레드크럼 -->
홈 > 회사 목록 > {nameKo}

<!-- H1 -->
{nameKo} ({ticker}) 공시 분석

<!-- 회사 설명 -->
{nameKo}({industry})의 SEC 공시를 질문으로 분석하세요.
답변마다 원문 근거가 포함됩니다.

<!-- 최신 공시 정보 -->
## 최신 공시
- {latestFiling.type} | 기간: {latestFiling.period}
- 주요 세그먼트: {highlights.segments.join(', ')}

<!-- 추천 분석 질문 -->
## 이런 질문으로 시작해보세요
1. "{nameKo}의 매출 성장 동인을 최근 공시 기준으로 분석해줘"
2. "{nameKo}의 주요 리스크 요인을 최근 10-K에서 정리해줘"
3. "{nameKo}의 {highlights.segments[0]} 세그먼트 실적 변화를 보여줘"
4. "{nameKo}의 실적 동인과 리스크를 연결해서 설명해줘"

[무료로 {nameKo} 분석 시작]

<!-- 핵심 데이터 -->
## {nameKo} 공시 핵심 포인트
- {highlights.revenue}
- 주요 리스크: {highlights.topRisks.join(', ')}

<!-- 관련 분석 토픽 -->
## 관련 분석 토픽
- [매출 동인 분석 →](/questions/margin-driver)
- [리스크 요인 분석 →](/questions/risk-factors)
- [세그먼트 분석 →](/questions/segment-analysis)

<!-- 동종 업계 회사 -->
## 같은 업계의 다른 기업
{competitors.map(c => `- [${c.name}](${c.ticker})`)}

<!-- 하단 CTA -->
{nameKo}의 공시를 근거와 함께 분석하세요.
[무료로 첫 분석 시작]
```

### 2.3 회사 우선순위 (1단계)

한국 투자자 관심도 + 시가총액 기준 상위 50개:

**1순위 (10개, 즉시 생성):**

| 티커 | 회사명 | 한국어명 | 이유 |
|-------|--------|----------|------|
| AAPL | Apple Inc. | 애플 | 최고 관심 |
| MSFT | Microsoft Corp. | 마이크로소프트 | 최고 관심 |
| GOOGL | Alphabet Inc. | 구글 | 최고 관심 |
| AMZN | Amazon.com Inc. | 아마존 | 최고 관심 |
| NVDA | NVIDIA Corp. | 엔비디아 | AI 테마 최고 인기 |
| TSLA | Tesla Inc. | 테슬라 | 한국 개미 최고 관심 |
| META | Meta Platforms | 메타 | 플랫폼 관심 |
| NFLX | Netflix Inc. | 넷플릭스 | 콘텐츠 테마 |
| AMD | AMD Inc. | AMD | 반도체 테마 |
| CRM | Salesforce Inc. | 세일즈포스 | SaaS 테마 |

**2순위 (40개, Phase 2 생성):**
- 반도체: AVGO, INTC, QCOM, TXN, MU
- 클라우드/SaaS: NOW, SNOW, PLTR, DDOG, NET
- 핀테크/결제: V, MA, PYPL, SQ
- 이커머스/소비: COST, WMT, TGT, HD
- 헬스케어: JNJ, UNH, PFE, LLY, MRK
- 에너지/산업: XOM, CVX, CAT, BA
- 금융: JPM, BAC, GS, MS
- 엔터테인먼트: DIS, SONY, EA
- 자동차/모빌리티: TM, F, GM, RIVN
- 기타 한국 관심: COIN, RBLX, UBER, ABNB

**3순위 (500개, Phase 3):**
- S&P 500 전체 커버리지
- 한국어 투자자가 자주 검색하는 중소형주

### 2.4 품질 기준

최소 데이터 기준을 충족하지 않는 회사는 페이지를 생성하지 않습니다:

| 항목 | 최소 기준 |
|------|-----------|
| 회사명 + 한국어명 | 필수 |
| 최신 공시 (10-K 또는 10-Q) | 필수 |
| 산업 분류 | 필수 |
| 세그먼트 정보 | 권장 (없으면 섹션 생략) |
| 리스크 정보 | 권장 (없으면 섹션 생략) |
| 경쟁사 정보 | 권장 (없으면 섹션 생략) |

---

## 3. 질문 템플릿 페이지

### 3.1 템플릿 데이터 구조

```typescript
interface QuestionTemplate {
  slug: string             // "margin-driver"
  titleKo: string          // "매출 동인 분석 질문"
  titleEn: string          // "Revenue Driver Analysis Questions"
  description: string      // 페이지 설명
  questions: {
    template: string       // "{회사명}의 매출 성장 동인을..."
    category: string       // "growth", "margin", "risk", "segment"
    difficulty: "basic" | "intermediate" | "advanced"
  }[]
  relatedTopics: string[]  // 관련 토픽 slug
  relatedUseCases: string[] // 관련 유스케이스
}
```

### 3.2 질문 토픽 목록

**기본 토픽 (20개, Phase 1-2):**

| slug | 제목 | 카테고리 | 난이도 |
|------|------|----------|--------|
| margin-driver | 매출 동인 분석 질문 | growth | 기본 |
| revenue-growth | 매출 성장 분석 질문 | growth | 기본 |
| risk-factors | 리스크 요인 분석 질문 | risk | 기본 |
| segment-analysis | 세그먼트 분석 질문 | segment | 기본 |
| competitive-position | 경쟁 우위 분석 질문 | competitive | 중급 |
| cost-structure | 비용 구조 분석 질문 | margin | 중급 |
| cash-flow | 현금흐름 분석 질문 | financial | 중급 |
| management-discussion | 경영진 논의 분석 질문 | qualitative | 중급 |
| eps-analysis | 주당순이익 분석 질문 | financial | 기본 |
| dividend-sustainability | 배당 지속성 분석 질문 | financial | 중급 |
| thesis-check | 투자 thesis 검증 질문 | thesis | 중급 |
| new-product | 신제품/신사업 분석 질문 | growth | 기본 |
| regulatory-risk | 규제 리스크 분석 질문 | risk | 중급 |
| supply-chain | 공급망 분석 질문 | operational | 중급 |
| market-expansion | 시장 확장 분석 질문 | growth | 기본 |
| margin-trend | 이익률 추세 분석 질문 | margin | 중급 |
| debt-analysis | 부채 분석 질문 | financial | 중급 |
| acquisition-impact | M&A 영향 분석 질문 | event | 고급 |
| seasonality | 계절성 분석 질문 | operational | 기본 |
| guidance-analysis | 가이던스 분석 질문 | forward | 고급 |

**확장 토픽 (30개, Phase 3):**

| slug | 제목 | 카테고리 |
|------|------|----------|
| customer-concentration | 고객 집중도 분석 | risk |
| pricing-power | 가격 결정력 분석 | competitive |
| working-capital | 운전자본 분석 | financial |
| capex-analysis | 설비투자 분석 | financial |
| talent-retention | 인재 유지 분석 | qualitative |
| ip-portfolio | 지적재산 분석 | competitive |
| esg-analysis | ESG 분석 | qualitative |
| sector-comparison | 업계 비교 분석 | competitive |
| free-cash-flow | 잉여현금흐름 분석 | financial |
| return-on-capital | 자본수익률 분석 | financial |
| earnings-quality | 이익 품질 분석 | financial |
| off-balance-sheet | 표외부채 분석 | financial |
| related-party | 관계사 거래 분석 | risk |
| litigation-risk | 소송 리스크 분석 | risk |
| currency-exposure | 환율 노출 분석 | risk |
| interest-rate | 금리 민감도 분석 | risk |
| commodity-exposure | 원자재 노출 분석 | risk |
| subscription-metrics | 구독 지표 분석 | operational |
| saas-metrics | SaaS 지표 분석 | operational |
| retail-metrics | 소매 지표 분석 | operational |
| biotech-pipeline | 바이오 파이프라인 분석 | industry |
| bank-metrics | 은행 지표 분석 | industry |
| insurance-metrics | 보험 지표 분석 | industry |
| reit-analysis | REIT 분석 | industry |
| energy-reserves | 에너지 매장량 분석 | industry |
| telecom-metrics | 통신 지표 분석 | industry |
| auto-metrics | 자동차 지표 분석 | industry |
| semiconductor-cycle | 반도체 사이클 분석 | industry |
| cloud-metrics | 클라우드 지표 분석 | industry |
| ad-revenue | 광고 수익 분석 | operational |

### 3.3 질문 템플릿 페이지 콘텐츠

```markdown
---
title: "{titleKo} — KRW Ontology"
description: "{titleKo} 모음. SEC 공시 기반으로 {category} 분석을 위한 질문 템플릿."
canonical: "https://krwontology.com/questions/{slug}"
---

<!-- 브레드크럼 -->
홈 > 질문 템플릿 > {titleKo}

<!-- H1 -->
{titleKo}

<!-- 설명 -->
{description}. 각 질문을 회사명과 함께 입력하면,
공시 원문에서 근거를 찾아 답변합니다.

<!-- 질문 리스트 -->
## 기본 질문
{questions.filter(q => q.difficulty === 'basic').map(q => (
  "- \"{q.template}\""
)}

## 심화 질문
{questions.filter(q => q.difficulty !== 'basic').map(q => (
  "- \"{q.template}\""
)}

[질문으로 분석 시작 →]

<!-- 이 질문으로 분석 가능한 회사 -->
## 이 질문으로 분석할 수 있는 회사
{sampledCompanies.slice(0, 6).map(c => (
  "- [{c.nameKo} ({c.ticker})](/companies/{c.ticker})"
)}

<!-- 관련 분석 토픽 -->
## 관련 분석 토픽
{relatedTopics.map(t => (
  "- [{t.titleKo}](/questions/{t.slug})"
)}

<!-- 관련 유스케이스 -->
## 관련 유스케이스
{relatedUseCases.map(u => (
  "- [{u.title}](/use-cases/{u.slug})"
))}
```

---

## 4. 구현 아키텍처

### 4.1 Next.js 라우트 구조

```
src/app/
├── companies/
│   ├── page.tsx              # 회사 목록 (수동)
│   └── [ticker]/
│       └── page.tsx          # 회사 랜딩 (프로그래매틱)
│           - generateStaticParams()로 정적 생성
│           - generateMetadata()로 동적 메타
│           - ISR로 공시 업데이트 시 재생성
└── questions/
    └── [topic]/
        └── page.tsx          # 질문 템플릿 (프로그래매틱)
            - generateStaticParams()
            - generateMetadata()
```

### 4.2 정적 생성 전략

```typescript
// src/app/companies/[ticker]/page.tsx
export const dynamicParams = true; // 새 회사 추가 시 동적 렌더링
export const revalidate = 86400;   // ISR: 24시간마다 재검증

export async function generateStaticParams() {
  const companies = await listIndexedCompanies();
  return companies.map(c => ({ ticker: c.ticker }));
}

export async function generateMetadata({ params }: { params: { ticker: string } }) {
  const company = await getCompanyData(params.ticker);
  return {
    title: `${company.nameKo} (${params.ticker}) 공시 분석 — KRW Ontology`,
    description: `${company.nameKo} SEC 공시 기반 AI 분석. 원문 근거와 함께 매출 동인, 리스크, 세그먼트를 분석하세요.`,
    alternates: { canonical: `https://krwontology.com/companies/${params.ticker}` },
    openGraph: {
      title: `${company.nameKo} (${params.ticker}) 공시 분석`,
      description: `SEC 공시 기반으로 ${company.nameKo}를 분석하세요.`,
    },
  };
}
```

### 4.3 sitemap에 프로그래매틱 페이지 포함

```typescript
// src/app/sitemap.ts
export default async function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://krwontology.com';

  // 정적 페이지
  const staticPages = [...];

  // 회사 페이지
  const companies = await listIndexedCompanies();
  const companyPages = companies.map(c => ({
    url: `${baseUrl}/companies/${c.ticker}`,
    lastModified: c.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // 질문 템플릿 페이지
  const topics = await getQuestionTopics();
  const topicPages = topics.map(t => ({
    url: `${baseUrl}/questions/${t.slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...companyPages, ...topicPages];
}
```

---

## 5. 품질 관리

### 5.1 콘텐츠 품질 기준

| 항목 | 기준 |
|------|------|
| 중복 콘텐츠 | 동일 산업 회사 간 겹치는 텍스트 < 30% |
| 최소 콘텐츠 | 각 페이지 500자 이상의 고유 콘텐츠 |
| 데이터 신선도 | 최신 공시 기반, ISR로 24시간 내 업데이트 |
| 내부 링크 | 각 페이지에서 3개 이상의 내부 링크 |
| 투자 면책 | 모든 회사 페이지에 면책 문구 포함 |

### 5.2 중복 콘텐츠 방지

**문제:** 같은 산업의 회사 페이지들이 비슷한 내용을 가질 수 있음

**해결책:**
1. **회사별 고유 데이터 강조** — 매출, 세그먼트, 리스크 등 구체적 수치 차이화
2. **템플릿 문장에 회사명 삽입** — "{회사명}의 핵심 리스크는..."
3. **동적 질문 생성** — 회사별 세그먼트, 리스크 기반으로 질문 자동 생성
4. **비교 섹션** — 동종 업계 회사와의 비교 링크로 차별화

### 5.3 품질 검증 프로세스

1. 페이지 생성 전 최소 데이터 기준 확인
2. 생성 후 메타데이터 검증 (제목, 설명, canonical)
3. 내부 링크 연결 확인
4. Google Search Console에서 색인 상태 모니터링
5. 월 1회 품질 감사 — 트래픽 없는 페이지 원인 분석

---

## 6. 확장 로드맵

### Phase 1 (1-2개월)
- 상위 50개 회사 랜딩페이지 생성
- 기본 20개 질문 템플릿 페이지 생성
- sitemap에 포함

### Phase 2 (3-6개월)
- S&P 500 전체 회사 확대 (500개)
- 질문 템플릿 50개 확대
- 업계별 비교 페이지 추가

### Phase 3 (7-12개월)
- 1,000개 이상 회사 랜딩페이지
- 질문 템플릿 100개
- 회사 × 토픽 교차 페이지 (선택)

---

## 7. 성과 측정

| 지표 | 측정 방법 | Phase 1 목표 | Phase 3 목표 |
|------|-----------|-------------|-------------|
| 색인 페이지 수 | Search Console | 70 | 1,100+ |
| 회사 페이지 조회수 | GA4 | 월 200 | 월 2,000+ |
| 질문 템플릿 조회수 | GA4 | 월 100 | 월 500+ |
| 프로그래매틱 → 가입 | Supabase | 2% | 3%+ |
| 롱테일 키워드 노출 | Search Console | 100 | 1,000+ |
