# KRW Ontology SEO 전략

*작성일: 2026-05-23*
*상태: 프리런치 — 기술 SEO 기반 구축 + 콘텐츠 SEO 실행*

---

## 1. 현재 사이트 SEO 감사 요약

### 1.1 기술 SEO 현황

| 항목 | 상태 | 심각도 |
|------|------|--------|
| robots.txt / robots.ts | **미구현** — 크롤러 제어 불가 | 높음 |
| sitemap.ts | **미구현** — XML 사이트맵 없음 | 높음 |
| 페이지별 metadata | 홈, 프라이버시, 약관만 존재. 회사, 채팅, 로그인 누락 | 높음 |
| Open Graph / Twitter Card | **미설정** — 공유 시 미리보기 없음 | 중간 |
| canonical URL | 명시적 설정 없음 | 중간 |
| JSON-LD 구조화된 데이터 | **미구현** | 중간 |
| HTTPS / 보안 헤더 | HSTS, CSP, X-Frame-Options 설정됨 | 양호 |
| html lang="ko" | 설정됨 | 양호 |
| 한국어 폰트 | 시스템 폰트 스택 사용, 원격 폰트 의존 없음 | 양호 |
| 모바일 반응형 | flex/grid 기반, min-h-[100dvh] 사용 | 양호 |
| Core Web Vitals | 측정 전 — Next.js standalone + SWC 최적화 기대 | 측정 필요 |
| 내부 링크 구조 | 홈 → 채팅/회사목록/프라이버시/약관만 연결 | 낮음 |

### 1.2 주요 발견 사항

**긴급 수정 필요:**
1. `robots.ts`와 `sitemap.ts`가 없어 Google이 사이트를 효율적으로 크롤링할 수 없음
2. 회사 페이지, 채팅 페이지, 로그인 페이지에 metadata가 없어 검색결과에 제목/설명이 제대로 표시되지 않음
3. Open Graph 태그가 없어 소셜 공유 시 미리보기가 빈약함

**개선 필요:**
4. 전체 페이지에 canonical URL이 명시되지 않음
5. JSON-LD 구조화된 데이터가 전혀 없음
6. 내부 링크가 최소한으로, 홈 외의 진입 페이지가 없음
7. 블로그, 유스케이스, 프로그래매틱 페이지가 없어 콘텐츠 SEO 기반이 부재

---

## 2. 키워드 리서치 및 우선순위

### 2.1 1차 키워드 (의도: 제품 인지 및 비교)

한국어 투자자가 실제 검색하는 표현 중심.

| 키워드 | 월간 검색량 추정 | 난이도 | 의도 | 우선순위 |
|--------|------------------|--------|------|----------|
| 기업 공시 AI 분석 | 중간 | 중간 | 제품 탐색 | P0 |
| 10-K 분석 AI | 중간 | 낮음~중간 | 제품 탐색 | P0 |
| SEC 공시 분석 | 중간 | 중간 | 정보/탐색 | P0 |
| 미국 주식 공시 분석 | 중간 | 중간 | 정보 | P0 |
| 10-K 요약 | 중간 | 낮음 | 도구 탐색 | P1 |
| 10-Q 분석 | 낮음~중간 | 낮음 | 정보 | P1 |
| 미국 기업 리서치 툴 | 낮음 | 낮음 | 제품 비교 | P1 |
| 공시 리서치 AI | 낮음 | 낮음 | 제품 탐색 | P1 |

### 2.2 2차 키워드 (의도: 사용법 및 교육)

| 키워드 | 월간 검색량 추정 | 난이도 | 의도 | 우선순위 |
|--------|------------------|--------|------|----------|
| 10-K 읽는 법 | 높음 | 중간 | 교육 | P0 |
| SEC 공시 확인법 | 중간 | 낮음 | 교육 | P0 |
| 기업 공시 분석 방법 | 중간 | 낮음 | 교육 | P1 |
| 10-K 리스크 요인 분석 | 낮음 | 낮음 | 정보 | P1 |
| 세그먼트별 매출 분석 | 낮음 | 낮음 | 정보 | P1 |
| 미국 기업 실적 동인 분석 | 낮음 | 낮음 | 정보 | P2 |
| equity research AI | 낮음 | 중간 | 영문 탐색 | P2 |
| SEC filing analysis tool | 낮음 | 중간 | 영문 탐색 | P2 |

