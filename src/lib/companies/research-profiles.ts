export interface CompanyQuestionNode {
  id: string;
  title: string;
  question: string;
  answerHint?: string;
}

export interface CompanyQuestionStage {
  id: string;
  label: string;
  nodes: CompanyQuestionNode[];
}

export interface CompanyQuestionChain {
  ticker: string;
  companyName: string;
  title: string;
  description: string;
  primaryQuestion: string;
  stages: CompanyQuestionStage[];
}

export interface CompanyResearchProfile {
  ticker: string;
  companyName: string;
  companyNameKo: string;
  sectorKo: string;
  signature: string;
  description: string;
  researchFocus: string[];
  riskVariables: string[];
  suggestedPrompts: readonly string[];
  questionChains: Record<string, CompanyQuestionChain>;
}

const APPLE_QUESTION_CHAINS: Record<string, CompanyQuestionChain> = {
  "revenue-growth": {
    ticker: "AAPL",
    companyName: "Apple",
    title: "Apple 매출을 따라가는 질문 흐름",
    description:
      "iPhone과 Services를 출발점으로 삼고, Pro 모델·지역 수요·App Store 수익 구조까지 질문을 좁힙니다.",
    primaryQuestion:
      "Apple은 iPhone, Services, Mac, iPad, Wearables로 어떻게 돈을 벌고, 최근 매출 동인은 무엇인지 정리해줘.",
    stages: [
      {
        id: "business-model",
        label: "사업 구조",
        nodes: [
          {
            id: "what-sells",
            title: "Apple은 무엇으로 돈을 벌어?",
            question:
              "Apple은 iPhone, Services, Mac, iPad, Wearables 매출 구조를 공시 기준으로 정리해줘.",
            answerHint: "iPhone · Services · Mac · iPad · Wearables",
          },
        ],
      },
      {
        id: "mix",
        label: "매출 믹스",
        nodes: [
          {
            id: "iphone-services-mix",
            title: "iPhone과 Services 비중은?",
            question:
              "Apple의 iPhone과 Services 매출 비중이 어떻게 달라졌는지 공시 근거로 비교해줘.",
          },
          {
            id: "product-service-growth",
            title: "제품과 Services 성장은 달라?",
            question:
              "Apple의 제품 매출과 Services 매출 성장률 차이를 공시 기준으로 정리해줘.",
          },
        ],
      },
      {
        id: "drivers",
        label: "동인",
        nodes: [
          {
            id: "iphone-pro-models",
            title: "iPhone 성장은 Pro 모델 때문이야?",
            question:
              "Apple iPhone 매출 변화가 Pro 모델, 제품 주기, 가격, 물량 중 어디와 연결되는지 정리해줘.",
          },
          {
            id: "regional-demand",
            title: "지역별 수요는 어디가 움직였어?",
            question:
              "Apple의 Americas, Europe, Greater China, Rest of Asia Pacific 매출 변화가 iPhone과 Services 중 어디와 연결되는지 알려줘.",
          },
        ],
      },
      {
        id: "thesis",
        label: "판단",
        nodes: [
          {
            id: "revenue-thesis",
            title: "성장 thesis에 어떤 의미야?",
            question:
              "Apple의 iPhone과 Services 매출 변화가 성장 thesis에 어떤 의미인지 지지 근거와 우려 근거로 나눠줘.",
          },
        ],
      },
    ],
  },
  "margin-change": {
    ticker: "AAPL",
    companyName: "Apple",
    title: "Apple 수익성을 따라가는 질문 흐름",
    description:
      "제품과 Services의 매출 믹스를 먼저 보고, 공급망·환율·관세·운영비가 마진에 어떻게 연결되는지 좁힙니다.",
    primaryQuestion:
      "Apple의 제품 매출과 Services 매출 믹스가 마진 변화에 어떤 영향을 줬는지 공시 근거로 정리해줘.",
    stages: [
      {
        id: "mix",
        label: "믹스",
        nodes: [
          {
            id: "product-services-mix",
            title: "제품과 Services 비중은?",
            question:
              "Apple의 제품 매출과 Services 매출 비중이 어떻게 달라졌는지 먼저 정리해줘.",
            answerHint: "Products gross margin · Services gross margin",
          },
        ],
      },
      {
        id: "margin",
        label: "마진",
        nodes: [
          {
            id: "gross-margin",
            title: "매출총이익률은 왜 바뀌었어?",
            question:
              "Apple의 매출총이익률 변화가 제품 믹스, Services 비중, 원가 압력 중 어디와 연결되는지 공시 근거로 알려줘.",
          },
          {
            id: "operating-margin",
            title: "영업이익률에는 어떤 영향이야?",
            question:
              "Apple의 영업이익률 변화가 매출총이익률, R&D, SG&A와 어떻게 연결되는지 정리해줘.",
          },
        ],
      },
      {
        id: "pressure",
        label: "압력",
        nodes: [
          {
            id: "supply-chain-cost",
            title: "공급망과 관세 부담은?",
            question:
              "Apple의 공급망, 부품 조달, 관세, 원재료 이슈가 가격과 매출총이익률에 어떤 부담을 주는지 찾아줘.",
          },
          {
            id: "fx-pressure",
            title: "환율은 마진에 어떤 영향이야?",
            question:
              "Apple의 환율 변동이 매출, 매출원가, 매출총이익률, 현금흐름에 어떻게 연결되는지 정리해줘.",
          },
        ],
      },
      {
        id: "quality",
        label: "질",
        nodes: [
          {
            id: "margin-quality",
            title: "마진 개선은 구조적이야?",
            question:
              "Apple의 마진 변화가 Services 믹스 개선인지, 제품 주기와 비용 요인에 따른 단기 효과인지 구분해줘.",
          },
        ],
      },
    ],
  },
  "risk-factors": {
    ticker: "AAPL",
    companyName: "Apple",
    title: "Apple 리스크를 따라가는 질문 흐름",
    description:
      "iPhone 의존도, App Store 규제, 공급망 집중도, 관세와 환율을 투자 thesis의 반대 근거로 연결합니다.",
    primaryQuestion:
      "Apple의 핵심 사업 활동과 연결된 리스크를 공시 기준으로 정리해줘.",
    stages: [
      {
        id: "exposure",
        label: "노출",
        nodes: [
          {
            id: "business-exposure",
            title: "어느 사업에 리스크가 몰려 있어?",
            question:
              "Apple의 iPhone, Services, 지역 매출 구조에서 어떤 리스크 노출이 큰지 정리해줘.",
            answerHint: "iPhone · Services · App Store · 공급망",
          },
        ],
      },
      {
        id: "risk-paths",
        label: "경로",
        nodes: [
          {
            id: "app-store-regulation",
            title: "App Store 규제 리스크는?",
            question:
              "Apple의 App Store, 외부 결제, 개발자 수수료, antitrust 관련 리스크가 공시에서 어떻게 설명되는지 정리해줘.",
          },
          {
            id: "outsourced-manufacturing",
            title: "제조 집중 리스크는?",
            question:
              "Apple의 외주 제조와 중국, 인도, 일본, 한국, 대만, 베트남 공급망 구조가 어떤 리스크로 연결되는지 알려줘.",
          },
        ],
      },
      {
        id: "cost-risk",
        label: "비용",
        nodes: [
          {
            id: "tariff-components",
            title: "관세와 부품 조달은?",
            question:
              "Apple의 관세, 희토류, 부품 조달, 원재료 이슈가 가격과 매출총이익률에 미치는 리스크를 정리해줘.",
          },
        ],
      },
      {
        id: "thesis",
        label: "점검",
        nodes: [
          {
            id: "risk-thesis",
            title: "thesis를 흔드는 리스크는?",
            question:
              "Apple 성장 thesis를 가장 크게 흔들 수 있는 리스크를 공시 근거와 함께 우선순위로 정리해줘.",
          },
        ],
      },
    ],
  },
  "segment-performance": {
    ticker: "AAPL",
    companyName: "Apple",
    title: "Apple 제품군과 지역을 따라가는 질문 흐름",
    description:
      "Apple은 제품군과 지역 흐름이 중요합니다. iPhone·Services와 Greater China, Americas, Europe 변화를 나눕니다.",
    primaryQuestion:
      "Apple 실적을 제품군과 지역 기준으로 나눠서 무엇이 움직였는지 정리해줘.",
    stages: [
      {
        id: "products",
        label: "제품군",
        nodes: [
          {
            id: "product-lines",
            title: "어떤 제품군이 있어?",
            question:
              "Apple의 iPhone, Mac, iPad, Wearables, Services를 공시 기준 매출원으로 정리해줘.",
            answerHint: "iPhone · Mac · iPad · Wearables · Services",
          },
        ],
      },
      {
        id: "performance",
        label: "성과",
        nodes: [
          {
            id: "iphone-performance",
            title: "iPhone이 얼마나 움직였어?",
            question:
              "Apple의 iPhone 매출 변화와 전체 매출 기여도를 공시 근거로 정리해줘.",
          },
          {
            id: "services-performance",
            title: "Services는 얼마나 커졌어?",
            question:
              "Apple Services 매출 변화와 App Store, 구독, 라이선스, 결제 생태계 연결성을 정리해줘.",
          },
        ],
      },
      {
        id: "region",
        label: "지역",
        nodes: [
          {
            id: "greater-china",
            title: "Greater China는 회복이야, 부담이야?",
            question:
              "Apple의 Greater China 매출과 영업이익 흐름을 공시 기준으로 보고, iPhone 수요와 어떤 관련이 있는지 정리해줘.",
          },
        ],
      },
      {
        id: "next",
        label: "다음 질문",
        nodes: [
          {
            id: "segment-next",
            title: "다음에 무엇을 봐야 해?",
            question:
              "Apple 제품군과 지역 성과를 봤을 때 이어서 확인해야 할 마진과 리스크 질문을 제안해줘.",
          },
        ],
      },
    ],
  },
  "capex-and-cash-flow": {
    ticker: "AAPL",
    companyName: "Apple",
    title: "Apple 현금흐름을 따라가는 질문 흐름",
    description:
      "Apple의 이익이 현금으로 전환되는지 보고, 투자 지출·자사주 매입·부채 관리와 연결합니다.",
    primaryQuestion:
      "Apple의 영업현금흐름, 투자 지출, 잉여현금흐름이 어떤 사업 신호를 주는지 정리해줘.",
    stages: [
      {
        id: "cash-engine",
        label: "현금 창출",
        nodes: [
          {
            id: "cash-conversion",
            title: "이익이 현금으로 잘 바뀌어?",
            question:
              "Apple의 순이익과 영업현금흐름 흐름을 비교해서 현금 창출력을 공시 근거로 정리해줘.",
            answerHint: "Operating cash flow · CAPEX · Free cash flow",
          },
        ],
      },
      {
        id: "investment",
        label: "투자",
        nodes: [
          {
            id: "capex",
            title: "투자 지출은 어디에 쓰여?",
            question:
              "Apple의 투자 지출과 자본 프로젝트가 어떤 사업 목적과 연결되는지 공시 기준으로 찾아줘.",
          },
          {
            id: "cash-return",
            title: "현금은 어떻게 배분돼?",
            question:
              "Apple의 현금흐름이 자사주 매입, 배당, 투자 지출, 부채 관리와 어떻게 배분되는지 정리해줘.",
          },
        ],
      },
      {
        id: "risk",
        label: "재무 리스크",
        nodes: [
          {
            id: "debt-rates",
            title: "부채와 금리 리스크는?",
            question:
              "Apple의 부채, 이자율, 자본시장 접근성이 현금흐름과 재무 여력에 어떤 의미인지 정리해줘.",
          },
        ],
      },
      {
        id: "signal",
        label: "신호",
        nodes: [
          {
            id: "cash-flow-signal",
            title: "사업 신호는 무엇이야?",
            question:
              "Apple의 현금흐름 변화가 성장 투자, 방어력, 주주환원 측면에서 어떤 신호인지 정리해줘.",
          },
        ],
      },
    ],
  },
  "thesis-check": {
    ticker: "AAPL",
    companyName: "Apple",
    title: "Apple thesis를 따라가는 질문 흐름",
    description:
      "Apple에 대한 가설을 iPhone, Services, App Store 규제, 공급망, Greater China 근거로 쪼개 검증합니다.",
    primaryQuestion:
      "Apple에 대한 성장 thesis를 iPhone, Services, 마진, App Store 규제, 공급망 리스크로 나눠 점검해줘.",
    stages: [
      {
        id: "claim",
        label: "가설",
        nodes: [
          {
            id: "state-thesis",
            title: "내 thesis를 어떻게 쪼개?",
            question:
              "Apple 성장 thesis를 iPhone 성장, Services 전환, 마진, 지역 수요, 규제 리스크로 쪼개줘.",
            answerHint: "iPhone · Services · Greater China · App Store",
          },
        ],
      },
      {
        id: "support",
        label: "지지",
        nodes: [
          {
            id: "support-revenue",
            title: "지지 근거는?",
            question:
              "Apple thesis를 지지하는 iPhone, Services, 지역 매출 근거를 공시 기준으로 찾아줘.",
          },
          {
            id: "support-margin",
            title: "마진 근거는?",
            question:
              "Apple thesis를 지지하거나 약화시키는 마진 근거를 제품과 Services 믹스로 나눠줘.",
          },
        ],
      },
      {
        id: "against",
        label: "반대",
        nodes: [
          {
            id: "counter-evidence",
            title: "반대 근거는?",
            question:
              "Apple thesis를 흔들 수 있는 App Store 규제, 공급망, 관세, Greater China 리스크를 공시 기준으로 정리해줘.",
          },
        ],
      },
      {
        id: "decision",
        label: "다음",
        nodes: [
          {
            id: "open-questions",
            title: "아직 확인할 것은?",
            question:
              "Apple thesis에서 공시로 확인된 부분과 아직 확인이 부족한 부분을 분리해줘.",
          },
        ],
      },
    ],
  },
};

