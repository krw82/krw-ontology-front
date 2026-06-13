import type { Metadata } from "next";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { APPLE_QUESTION_CHAINS } from "@/lib/companies/landing-copy";
import { normalizeTicker } from "@/lib/ontology/ticker";

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
  questionChain: QuestionChain;
  userProblem: string;
  bestFor: string[];
  notFor: string[];
  evidenceTargets: string[];
  promptVariants: string[];
  expectedAnswerShape: string[];
  exampleTickers: string[];
  answerBlocks: string[];
  relatedUseCaseSlugs: string[];
  relatedQuestionSlugs: string[];
  seoKeywords: string[];
}

export interface QuestionChainNode {
  id: string;
  title: string;
  question: string;
  answerHint?: string;
}

export interface QuestionChainStage {
  id: string;
  label: string;
  nodes: QuestionChainNode[];
}

export interface QuestionChain {
  ticker: string;
  companyName: string;
  title: string;
  description: string;
  primaryQuestion: string;
  stages: QuestionChainStage[];
}

export interface UseCasePage {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  audience: string;
  problem: string;
  primaryQuestion: string;
  outcome: string;
  proofPoints: string[];
  workflowSteps: Array<{
    title: string;
    body: string;
  }>;
  relatedQuestionSlugs: string[];
  recommendedQuestionSlugs: string[];
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
    questionChain: APPLE_QUESTION_CHAINS["revenue-growth"],
    userProblem:
      "매출이 늘었다는 숫자는 확인했지만, 제품·서비스·지역·가격 중 무엇이 실제 동인이었는지 빠르게 분리하고 싶을 때 사용합니다.",
    bestFor: [
      "실적 발표 후 성장 동인이 제품, 서비스, 가격, 물량 중 어디에 있는지 확인할 때",
      "회사 설명과 숫자 변화가 같은 방향인지 공시 문장으로 대조할 때",
      "후속으로 세그먼트나 리스크 질문을 이어가기 전에 큰 흐름을 잡을 때",
    ],
    notFor: [
      "다음 분기 매출을 예측하거나 목표주가를 계산하려는 경우",
      "특정 제품의 비공개 판매량을 공시 밖에서 추정하려는 경우",
    ],
    evidenceTargets: [
      "Revenue, net sales, segment revenue 관련 MetricObservation",
      "Management discussion의 제품·서비스·지역 수요 설명",
      "가격, 물량, 고객 수요, 환율, 인수 효과를 언급한 filing claims",
    ],
    promptVariants: [
      "최근 공시 기준으로 매출 성장이 어디서 나왔는지 제품, 서비스, 지역 요인으로 나눠줘.",
      "매출 증가가 가격, 물량, 믹스 중 어느 요인과 연결되는지 공시 근거로 정리해줘.",
      "전년 대비 매출 성장에 가장 크게 기여한 사업 활동과 근거 문장을 찾아줘.",
    ],
    expectedAnswerShape: [
      "매출 성장 요인을 2~4개로 분리",
      "각 요인별 공시 근거와 연결된 사업 활동 제시",
      "확인되지 않은 부분과 후속 질문 제안",
    ],
    exampleTickers: ["AAPL", "AMZN", "NVDA"],
    answerBlocks: [
      "매출 성장은 보통 제품 판매량, 가격, 서비스 믹스, 지역 수요, 신규 세그먼트 기여가 함께 움직입니다.",
      "KRW Ontology는 답변 전에 관련 공시 문장과 사업 활동을 먼저 찾고, 어느 근거에서 요인이 나왔는지 남깁니다.",
    ],
    relatedUseCaseSlugs: ["filing-analysis", "thesis-check"],
    relatedQuestionSlugs: ["segment-performance", "margin-change", "risk-factors"],
    seoKeywords: ["매출 성장", "revenue growth", "10-K 매출", "공시 분석"],
  },
  {
    slug: "margin-change",
    title: "마진 변화는 어떤 사업 요인과 연결되는가?",
    shortTitle: "마진 변화",
    description:
      "매출총이익률, 영업이익률, 비용 구조 변화가 어떤 사업 활동과 연결되는지 공시 근거로 추적합니다.",
    question: "마진이 왜 바뀌었는지 공시 기준으로 정리해줘.",
    category: "수익성",
    questionChain: APPLE_QUESTION_CHAINS["margin-change"],
    userProblem:
      "매출은 괜찮아 보이는데 이익률이 흔들렸거나, 마진 개선이 지속 가능한지 공시상 원인을 나눠 보고 싶을 때 사용합니다.",
    bestFor: [
      "매출총이익률이나 영업이익률 변화의 사업 요인을 확인할 때",
      "제품 믹스, 원가, 가격, 클라우드/광고 같은 고마진 사업 비중을 분리할 때",
      "일회성 비용과 구조적 수익성 변화를 구분하고 싶을 때",
    ],
    notFor: [
      "회계상 조정 항목을 투자 결론으로 바로 바꾸려는 경우",
      "공시에 없는 원가 세부 내역을 확정적으로 계산하려는 경우",
    ],
    evidenceTargets: [
      "Gross margin, operating income, cost of revenue 관련 MetricObservation",
      "Management discussion의 원가, 가격, 믹스, 효율화 설명",
      "Restructuring, impairment, logistics, cloud infrastructure 비용 관련 filing claims",
    ],
    promptVariants: [
      "마진이 왜 바뀌었는지 매출총이익률과 영업이익률 관점으로 나눠 정리해줘.",
      "마진 변화가 제품 믹스, 가격, 원가, 일회성 비용 중 어디와 연결되는지 공시 근거로 알려줘.",
      "수익성 변화가 구조적 개선인지 단기 비용 영향인지 확인할 근거를 찾아줘.",
    ],
    expectedAnswerShape: [
      "마진 변화 방향과 관련 지표 요약",
      "제품 믹스·원가·가격·비용 항목별 근거 분리",
      "지속 가능성 판단에 필요한 확인 질문 제안",
    ],
    exampleTickers: ["AMZN", "TSLA", "MSFT"],
    answerBlocks: [
      "마진 변화는 원가, 가격, 제품 믹스, 클라우드/광고 같은 고마진 사업 비중, 구조조정 비용의 영향을 받습니다.",
      "답변은 숫자만 요약하지 않고 관련 세그먼트와 리스크 문장을 함께 확인하는 흐름으로 정리됩니다.",
    ],
    relatedUseCaseSlugs: ["filing-analysis", "thesis-check"],
    relatedQuestionSlugs: ["revenue-growth", "segment-performance", "capex-and-cash-flow"],
    seoKeywords: ["마진 변화", "gross margin", "operating margin", "수익성 분석"],
  },
  {
    slug: "risk-factors",
    title: "핵심 리스크는 어느 사업 활동과 연결되는가?",
    shortTitle: "리스크 요인",
    description:
      "Risk Factors 문장을 사업 활동, 외부 변수, 규제·공급망·가격 압력과 연결해 투자 thesis 점검에 사용합니다.",
    question: "핵심 리스크와 연결된 사업 활동을 알려줘.",
    category: "리스크",
    questionChain: APPLE_QUESTION_CHAINS["risk-factors"],
    userProblem:
      "Risk Factors가 길고 추상적으로 보일 때, 어떤 사업 활동과 실제로 연결되는 리스크인지 좁히고 싶을 때 사용합니다.",
    bestFor: [
      "규제, 공급망, 가격 경쟁, 수요 둔화 같은 하방 변수를 먼저 점검할 때",
      "투자 thesis의 반대 근거를 공시 문장으로 찾고 싶을 때",
      "리스크가 특정 제품·세그먼트·지역과 연결되는지 확인할 때",
    ],
    notFor: [
      "리스크 발생 확률을 숫자로 예측하려는 경우",
      "공시가 언급하지 않은 외부 사건을 확정적 리스크로 단정하려는 경우",
    ],
    evidenceTargets: [
      "RiskFactor, Headwind, ExternalFactorExposure 노드",
      "규제, 법무, 공급망, 경쟁, 고객 집중 관련 filing claims",
      "리스크와 연결된 Segment, BusinessActivity, ProductService",
    ],
    promptVariants: [
      "핵심 리스크를 사업 활동별로 묶고, 각 리스크의 공시 근거를 보여줘.",
      "Risk Factors에서 실제 실적에 영향을 줄 수 있는 리스크를 우선순위로 정리해줘.",
      "현재 투자 thesis를 흔들 수 있는 반대 근거를 공시 기준으로 찾아줘.",
    ],
    expectedAnswerShape: [
      "핵심 리스크를 3~5개 범주로 정리",
      "각 리스크가 연결되는 사업 활동과 공시 근거 제시",
      "실적 지표로 이어서 확인할 후속 질문 제안",
    ],
    exampleTickers: ["AAPL", "NVDA", "XOM"],
    answerBlocks: [
      "리스크는 독립적인 문장처럼 보이지만 실제로는 특정 제품, 공급망, 고객군, 규제 환경과 연결됩니다.",
      "KRW Ontology는 리스크를 단순 목록이 아니라 회사의 사업 활동과 외부 변수에 붙여 확인하는 데 초점을 둡니다.",
    ],
    relatedUseCaseSlugs: ["risk-factor-analysis", "thesis-check"],
    relatedQuestionSlugs: ["thesis-check", "margin-change", "capex-and-cash-flow"],
    seoKeywords: ["risk factors", "리스크 요인", "공시 리스크", "10-K risk"],
  },
  {
    slug: "segment-performance",
    title: "어느 세그먼트가 실적을 움직였는가?",
    shortTitle: "세그먼트 성과",
    description:
      "사업부별 매출, 영업이익, 성장률을 공시 기준으로 나눠 회사 전체 실적의 동인을 확인합니다.",
    question: "실적을 움직인 핵심 세그먼트를 알려줘.",
    category: "세그먼트",
    questionChain: APPLE_QUESTION_CHAINS["segment-performance"],
    userProblem:
      "회사 전체 숫자만으로는 변화가 흐려질 때, 어느 세그먼트가 매출과 이익을 실제로 움직였는지 확인하고 싶을 때 사용합니다.",
    bestFor: [
      "복수 사업부를 가진 회사의 성장·수익성 동인을 분리할 때",
      "전체 매출 성장과 세그먼트별 성장률이 다르게 움직이는지 볼 때",
      "세그먼트 변화가 thesis의 핵심 가정과 맞는지 확인할 때",
    ],
    notFor: [
      "회사가 공시하지 않는 세부 사업부 단위까지 계산하려는 경우",
      "세그먼트 명칭이 바뀐 기간을 보정 없이 단순 비교하려는 경우",
    ],
    evidenceTargets: [
      "Segment revenue, segment operating income 관련 MetricObservation",
      "Reportable segment 설명과 Management discussion 문장",
      "세그먼트 변경, 재분류, 제품군 이동을 설명한 filing claims",
    ],
    promptVariants: [
      "최근 공시 기준으로 실적을 움직인 핵심 세그먼트를 매출과 이익 관점에서 정리해줘.",
      "세그먼트별 성장률과 이익 기여도를 비교해서 회사 전체 실적 동인을 알려줘.",
      "어느 사업부가 thesis에서 가장 중요한지 공시 근거로 좁혀줘.",
    ],
    expectedAnswerShape: [
      "주요 세그먼트별 매출·이익 변화 요약",
      "회사 전체 실적에 대한 기여도 구분",
      "세그먼트 재분류나 비교 제한 사항 표시",
    ],
    exampleTickers: ["AMZN", "MSFT", "META"],
    answerBlocks: [
      "전체 매출만 보면 회사의 변화가 흐려질 수 있습니다. 세그먼트별 성장과 이익 기여를 분리해야 핵심 동인이 보입니다.",
      "질문을 입력하면 관련 세그먼트와 공시 문장을 찾아 답변 안에 근거 흐름을 남깁니다.",
    ],
    relatedUseCaseSlugs: ["filing-analysis", "thesis-check"],
    relatedQuestionSlugs: ["revenue-growth", "margin-change", "risk-factors"],
    seoKeywords: ["세그먼트 분석", "segment revenue", "segment performance", "사업부 실적"],
  },
  {
    slug: "capex-and-cash-flow",
    title: "투자 지출과 현금흐름은 어떤 신호를 주는가?",
    shortTitle: "투자 지출",
    description:
      "CAPEX, 영업현금흐름, 잉여현금흐름 변화를 성장 투자와 비용 부담 관점에서 확인합니다.",
    question: "투자 지출과 현금흐름이 어떤 의미인지 정리해줘.",
    category: "현금흐름",
    questionChain: APPLE_QUESTION_CHAINS["capex-and-cash-flow"],
    userProblem:
      "CAPEX가 늘었거나 현금흐름이 흔들릴 때, 성장 투자와 단기 부담 중 어느 쪽으로 해석해야 하는지 공시 근거를 보고 싶을 때 사용합니다.",
    bestFor: [
      "CAPEX 증가가 AI 인프라, 생산능력, 데이터센터 등 성장 투자와 연결되는지 볼 때",
      "영업현금흐름과 잉여현금흐름 변화를 이익률 변화와 함께 확인할 때",
      "투자 지출이 재무 여력이나 thesis 리스크와 연결되는지 점검할 때",
    ],
    notFor: [
      "공시 밖의 내부 투자 프로젝트 수익률을 계산하려는 경우",
      "현금흐름 하나만으로 투자 결론을 확정하려는 경우",
    ],
    evidenceTargets: [
      "Capital expenditures, operating cash flow, free cash flow 관련 MetricObservation",
      "Liquidity and capital resources, investment commitment 설명",
      "Data center, manufacturing, property and equipment 투자 관련 filing claims",
    ],
    promptVariants: [
      "투자 지출과 현금흐름 변화가 어떤 사업 신호인지 공시 근거로 정리해줘.",
      "CAPEX 증가가 성장 투자와 단기 현금흐름 부담 중 어디에 가까운지 확인해줘.",
      "현금흐름 변화가 마진, 재고, 투자 계획과 어떻게 연결되는지 알려줘.",
    ],
    expectedAnswerShape: [
      "CAPEX·영업현금흐름·잉여현금흐름 변화 요약",
      "투자 목적과 사업 활동 연결",
      "재무 부담과 성장 투자 해석을 분리",
    ],
    exampleTickers: ["NVDA", "AMZN", "XOM"],
    answerBlocks: [
      "투자 지출 증가는 성장 신호일 수도 있고, 단기 현금흐름 부담일 수도 있습니다. 공시에서 투자 목적과 사업 맥락을 같이 봐야 합니다.",
      "KRW Ontology는 숫자 변화와 설명 문장을 함께 추적해 현금흐름 해석의 근거를 남깁니다.",
    ],
    relatedUseCaseSlugs: ["filing-analysis", "risk-factor-analysis"],
    relatedQuestionSlugs: ["margin-change", "risk-factors", "thesis-check"],
    seoKeywords: ["CAPEX", "현금흐름", "free cash flow", "투자 지출"],
  },
  {
    slug: "thesis-check",
    title: "투자 아이디어가 공시 근거와 맞는가?",
    shortTitle: "Thesis check",
    description:
      "사용자의 투자 가설을 회사 공시 문장, 실적 동인, 리스크 요인과 대조해 확인합니다.",
    question: "내 투자 thesis가 공시 근거와 맞는지 점검해줘.",
    category: "검증",
    questionChain: APPLE_QUESTION_CHAINS["thesis-check"],
    userProblem:
      "이미 갖고 있는 투자 아이디어가 공시 근거와 맞는지, 그리고 어떤 반대 근거를 봐야 하는지 확인하고 싶을 때 사용합니다.",
    bestFor: [
      "매수·보유 판단 전에 핵심 가설과 공시 근거를 대조할 때",
      "성장 동인과 리스크 요인을 같은 답변에서 함께 보고 싶을 때",
      "확신이 아니라 확인할 근거와 빈틈을 분리하고 싶을 때",
    ],
    notFor: [
      "종목 추천이나 매수·매도 결론을 대신 받으려는 경우",
      "공시 근거 없이 주가 방향을 예측하려는 경우",
    ],
    evidenceTargets: [
      "Revenue, Margin, RiskFactor, Segment 관련 주요 MetricObservation",
      "투자 thesis를 지지하거나 약화시키는 filing claims",
      "공시에 직접 확인되지 않은 가정과 추가 확인이 필요한 영역",
    ],
    promptVariants: [
      "내 thesis가 공시 근거와 맞는지 지지 근거와 반대 근거로 나눠 점검해줘.",
      "이 회사의 성장 thesis에서 확인해야 할 공시 근거와 리스크를 같이 정리해줘.",
      "내 가설 중 공시로 확인되는 부분과 아직 확인되지 않은 부분을 분리해줘.",
    ],
    expectedAnswerShape: [
      "사용자 thesis를 검증 가능한 주장으로 분해",
      "지지 근거, 반대 근거, 확인 부족 영역을 분리",
      "다음에 물어볼 구체 질문 제안",
    ],
    exampleTickers: ["AAPL", "META", "TSLA"],
    answerBlocks: [
      "좋은 투자 아이디어도 공시 근거와 어긋나면 위험합니다. 가설을 매출 동인, 리스크, 비용 구조와 나눠 확인해야 합니다.",
      "KRW Ontology는 결론을 대신 내리기보다, 판단에 필요한 원문 근거와 반대 근거를 찾는 흐름을 제공합니다.",
    ],
    relatedUseCaseSlugs: ["thesis-check", "risk-factor-analysis"],
    relatedQuestionSlugs: ["risk-factors", "revenue-growth", "margin-change"],
    seoKeywords: ["투자 thesis", "thesis check", "공시 근거", "투자 가설"],
  },
];