### 2.3 3차 키워드 (의도: 프로그래매틱 — 회사명 + 질문)

| 키워드 패턴 | 예상 트래픽 | 난이도 | 우선순위 |
|-------------|-------------|--------|----------|
| {회사명} 10-K 분석 | 페이지당 낮음, 볼륨으로 승부 | 낮음 | P1 |
| {회사명} 리스크 요인 | 페이지당 낮음 | 낮음 | P1 |
| {티커} 공시 분석 | 페이지당 낮음 | 낮음 | P2 |
| {회사명} 실적 동인 | 페이지당 낮음 | 낮음 | P2 |
| {회사명} 세그먼트 분석 | 페이지당 낮음 | 낮음 | P2 |

### 2.4 키워드 클러스터 매핑

| 클러스터 | 허브 페이지 | 스포크 페이지 |
|----------|-------------|---------------|
| 공시 분석 기초 | `/use-cases/filing-analysis` | `/blog/10k-reading-guide`, `/blog/sec-filing-basics` |
| 투자 thesis 검증 | `/use-cases/thesis-check` | `/blog/how-to-verify-investment-thesis`, `/blog/evidence-path-explained` |
| 리스크 분석 | `/use-cases/risk-factor-analysis` | `/blog/risk-factor-10k`, `/blog/company-risk-checklist` |
| 회사 리서치 | `/companies/[ticker]` | `/companies/AAPL`, `/companies/NVDA`, `/companies/TSLA` |
| 질문 템플릿 | `/questions/[topic]` | `/questions/margin-driver`, `/questions/revenue-growth` |

---

## 3. 기술 SEO 개선안

### 3.1 1단계: 크롤링 기반 구축 (1주)

**robots.ts 추가:**
```
// src/app/robots.ts
export default function robots() {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/chat/', '/login/', '/share/'] },
    ],
    sitemap: 'https://krwontology.com/sitemap.xml',
  }
}
```

- `/api/`, `/chat/`, `/login/`, `/share/`은 크롤링 차단
- 홈, 회사, 프라이버시, 약관, 유스케이스, 블로그만 크롤링 허용

**sitemap.ts 추가:**
```
// src/app/sitemap.ts
export default async function sitemap() {
  const staticPages = ['', '/companies', '/privacy', '/terms',
    '/use-cases/filing-analysis', '/use-cases/thesis-check',
    '/use-cases/risk-factor-analysis']
  // + 회사 페이지 동적 생성
  return [...staticPages, ...companyPages].map(...)
}
```

### 3.2 2단계: 페이지별 metadata 보강 (1-2주)

**홈페이지 metadata 개선:**
```typescript
export const metadata: Metadata = {
  title: 'KRW Ontology — 근거 경로가 남는 기업 공시 리서치 AI',
  description: 'SEC 공시 기반 기업 분석 AI. 10-K, 10-Q 원문 근거와 함께 투자 질문에 답변합니다. 출처 확인, 리스크 분석, 세그먼트 분석을 한 번에.',
  openGraph: {
    title: 'KRW Ontology — 근거 경로가 남는 기업 공시 리서치 AI',
    description: 'SEC 공시 기반 기업 분석 AI. 원문 근거와 함께 답변합니다.',
    url: 'https://krwontology.com',
    siteName: 'KRW Ontology',
    locale: 'ko_KR',
    type: 'website',
  },
  alternates: { canonical: 'https://krwontology.com' },
}
```

**회사 페이지 metadata:**
```typescript
export const metadata: Metadata = {
  title: '지원 회사 목록 — KRW Ontology',
  description: 'KRW Ontology에서 분석 가능한 미국 상장 기업 목록을 확인하세요. SEC 공시 기반 AI 리서치.',
  openGraph: { ... },
  alternates: { canonical: 'https://krwontology.com/companies' },
}
```

### 3.3 3단계: Core Web Vitals 최적화 (지속)

| 지표 | 목표 | 현재 추정 | 개선 방법 |
|------|------|-----------|-----------|
| LCP | < 2.5s | Next.js standalone으로 양호 예상 | 홈 히어로 이미지 최적화, 폰트 preload |
| INP | < 200ms | 측정 필요 | 질문 폼 인터랙션 최적화 |
| CLS | < 0.1 | 폰트 swap으로 약간 발생 가능 | 폰트 display: swap 유지, 레이아웃 고정 |

