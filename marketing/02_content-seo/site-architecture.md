# KRW Ontology 사이트 아키텍처

*작성일: 2026-05-23*
*목표: 한국어 투자자가 검색에서 자연스럽게 진입하고, 제품으로 전환하는 URL 구조와 내비게이션 설계*

---

## 1. 사이트 구조 개요

### 1.1 설계 원칙

1. **3클릭 원칙** — 모든 중요 페이지는 홈에서 3클릭 이내 도달
2. **키워드 매핑** — URL 구조가 타겟 키워드 클러스터와 정렬
3. **프로그래매틱 확장** — 회사/질문 페이지를 자동 생성 가능한 구조로 설계
4. **AI 검색 친화** — 각 페이지가 독립적으로 검색결과에서 의미 전달

### 1.2 전체 사이트 맵

```
krwontology.com/
├── /                                    # 홈페이지
├── /pricing                             # 요금제
├── /companies                           # 지원 회사 목록
│   └── /companies/[ticker]              # 회사별 랜딩페이지 (프로그래매틱)
├── /use-cases/
│   ├── /use-cases/filing-analysis       # 공시 분석 유스케이스
│   ├── /use-cases/thesis-check          # 투자 thesis 검증 유스케이스
│   └── /use-cases/risk-factor-analysis  # 리스크 분석 유스케이스
├── /questions/
│   └── /questions/[topic]               # 질문 템플릿 (프로그래매틱)
├── /blog/
│   ├── /blog/[slug]                     # 블로그 글
│   └── /blog/category/[category]        # 블로그 카테고리 (선택)
├── /chat                                # 채팅/리서치 (인증 필요, noindex)
├── /login                               # 로그인 (noindex)
├── /privacy                             # 개인정보처리방침
├── /terms                               # 서비스 약관
└── /share/[token]                       # 공유 링크 (noindex)
```

---

## 2. URL 구조 설계

### 2.1 URL 명명 규칙

| 규칙 | 설명 | 예시 |
|------|------|------|
| 소문자, 하이픈 구분 | URL은 소문자, 단어 사이 하이픈 | `/filing-analysis` |
| 키워드 포함 | URL에 타겟 키워드 자연스럽게 포함 | `/use-cases/risk-factor-analysis` |
| 깊이 3단계 이하 | `/category/subcategory/page` 최대 | `/companies/AAPL` |
| 한국어 URL 사용 안 함 | 영문 URL, 한국어 콘텐츠 | `/companies/AAPL` (한국어 페이지) |
| 티커 대문자 허용 | 회사 티커는 대문자 유지 | `/companies/NVDA` |

### 2.2 페이지별 URL 및 키워드 매핑

| URL | 페이지명 | 1차 키워드 | 2차 키워드 |
|-----|----------|------------|------------|
| `/` | 홈 | 기업 공시 AI 분석 | KRW Ontology |
| `/pricing` | 요금제 | SEC 공시 분석 가격 | 기업 리서치 AI 요금 |
| `/companies` | 회사 목록 | 미국 기업 공시 분석 | SEC 분석 대상 기업 |
| `/companies/[ticker]` | 회사 랜딩 | {회사명} 10-K 분석 | {회사명} 공시 리서치 |
| `/use-cases/filing-analysis` | 공시 분석 | 10-K 분석 AI | SEC 공시 분석 방법 |
| `/use-cases/thesis-check` | thesis 검증 | 투자 thesis 검증 | 공시 기반 투자 분석 |
| `/use-cases/risk-factor-analysis` | 리스크 분석 | 기업 리스크 분석 | 10-K 리스크 요인 |
| `/questions/[topic]` | 질문 템플릿 | {토픽} 분석 질문 | 기업 리서치 질문 |
| `/blog/[slug]` | 블로그 | 글별 타겟 키워드 | 관련 롱테일 키워드 |

---

## 3. 내비게이션 설계

### 3.1 글로벌 내비게이션 (헤더)

```
[KRW Ontology 로고]     리서치  |  회사 목록  |  요금제  |  블로그     [시작하기]
```

| 항목 | 링크 | 공개 여부 |
|------|------|-----------|
| 리서치 | `/chat` | 로그인 후 |
| 회사 목록 | `/companies` | 공개 |
| 요금제 | `/pricing` | 공개 |
| 블로그 | `/blog` | 공개 |
| 시작하기 | `/chat` (로그인 플로우) | 공개 |

### 3.2 푸터 내비게이션

```
제품         리소스           회사
─────────   ──────────      ──────────
홈          블로그           개인정보처리방침
요금제      회사 목록        서비스 약관
리서치      질문 템플릿      문의
            10-K 분석 가이드
```

### 3.3 브레드크럼

