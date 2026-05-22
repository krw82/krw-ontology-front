import type { Metadata } from "next";

export const SITE_NAME = "KRW Ontology";
export const DEFAULT_SITE_ORIGIN = "https://krwontology.com";
export const SITE_DESCRIPTION =
  "공시 원문 근거를 따라가며 미국 상장기업의 실적 변화, 리스크, 사업 흐름을 확인하는 기업 리서치 AI.";

export function getSiteOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    DEFAULT_SITE_ORIGIN;

  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

export function absoluteUrl(pathname = "/"): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getSiteOrigin()}${path}`;
}

export function pageMetadata({
  title,
  description = SITE_DESCRIPTION,
  path = "/",
  noIndex = false,
}: {
  title: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: absoluteUrl(path),
    },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      siteName: SITE_NAME,
      locale: "ko_KR",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : {
          index: true,
          follow: true,
        },
  };
}

export const PRIORITY_COMPANY_TICKERS = [
  "AAPL",
  "AMZN",
  "NVDA",
  "MSFT",
  "META",
  "GOOG",
  "TSLA",
  "AVGO",
  "WMT",
  "XOM",
] as const;

export interface QuestionTopicPage {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  question: string;
  category: string;
  exampleTickers: string[];
  answerBlocks: string[];
}

export interface UseCasePage {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  audience: string;
  primaryQuestion: string;
  outcome: string;
  proofPoints: string[];
  workflowSteps: Array<{
    title: string;
    body: string;
  }>;
  relatedQuestionSlugs: string[];
  exampleTickers: string[];
}

export const QUESTION_TOPIC_PAGES: QuestionTopicPage[] = [
  {
    slug: "revenue-growth",
    title: "매출 성장은 어디서 나왔는가?",
    shortTitle: "매출 성장",
    description:
      "10-K와 10-Q 공시에서 제품, 세그먼트, 가격, 물량, 지역 요인을 나눠 매출 성장의 근거를 확인합니다.",
    question: "매출 성장은 어디서 나왔어?",
    category: "실적 동인",
    exampleTickers: ["AAPL", "AMZN", "NVDA"],
    answerBlocks: [
      "매출 성장은 보통 제품 판매량, 가격, 서비스 믹스, 지역 수요, 신규 세그먼트 기여가 함께 움직입니다.",
      "KRW Ontology는 답변 전에 관련 공시 문장과 사업 활동을 먼저 찾고, 어느 근거에서 요인이 나왔는지 남깁니다.",
    ],
  },
  {
    slug: "margin-change",
    title: "마진 변화는 어떤 사업 요인과 연결되는가?",
    shortTitle: "마진 변화",
    description:
      "매출총이익률, 영업이익률, 비용 구조 변화가 어떤 사업 활동과 연결되는지 공시 근거로 추적합니다.",
    question: "마진이 왜 바뀌었는지 공시 기준으로 정리해줘.",
    category: "수익성",
    exampleTickers: ["AMZN", "TSLA", "MSFT"],
    answerBlocks: [
      "마진 변화는 원가, 가격, 제품 믹스, 클라우드/광고 같은 고마진 사업 비중, 구조조정 비용의 영향을 받습니다.",
      "답변은 숫자만 요약하지 않고 관련 세그먼트와 리스크 문장을 함께 확인하는 흐름으로 정리됩니다.",
    ],
  },
  {
    slug: "risk-factors",
    title: "핵심 리스크는 어느 사업 활동과 연결되는가?",
    shortTitle: "리스크 요인",
    description:
      "Risk Factors 문장을 사업 활동, 외부 변수, 규제·공급망·가격 압력과 연결해 투자 thesis 점검에 사용합니다.",
    question: "핵심 리스크와 연결된 사업 활동을 알려줘.",
    category: "리스크",
    exampleTickers: ["AAPL", "NVDA", "XOM"],
    answerBlocks: [
      "리스크는 독립적인 문장처럼 보이지만 실제로는 특정 제품, 공급망, 고객군, 규제 환경과 연결됩니다.",
      "KRW Ontology는 리스크를 단순 목록이 아니라 회사의 사업 활동과 외부 변수에 붙여 확인하는 데 초점을 둡니다.",
    ],
  },
  {
    slug: "segment-performance",
    title: "어느 세그먼트가 실적을 움직였는가?",
    shortTitle: "세그먼트 성과",
    description:
      "사업부별 매출, 영업이익, 성장률을 공시 기준으로 나눠 회사 전체 실적의 동인을 확인합니다.",
    question: "실적을 움직인 핵심 세그먼트를 알려줘.",
    category: "세그먼트",
    exampleTickers: ["AMZN", "MSFT", "META"],
    answerBlocks: [
      "전체 매출만 보면 회사의 변화가 흐려질 수 있습니다. 세그먼트별 성장과 이익 기여를 분리해야 핵심 동인이 보입니다.",
      "질문을 입력하면 관련 세그먼트와 공시 문장을 찾아 답변 안에 근거 흐름을 남깁니다.",
    ],
  },
  {
    slug: "capex-and-cash-flow",
    title: "투자 지출과 현금흐름은 어떤 신호를 주는가?",
    shortTitle: "투자 지출",
    description:
      "CAPEX, 영업현금흐름, 잉여현금흐름 변화를 성장 투자와 비용 부담 관점에서 확인합니다.",
    question: "투자 지출과 현금흐름이 어떤 의미인지 정리해줘.",
    category: "현금흐름",
    exampleTickers: ["NVDA", "AMZN", "XOM"],
    answerBlocks: [
      "투자 지출 증가는 성장 신호일 수도 있고, 단기 현금흐름 부담일 수도 있습니다. 공시에서 투자 목적과 사업 맥락을 같이 봐야 합니다.",
      "KRW Ontology는 숫자 변화와 설명 문장을 함께 추적해 현금흐름 해석의 근거를 남깁니다.",
    ],
  },
  {
    slug: "thesis-check",
    title: "투자 아이디어가 공시 근거와 맞는가?",
    shortTitle: "Thesis check",
    description:
      "사용자의 투자 가설을 회사 공시 문장, 실적 동인, 리스크 요인과 대조해 확인합니다.",
    question: "내 투자 thesis가 공시 근거와 맞는지 점검해줘.",
    category: "검증",
    exampleTickers: ["AAPL", "META", "TSLA"],
    answerBlocks: [
      "좋은 투자 아이디어도 공시 근거와 어긋나면 위험합니다. 가설을 매출 동인, 리스크, 비용 구조와 나눠 확인해야 합니다.",
      "KRW Ontology는 결론을 대신 내리기보다, 판단에 필요한 원문 근거와 반대 근거를 찾는 흐름을 제공합니다.",
    ],
  },
];

export function findQuestionTopic(slug: string): QuestionTopicPage | null {
  return QUESTION_TOPIC_PAGES.find((topic) => topic.slug === slug) ?? null;
}

export const USE_CASE_PAGES: UseCasePage[] = [
  {
    slug: "filing-analysis",
    title: "10-K와 10-Q를 질문으로 분석하기",
    shortTitle: "공시 분석",
    description:
      "긴 공시 문서를 처음부터 읽기 전에, 매출 동인·마진·리스크 같은 질문으로 원문 근거를 먼저 좁힙니다.",
    audience: "미국 기업 공시를 빠르게 훑고 핵심 문장부터 확인하려는 투자자",
    primaryQuestion: "최근 10-K 기준으로 실적을 움직인 핵심 요인을 정리해줘.",
    outcome: "답변은 읽기 좋은 Markdown으로 정리되고, 근거 경로와 인용구를 통해 원문 확인으로 이어집니다.",
    proofPoints: [
      "10-K, 10-Q 문장과 사업 활동을 함께 조회",
      "답변마다 확인 가능한 공시 근거를 남김",
      "한국어 질문으로 미국 기업 공시 리서치 시작",
    ],
    workflowSteps: [
      {
        title: "질문으로 범위 좁히기",
        body: "회사 전체를 요약하라고 묻기보다 매출, 마진, 리스크, 세그먼트처럼 검증할 범위를 먼저 정합니다.",
      },
      {
        title: "공시 근거 검색",
        body: "온톨로지 인덱스에서 관련 공시 문장, 사업 활동, 외부 요인을 찾아 답변의 출처 후보를 만듭니다.",
      },
      {
        title: "Markdown 답변 확인",
        body: "최종 답변은 구조화 리포트가 아니라 모바일과 웹에서 읽기 쉬운 Markdown 리서치 노트로 표시됩니다.",
      },
    ],
    relatedQuestionSlugs: ["revenue-growth", "margin-change", "segment-performance"],
    exampleTickers: ["AAPL", "AMZN", "NVDA"],
  },
  {
    slug: "thesis-check",
    title: "투자 thesis를 공시 근거로 점검하기",
    shortTitle: "Thesis 점검",
    description:
      "내 투자 아이디어가 실제 공시의 실적 동인, 리스크 요인, 사업 활동과 맞는지 질문 단위로 대조합니다.",
    audience: "매수·보유 판단 전에 자신의 가설을 반대 근거까지 포함해 확인하고 싶은 투자자",
    primaryQuestion: "내 thesis가 공시 근거와 맞는지 찬성 근거와 반대 근거로 나눠줘.",
    outcome: "가설을 결론으로 포장하지 않고, 확인 가능한 근거와 확인이 부족한 부분을 나눠 보여줍니다.",
    proofPoints: [
      "실적 동인과 리스크 문장을 같은 흐름에서 확인",
      "가설을 지지하는 근거와 조심해야 할 근거를 분리",
      "후속 질문으로 특정 사업·기간·문서까지 좁힐 수 있음",
    ],
    workflowSteps: [
      {
        title: "가설을 문장으로 입력",
        body: "예상 성장 요인, 비용 우려, 규제 리스크 같은 가설을 자연어로 입력합니다.",
      },
      {
        title: "근거와 빈틈 분리",
        body: "공시에 직접 등장하는 근거, 추론이 필요한 부분, 확인하지 못한 부분을 구분해 리서치 리스크를 줄입니다.",
      },
      {
        title: "후속 질문으로 좁히기",
        body: "답변 후에는 특정 세그먼트, 기간, 리스크 요인에 대해 이어서 질문할 수 있습니다.",
      },
    ],
    relatedQuestionSlugs: ["thesis-check", "risk-factors", "capex-and-cash-flow"],
    exampleTickers: ["AAPL", "META", "TSLA"],
  },
  {
    slug: "risk-factor-analysis",
    title: "Risk Factors를 사업 활동과 연결해 보기",
    shortTitle: "리스크 분석",
    description:
      "Risk Factors 문장을 단순 목록으로 보지 않고, 어떤 제품·공급망·규제·외부 변수와 연결되는지 확인합니다.",
    audience: "기업의 성장 스토리보다 먼저 하방 리스크와 공시상 경고 문장을 점검하려는 투자자",
    primaryQuestion: "핵심 리스크와 연결된 사업 활동을 알려줘.",
    outcome: "리스크 문장을 사업 맥락과 함께 읽어, thesis에서 반드시 확인해야 할 변수를 빠르게 정리합니다.",
    proofPoints: [
      "RiskFactor, Headwind, ExternalFactorExposure를 함께 조회",
      "사업 활동·외부 변수·규제 리스크를 한 답변에서 연결",
      "공시 문장에 근거하지 않은 단정적 투자 조언을 피함",
    ],
    workflowSteps: [
      {
        title: "리스크 유형 지정",
        body: "규제, 공급망, 가격 경쟁, 수요 둔화처럼 보고 싶은 리스크 범주를 질문에 포함합니다.",
      },
      {
        title: "연결된 사업 활동 확인",
        body: "공시의 리스크 문장이 어떤 제품, 고객군, 사업부, 외부 요인과 맞물리는지 찾아냅니다.",
      },
      {
        title: "다음 확인 질문 만들기",
        body: "리스크가 실제 실적 지표나 세그먼트 변화에 나타났는지 후속 질문으로 이어갑니다.",
      },
    ],
    relatedQuestionSlugs: ["risk-factors", "margin-change", "thesis-check"],
    exampleTickers: ["AAPL", "NVDA", "XOM"],
  },
];

export function findUseCase(slug: string): UseCasePage | null {
  return USE_CASE_PAGES.find((useCase) => useCase.slug === slug) ?? null;
}