### 3.4 4단계: URL 정규화 및 HTTP 상태 코드

- 모든 페이지에 self-referencing canonical URL 추가
- HTTP → HTTPS 리다이렉트 확인 (HSTS 설정됨)
- www → non-www 또는 그 반대 통일
- trailing slash 일관성 유지
- 404 페이지 커스텀 구현 (검색 친화적)

---

## 4. AI 검색 엔진 최적화 (AEO/GEO)

### 4.1 AI 검색 최적화 원칙

Google AI Overview, Perplexity, ChatGPT 검색 등 AI 답변 엔진에 인용되기 위한 전략.

**핵심 원칙:**
1. **직접 정의 작성** — 각 개념을 첫 문장에 명확히 정의
2. **출처 명시** — 구체적인 공시 문장, 섹션, 기간 인용
3. **비교 구조** — "A와 B의 차이", "X를 하는 방법" 형태의 질문-답 구조
4. **한국어 + 영문 용어 병기** — "10-K (연간 보고서)", "SEC (미국 증권거래위원회)"
5. **신뢰 신호** — 한계 명시, "투자 권유 아님", 검증 가능한 사실만 서술

### 4.2 AI 인용 대상 콘텐츠 구조

각 콘텐츠는 다음 구조를 따름:

```
## {질문 형태의 제목}

{2-3문장 직접 답변 — AI가 인용하기 쉬운 형태}

### 핵심 내용
- 구체적 사실 1 (출처 포함)
- 구체적 사실 2 (출처 포함)

### 한계 및 참고
- 이 분석은 공시 기반이며 투자 권유가 아님
```

### 4.3 AI 검색 대상 헤딩 예시

- "What is evidence-backed company research?"
- "How to analyze a 10-K filing with AI"
- "SEC 공시에서 리스크 요인을 찾는 방법"
- "10-K와 10-Q의 차이점"
- "기업 공시 AI 분석이란 무엇인가"
- "How KRW Ontology provides citation-backed answers"

---

## 5. 경쟁사 SEO 분석

### 5.1 직접 경쟁

| 경쟁사 | SEO 강점 | 약점 | 우리의 기회 |
|---------|----------|------|-------------|
| 일반 LLM (ChatGPT, Claude) | 브랜드 인지도 압도 | SEC 공시 전문 도구 아님, 한국어 공시 분석 약함 | 전문성 + 한국어 + 근거 경로 |
| 붐빅 등 한국어 증권 플랫폼 | 한국 사용자 기반 | 미국 공시 심층 분석 부족, AI 리서치 기능 제한 | 미국 공시 특화 + AI 분석 |
| 영문 SEC 분석 툴 | 영문 SEO 강점 | 한국어 지원 없음 | 한국어 우선 시장 |

### 5.2 차별화 SEO 포지셔닝

- 한국어 + SEC 공시 + AI 분석 = 유니크한 키워드 조합
- "근거 경로"라는 고유 개념을 SEO 키워드로 육성
- 회사별 랜딩페이지로 롱테일 트래픽 확보

---

## 6. 12개월 SEO 로드맵

### Phase 1: 기반 구축 (1-2개월, 2026년 6-7월)

**목표:** Google 색인 생성, 기술 SEO 완성

| 주차 | 작업 | 산출물 |
|------|------|--------|
| 1-2 | robots.ts, sitemap.ts 구현 | 크롤링 기반 |
| 1-2 | 모든 페이지 metadata 보강 | 제목/설명/OG 태그 |
| 2-3 | Google Search Console 등록 | 색인 모니터링 |
| 2-3 | JSON-LD 기본 스키마 추가 | Organization, WebSite |
| 3-4 | 3개 유스케이스 페이지 런칭 | filing-analysis, thesis-check, risk |
| 4-6 | 초기 블로그 글 4-6편 발행 | 교육 콘텐츠 |

**성공 기준:**
- Google에 10개 이상 페이지 색인
- Search Console에 등록 완료
- 홈페이지 + 유스케이스 페이지 랜딩 가능

### Phase 2: 콘텐츠 확장 (3-5개월, 2026년 8-10월)

**목표:** 키워드 클러스터 구축, 블로그 트래픽 시작