| 페이지 | 브레드크럼 |
|--------|------------|
| `/companies/AAPL` | 홈 > 회사 목록 > Apple Inc. |
| `/use-cases/filing-analysis` | 홈 > 공시 분석 |
| `/questions/margin-driver` | 홈 > 질문 템플릿 > 매출 동인 분석 |
| `/blog/10k-reading-guide` | 홈 > 블로그 > 10-K 읽는 법 |

---

## 4. 내부 링크 전략

### 4.1 내부 링크 원칙

1. **허브-스포크 모델** — 각 클러스터의 허브 페이지가 스포크 페이지로 링크
2. **맥락 링크** — 본문 내 자연스러운 앵커 텍스트로 연결
3. **3-way 링크** — 블로그 → 유스케이스 → 회사 페이지 순환
4. **고아 페이지 방지** — 모든 페이지가 최소 2개 이상의 내부 링크를 받도록

### 4.2 클러스터별 링크 구조

```
                        [홈]
                     /   |   \
            [유스케이스]  [회사]  [블로그]
            /    |   \     |       |
    [공시] [thesis] [리스크] [ticker] [slug]
      |      |       |       |       |
      └──────┴───────┴───────┴───────┘
              (상호 내부 링크)
```

### 4.3 내부 링크 앵커 텍스트 가이드

| 링크 대상 | 권장 앵커 텍스트 예시 |
|-----------|----------------------|
| 유스케이스: 공시 분석 | "10-K 분석 방법 알아보기", "공시 분석 유스케이스" |
| 유스케이스: thesis | "투자 thesis를 공시로 검증하기" |
| 회사 페이지 | "AAPL 공시 분석하기", "애플 리서치" |
| 질문 템플릿 | "매출 동인 분석 질문 템플릿", "리스크 요인 질문" |
| 블로그 글 | "10-K 읽는 법 가이드", "SEC 공시 기초" |
| 홈 | "KRW Ontology" (로고), "근거 기반 기업 분석 AI" |

### 4.4 페이지별 최소 내부 링크 요구사항

| 페이지 유형 | 최소 인바운드 링크 | 아웃바운드 링크 |
|-------------|-------------------|----------------|
| 홈 | - (최상위) | 모든 주요 페이지로 링크 |
| 유스케이스 | 3+ | 5+ (블로그, 회사, 질문) |
| 회사 랜딩 | 2+ | 3+ (유스케이스, 질문, 관련 회사) |
| 질문 템플릿 | 2+ | 2+ (유스케이스, 회사) |
| 블로그 | 3+ | 3+ (유스케이스, 회사, 질문) |

---

## 5. 프로그래매틱 페이지 구조

### 5.1 회사 랜딩페이지 (`/companies/[ticker]`)

**URL 패턴:** `/companies/AAPL`, `/companies/NVDA`, `/companies/TSLA`

**페이지 구성:**
```
┌─────────────────────────────────────┐
│ 브레드크럼: 홈 > 회사 목록 > Apple  │
├─────────────────────────────────────┤
│ H1: {회사명} ({티커}) 공시 분석     │
│ 회사 설명 (1-2문장)                 │
├─────────────────────────────────────┤
│ "이 회사에 질문하기" CTA            │
├─────────────────────────────────────┤
│ 추천 분석 질문 3-5개               │
│ - "{회사명} 매출 동인 분석"         │
│ - "{회사명} 리스크 요인 정리"       │
│ - "{회사명} 세그먼트별 성장"        │
├─────────────────────────────────────┤
│ 최근 공시 정보                      │
│ - 최신 10-K 요약                    │
│ - 최신 10-Q 하이라이트              │
├─────────────────────────────────────┤
│ 관련 질문 템플릿                    │
│ - 매출 동인 분석 →                  │
│ - 리스크 요인 분석 →                │
├─────────────────────────────────────┤
│ 관련 회사 (동종 업계)               │
│ - {경쟁사1} → /companies/{ticker}   │
│ - {경쟁사2} → /companies/{ticker}   │
├─────────────────────────────────────┤
│ 관련 블로그 글                      │
│ - "실전: {회사명} 분석하기" →       │
├─────────────────────────────────────┤
│ CTA: "무료로 {회사명} 분석 시작"    │
└─────────────────────────────────────┘
```

**metadata 템플릿:**
```typescript
{
  title: `${companyName} (${ticker}) 공시 분석 — KRW Ontology`,
  description: `${companyName} SEC 공시 기반 AI 분석. 10-K, 10-Q 원문 근거와 함께 매출 동인, 리스크, 세그먼트를 분석하세요.`,
}
```

### 5.2 질문 템플릿 페이지 (`/questions/[topic]`)

**URL 패턴:** `/questions/margin-driver`, `/questions/revenue-growth`, `/questions/risk-factors`