export const COMPANY_RESEARCH_PROFILES = {
  AAPL: {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    companyNameKo: "애플",
    sectorKo: "기술",
    signature:
      "iPhone과 Services 생태계를 중심으로 매출을 만들고, 지역 수요와 App Store 규제가 투자 판단을 흔드는 소비자 플랫폼 기업",
    description:
      "Apple은 iPhone과 Services가 실적의 핵심 축입니다. Pro 모델 수요, App Store 수익 구조, Greater China 흐름, 공급망·관세·환율이 매출과 마진 해석의 핵심 변수입니다.",
    researchFocus: [
      "iPhone 매출과 Pro 모델 수요",
      "Services와 App Store 수익 구조",
      "Greater China와 지역별 매출 흐름",
      "제품·Services 믹스와 매출총이익률",
    ],
    riskVariables: [
      "App Store 규제와 외부 결제 압력",
      "중국·아시아 외주 제조와 공급망 집중도",
      "관세, 희토류, 부품 조달 비용",
      "환율, 최종수요, 지역별 iPhone 수요",
    ],
    suggestedPrompts: [
      "Apple은 iPhone, Services, Mac, iPad, Wearables로 어떻게 돈을 벌고, 최근 매출 동인은 무엇인지 정리해줘.",
      "Apple의 iPhone과 Services 매출 비중이 어떻게 달라졌고, 마진에는 어떤 의미인지 비교해줘.",
      "Apple의 App Store 규제, 공급망, Greater China 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: APPLE_QUESTION_CHAINS,
  },
} satisfies Record<string, CompanyResearchProfile>;

export const APPLE_RESEARCH_PROFILE = COMPANY_RESEARCH_PROFILES.AAPL;
export { APPLE_QUESTION_CHAINS };
