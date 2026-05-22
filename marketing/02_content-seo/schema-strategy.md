# KRW Ontology JSON-LD 구조화된 데이터 전략

*작성일: 2026-05-23*
*목표: 각 페이지에 적절한 JSON-LD 스키마를 적용하여 검색결과 가시성과 AI 검색 인용률을 높이는 전략*

---

## 1. 스키마 전략 개요

### 1.1 원칙

1. **표시된 콘텐츠만 스키마에 반영** — 페이지에 보이지 않는 정보를 스키마에 넣지 않음
2. **단계적 적용** — 필수 스키마 먼저, Rich Result 가능 스키마는 추후 추가
3. **오류 방지** — Google Rich Results Test로 모든 스키마 검증 후 배포
4. **최소 필드 원칙** — 필수 필드만 채우고, 검증할 수 없는 필드는 생략

### 1.2 페이지별 스키마 매핑

| 페이지 | 기본 스키마 | Rich Result 스키마 | 우선순위 |
|--------|------------|-------------------|----------|
| 홈 (`/`) | Organization, WebSite, SoftwareApplication | - | P0 |
| 요금제 (`/pricing`) | SoftwareApplication (제품 가격) | - | P1 |
| 회사 목록 (`/companies`) | WebPage, BreadcrumbList | - | P1 |
| 회사 랜딩 (`/companies/[ticker]`) | WebPage, BreadcrumbList | FAQPage (선택) | P1 |
| 유스케이스 | WebPage, BreadcrumbList | FAQPage, Article | P1 |
| 질문 템플릿 | WebPage, BreadcrumbList | FAQPage | P2 |
| 블로그 글 | Article, BreadcrumbList | FAQPage (선택) | P1 |
| 프라이버시/약관 | WebPage | - | P2 |

---

## 2. 홈페이지 스키마

### 2.1 Organization + WebSite + SoftwareApplication

홈페이지에는 3개의 연결된 스키마를 적용합니다.

```json
[
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "KRW Ontology",
    "url": "https://krwontology.com",
    "logo": "https://krwontology.com/icons/apple-icon.png",
    "description": "근거 경로가 남는 기업 공시 리서치 AI. SEC 공시 기반으로 기업을 분석하고 원문 출처를 확인할 수 있습니다.",
    "sameAs": [],
    "contactPoint": {
      "@type": "ContactPoint",
      "email": "business@example.com",
      "contactType": "customer support",
      "availableLanguage": ["Korean", "English"]
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "KRW Ontology",
    "url": "https://krwontology.com",
    "inLanguage": "ko",
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://krwontology.com/companies?q={search_term_string}"
      },
      "query-input": "required name=search_term_string"
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "KRW Ontology",
    "url": "https://krwontology.com",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "inLanguage": "ko",
    "description": "SEC 공시 기반 기업 분석 AI. 10-K, 10-Q 원문 근거와 함께 투자 질문에 답변합니다.",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "description": "무료 체험: 월 10회 분석"
    },
    "featureList": [
      "SEC 공시 기반 AI 분석",
      "근거 경로 확인",
      "출처 인용 포함 답변",
      "세그먼트 분석",
      "리스크 요인 분석",
      "매출 동인 분석"
    ]
  }
]
```

### 2.2 홈페이지 구현 가이드

```typescript
// src/components/JsonLd.tsx
export function HomePageJsonLd() {
  const schema = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "KRW Ontology",
      url: "https://krwontology.com",
      logo: "https://krwontology.com/icons/apple-icon.png",
      description: "근거 경로가 남는 기업 공시 리서치 AI.",
      contactPoint: {
        "@type": "ContactPoint",
        email: "business@example.com",
        contactType: "customer support",
        availableLanguage: ["Korean", "English"],
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "KRW Ontology",
      url: "https://krwontology.com",
      inLanguage: "ko",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://krwontology.com/companies?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "KRW Ontology",
      url: "https://krwontology.com",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "ko",
      description: "SEC 공시 기반 기업 분석 AI.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "무료 체험: 월 10회 분석",
      },
    },
  ];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
```

---

## 3. 회사 랜딩페이지 스키마

### 3.1 WebPage + BreadcrumbList