**페이지 구성:**
```
┌─────────────────────────────────────┐
│ 브레드크럼: 홈 > 질문 템플릿 > {토픽}│
├─────────────────────────────────────┤
│ H1: {토픽} 분석 질문 템플릿         │
│ 설명 (이 질문으로 무엇을 할 수 있는지)│
├─────────────────────────────────────┤
│ 추천 질문 리스트                    │
│ 1. "{질문 템플릿 1}"               │
│ 2. "{질문 템플릿 2}"               │
│ 3. "{질문 템플릿 3}"               │
│ [질문으로 분석 시작] CTA            │
├─────────────────────────────────────┤
│ 이 질문으로 분석할 수 있는 회사     │
│ - {회사1} → /companies/{ticker}     │
│ - {회사2} → /companies/{ticker}     │
├─────────────────────────────────────┤
│ 관련 유스케이스                     │
│ - 공시 분석 →                       │
│ - thesis 검증 →                     │
├─────────────────────────────────────┤
│ 관련 블로그                         │
│ - "{토픽} 분석 방법" →              │
└─────────────────────────────────────┘
```

---

## 6. 크롤링 제어 전략

### 6.1 색인 허용 페이지

| 페이지 | 색인 | 근거 |
|--------|------|------|
| `/` | O | 메인 랜딩 |
| `/pricing` | O | 전환 페이지 |
| `/companies` | O | 회사 탐색 |
| `/companies/[ticker]` | O | 프로그래매틱 SEO |
| `/use-cases/*` | O | SEO 콘텐츠 |
| `/questions/*` | O | SEO 콘텐츠 |
| `/blog/*` | O | SEO 콘텐츠 |
| `/privacy` | O | 법적 필수 |
| `/terms` | O | 법적 필수 |

### 6.2 색인 차단 페이지 (noindex)

| 페이지 | 차단 | 근거 |
|--------|------|------|
| `/chat` | X | 인증 필요, 개인 세션 |
| `/login` | X | 인증 페이지 |
| `/api/*` | X | API 엔드포인트 |
| `/share/[token]` | X | 임시 공유 링크 |

### 6.3 robots.ts 구현 가이드

```typescript
// src/app/robots.ts
import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/chat/', '/login/', '/share/'],
      },
    ],
    sitemap: 'https://krwontology.com/sitemap.xml',
  }
}
```

### 6.4 sitemap.ts 구현 가이드

```typescript
// src/app/sitemap.ts
import { MetadataRoute } from 'next'

export default async function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://krwontology.com'

  const staticPages = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/companies`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/use-cases/filing-analysis`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/use-cases/thesis-check`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/use-cases/risk-factor-analysis`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
  ]

  // 동적 회사 페이지 (추후 구현)
  // const companies = await getIndexedCompanies()
  // const companyPages = companies.map(c => ({ url: `${baseUrl}/companies/${c.ticker}`, ... }))

  // 동적 블로그 페이지 (추후 구현)
  // const posts = await getPublishedPosts()
  // const blogPages = posts.map(p => ({ url: `${baseUrl}/blog/${p.slug}`, ... }))

  return [...staticPages]
}
```

---

## 7. 404 및 리다이렉트 전략

### 7.1 커스텀 404 페이지

404 페이지에 포함할 내용:
- "페이지를 찾을 수 없습니다" 안내
- 인기 페이지 링크 (홈, 회사 목록, 요금제, 블로그)
- 검색 기능 (회사명/티커 검색)
- "질문으로 분석 시작" CTA

### 7.2 필수 리다이렉트

| 소스 | 대상 | 유형 | 근거 |
|------|------|------|------|
| `http://` → `https://` | HTTPS | 301 | 보안 + SEO |
| `www.krwontology.com` | `krwontology.com` | 301 | 정규화 |
| `/blog` (슬래시 없음) | `/blog/` 또는 그 반대 | 301 | 일관성 |

---

## 8. 모바일 아키텍처

### 8.1 모바일 내비게이션

- 햄버거 메뉴 사용 (768px 이하)
- 주요 CTA("시작하기")는 모바일에서도 항상 보이도록 fixed 위치
- 브레드크럼은 모바일에서 축약 표시 ("... > 회사 > AAPL")

### 8.2 모바일 페이지 우선순위

1. 홈 — 첫인상 + CTA
2. 회사 랜딩 — 검색 진입
3. 질문 템플릿 — 빠른 체험
4. 블로그 — 읽기 최적화

---

## 9. 아키텍처 성과 측정

| 지표 | 측정 방법 | 목표 |
|------|-----------|------|
| 평균 클릭 깊이 | GA4 페이지 트래킹 | 3클릭 이내 |
| 내부 링크 클릭률 | GA4 이벤트 | 페이지뷰당 2회+ |
| 오류 페이지 비율 | Search Console | < 1% |
| 크롤링 효율 | Search Console | 200 상태 95%+ |
| 페이지별 이탈률 | GA4 | 블로그 < 60%, 랜딩 < 40% |