| 주차 | 작업 | 산출물 |
|------|------|--------|
| 7-10 | 블로그 글 주 1편 발행 | 10-K 읽는 법, SEC 공시 기초 등 |
| 10-12 | 질문 템플릿 페이지 5-10개 | `/questions/margin-driver` 등 |
| 10-14 | 회사 랜딩페이지 20-50개 | `/companies/AAPL` 등 |
| 12-14 | FAQ 페이지 추가 | 자주 묻는 질문 + FAQPage 스키마 |

**성공 기준:**
- 블로그 월 유기 트래픽 500+
- 1차 키워드 10위권 진입 시작
- 회사별 페이지 유입 시작

### Phase 3: 프로그래매틱 확대 (6-9개월, 2026년 11월-2027년 2월)

**목표:** 프로그래매틱 SEO 대량 페이지, 롱테일 트래픽 확보

| 주차 | 작업 | 산출물 |
|------|------|--------|
| 15-20 | 회사 랜딩페이지 200-500개 확대 | 주요 S&P 500 + 한국 투자자 인기 주식 |
| 20-25 | 질문 템플릿 50-100개 확대 | 토픽별 질문 패턴 |
| 22-28 | 비교 페이지 추가 | "10-K 분석 툴 비교" 등 |
| 24-28 | 디렉토리 제출 | AI 툴 디렉토리, 한국어 SaaS 디렉토리 |

**성공 기준:**
- 월 유기 트래픽 2,000+
- 색인 페이지 500+
- 1차 키워드 5위권 진입

### Phase 4: 권위 구축 (10-12개월, 2027년 3-5월)

**목표:** 백링크 확보, 도메인 권위 상승

| 주차 | 작업 | 산출물 |
|------|------|--------|
| 29-36 | 게스트 포스트 4-8편 | 투자 커뮤니티, 핀테크 미디어 |
| 30-36 | 데이터 기반 콘텐츠 | "2027 SEC 공시 트렌드 분석" 등 |
| 32-40 | 회사 랜딩페이지 1,000개 | 전체 S&P 500 커버리지 |
| 36-40 | 콘텐츠 갱신 및 최적화 | 기존 글 업데이트, 내부 링크 강화 |

**성공 기준:**
- 월 유기 트래픽 5,000+
- 1차 키워드 3위권
- 유기 가입 월 200+

---

## 7. SEO KPI 및 측정

| 지표 | 3개월 | 6개월 | 12개월 |
|------|-------|-------|--------|
| 색인 페이지 수 | 30+ | 200+ | 1,000+ |
| 월 유기 트래픽 | 300 | 2,000 | 5,000+ |
| 1차 키워드 순위 | 10위권 진입 | 5위권 | 3위권 |
| 유기 가입 | 20/월 | 100/월 | 200/월 |
| 블로그 발행 | 6편 | 24편 | 52편 |
| 백링크 도메인 | 5 | 20 | 50+ |
| AI 검색 인용 | 0 | 확인 시작 | 월 5회+ |

---

## 8. SEO 도구 추천

| 도구 | 용도 | 비용 |
|------|------|------|
| Google Search Console | 색인, 트래픽, 오류 모니터링 | 무료 |
| Google Analytics 4 | 유기 트래픽, 전환 추적 | 무료 |
| Bing Webmaster Tools | Bing 색인 관리 | 무료 |
| Ahrefs / Semrush | 키워드 리서치, 백링크 분석 | 유료 |
| PageSpeed Insights | Core Web Vitals 측정 | 무료 |
| Rich Results Test | JSON-LD 검증 | 무료 |
| Screaming Frog | 크롤링 감사 | 무료 (500 URL) |

---

## 9. 위험 요소 및 대응

| 위험 | 영향 | 대응 |
|------|------|------|
| 한국어 SEC 공시 키워드 검색량이 예상보다 낮음 | 트래픽 지연 | 영문 키워드 병행, 교육 콘텐츠로 수요 창출 |
| AI 검색 엔진이 콘텐츠를 인용하지 않음 | AI 트래픽 미발생 | 직접 답변 구조 지속, 스키마 강화 |
| 경쟁사가 유사한 한국어 도구 런칭 | 차별화 약화 | 근거 경로 + 온톨로지 고유 기능 강조 |
| Google 핵심 업데이트로 순위 변동 | 트래픽 감소 | 고품질 콘텐츠 지속, E-E-A-T 강화 |