```json
[
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Apple Inc. (AAPL) 공시 분석",
    "description": "Apple Inc. SEC 공시 기반 AI 분석. 원문 근거와 함께 매출 동인, 리스크, 세그먼트를 분석하세요.",
    "url": "https://krwontology.com/companies/AAPL",
    "inLanguage": "ko",
    "isPartOf": {
      "@type": "WebSite",
      "name": "KRW Ontology",
      "url": "https://krwontology.com"
    },
    "about": {
      "@type": "Organization",
      "name": "Apple Inc.",
      "tickerSymbol": "AAPL",
      "description": "Consumer Electronics"
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "홈",
        "item": "https://krwontology.com"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "회사 목록",
        "item": "https://krwontology.com/companies"
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": "Apple Inc. (AAPL)",
        "item": "https://krwontology.com/companies/AAPL"
      }
    ]
  }
]
```

### 3.2 FAQPage (선택, 추천 질문이 있는 경우)

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "애플(AAPL)의 매출 성장 동인은 무엇인가요?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "최근 10-K 기준 애플의 매출은 iPhone, Services, Mac 제품군이 주도합니다. Services 세그먼트는 가장 빠른 성장을 보이며, App Store, iCloud, Apple Music 등이 포함됩니다. KRW Ontology에서 공시 원문 근거와 함께 확인할 수 있습니다."
      }
    },
    {
      "@type": "Question",
      "name": "애플(AAPL)의 주요 리스크 요인은 무엇인가요?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "10-K Item 1A 기준 주요 리스크로는 글로벌 공급망 의존도, 중국 시장 규제 리스크, 환율 변동, 기술 변화 대응 등이 포함됩니다. 구체적 내용은 KRW Ontology에서 공시 원문으로 확인할 수 있습니다."
      }
    }
  ]
}
```

---

## 4. 유스케이스 페이지 스키마

### 4.1 Article + BreadcrumbList + FAQPage

```json
[
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "10-K, 10-Q 공시 분석 — KRW Ontology",
    "description": "긴 공시를 질문 중심으로 분석하세요. 답변마다 공시 원문 출처가 포함됩니다.",
    "url": "https://krwontology.com/use-cases/filing-analysis",
    "inLanguage": "ko",
    "publisher": {
      "@type": "Organization",
      "name": "KRW Ontology",
      "url": "https://krwontology.com"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "url": "https://krwontology.com/use-cases/filing-analysis"
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "홈",
        "item": "https://krwontology.com"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "공시 분석",
        "item": "https://krwontology.com/use-cases/filing-analysis"
      }
    ]
  }
]
```

---

## 5. 블로그 글 스키마

### 5.1 Article + BreadcrumbList

```json
[
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "10-K란 무엇인가? 연간 보고서 구조와 읽는 법",
    "description": "SEC 10-K 연간 보고서의 구조와 주요 섹션을 이해하고, 투자자가 확인해야 할 핵심 정보를 정리합니다.",
    "url": "https://krwontology.com/blog/what-is-10k",
    "inLanguage": "ko",
    "datePublished": "2026-06-10",
    "dateModified": "2026-06-10",
    "author": {
      "@type": "Organization",
      "name": "KRW Ontology"
    },
    "publisher": {
      "@type": "Organization",
      "name": "KRW Ontology",
      "url": "https://krwontology.com",
      "logo": {
        "@type": "ImageObject",
        "url": "https://krwontology.com/icons/apple-icon.png"
      }
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "url": "https://krwontology.com/blog/what-is-10k"
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "홈",
        "item": "https://krwontology.com"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "블로그",
        "item": "https://krwontology.com/blog"
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": "10-K란 무엇인가?",
        "item": "https://krwontology.com/blog/what-is-10k"
      }
    ]
  }
]
```

---

## 6. 요금제 페이지 스키마

### 6.1 SoftwareApplication (상세 가격)

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "KRW Ontology",
  "url": "https://krwontology.com/pricing",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web",
  "inLanguage": "ko",
  "description": "SEC 공시 기반 기업 분석 AI. 근거 경로가 남는 기업 공시 리서치.",
  "offers": [
    {
      "@type": "Offer",
      "name": "Free",
      "price": "0",
      "priceCurrency": "USD",
      "description": "월 10회 분석. 지원 회사 전체 접근, 기본 채팅 기록, 근거 경로 확인."
    },
    {
      "@type": "Offer",
      "name": "Pro",
      "price": "{가격}",
      "priceCurrency": "KRW",
      "billingIncrement": "P1M",
      "description": "월 100회 분석. 긴 채팅 기록, 고급 질문 템플릿, 반복 리서치 흐름."
    },
    {
      "@type": "Offer",
      "name": "Power",
      "price": "{가격}",
      "priceCurrency": "KRW",
      "billingIncrement": "P1M",
      "description": "월 300회 분석. 우선 분석 큐, 고급 질문 템플릿, 신규 기능 우선 접근."
    }
  ]
}
```