export function findQuestionTopic(slug: string): QuestionTopicPage | null {
  return QUESTION_TOPIC_PAGES.find((topic) => topic.slug === slug) ?? null;
}

export function getQuestionTopicGroups(): Array<{
  category: string;
  topics: QuestionTopicPage[];
}> {
  const groups = new Map<string, QuestionTopicPage[]>();

  for (const topic of QUESTION_TOPIC_PAGES) {
    const current = groups.get(topic.category) ?? [];
    current.push(topic);
    groups.set(topic.category, current);
  }

  return Array.from(groups, ([category, topics]) => ({ category, topics }));
}

export function buildQuestionChatHref(
  topic: QuestionTopicPage,
  options: { ticker?: string; question?: string; locale?: Locale } = {},
): string {
  const params = new URLSearchParams();
  const question = options.question?.trim();
  const ticker = normalizeTicker(options.ticker ?? "");

  params.set("templateId", topic.slug);
  if (ticker) params.set("ticker", ticker);
  if (question && question !== topic.question) params.set("query", question);
  if (options.locale && options.locale !== DEFAULT_LOCALE) {
    params.set("locale", options.locale);
  }

  return `/chat/new?${params.toString()}`;
}

export const USE_CASE_PAGES: UseCasePage[] = [
  {
    slug: "filing-analysis",
    title: "10-K와 10-Q를 질문으로 분석하기",
    shortTitle: "공시 분석",
    description:
      "긴 공시 문서를 처음부터 읽기 전에, 매출 동인·마진·리스크 같은 질문으로 원문 근거를 먼저 좁힙니다.",
    audience: "미국 기업 공시를 빠르게 훑고 핵심 문장부터 확인하려는 투자자",
    problem:
      "10-K와 10-Q는 길고 정보 밀도가 높습니다. 처음부터 모두 읽기보다 먼저 검증할 질문을 정하고, 그 질문에 맞는 공시 근거를 좁히는 흐름이 필요합니다.",
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
    recommendedQuestionSlugs: [
      "revenue-growth",
      "segment-performance",
      "margin-change",
      "risk-factors",
    ],
    exampleTickers: ["AAPL", "AMZN", "NVDA"],
  },
  {
    slug: "thesis-check",
    title: "투자 thesis를 공시 근거로 점검하기",
    shortTitle: "Thesis 점검",
    description:
      "내 투자 아이디어가 실제 공시의 실적 동인, 리스크 요인, 사업 활동과 맞는지 질문 단위로 대조합니다.",
    audience: "매수·보유 판단 전에 자신의 가설을 반대 근거까지 포함해 확인하고 싶은 투자자",
    problem:
      "투자 아이디어는 그럴듯해도 공시 근거와 어긋날 수 있습니다. thesis를 지지 근거, 반대 근거, 확인되지 않은 가정으로 나눠 보는 절차가 필요합니다.",
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
    recommendedQuestionSlugs: [
      "thesis-check",
      "revenue-growth",
      "risk-factors",
      "margin-change",
    ],
    exampleTickers: ["AAPL", "META", "TSLA"],
  },
  {
    slug: "risk-factor-analysis",
    title: "Risk Factors를 사업 활동과 연결해 보기",
    shortTitle: "리스크 분석",
    description:
      "Risk Factors 문장을 단순 목록으로 보지 않고, 어떤 제품·공급망·규제·외부 변수와 연결되는지 확인합니다.",
    audience: "기업의 성장 스토리보다 먼저 하방 리스크와 공시상 경고 문장을 점검하려는 투자자",
    problem:
      "Risk Factors는 대부분 길고 일반적인 문장처럼 보입니다. 실제로 어떤 사업 활동, 세그먼트, 외부 변수와 연결되는지 좁혀야 리서치에 쓸 수 있습니다.",
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
    recommendedQuestionSlugs: [
      "risk-factors",
      "thesis-check",
      "margin-change",
      "capex-and-cash-flow",
    ],
    exampleTickers: ["AAPL", "NVDA", "XOM"],
  },
];

export function findUseCase(slug: string): UseCasePage | null {
  return USE_CASE_PAGES.find((useCase) => useCase.slug === slug) ?? null;
}

export function buildUseCaseChatHref(
  useCase: UseCasePage,
  options: { ticker?: string; question?: string; locale?: Locale } = {},
): string {
  const params = new URLSearchParams();
  const firstTopic = useCase.recommendedQuestionSlugs
    .map(findQuestionTopic)
    .find((topic): topic is QuestionTopicPage => Boolean(topic));
  const ticker = normalizeTicker(options.ticker ?? "");

  if (firstTopic) params.set("templateId", firstTopic.slug);
  if (ticker) params.set("ticker", ticker);
  params.set("query", options.question?.trim() || useCase.primaryQuestion);
  params.set("useCase", useCase.slug);
  if (options.locale && options.locale !== DEFAULT_LOCALE) {
    params.set("locale", options.locale);
  }

  return `/chat/new?${params.toString()}`;
}