---

## 7. 질문 템플릿 페이지 스키마

### 7.1 WebPage + BreadcrumbList + FAQPage

```json
[
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "매출 동인 분석 질문 템플릿",
    "description": "SEC 공시 기반 매출 동인 분석을 위한 질문 템플릿 모음.",
    "url": "https://krwontology.com/questions/margin-driver",
    "inLanguage": "ko",
    "isPartOf": {
      "@type": "WebSite",
      "name": "KRW Ontology",
      "url": "https://krwontology.com"
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "홈",
        "item": "https://krwontology.com"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "질문 템플릿",
        "item": "https://krwontology.com/questions/margin-driver"
      }
    ]
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "{회사명}의 매출 성장 동인을 분석하려면 어떤 질문을 해야 하나요?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "\"{회사명}의 매출 성장 동인을 최근 공시 기준으로 분석해줘\"와 같이 질문하면, KRW Ontology가 SEC 공시에서 관련 근거를 찾아 원문 출처와 함께 답변합니다."
        }
      }
    ]
  }
]
```

---

## 8. 구현 가이드

### 8.1 공통 컴포넌트

```typescript
// src/components/JsonLd.tsx
interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[];
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

### 8.2 BreadcrumbList 헬퍼

```typescript
// src/lib/schema/breadcrumb.ts
interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumb(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
```

### 8.3 각 페이지에 적용

```typescript
// src/app/page.tsx에 추가
import { JsonLd } from "@/components/JsonLd";

export default function Home() {
  return (
    <>
      <JsonLd data={homePageSchema} />
      {/* 기존 페이지 콘텐츠 */}
    </>
  );
}
```

---

## 9. 검증 체크리스트

### 9.1 배포 전 검증

| 항목 | 도구 | 기준 |
|------|------|------|
| JSON-LD 문법 | Google Rich Results Test | 오류 0개 |
| 스키마 타입 적합성 | Schema.org 타입 확인 | 올바른 타입 사용 |
| 필수 필드 | Rich Results Test | 모든 필수 필드 채움 |
| 페이지 콘텐츠 일치 | 수동 확인 | 스키마 내용이 페이지에 표시됨 |
| URL 일치 | 수동 확인 | canonical URL과 스키마 URL 동일 |

### 9.2 배포 후 모니터링

| 항목 | 도구 | 주기 |
|------|------|------|
| Rich Results 상태 | Search Console | 주간 |
| 스키마 오류 | Search Console 향상된 보고서 | 주간 |
| 검색결과 표시 | 직접 검색 | 월간 |

---

## 10. 주의사항

### 10.1 피해야 할 스키마 오용

| 오용 | 이유 | 대체 |
|------|------|------|
| 회사 랜딩에 FinancialProduct | 금융 상품이 아님 | Organization + WebPage |
| 가짜 리뷰/평점 | 정책 위반 | 실제 사용자 데이터 확보 후 적용 |
| 과도한 AggregateRating | 검증 불가 | omit until real data |
| 회사 재무 수치를 스키마에 직접 기재 | 실시간 업데이트 어려움 | 페이지 콘텐츠로만 표시 |
| 투자 권유성 스키마 | 규제 위반 | "정보 제공"으로만 표시 |

### 10.2 한국어 스키마 주의점

- `inLanguage` 필드에 `"ko"` 명시
- 설명 텍스트는 한국어로 작성
- 브랜드명 "KRW Ontology"는 영문 그대로 유지
- 통화 표기는 `priceCurrency`에 `"KRW"` 또는 `"USD"` 명확히

---

## 11. 단계별 적용 계획

| 단계 | 시기 | 적용 스키마 | 대상 페이지 |
|------|------|------------|-------------|
| 1 | 1주 | Organization, WebSite, SoftwareApplication | 홈 |
| 2 | 1-2주 | BreadcrumbList | 모든 페이지 |
| 3 | 2-3주 | WebPage | 회사, 유스케이스, 질문 |
| 4 | 3-4주 | Article | 유스케이스, 블로그 |
| 5 | 4-6주 | FAQPage | 회사(선택), 질문 템플릿 |
| 6 | 6-8주 | SoftwareApplication (가격) | 요금제 |
