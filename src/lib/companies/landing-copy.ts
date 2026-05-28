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
  ABBV: {
    ticker: "ABBV",
    companyName: "AbbVie Inc.",
    companyNameKo: "애브비",
    sectorKo: "제약",
    signature:
      "Immunology·Oncology, 미용의학, 파이프라인 상용화와 인수·라이선스가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: Immunology·Oncology 포트폴리오, 미용의학, 파이프라인 상용화, IRA·Medicare 가격 압력을 함께 봅니다.",
    researchFocus: [
      "Immunology·Oncology 포트폴리오",
      "미용의학 포트폴리오",
      "파이프라인·제품 상용화",
      "인수·라이선스",
    ],
    riskVariables: [
      "IRA·Medicare 가격 설정",
      "특허 만료와 바이오시밀러",
      "인재 확보와 인건비",
      "금리·부채 서비스 부담",
    ],
    suggestedPrompts: [
      "애브비에서 Immunology·Oncology 포트폴리오, 미용의학 포트폴리오, 파이프라인·제품 상용화 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "애브비의 Immunology·Oncology 포트폴리오, 미용의학 포트폴리오 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "애브비의 IRA·Medicare 가격 설정, 특허 만료와 바이오시밀러, 인재 확보와 인건비 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  ABT: {
    ticker: "ABT",
    companyName: "Abbott Laboratories",
    companyNameKo: "애보트",
    sectorKo: "헬스케어",
    signature:
      "의료기기, 진단, 영양 제품, 기존 의약품의 제품 믹스와 비용 구조가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 의료기기·진단·영양 제품 매출과 제품 원가, R&D·SG&A 비용, 헬스케어 비용 가정을 함께 봅니다.",
    researchFocus: ["의료기기", "진단 제품", "영양 제품", "기존 의약품"],
    riskVariables: [
      "헬스케어 비용 추세 가정",
      "제품 원가와 매출총이익률",
      "R&D·SG&A 비용 통제",
      "규제 승인과 환율",
    ],
    suggestedPrompts: [
      "애보트에서 의료기기, 진단 제품, 영양 제품 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "애보트의 의료기기, 진단 제품 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "애보트의 헬스케어 비용 추세 가정, 제품 원가와 매출총이익률, R&D·SG&A 비용 통제 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  ADBE: {
    ticker: "ADBE",
    companyName: "Adobe Inc.",
    companyNameKo: "어도비",
    sectorKo: "소프트웨어·디지털 미디어",
    signature:
      "Creative Cloud, Document Cloud, Experience Cloud와 cloud hosting 조달 비용이 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 구독 클라우드 제품군, Experience Cloud, third-party hosting·데이터센터 구매의무, 영업·마케팅 비용을 함께 봅니다.",
    researchFocus: [
      "Creative Cloud",
      "Document Cloud",
      "Experience Cloud",
      "cloud hosting·데이터센터 조달",
    ],
    riskVariables: [
      "third-party hosting 구매의무",
      "영업·마케팅 비용 증가",
      "거시경제와 기업 IT 지출",
      "환율·규제·소송",
    ],
    suggestedPrompts: [
      "어도비에서 Creative Cloud, Document Cloud, Experience Cloud 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "어도비의 Creative Cloud, Document Cloud 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "어도비의 third-party hosting 구매의무, 영업·마케팅 비용 증가, 거시경제와 기업 IT 지출 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  ADI: {
    ticker: "ADI",
    companyName: "Analog Devices, Inc.",
    companyNameKo: "아날로그 디바이시스",
    sectorKo: "반도체",
    signature:
      "아날로그·혼합신호 반도체 수요, 공급망 조달, 재고 약정과 운영비가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 산업·자동차 반도체 수요, 공급업체 납기·품질, 재고 구매 약정, R&D·보상 비용을 함께 봅니다.",
    researchFocus: [
      "아날로그·혼합신호 반도체",
      "산업·자동차 수요",
      "공급망 조달과 재고 약정",
      "R&D·운영비 구조",
    ],
    riskVariables: [
      "핵심 공급업체 납기·품질 차질",
      "재고 관련 구매 약정",
      "기술 인재와 보상 비용",
      "산업·자동차 수요 사이클",
    ],
    suggestedPrompts: [
      "아날로그 디바이시스에서 아날로그·혼합신호 반도체, 산업·자동차 수요, 공급망 조달과 재고 약정 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "아날로그 디바이시스의 아날로그·혼합신호 반도체, 산업·자동차 수요 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "아날로그 디바이시스의 핵심 공급업체 납기·품질 차질, 재고 관련 구매 약정, 기술 인재와 보상 비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  AMAT: {
    ticker: "AMAT",
    companyName: "Applied Materials, Inc.",
    companyNameKo: "어플라이드 머티어리얼즈",
    sectorKo: "반도체 장비",
    signature:
      "반도체 장비 수요, 서비스 매출, 고객 투자 사이클, 공급망 조달 비용이 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 반도체 장비·서비스 매출, 고객 투자 사이클, segment 비용 배분, 공급망·환경·사이버 리스크를 함께 봅니다.",
    researchFocus: [
      "반도체 장비 매출",
      "서비스 매출",
      "고객 투자 사이클",
      "공급망 조달과 segment 비용 배분",
    ],
    riskVariables: [
      "부품·원자재·운송 비용 변동",
      "중국·수출규제",
      "사이버보안 위협",
      "환경규제와 이상기후",
    ],
    suggestedPrompts: [
      "어플라이드 머티어리얼즈에서 반도체 장비 매출, 서비스 매출, 고객 투자 사이클 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "어플라이드 머티어리얼즈의 반도체 장비 매출, 서비스 매출 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "어플라이드 머티어리얼즈의 부품·원자재·운송 비용 변동, 중국·수출규제, 사이버보안 위협 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  AMD: {
    ticker: "AMD",
    companyName: "Advanced Micro Devices, Inc.",
    companyNameKo: "에이엠디",
    sectorKo: "반도체·데이터센터",
    signature:
      "데이터센터 GPU·CPU, Client·Gaming, wafer·substrate 조달과 CSP 약정이 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 데이터센터 GPU·CPU 수요, Client·Gaming 매출, wafer·substrate 구매의무, 미국 수출통제 영향을 함께 봅니다.",
    researchFocus: [
      "데이터센터 GPU·CPU",
      "Client·Gaming 매출",
      "wafer·substrate 조달",
      "소프트웨어·CSP 약정",
    ],
    riskVariables: [
      "미국 수출통제와 MI308 재고 부담",
      "wafer·substrate 구매의무",
      "반도체 공급망 차질",
      "데이터센터 수요 변동",
    ],
    suggestedPrompts: [
      "에이엠디에서 데이터센터 GPU·CPU, Client·Gaming 매출, wafer·substrate 조달 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "에이엠디의 데이터센터 GPU·CPU, Client·Gaming 매출 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "에이엠디의 미국 수출통제와 MI308 재고 부담, wafer·substrate 구매의무, 반도체 공급망 차질 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  AMGN: {
    ticker: "AMGN",
    companyName: "Amgen Inc.",
    companyNameKo: "암젠",
    sectorKo: "biopharmaceuticals",
    signature:
      "제품 상용화, Horizon 인수 제품, 파이프라인 개발과 바이오의약품 제조가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 제품 상용화, Horizon 인수로 편입된 제품 매출, 파이프라인 개발, IRA·Medicare 가격 압력을 함께 봅니다.",
    researchFocus: [
      "제품 상용화",
      "Horizon 인수 제품 매출",
      "파이프라인 개발",
      "바이오의약품 제조",
    ],
    riskVariables: [
      "IRA·Medicare 가격 협상",
      "약가·리베이트 압력",
      "규제 승인과 임상 실패",
      "인수 통합과 제품 수요",
    ],
    suggestedPrompts: [
      "암젠에서 제품 상용화, Horizon 인수 제품 매출, 파이프라인 개발 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "암젠의 제품 상용화, Horizon 인수 제품 매출 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "암젠의 IRA·Medicare 가격 협상, 약가·리베이트 압력, 규제 승인과 임상 실패 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  AMZN: {
    ticker: "AMZN",
    companyName: "Amazon.com, Inc.",
    companyNameKo: "아마존",
    sectorKo: "이커머스·클라우드",
    signature:
      "North America·International 리테일, AWS 클라우드 서비스, 광고·구독 서비스 중심으로 매출 성장과 마진을 봅니다.",
    description:
      "기업 리포트: North America·International 리테일, AWS 클라우드 서비스, 광고·구독 서비스, fulfillment 네트워크 비용 흐름을 중심으로 봅니다.",
    researchFocus: [
      "North America·International 리테일",
      "AWS 클라우드 서비스",
      "광고·구독 서비스",
      "fulfillment 네트워크 비용",
    ],
    riskVariables: [
      "노동시장과 인건비 압력",
      "운송·에너지·포장재 비용",
      "리테일 경쟁 강도",
      "규제·소송·환율 리스크",
    ],
    suggestedPrompts: [
      "아마존에서 North America·International 리테일, AWS 클라우드 서비스, 광고·구독 서비스 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "아마존의 North America·International 리테일, AWS 클라우드 서비스 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "아마존의 노동시장과 인건비 압력, 운송·에너지·포장재 비용, 리테일 경쟁 강도 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  ANET: {
    ticker: "ANET",
    companyName: "Arista Networks, Inc.",
    companyNameKo: "아리스타 네트웍스",
    sectorKo: "클라우드 네트워킹",
    signature:
      "클라우드 네트워킹 솔루션, 데이터센터 네트워킹, 신제품 개발과 공급망 관리가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 클라우드·데이터센터 네트워킹 수요, 제품 개발, 부품 조달·공급망, 고객 투자 사이클과 매출총이익률을 함께 봅니다.",
    researchFocus: [
      "클라우드 네트워킹 솔루션",
      "데이터센터 네트워킹",
      "신제품 개발",
      "부품 조달·공급망 관리",
    ],
    riskVariables: [
      "공급망 차질과 부품 조달",
      "데이터센터 최종수요",
      "지정학·관세 리스크",
      "사이버보안과 경쟁 압력",
    ],
    suggestedPrompts: [
      "아리스타 네트웍스의 클라우드 네트워킹 솔루션, 데이터센터 네트워킹, 신제품 개발이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "아리스타 네트웍스의 부품 조달·공급망 관리와 데이터센터 최종수요가 매출총이익률과 현금흐름에 어떤 의미인지 비교해줘.",
      "아리스타 네트웍스의 공급망 차질, 지정학·관세, 사이버보안 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  AVGO: {
    ticker: "AVGO",
    companyName: "Broadcom Inc.",
    companyNameKo: "브로드컴",
    sectorKo: "반도체·인프라 소프트웨어",
    signature:
      "반도체 솔루션, 인프라 소프트웨어, VMware 통합 효과와 AI 네트워킹 수요가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 반도체·인프라 소프트웨어 매출, VMware 통합 비용 효과, 총부채·금리 부담, 수요 사이클을 함께 봅니다.",
    researchFocus: [
      "반도체 솔루션 매출",
      "인프라 소프트웨어",
      "VMware 통합 효과",
      "AI 네트워킹 수요",
    ],
    riskVariables: [
      "VMware 통합과 비용 절감 지속성",
      "높은 부채와 금리 부담",
      "고객 수요와 반도체 사이클",
      "수출규제와 공급망",
    ],
    suggestedPrompts: [
      "브로드컴에서 반도체 솔루션 매출, 인프라 소프트웨어, VMware 통합 효과 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "브로드컴의 반도체 솔루션 매출, 인프라 소프트웨어 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "브로드컴의 VMware 통합과 비용 절감 지속성, 높은 부채와 금리 부담, 고객 수요와 반도체 사이클 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  AXP: {
    ticker: "AXP",
    companyName: "American Express Company",
    companyNameKo: "아메리칸 익스프레스",
    sectorKo: "결제·카드 네트워크",
    signature:
      "카드 회원 지출, 가맹점 수수료, 순이자수익과 운영비 통제가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 카드 지출·가맹점 네트워크, 순이자수익, 운영비 통제, 인플레이션과 신용평가 리스크를 함께 봅니다.",
    researchFocus: [
      "카드 회원 지출",
      "가맹점 수수료",
      "순이자수익",
      "운영비 통제",
    ],
    riskVariables: [
      "소비 지출 둔화와 인플레이션",
      "신용평가·신용손실",
      "보상·서비스 비용 증가",
      "금리 변동",
    ],
    suggestedPrompts: [
      "아메리칸 익스프레스에서 카드 회원 지출, 가맹점 수수료, 순이자수익 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "아메리칸 익스프레스의 카드 회원 지출, 가맹점 수수료 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "아메리칸 익스프레스의 소비 지출 둔화와 인플레이션, 신용평가·신용손실, 보상·서비스 비용 증가 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  BAC: {
    ticker: "BAC",
    companyName: "Bank of America Corporation",
    companyNameKo: "뱅크오브아메리카",
    sectorKo: "은행",
    signature:
      "순이자수익, 예금·대출 믹스, 자산관리 수수료와 시장금리 민감도가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 순이자수익, 예금 비용, 소비자·상업 대출, MBS·ABS 조기상환과 공정가치 민감도를 함께 봅니다.",
    researchFocus: [
      "순이자수익",
      "소비자·상업 예금과 대출",
      "자산관리 수수료",
      "시장금리와 예금 비용",
    ],
    riskVariables: [
      "금리 변동과 예금 비용",
      "MBS·ABS 조기상환 리스크",
      "공정가치·연금 가정 변동",
      "신용비용과 규제 자본",
    ],
    suggestedPrompts: [
      "뱅크오브아메리카에서 순이자수익, 소비자·상업 예금과 대출, 자산관리 수수료 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "뱅크오브아메리카의 순이자수익, 소비자·상업 예금과 대출 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "뱅크오브아메리카의 금리 변동과 예금 비용, MBS·ABS 조기상환 리스크, 공정가치·연금 가정 변동 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  BKNG: {
    ticker: "BKNG",
    companyName: "Booking Holdings Inc.",
    companyNameKo: "부킹 홀딩스",
    sectorKo: "온라인 여행",
    signature:
      "온라인 여행 예약, 숙박·항공 수요, 성과형 마케팅과 해외 여행 수요가 매출 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 온라인 여행 예약, 객실박·총예약, 성과형 마케팅 비용, 국제 여행 수요와 환율 민감도를 함께 봅니다.",
    researchFocus: [
      "온라인 여행 예약",
      "객실박·총예약",
      "성과형 마케팅과 KAYAK",
      "국제 여행 수요와 환율",
    ],
    riskVariables: [
      "여행 수요 둔화와 인플레이션",
      "성과형 마케팅·고객획득비",
      "인건비·보상 비용",
      "환율·규제·세무 리스크",
    ],
    suggestedPrompts: [
      "부킹 홀딩스의 객실박, 총예약, 온라인 여행 예약이 매출 성장에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "부킹 홀딩스의 성과형 마케팅과 KAYAK 고객획득비가 마진과 현금흐름에 어떤 부담을 주는지 비교해줘.",
      "부킹 홀딩스의 여행 수요 둔화, 인플레이션, 환율 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  BLK: {
    ticker: "BLK",
    companyName: "BlackRock, Inc.",
    companyNameKo: "블랙록",
    sectorKo: "자산운용",
    signature:
      "운용자산 AUM, ETF·인덱스 상품, Aladdin 플랫폼과 순유입 흐름이 수수료 매출을 좌우합니다.",
    description:
      "기업 리포트: AUM 규모, ETF·인덱스 운용 수수료, Aladdin·기술 서비스, 시장 가격과 순유입 민감도를 함께 봅니다.",
    researchFocus: [
      "운용자산 AUM",
      "ETF·인덱스 운용 수수료",
      "Aladdin·기술 서비스",
      "시장 가격과 순유입",
    ],
    riskVariables: [
      "시장 가격 하락과 순유출",
      "성과보수·인센티브 보상",
      "인재 유지와 보상 비용",
      "기술 투자와 규제 환경",
    ],
    suggestedPrompts: [
      "블랙록의 AUM, ETF·인덱스 상품, Aladdin이 수수료 매출을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "블랙록의 시장 가격과 순유입 변화가 운용 수수료, 마진, 현금흐름에 어떤 의미인지 비교해줘.",
      "블랙록의 성과보수, 인재 유지 비용, 기술 투자 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  C: {
    ticker: "C",
    companyName: "Citigroup Inc.",
    companyNameKo: "씨티그룹",
    sectorKo: "은행",
    signature:
      "자금거래 솔루션, 카드·소비자 금융, 시장 거래 수익과 신용비용이 실적 변동을 좌우합니다.",
    description:
      "기업 리포트: Treasury and Trade Solutions, 카드·소비자 금융, 시장 거래 활동, 상품 재고 헤지와 규제 자본을 함께 봅니다.",
    researchFocus: [
      "Treasury and Trade Solutions",
      "카드·소비자 금융",
      "시장 거래 활동",
      "상품 재고 헤지와 DVA",
    ],
    riskVariables: [
      "신용비용과 경기 민감도",
      "상품 가격·헤지 변동성",
      "시장 변동성과 DVA",
      "규제 자본·해외 환율 리스크",
    ],
    suggestedPrompts: [
      "씨티그룹의 TTS, 카드·소비자 금융, 시장 거래 활동이 매출과 이익에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "씨티그룹의 상품 재고 헤지와 DVA가 시장 수익 변동성에 어떤 의미인지 비교해줘.",
      "씨티그룹의 신용비용, 규제 자본, 상품 가격 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  CAT: {
    ticker: "CAT",
    companyName: "Caterpillar Inc.",
    companyNameKo: "캐터필러",
    sectorKo: "산업기계",
    signature:
      "건설·광산 장비, Power & Energy, Cat Financial과 부품·원자재 비용이 실적을 좌우합니다.",
    description:
      "기업 리포트: Construction Industries, Resource Industries, Power & Energy, Cat Financial과 딜러·부품 조달 흐름을 함께 봅니다.",
    researchFocus: [
      "Construction Industries",
      "Resource Industries 광산 장비",
      "Power & Energy 엔진·터빈",
      "Cat Financial 고객 금융",
    ],
    riskVariables: [
      "원자재·부품 가격 전가",
      "딜러 재고와 최종수요",
      "금융 서비스 신용위험",
      "공급망·환율·지정학 리스크",
    ],
    suggestedPrompts: [
      "캐터필러의 건설 장비, 광산 장비, Power & Energy가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "캐터필러의 Cat Financial과 딜러 재고 변화가 장비 수요와 현금흐름에 어떤 의미인지 비교해줘.",
      "캐터필러의 원자재·부품 가격, 공급망, 금융 서비스 신용위험이 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  COST: {
    ticker: "COST",
    companyName: "Costco Wholesale Corporation",
    companyNameKo: "코스트코",
    sectorKo: "창고형 리테일",
    signature:
      "창고형 리테일 매출, 멤버십 수수료, 상품 조달·물류 비용과 가격 전략이 마진을 좌우합니다.",
    description:
      "기업 리포트: 창고형 리테일 매출, 멤버십 수수료, 상품 조달·fulfillment 비용, 연료·에너지 비용과 가격 전략을 함께 봅니다.",
    researchFocus: [
      "창고형 리테일 매출",
      "멤버십 수수료",
      "상품 조달·fulfillment 비용",
      "가격 전략과 점포 확장",
    ],
    riskVariables: [
      "상품 원가와 물류비",
      "연료·전력·천연가스 가격",
      "가격 전략과 매출총이익률",
      "트래픽·멤버십 갱신율",
    ],
    suggestedPrompts: [
      "코스트코의 창고형 리테일 매출과 멤버십 수수료가 이익 구조를 어떻게 만드는지 공시 기준으로 정리해줘.",
      "코스트코의 상품 조달·물류 비용과 연료·에너지 비용이 매출총이익률에 어떤 영향을 주는지 비교해줘.",
      "코스트코의 가격 전략, 상품 원가, 멤버십 갱신율 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  CSCO: {
    ticker: "CSCO",
    companyName: "Cisco Systems, Inc.",
    companyNameKo: "시스코",
    sectorKo: "네트워킹 장비",
    signature:
      "네트워킹 제품, 보안·구독, 서비스 매출과 제품 매출총이익률이 실적의 핵심입니다.",
    description:
      "기업 리포트: 네트워킹 제품, 보안·구독 전환, 서비스 매출, 제품·서비스 매출총이익률과 거시 수요 압력을 함께 봅니다.",
    researchFocus: [
      "네트워킹 제품",
      "보안·구독 전환",
      "서비스 매출",
      "제품·서비스 매출총이익률",
    ],
    riskVariables: [
      "거시 수요 둔화",
      "제품 매출총이익률 압박",
      "원가 인플레이션과 경쟁",
      "R&D·인재 비용",
    ],
    suggestedPrompts: [
      "시스코의 네트워킹 제품, 보안·구독, 서비스 매출이 성장과 마진에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "시스코의 제품 매출총이익률과 서비스 매출총이익률이 비용 인플레이션과 수요 둔화에 어떻게 반응하는지 비교해줘.",
      "시스코의 거시 수요, 경쟁, 원가 인플레이션 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  DE: {
    ticker: "DE",
    companyName: "Deere & Company",
    companyNameKo: "디어",
    sectorKo: "농업·건설 장비",
    signature:
      "Production & Precision Ag, Small Ag & Turf, Construction & Forestry와 금융 서비스가 실적을 좌우합니다.",
    description:
      "기업 리포트: 농업 장비 판매, 건설·임업 장비, Financial Services, 농산물 가격·농가 현금흐름과 금융 스프레드를 함께 봅니다.",
    researchFocus: [
      "Production & Precision Ag",
      "Small Ag & Turf",
      "Construction & Forestry",
      "Financial Services",
    ],
    riskVariables: [
      "농산물 가격과 농가 현금흐름",
      "금융 스프레드와 신용손실",
      "무역정책·정부 보조금",
      "공급 계약과 딜러 재고",
    ],
    suggestedPrompts: [
      "디어의 Production & Precision Ag, Small Ag & Turf, Construction & Forestry가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "디어의 금융 서비스 수익과 금융 스프레드, 신용손실이 장비 판매 사이클과 어떻게 연결되는지 비교해줘.",
      "디어의 농산물 가격, 무역정책, 정부 보조금 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  DHR: {
    ticker: "DHR",
    companyName: "Danaher Corporation",
    companyNameKo: "다나허",
    sectorKo: "생명과학·진단",
    signature:
      "생명과학·진단 플랫폼, recurring 소모품·서비스, 포트폴리오 전환과 공급·인건비가 마진을 좌우합니다.",
    description:
      "기업 리포트: Life Sciences·Diagnostics, recurring 소모품·서비스, M&A·포트폴리오, 공급 조달과 labor cost 민감도를 함께 봅니다.",
    researchFocus: [
      "Life Sciences·Diagnostics",
      "Recurring 소모품·서비스",
      "M&A·포트폴리오 전환",
      "공급 조달과 labor cost",
    ],
    riskVariables: [
      "단일·제한 공급업체 의존",
      "공급·인건비 인플레이션",
      "가격 전가 지연",
      "고객 비용 절감 압력",
    ],
    suggestedPrompts: [
      "다나허의 Life Sciences, Diagnostics, recurring 소모품·서비스가 매출 안정성과 성장에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "다나허의 공급 조달과 labor cost가 매출총이익률과 가격 전가에 어떤 부담을 주는지 비교해줘.",
      "다나허의 제한 공급업체, 비용 인플레이션, 고객 비용 절감 압력이 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  DIS: {
    ticker: "DIS",
    companyName: "The Walt Disney Company",
    companyNameKo: "월트디즈니",
    sectorKo: "미디어·테마파크",
    signature:
      "파크·경험 사업, DTC 스트리밍, 콘텐츠 제작·편성 비용과 광고 수요가 실적을 좌우합니다.",
    description:
      "기업 리포트: Experiences, DTC 스트리밍, 엔터테인먼트 콘텐츠, 광고·배급 수익과 프로그래밍 권리 비용을 함께 봅니다.",
    researchFocus: [
      "Parks·Experiences",
      "DTC 스트리밍",
      "엔터테인먼트 콘텐츠",
      "광고·배급 수익",
    ],
    riskVariables: [
      "프로그래밍 권리·제작 비용",
      "테마파크 방문객과 계절성",
      "소비자 수요와 가격 인플레이션",
      "마케팅·기술 지원 비용",
    ],
    suggestedPrompts: [
      "월트디즈니의 Parks·Experiences, DTC 스트리밍, 콘텐츠 사업이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "월트디즈니의 프로그래밍 권리 비용과 콘텐츠 제작비가 스트리밍·엔터테인먼트 마진에 어떤 영향을 주는지 비교해줘.",
      "월트디즈니의 테마파크 방문객, 소비자 수요, 가격 인플레이션 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  ETN: {
    ticker: "ETN",
    companyName: "Eaton Corporation plc",
    companyNameKo: "이튼",
    sectorKo: "전력관리·산업장비",
    signature:
      "전력관리 제품 판매, 인수 통합, 구조조정과 운영비 관리가 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 전력관리·산업 제품 매출, 인수 통합, 구조조정 프로그램, 공급망·인플레이션·환율 변수를 함께 봅니다.",
    researchFocus: [
      "전력관리 제품 판매",
      "인수 통합",
      "구조조정 프로그램",
      "운영비와 R&D",
    ],
    riskVariables: [
      "공급망 차질과 원가 부담",
      "인플레이션과 관세 정책",
      "금리·부채 비용",
      "환율과 소송 리스크",
    ],
    suggestedPrompts: [
      "이튼의 전력관리 제품 판매, 인수 통합, 구조조정 프로그램이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "이튼의 공급망 차질과 운영비 관리가 영업이익률, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "이튼의 인플레이션, 관세 정책, 금리·부채 비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  GILD: {
    ticker: "GILD",
    companyName: "Gilead Sciences, Inc.",
    companyNameKo: "길리어드",
    sectorKo: "biopharmaceuticals",
    signature:
      "HIV 포트폴리오, Oncology·Cell Therapy, Veklury 수요와 파이프라인 상업화가 실적을 좌우합니다.",
    description:
      "기업 리포트: HIV 치료제, Oncology·Cell Therapy, Veklury 제품 수요, 파이프라인과 IRA·Medicare 가격 압력을 함께 봅니다.",
    researchFocus: [
      "HIV 포트폴리오",
      "Oncology·Cell Therapy",
      "Veklury 제품 수요",
      "파이프라인 상업화",
    ],
    riskVariables: [
      "IRA·Medicare 가격 압력",
      "가격·환급 정책",
      "Veklury 물량 둔화",
      "인플레이션과 운영비",
    ],
    suggestedPrompts: [
      "길리어드의 HIV 포트폴리오, Oncology·Cell Therapy, Veklury가 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "길리어드의 Veklury 수요와 파이프라인 상업화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "길리어드의 IRA·Medicare 가격 압력, 환급 정책, 인플레이션 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  GEV: {
    ticker: "GEV",
    companyName: "GE Vernova Inc.",
    companyNameKo: "GE 버노바",
    sectorKo: "전력·그리드 장비",
    signature:
      "전력 장비·서비스, 그리드 인프라, 대형 capital project와 인플레이션 가격 전가가 실적을 좌우합니다.",
    description:
      "기업 리포트: Power·Grid 장비와 서비스, 대형 capital project, 순 PP&E 투자, 계약 가격 조정과 원가 인플레이션을 함께 봅니다.",
    researchFocus: [
      "Power·Grid 장비와 서비스",
      "대형 capital project",
      "순 PP&E 투자",
      "계약 가격 조정",
    ],
    riskVariables: [
      "원자재·공급망 가격 변동",
      "인플레이션과 가격 전가",
      "대형 프로젝트 현금흐름",
      "규제·에너지 전환 수요",
    ],
    suggestedPrompts: [
      "GE 버노바의 Power·Grid 장비와 서비스, 대형 capital project, 순 PP&E 투자가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "GE 버노바의 Power·Grid 장비와 서비스와 계약 가격 조정가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "GE 버노바의 원자재·공급망 가격 변동, 인플레이션과 가격 전가, 대형 프로젝트 현금흐름 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  GLW: {
    ticker: "GLW",
    companyName: "Corning Incorporated",
    companyNameKo: "코닝",
    sectorKo: "특수소재·광통신",
    signature:
      "광통신, 특수소재 제조, 생산능력 최적화와 자본투자가 매출 회복과 마진을 좌우합니다.",
    description:
      "기업 리포트: 광통신 수요, 특수소재·제조 운영, 설비투자와 생산능력 조정, 환율·최종수요·공급망 변수를 함께 봅니다.",
    researchFocus: [
      "광통신 매출",
      "특수소재 제조",
      "생산능력 최적화",
      "설비투자와 제조 운영",
    ],
    riskVariables: [
      "최종시장 수요 둔화",
      "환율 변동",
      "공급망 차질",
      "소송·규제와 환경 비용",
    ],
    suggestedPrompts: [
      "코닝의 광통신, 특수소재 제조, 생산능력 최적화가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "코닝의 설비투자와 제조 운영이 영업이익률, 현금흐름, 성장 투자에 어떤 의미인지 비교해줘.",
      "코닝의 최종시장 수요 둔화, 환율, 공급망 차질 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  GOOG: {
    ticker: "GOOG",
    companyName: "Alphabet Inc.",
    companyNameKo: "알파벳",
    sectorKo: "검색·광고·클라우드",
    signature:
      "검색·YouTube 광고, Google Cloud, 기술 인프라 원가와 데이터센터 투자가 실적을 좌우합니다.",
    description:
      "기업 리포트: 검색·YouTube 광고, Google Cloud, 기술 인프라 감가상각, 콘텐츠 획득 비용과 데이터센터 운영비를 함께 봅니다.",
    researchFocus: [
      "검색·YouTube 광고",
      "Google Cloud",
      "기술 인프라 감가상각",
      "콘텐츠 획득 비용",
    ],
    riskVariables: [
      "데이터센터 CAPEX와 감가상각",
      "콘텐츠 획득 비용",
      "검색·AI 경쟁과 규제",
      "공급망·수출 제한 리스크",
    ],
    suggestedPrompts: [
      "알파벳의 검색·YouTube 광고와 Google Cloud가 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "알파벳의 기술 인프라 감가상각과 콘텐츠 획득 비용이 매출총이익률에 어떤 영향을 주는지 비교해줘.",
      "알파벳의 데이터센터 투자, AI 경쟁, 규제 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  GOOGL: {
    ticker: "GOOGL",
    companyName: "Alphabet Inc.",
    companyNameKo: "알파벳",
    sectorKo: "검색·광고·클라우드",
    signature:
      "검색·YouTube 광고, Google Cloud, 데이터센터 운영비와 콘텐츠 획득 비용이 마진을 좌우합니다.",
    description:
      "기업 리포트: 검색·YouTube 광고, Google Cloud, 데이터센터 운영·감가상각, 콘텐츠 획득 비용과 투자자산 회계 민감도를 함께 봅니다.",
    researchFocus: [
      "검색·YouTube 광고",
      "Google Cloud",
      "데이터센터 운영·감가상각",
      "콘텐츠 획득 비용",
    ],
    riskVariables: [
      "데이터센터 CAPEX와 운영비",
      "콘텐츠 획득 비용",
      "검색·AI 경쟁과 규제",
      "투자자산 공정가치 변동",
    ],
    suggestedPrompts: [
      "알파벳의 검색·YouTube 광고와 Google Cloud가 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "알파벳의 데이터센터 운영비와 콘텐츠 획득 비용이 매출총이익률에 어떤 영향을 주는지 비교해줘.",
      "알파벳의 데이터센터 투자, AI 경쟁, 콘텐츠 비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  GS: {
    ticker: "GS",
    companyName: "The Goldman Sachs Group, Inc.",
    companyNameKo: "골드만삭스",
    sectorKo: "투자은행",
    signature:
      "투자은행, 자산·부관리, 파생상품·상품 트레이딩과 시장위험이 수익 변동을 좌우합니다.",
    description:
      "기업 리포트: 투자은행 수수료, 자산·부관리, 파생상품 거래, 원유·천연가스·전력 등 상품 트레이딩과 시장위험을 함께 봅니다.",
    researchFocus: [
      "투자은행 수수료",
      "자산·부관리",
      "파생상품 거래",
      "상품 트레이딩",
    ],
    riskVariables: [
      "상품 가격 변동성",
      "시장위험과 Level 3 파생상품",
      "자본시장 발행 부진",
      "유동성·규제 자본",
    ],
    suggestedPrompts: [
      "골드만삭스의 투자은행, 자산·부관리, 파생상품 거래가 매출과 이익에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "골드만삭스의 상품 트레이딩과 Level 3 파생상품 손익이 시장 변동성에 어떻게 노출되는지 비교해줘.",
      "골드만삭스의 상품 가격, 시장위험, 유동성 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  HON: {
    ticker: "HON",
    companyName: "Honeywell International Inc.",
    companyNameKo: "허니웰",
    sectorKo: "산업 자동화·항공우주",
    signature:
      "항공우주·자동화·에너지 솔루션, 장기계약 가격 조건과 인플레이션 전가가 마진을 좌우합니다.",
    description:
      "기업 리포트: 항공우주 제품·애프터마켓, 자동화 솔루션, 에너지·지속가능 솔루션, 장기계약 매출 인식과 가격·물량 효과를 함께 봅니다.",
    researchFocus: [
      "항공우주 제품·애프터마켓",
      "자동화 솔루션",
      "에너지·지속가능 솔루션",
      "장기계약 매출 인식",
    ],
    riskVariables: [
      "인플레이션과 계약 가격 조건",
      "원가 상승과 가격 전가",
      "인수 효과와 물량 변동",
      "공급망·지정학 리스크",
    ],
    suggestedPrompts: [
      "허니웰의 항공우주 제품·애프터마켓, 자동화 솔루션, 에너지·지속가능 솔루션가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "허니웰의 항공우주 제품·애프터마켓와 장기계약 매출 인식가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "허니웰의 인플레이션과 계약 가격 조건, 원가 상승과 가격 전가, 인수 효과와 물량 변동 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  IBM: {
    ticker: "IBM",
    companyName: "International Business Machines Corporation",
    companyNameKo: "아이비엠",
    sectorKo: "하이브리드 클라우드·컨설팅",
    signature:
      "소프트웨어, 컨설팅, 인프라 시스템과 연금·부채 비용이 현금흐름과 마진을 좌우합니다.",
    description:
      "기업 리포트: 하이브리드 클라우드 소프트웨어, 컨설팅, 인프라 시스템, free cash flow와 연금·이자 비용 민감도를 함께 봅니다.",
    researchFocus: [
      "하이브리드 클라우드 소프트웨어",
      "컨설팅 서비스",
      "인프라 시스템",
      "Free cash flow",
    ],
    riskVariables: [
      "연금 비용과 이자율",
      "부채·SOFR 기반 금융비용",
      "컨설팅 수요와 거시경제",
      "기술 전환·인재 비용",
    ],
    suggestedPrompts: [
      "아이비엠의 소프트웨어, 컨설팅, 인프라 시스템이 매출과 현금흐름을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "아이비엠의 연금 비용과 이자 비용이 영업마진과 free cash flow에 어떤 영향을 주는지 비교해줘.",
      "아이비엠의 이자율, 컨설팅 수요, 기술 전환 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  INTC: {
    ticker: "INTC",
    companyName: "Intel Corporation",
    companyNameKo: "인텔",
    sectorKo: "반도체·파운드리",
    signature:
      "Client Computing, Data Center·AI, Intel Products와 파운드리·제조 원가가 마진을 좌우합니다.",
    description:
      "기업 리포트: Client Computing, DCAI 프리미엄 믹스와 ASP, Intel Products 매출, 파운드리·제조 투자와 gross margin을 함께 봅니다.",
    researchFocus: [
      "Client Computing 매출",
      "DCAI 프리미엄 믹스와 ASP",
      "Intel Products 매출",
      "파운드리·제조 투자",
    ],
    riskVariables: [
      "공정 전환과 제조 원가",
      "파운드리 투자 부담",
      "DCAI 수요와 경쟁",
      "보조금·수출 규제",
    ],
    suggestedPrompts: [
      "인텔의 Client Computing, DCAI, Intel Products가 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "인텔의 DCAI 프리미엄 믹스와 ASP 변화가 매출총이익률에 어떤 영향을 주는지 비교해줘.",
      "인텔의 제조 원가, 파운드리 투자, 수출 규제 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  INTU: {
    ticker: "INTU",
    companyName: "Intuit Inc.",
    companyNameKo: "인튜이트",
    sectorKo: "세무·회계 소프트웨어",
    signature:
      "TurboTax, QuickBooks, Credit Karma와 보상 비용·담보 차입 구조가 마진과 유동성을 좌우합니다.",
    description:
      "기업 리포트: TurboTax, QuickBooks, Credit Karma, AI 자동화, 보상 비용과 secured facility 유동성 구조를 함께 봅니다.",
    researchFocus: [
      "TurboTax 세무 소프트웨어",
      "QuickBooks 회계 플랫폼",
      "Credit Karma",
      "AI 자동화와 생산성",
    ],
    riskVariables: [
      "보상 비용과 인재 유지",
      "운영비 증가와 마진 압박",
      "담보 차입과 유동성",
      "세제 변화와 신용 사이클",
    ],
    suggestedPrompts: [
      "인튜이트의 TurboTax, QuickBooks, Credit Karma가 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "인튜이트의 보상 비용과 운영비 증가가 영업마진에 어떤 부담을 주는지 비교해줘.",
      "인튜이트의 인재 비용, 담보 차입, 세제 변화 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  ISRG: {
    ticker: "ISRG",
    companyName: "Intuitive Surgical, Inc.",
    companyNameKo: "인튜이티브 서지컬",
    sectorKo: "수술 로봇",
    signature:
      "da Vinci 시스템, 기구·액세서리 반복매출, 병원 상환 환경과 단일 공급업체 의존이 실적을 좌우합니다.",
    description:
      "기업 리포트: da Vinci 시스템, 기구·액세서리, 시스템 리스, 수술 건수 성장, 부품 조달과 병원 reimbursement를 함께 봅니다.",
    researchFocus: [
      "da Vinci 시스템 판매",
      "기구·액세서리 반복매출",
      "시스템 리스",
      "수술 건수와 병원 상환",
    ],
    riskVariables: [
      "단일·sole-sourced 부품 공급",
      "병원 reimbursement 부족",
      "인플레이션과 가격 전가 지연",
      "규제 승인과 절차 채택 속도",
    ],
    suggestedPrompts: [
      "인튜이티브 서지컬의 da Vinci 시스템 판매, 기구·액세서리 반복매출, 시스템 리스가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "인튜이티브 서지컬의 da Vinci 시스템 판매와 수술 건수와 병원 상환가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "인튜이티브 서지컬의 단일·sole-sourced 부품 공급, 병원 reimbursement 부족, 인플레이션과 가격 전가 지연 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  JNJ: {
    ticker: "JNJ",
    companyName: "Johnson & Johnson",
    companyNameKo: "존슨앤드존슨",
    sectorKo: "제약·의료기기",
    signature:
      "의약품·의료기기, 가격 인상, 연구개발과 비용 인플레이션 대응이 마진을 좌우합니다.",
    description:
      "기업 리포트: Innovative Medicine, MedTech, 연구개발, 가격 인상과 비용 인플레이션에 대한 마진 유지 전략을 함께 봅니다.",
    researchFocus: [
      "Innovative Medicine",
      "MedTech 의료기기",
      "연구개발 파이프라인",
      "가격 인상과 마진 유지",
    ],
    riskVariables: [
      "비용 인플레이션과 가격 전가",
      "순가격 성장 둔화",
      "소송·제품 책임",
      "규제 승인과 환급 정책",
    ],
    suggestedPrompts: [
      "존슨앤드존슨의 Innovative Medicine, MedTech 의료기기, 연구개발 파이프라인가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "존슨앤드존슨의 Innovative Medicine와 가격 인상과 마진 유지가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "존슨앤드존슨의 비용 인플레이션과 가격 전가, 순가격 성장 둔화, 소송·제품 책임 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  JPM: {
    ticker: "JPM",
    companyName: "JPMorgan Chase & Co.",
    companyNameKo: "JP모건체이스",
    sectorKo: "은행·자본시장",
    signature:
      "순이자수익, 카드·소비자 금융, 시장·투자은행 수익과 상품 파생상품 노출이 실적을 좌우합니다.",
    description:
      "기업 리포트: 순이자수익, 카드·소비자 금융, 투자은행·시장 수익, 상품 파생상품과 금리·예금 비용 민감도를 함께 봅니다.",
    researchFocus: [
      "순이자수익",
      "카드·소비자 금융",
      "투자은행·시장 수익",
      "상품 파생상품 거래",
    ],
    riskVariables: [
      "금리·예금 비용",
      "신용비용과 경기 민감도",
      "원유·천연가스 가격 변동",
      "규제 자본과 유동성",
    ],
    suggestedPrompts: [
      "JP모건체이스의 순이자수익, 카드·소비자 금융, 투자은행·시장 수익가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "JP모건체이스의 순이자수익와 상품 파생상품 거래가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "JP모건체이스의 금리·예금 비용, 신용비용과 경기 민감도, 원유·천연가스 가격 변동 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  KLAC: {
    ticker: "KLAC",
    companyName: "KLA Corporation",
    companyNameKo: "케이엘에이",
    sectorKo: "반도체 검사·계측 장비",
    signature:
      "웨이퍼 검사·계측 장비, 서비스 매출, 제조 조달과 DRAM 투자 사이클이 실적을 좌우합니다.",
    description:
      "기업 리포트: 공정 제어·검사 장비, 계측 장비, 서비스 매출, supplier purchase commitments와 고객 주문 변동성을 함께 봅니다.",
    researchFocus: [
      "공정 제어·검사 장비",
      "계측 장비",
      "서비스 매출",
      "제조 조달·구매 약정",
    ],
    riskVariables: [
      "공급 약정과 재고 부담",
      "보장 공급 계약 부재",
      "DRAM 비용·마진 압력",
      "수출 제한과 반도체 투자 사이클",
    ],
    suggestedPrompts: [
      "케이엘에이의 공정 제어·검사 장비, 계측 장비, 서비스 매출가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "케이엘에이의 공정 제어·검사 장비와 제조 조달·구매 약정가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "케이엘에이의 공급 약정과 재고 부담, 보장 공급 계약 부재, DRAM 비용·마진 압력 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  KO: {
    ticker: "KO",
    companyName: "The Coca-Cola Company",
    companyNameKo: "코카콜라",
    sectorKo: "음료",
    signature:
      "음료 원액·완제품 판매, 가격·믹스, 병입 파트너와 원재료·포장·운송 비용이 마진을 좌우합니다.",
    description:
      "기업 리포트: 원액 판매, 완제품 음료, 가격·믹스, 병입 파트너, 원재료·포장·에너지·운송비와 부채 관리를 함께 봅니다.",
    researchFocus: [
      "원액·완제품 음료 판매",
      "가격·믹스",
      "글로벌 병입 파트너",
      "부채·상업어음 관리",
    ],
    riskVariables: [
      "원재료·포장·에너지 비용",
      "인플레이션과 소비자 수요",
      "공급망 차질",
      "부채 만기와 신용시장",
    ],
    suggestedPrompts: [
      "코카콜라의 원액·완제품 음료 판매, 가격·믹스, 글로벌 병입 파트너가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "코카콜라의 원액·완제품 음료 판매와 부채·상업어음 관리가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "코카콜라의 원재료·포장·에너지 비용, 인플레이션과 소비자 수요, 공급망 차질 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  LIN: {
    ticker: "LIN",
    companyName: "Linde plc",
    companyNameKo: "린데",
    sectorKo: "산업가스",
    signature:
      "산업가스 판매, 장기 고객 계약, feed gas 조달과 end-market 수요가 EBITDA와 EPS를 좌우합니다.",
    description:
      "기업 리포트: 산업가스 운영, 장기 공급계약, hydrogen·helium·CO2 원료 조달, end-market 수요와 share buyback 효과를 함께 봅니다.",
    researchFocus: [
      "산업가스 운영",
      "장기 공급계약",
      "Feed gas·특수가스 원료 조달",
      "End-market 수요와 EPS",
    ],
    riskVariables: [
      "천연가스·feed gas 가격",
      "원료 장기 가용성",
      "고객 수요와 산업 경기",
      "공급업체 차질",
    ],
    suggestedPrompts: [
      "린데의 산업가스 운영, 장기 공급계약, Feed gas·특수가스 원료 조달가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "린데의 산업가스 운영와 End-market 수요와 EPS가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "린데의 천연가스·feed gas 가격, 원료 장기 가용성, 고객 수요와 산업 경기 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  LLY: {
    ticker: "LLY",
    companyName: "Eli Lilly and Company",
    companyNameKo: "일라이 릴리",
    sectorKo: "제약",
    signature:
      "당뇨·비만 치료제, 제조설비 증설, 의약품 유통과 공급망·물류 비용이 성장을 좌우합니다.",
    description:
      "기업 리포트: GLP-1·당뇨·비만 포트폴리오, 의약품 가격, 제조설비 증설, 유통·물류와 비용 인플레이션을 함께 봅니다.",
    researchFocus: [
      "GLP-1·당뇨·비만 포트폴리오",
      "의약품 가격",
      "제조설비 증설",
      "유통·물류 역량",
    ],
    riskVariables: [
      "공급망·물류 차질",
      "제조설비 증설 비용",
      "인플레이션과 운영비",
      "가격·환급 정책",
    ],
    suggestedPrompts: [
      "일라이 릴리의 GLP-1·당뇨·비만 포트폴리오, 의약품 가격, 제조설비 증설가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "일라이 릴리의 GLP-1·당뇨·비만 포트폴리오와 유통·물류 역량가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "일라이 릴리의 공급망·물류 차질, 제조설비 증설 비용, 인플레이션과 운영비 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  LRCX: {
    ticker: "LRCX",
    companyName: "Lam Research Corporation",
    companyNameKo: "램리서치",
    sectorKo: "반도체 장비",
    signature:
      "웨이퍼 제조 장비, 반도체 capex 사이클, R&D 투자와 유동성 보유 전략이 실적을 좌우합니다.",
    description:
      "기업 리포트: 식각·증착 장비, 고객의 반도체 투자 사이클, R&D·capital investment, 유동성 보유 전략과 end-market demand를 함께 봅니다.",
    researchFocus: [
      "식각·증착 장비",
      "반도체 end-market demand",
      "R&D·capital investment",
      "유동성 보유 전략",
    ],
    riskVariables: [
      "반도체 capex 급변",
      "고객 수요 변동",
      "R&D·투자 부담",
      "공급망·수출 제한",
    ],
    suggestedPrompts: [
      "램리서치의 식각·증착 장비, 반도체 end-market demand, R&D·capital investment가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "램리서치의 식각·증착 장비와 유동성 보유 전략가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "램리서치의 반도체 capex 급변, 고객 수요 변동, R&D·투자 부담 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  MA: {
    ticker: "MA",
    companyName: "Mastercard Incorporated",
    companyNameKo: "마스터카드",
    sectorKo: "결제 네트워크",
    signature:
      "결제 네트워크 수수료, cross-border volume, 데이터·부가서비스와 기술 인재 비용이 실적을 좌우합니다.",
    description:
      "기업 리포트: 결제 네트워크, cross-border volume, switched transactions, 데이터·서비스, 투자증권 회계와 effective tax rate를 함께 봅니다.",
    researchFocus: [
      "결제 네트워크 수수료",
      "Cross-border volume",
      "Switched transactions",
      "데이터·부가서비스",
    ],
    riskVariables: [
      "기술 인재 유지 비용",
      "effective tax rate 변동",
      "소비·여행 결제 둔화",
      "규제·수수료 압력",
    ],
    suggestedPrompts: [
      "마스터카드의 결제 네트워크, cross-border volume, switched transactions가 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "마스터카드의 기술 인재 비용과 effective tax rate 변동이 마진과 순이익에 어떤 의미인지 비교해줘.",
      "마스터카드의 소비 둔화, 규제, 인재 비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  MCD: {
    ticker: "MCD",
    companyName: "McDonald's Corporation",
    companyNameKo: "맥도날드",
    sectorKo: "외식 프랜차이즈",
    signature:
      "프랜차이즈 로열티, comparable sales, 메뉴 가격·디지털 주문과 beef·chicken 원가가 실적을 좌우합니다.",
    description:
      "기업 리포트: 프랜차이즈 로열티, comparable sales, 메뉴 가격·디지털·delivery 성장, beef·chicken 원재료와 hyperinflation 영향을 함께 봅니다.",
    researchFocus: [
      "프랜차이즈 로열티",
      "Comparable sales",
      "메뉴 가격·디지털 주문",
      "Delivery 성장",
    ],
    riskVariables: [
      "Beef·chicken 원재료 가격",
      "인플레이션과 소비자 수요",
      "환율·hyperinflation 조정",
      "가맹점 운영 비용",
    ],
    suggestedPrompts: [
      "맥도날드의 프랜차이즈 로열티, comparable sales, 메뉴 가격이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "맥도날드의 beef·chicken 원재료 가격과 delivery·digital 성장이 매출총이익률에 어떤 영향을 주는지 비교해줘.",
      "맥도날드의 인플레이션, 원재료 가격, hyperinflation 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  META: {
    ticker: "META",
    companyName: "Meta Platforms, Inc.",
    companyNameKo: "메타",
    sectorKo: "소셜 광고·AI",
    signature:
      "Family of Apps 광고, Reality Labs, AI·데이터센터 capex와 클라우드 용량 약정이 실적을 좌우합니다.",
    description:
      "기업 리포트: FoA 광고, Reality Labs, AI 추천·광고 인프라, 서버·네트워크·데이터센터 투자와 third-party cloud capacity commitments를 함께 봅니다.",
    researchFocus: [
      "Family of Apps 광고",
      "Reality Labs",
      "AI·데이터센터 인프라",
      "Cloud capacity commitments",
    ],
    riskVariables: [
      "데이터센터·서버 CAPEX",
      "클라우드 용량 장기 약정",
      "Reality Labs 비용",
      "규제·광고 수요 둔화",
    ],
    suggestedPrompts: [
      "메타의 FoA 광고, Reality Labs, AI 인프라가 매출과 비용 구조를 어떻게 만드는지 공시 기준으로 정리해줘.",
      "메타의 cloud capacity commitments와 데이터센터 투자가 capex와 free cash flow에 어떤 의미인지 비교해줘.",
      "메타의 데이터센터 비용, Reality Labs 손실, 광고 수요 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  MRK: {
    ticker: "MRK",
    companyName: "Merck & Co., Inc.",
    companyNameKo: "머크",
    sectorKo: "제약",
    signature:
      "Keytruda 중심 의약품, 백신·동물건강, 제품 가격과 인재·운영비가 마진을 좌우합니다.",
    description:
      "기업 리포트: Keytruda, 백신·동물건강, 의약품 가격, 파이프라인과 인재 유치·Argentina hyperinflation 영향을 함께 봅니다.",
    researchFocus: [
      "Keytruda 중심 의약품",
      "백신·동물건강",
      "의약품 가격",
      "파이프라인 상업화",
    ],
    riskVariables: [
      "인재 유치·유지 비용",
      "가격·환급 정책",
      "Argentina hyperinflation 영향",
      "특허·규제 승인",
    ],
    suggestedPrompts: [
      "머크의 Keytruda 중심 의약품, 백신·동물건강, 의약품 가격가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "머크의 Keytruda 중심 의약품와 파이프라인 상업화가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "머크의 인재 유치·유지 비용, 가격·환급 정책, Argentina hyperinflation 영향 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  MS: {
    ticker: "MS",
    companyName: "Morgan Stanley",
    companyNameKo: "모건스탠리",
    sectorKo: "투자은행·자산관리",
    signature:
      "자산관리, 투자은행, trading market making과 원유·상품 가격 변동성이 수익을 좌우합니다.",
    description:
      "기업 리포트: Wealth Management, Investment Banking, equity·fixed income trading, commodities revenues와 crude oil price 노출을 함께 봅니다.",
    researchFocus: [
      "Wealth Management",
      "Investment Banking",
      "Equity·Fixed Income trading",
      "Commodities revenues",
    ],
    riskVariables: [
      "원유·상품 가격 변동성",
      "시장 변동성과 거래 수익",
      "자본시장 발행 부진",
      "규제 자본·유동성",
    ],
    suggestedPrompts: [
      "모건스탠리의 Wealth Management, Investment Banking, Equity·Fixed Income trading가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "모건스탠리의 Wealth Management와 Commodities revenues가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "모건스탠리의 원유·상품 가격 변동성, 시장 변동성과 거래 수익, 자본시장 발행 부진 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  MSFT: {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    companyNameKo: "마이크로소프트",
    sectorKo: "소프트웨어·클라우드",
    signature:
      "Azure와 클라우드 서비스 성장, 소프트웨어 라이선스와 구독 매출, AI·데이터센터 인프라 투자 중심으로 매출 성장과 마진을 봅니다.",
    description:
      "기업 리포트: Azure와 클라우드 서비스 성장, 소프트웨어 라이선스와 구독 매출, AI·데이터센터 인프라 투자, 클라우드 규모의 경제와 마진 흐름을 중심으로 봅니다.",
    researchFocus: [
      "Azure와 클라우드 서비스 성장",
      "소프트웨어 라이선스와 구독 매출",
      "AI·데이터센터 인프라 투자",
      "클라우드 규모의 경제와 마진",
    ],
    riskVariables: [
      "데이터센터 부품·공급망 제약",
      "AI·클라우드 CAPEX 부담",
      "규제 승인·소송",
      "사이버보안·최종수요 리스크",
    ],
    suggestedPrompts: [
      "마이크로소프트에서 Azure와 클라우드 서비스 성장, 소프트웨어 라이선스와 구독 매출, AI·데이터센터 인프라 투자 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "마이크로소프트의 Azure와 클라우드 서비스 성장, 소프트웨어 라이선스와 구독 매출 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "마이크로소프트의 데이터센터 부품·공급망 제약, AI·클라우드 CAPEX 부담, 규제 승인·소송 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  MU: {
    ticker: "MU",
    companyName: "Micron Technology, Inc.",
    companyNameKo: "마이크론",
    sectorKo: "메모리 반도체",
    signature:
      "DRAM·NAND 메모리, HBM 수요, 반도체 사이클과 엔지니어링 인재 비용이 마진을 좌우합니다.",
    description:
      "기업 리포트: DRAM, NAND, HBM·AI 메모리 수요, R&D와 정부 인센티브, SG&A·인재 유지 비용을 함께 봅니다.",
    researchFocus: [
      "DRAM 메모리",
      "NAND 스토리지",
      "HBM·AI 메모리 수요",
      "R&D·정부 인센티브",
    ],
    riskVariables: [
      "메모리 가격 사이클",
      "엔지니어링 인재 경쟁",
      "SG&A·보상 비용",
      "공급 과잉과 capex",
    ],
    suggestedPrompts: [
      "마이크론의 DRAM, NAND, HBM 수요가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "마이크론의 R&D 투자, 정부 인센티브, 인재 비용이 영업마진에 어떤 의미인지 비교해줘.",
      "마이크론의 메모리 가격 사이클, 인재 이탈, capex 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  NEE: {
    ticker: "NEE",
    companyName: "NextEra Energy, Inc.",
    companyNameKo: "넥스트에라 에너지",
    sectorKo: "전력·재생에너지",
    signature:
      "FPL 전력판매, 재생에너지 개발, 천연가스·연료 조달과 대규모 capital projects가 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: FPL 규제 전력사업, NextEra Energy Resources, 천연가스·디젤·구매전력 조달, 송전·연료 운송과 capital expenditures를 함께 봅니다.",
    researchFocus: [
      "FPL 규제 전력사업",
      "재생에너지 개발",
      "연료 조달·운송",
      "대규모 capital projects",
    ],
    riskVariables: [
      "천연가스·연료 가격",
      "송전·연료 운송 의존",
      "규제·FERC 환경",
      "capex와 금리 부담",
    ],
    suggestedPrompts: [
      "넥스트에라 에너지의 FPL 규제 전력사업, 재생에너지 개발, 연료 조달·운송가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "넥스트에라 에너지의 FPL 규제 전력사업와 대규모 capital projects가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "넥스트에라 에너지의 천연가스·연료 가격, 송전·연료 운송 의존, 규제·FERC 환경 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  NFLX: {
    ticker: "NFLX",
    companyName: "Netflix, Inc.",
    companyNameKo: "넷플릭스",
    sectorKo: "스트리밍",
    signature:
      "구독 매출, 광고 요금제, 콘텐츠 제작비와 노동·제작 일정 리스크가 마진을 좌우합니다.",
    description:
      "기업 리포트: 스트리밍 멤버십, 광고 요금제, 콘텐츠 제작·라이선스 비용, collective bargaining과 labor dispute 비용을 함께 봅니다.",
    researchFocus: [
      "스트리밍 멤버십",
      "광고 요금제",
      "콘텐츠 제작·라이선스 비용",
      "콘텐츠 제작 일정",
    ],
    riskVariables: [
      "노동비·단체협약 비용",
      "제작 지연·취소",
      "거시경제와 구독 수요",
      "콘텐츠 원가와 현금흐름",
    ],
    suggestedPrompts: [
      "넷플릭스의 멤버십, 광고 요금제, 콘텐츠 제작이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "넷플릭스의 노동비와 collective bargaining이 콘텐츠 제작비와 영업마진에 어떤 영향을 주는지 비교해줘.",
      "넷플릭스의 구독 수요, 제작 지연, 콘텐츠 비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  NOW: {
    ticker: "NOW",
    companyName: "ServiceNow, Inc.",
    companyNameKo: "서비스나우",
    sectorKo: "엔터프라이즈 소프트웨어",
    signature:
      "워크플로우 SaaS 구독, enterprise expansion, AI 플랫폼과 고급 인재 채용이 성장의 핵심입니다.",
    description:
      "기업 리포트: ServiceNow Platform, subscription revenue, enterprise workflow expansion, AI 기능과 qualified personnel 확보 리스크를 함께 봅니다.",
    researchFocus: [
      "ServiceNow Platform",
      "Subscription revenue",
      "Enterprise workflow expansion",
      "AI 기능 확장",
    ],
    riskVariables: [
      "고급 인재 확보 경쟁",
      "매출 성장의 인력 의존",
      "영업·R&D 비용 증가",
      "대기업 IT 지출 둔화",
    ],
    suggestedPrompts: [
      "서비스나우의 ServiceNow Platform, Subscription revenue, Enterprise workflow expansion가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "서비스나우의 ServiceNow Platform와 AI 기능 확장가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "서비스나우의 고급 인재 확보 경쟁, 매출 성장의 인력 의존, 영업·R&D 비용 증가 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  NVDA: {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    companyNameKo: "엔비디아",
    sectorKo: "반도체·AI 인프라",
    signature:
      "데이터센터 컴퓨팅 수요, GPU·가속 컴퓨팅 플랫폼, 차세대 제품 출시 중심으로 매출 성장과 마진을 봅니다.",
    description:
      "기업 리포트: 데이터센터 컴퓨팅 수요, GPU·가속 컴퓨팅 플랫폼, 차세대 제품 출시, 반도체 공급망과 원가 구조 흐름을 중심으로 봅니다.",
    researchFocus: [
      "데이터센터 컴퓨팅 수요",
      "GPU·가속 컴퓨팅 플랫폼",
      "차세대 제품 출시",
      "반도체 공급망과 원가 구조",
    ],
    riskVariables: [
      "수출규제와 지정학",
      "공급망·생산 제약",
      "고객 수요 변동",
      "기술 인재와 운영비 압력",
    ],
    suggestedPrompts: [
      "엔비디아에서 데이터센터 컴퓨팅 수요, GPU·가속 컴퓨팅 플랫폼, 차세대 제품 출시 중 어디에서 성장과 매출이 나오는지 공시 기준으로 정리해줘.",
      "엔비디아의 데이터센터 컴퓨팅 수요, GPU·가속 컴퓨팅 플랫폼 변화가 마진, 현금흐름, 투자 부담에 어떤 의미인지 비교해줘.",
      "엔비디아의 수출규제와 지정학, 공급망·생산 제약, 고객 수요 변동 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  ORCL: {
    ticker: "ORCL",
    companyName: "Oracle Corporation",
    companyNameKo: "오라클",
    sectorKo: "기업용 소프트웨어·클라우드",
    signature:
      "Oracle Cloud Infrastructure, 클라우드 애플리케이션, 데이터센터 임대·부채 조달과 AI 수요가 실적을 좌우합니다.",
    description:
      "기업 리포트: OCI, cloud applications, AI model training 수요, 데이터센터 lease commitments와 senior notes 발행을 함께 봅니다.",
    researchFocus: [
      "Oracle Cloud Infrastructure",
      "Cloud applications",
      "AI model training 수요",
      "데이터센터 lease commitments",
    ],
    riskVariables: [
      "데이터센터 capex·리스 약정",
      "부채 조달과 이자비용",
      "수출통제·제재·관세",
      "클라우드 경쟁과 공급망",
    ],
    suggestedPrompts: [
      "오라클의 OCI와 cloud applications가 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "오라클의 데이터센터 임대 약정과 senior notes 발행이 capex와 현금흐름에 어떤 의미인지 비교해줘.",
      "오라클의 클라우드 경쟁, 데이터센터 약정, 수출통제 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  PEP: {
    ticker: "PEP",
    companyName: "PepsiCo, Inc.",
    companyNameKo: "펩시코",
    sectorKo: "생활필수재",
    signature:
      "스낵·음료 판매, 가격 전가, 상품·포장 원가와 공급 제약이 매출총이익률을 좌우합니다.",
    description:
      "기업 리포트: Frito-Lay, 음료 브랜드, 가격·물량, commodity·packaging input costs와 공급망 제약을 함께 봅니다.",
    researchFocus: [
      "스낵·음료 판매",
      "가격·물량 믹스",
      "Commodity·packaging 비용",
      "공급망 제약",
    ],
    riskVariables: [
      "원재료·포장 원가 상승",
      "가격 전가 실패와 물량 감소",
      "Ukraine·날씨·공급망 영향",
      "소비자 수요 둔화",
    ],
    suggestedPrompts: [
      "펩시코의 스낵·음료 판매, 가격·물량 믹스, Commodity·packaging 비용가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "펩시코의 스낵·음료 판매와 공급망 제약가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "펩시코의 원재료·포장 원가 상승, 가격 전가 실패와 물량 감소, Ukraine·날씨·공급망 영향 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  PFE: {
    ticker: "PFE",
    companyName: "Pfizer Inc.",
    companyNameKo: "화이자",
    sectorKo: "제약",
    signature:
      "의약품 포트폴리오, IRA 가격·리베이트, Haleon 관련 금융 구조와 이자 비용이 실적을 좌우합니다.",
    description:
      "기업 리포트: 의약품 매출, 백신·항암 포트폴리오, IRA manufacturer discounts와 Medicare 가격 협상, Haleon JV 대출·순이자 비용을 함께 봅니다.",
    researchFocus: [
      "의약품 포트폴리오",
      "백신·항암제 매출",
      "IRA 가격·리베이트",
      "Haleon JV·부채 구조",
    ],
    riskVariables: [
      "IRA·Medicare 가격 협상",
      "리베이트·할인 부담",
      "순이자 비용과 부채",
      "특허·임상·규제 승인",
    ],
    suggestedPrompts: [
      "화이자의 의약품 포트폴리오와 백신·항암제 매출이 실적에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "화이자의 IRA 할인·가격 협상과 순이자 비용이 매출총이익률과 순이익에 어떤 의미인지 비교해줘.",
      "화이자의 IRA, 부채·이자비용, 특허 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  PG: {
    ticker: "PG",
    companyName: "The Procter & Gamble Company",
    companyNameKo: "P&G",
    sectorKo: "consumer_goods",
    signature:
      "생활용품 브랜드, 가격·믹스, supplier take-or-pay 약정과 supply chain finance가 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: Beauty·Grooming·Health Care·Fabric & Home Care, 가격·믹스, supplier procurement, take-or-pay purchase obligations와 SCF를 함께 봅니다.",
    researchFocus: [
      "생활용품 브랜드 포트폴리오",
      "가격·믹스",
      "Supplier procurement",
      "Supply Chain Finance",
    ],
    riskVariables: [
      "take-or-pay 구매 약정",
      "원재료·공급망 비용",
      "공급업체 금융 비용",
      "소비자 수요와 가격 저항",
    ],
    suggestedPrompts: [
      "프록터앤드갬블의 브랜드 포트폴리오와 가격·믹스가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "프록터앤드갬블의 take-or-pay 구매 약정과 supply chain finance가 현금흐름에 어떤 의미인지 비교해줘.",
      "프록터앤드갬블의 원재료 비용, 공급업체 금융, 가격 저항 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  PGR: {
    ticker: "PGR",
    companyName: "The Progressive Corporation",
    companyNameKo: "프로그레시브",
    sectorKo: "손해보험",
    signature:
      "개인·상업 자동차보험, 보험료 pricing, 손해율·claims management와 제3자 labor cost가 마진을 좌우합니다.",
    description:
      "기업 리포트: personal auto, commercial auto, pricing data analytics, claims management, loss severity와 third-party labor cost inflation을 함께 봅니다.",
    researchFocus: [
      "Personal auto insurance",
      "Commercial auto insurance",
      "Pricing data analytics",
      "Claims management",
    ],
    riskVariables: [
      "Loss severity 상승",
      "제3자 labor cost inflation",
      "보험료 산정 데이터 품질",
      "경쟁적 가격 환경",
    ],
    suggestedPrompts: [
      "프로그레시브의 Personal auto insurance, Commercial auto insurance, Pricing data analytics가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "프로그레시브의 Personal auto insurance와 Claims management가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "프로그레시브의 Loss severity 상승, 제3자 labor cost inflation, 보험료 산정 데이터 품질 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  PLTR: {
    ticker: "PLTR",
    companyName: "Palantir Technologies Inc.",
    companyNameKo: "팔란티어",
    sectorKo: "데이터 분석 소프트웨어",
    signature:
      "AIP·Gotham·Foundry 플랫폼, 정부·상업 계약, 제3자 기술 라이선스와 payroll 비용이 실적을 좌우합니다.",
    description:
      "기업 리포트: AIP, Gotham, Foundry, 정부·상업 계약, third-party technology licenses와 revenue recognition·investee creditworthiness를 함께 봅니다.",
    researchFocus: [
      "AIP 플랫폼",
      "Gotham·Foundry",
      "정부·상업 계약",
      "제3자 기술 라이선스",
    ],
    riskVariables: [
      "기술 라이선스 대체 어려움",
      "Payroll-related cost 증가",
      "고객·투자대상 신용도",
      "구현 지연과 revenue recognition",
    ],
    suggestedPrompts: [
      "팔란티어의 AIP 플랫폼, Gotham·Foundry, 정부·상업 계약가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "팔란티어의 AIP 플랫폼와 제3자 기술 라이선스가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "팔란티어의 기술 라이선스 대체 어려움, Payroll-related cost 증가, 고객·투자대상 신용도 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  PM: {
    ticker: "PM",
    companyName: "Philip Morris International Inc.",
    companyNameKo: "필립모리스 인터내셔널",
    sectorKo: "담배·무연 제품",
    signature:
      "무연제품 전환, 담배 가격·믹스, 인수와 인플레이션 완화 전략이 마진을 좌우합니다.",
    description:
      "기업 리포트: IQOS·smoke-free products, combustible tobacco, 가격·믹스, 인수 대가·은행부채 인수와 indexation clauses를 함께 봅니다.",
    researchFocus: [
      "IQOS·무연제품",
      "Combustible tobacco",
      "가격·믹스",
      "인수·지분 투자",
    ],
    riskVariables: [
      "인플레이션과 가격 연동 조항",
      "Shipping chokepoint와 공급망",
      "규제·세금·니코틴 정책",
      "인수 부채와 현금흐름",
    ],
    suggestedPrompts: [
      "필립모리스 인터내셔널의 IQOS·무연제품, Combustible tobacco, 가격·믹스가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "필립모리스 인터내셔널의 IQOS·무연제품와 인수·지분 투자가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "필립모리스 인터내셔널의 인플레이션과 가격 연동 조항, Shipping chokepoint와 공급망, 규제·세금·니코틴 정책 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  QCOM: {
    ticker: "QCOM",
    companyName: "QUALCOMM Incorporated",
    companyNameKo: "퀄컴",
    sectorKo: "모바일 반도체·라이선스",
    signature:
      "핸드셋 칩셋, 자동차·IoT 확장, 라이선스와 엔지니어링 인재 경쟁이 성장을 좌우합니다.",
    description:
      "기업 리포트: QCT 핸드셋, automotive·IoT diversification, QTL licensing, 기술·제품 혁신과 engineer talent acquisition을 함께 봅니다.",
    researchFocus: [
      "QCT 핸드셋 칩셋",
      "Automotive·IoT 확장",
      "QTL 라이선스",
      "기술·제품 혁신",
    ],
    riskVariables: [
      "엔지니어링 인재 경쟁",
      "핸드셋 의존도",
      "원가·보상 비용 상승",
      "수요 둔화와 규제·소송",
    ],
    suggestedPrompts: [
      "퀄컴의 핸드셋 칩셋, automotive·IoT, QTL 라이선스가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "퀄컴의 기술 혁신과 엔지니어링 인재 경쟁이 성장과 비용 구조에 어떤 의미인지 비교해줘.",
      "퀄컴의 핸드셋 수요, 보상 비용, 라이선스 규제 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  RTX: {
    ticker: "RTX",
    companyName: "RTX Corporation",
    companyNameKo: "알티엑스",
    sectorKo: "항공우주·방산",
    signature:
      "항공우주·방산 계약, 엔진·미사일 시스템, 희토류·마이크로전자 조달과 정부계약 리스크가 실적을 좌우합니다.",
    description:
      "기업 리포트: Collins Aerospace, Pratt & Whitney, Raytheon 방산 시스템, critical raw materials와 U.S. government contract termination 리스크를 함께 봅니다.",
    researchFocus: [
      "Collins Aerospace",
      "Pratt & Whitney 엔진",
      "Raytheon 방산 시스템",
      "Critical raw materials 조달",
    ],
    riskVariables: [
      "희토류·microelectronics 공급 차질",
      "정부계약 termination",
      "생산 지연과 비용 증가",
      "수출통제·공급망 제약",
    ],
    suggestedPrompts: [
      "알티엑스의 Collins Aerospace, Pratt & Whitney 엔진, Raytheon 방산 시스템가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "알티엑스의 Collins Aerospace와 Critical raw materials 조달가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "알티엑스의 희토류·microelectronics 공급 차질, 정부계약 termination, 생산 지연과 비용 증가 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  SCHW: {
    ticker: "SCHW",
    companyName: "The Charles Schwab Corporation",
    companyNameKo: "찰스 슈왑",
    sectorKo: "브로커리지·자산관리",
    signature:
      "자산 gathering, brokerage·advisory, 예금·금리 민감도와 보상 비용이 실적을 좌우합니다.",
    description:
      "기업 리포트: Investor Services, Advisor Services, asset gathering, balance sheet repositioning, interest-rate risk와 compensation expense를 함께 봅니다.",
    researchFocus: [
      "Asset gathering",
      "Investor Services",
      "Advisor Services",
      "Balance sheet management",
    ],
    riskVariables: [
      "금리·funding sensitivity",
      "고객 자산 유입 둔화",
      "보상·employee-related costs",
      "유동성·예금 이동",
    ],
    suggestedPrompts: [
      "찰스 슈왑의 Asset gathering, Investor Services, Advisor Services가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "찰스 슈왑의 Asset gathering와 Balance sheet management가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "찰스 슈왑의 금리·funding sensitivity, 고객 자산 유입 둔화, 보상·employee-related costs 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  SPGI: {
    ticker: "SPGI",
    companyName: "S&P Global Inc.",
    companyNameKo: "S&P 글로벌",
    sectorKo: "금융정보·지수",
    signature:
      "신용평가, 지수·데이터·Market Intelligence, 자본시장 발행과 기술비용이 실적을 좌우합니다.",
    description:
      "기업 리포트: S&P Global Ratings, Market Intelligence, Indices, Commodity Insights, capital market opportunities와 segment profit drivers를 함께 봅니다.",
    researchFocus: [
      "Credit Ratings",
      "Market Intelligence",
      "Indices",
      "Commodity Insights",
    ],
    riskVariables: [
      "자본시장 발행 사이클",
      "거시경제와 신용시장",
      "기술 비용 증가",
      "규제 변화와 평판 리스크",
    ],
    suggestedPrompts: [
      "S&P글로벌의 신용평가, 지수, 데이터 사업이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "S&P글로벌의 자본시장 발행 환경과 technology costs가 segment operating profit에 어떤 의미인지 비교해줘.",
      "S&P글로벌의 신용시장, 규제, 기술비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  STX: {
    ticker: "STX",
    companyName: "Seagate Technology Holdings plc",
    companyNameKo: "씨게이트",
    sectorKo: "스토리지 하드웨어",
    signature:
      "HDD·데이터센터 스토리지, 제조 재고, 구매 약정 조정과 end-market demand가 실적을 좌우합니다.",
    description:
      "기업 리포트: nearline HDD, mass capacity storage, manufacturing operations, inventory mix와 forecasted demand 변화에 따른 purchase commitments 조정을 함께 봅니다.",
    researchFocus: [
      "Nearline HDD",
      "Mass capacity storage",
      "Manufacturing inventory",
      "Purchase commitments",
    ],
    riskVariables: [
      "수요 예측 변화와 약정 취소 비용",
      "데이터센터 스토리지 사이클",
      "재고·WIP 증가",
      "공급망·shipping chokepoint",
    ],
    suggestedPrompts: [
      "씨게이트의 Nearline HDD, Mass capacity storage, Manufacturing inventory가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "씨게이트의 Nearline HDD와 Purchase commitments가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "씨게이트의 수요 예측 변화와 약정 취소 비용, 데이터센터 스토리지 사이클, 재고·WIP 증가 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  SYK: {
    ticker: "SYK",
    companyName: "Stryker Corporation",
    companyNameKo: "스트라이커",
    sectorKo: "의료기기",
    signature:
      "Orthopaedics·MedSurg·Neurotechnology, 병원 수요, shipping·labor cost와 가격 전가 한계가 마진을 좌우합니다.",
    description:
      "기업 리포트: 의료기기 제품군, hospital procedure demand, capital·energy·shipping·labor costs, cost passthrough limitation과 talent retention을 함께 봅니다.",
    researchFocus: [
      "Orthopaedics",
      "MedSurg·Neurotechnology",
      "병원 procedure demand",
      "비용 전가와 가격",
    ],
    riskVariables: [
      "Shipping·labor cost 상승",
      "가격 전가 한계",
      "고급 인재 유지",
      "환율·고금리와 capital cost",
    ],
    suggestedPrompts: [
      "스트라이커의 Orthopaedics, MedSurg·Neurotechnology, 병원 procedure demand가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "스트라이커의 Orthopaedics와 비용 전가와 가격가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "스트라이커의 Shipping·labor cost 상승, 가격 전가 한계, 고급 인재 유지 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  T: {
    ticker: "T",
    companyName: "AT&T Inc.",
    companyNameKo: "AT&T",
    sectorKo: "통신",
    signature:
      "무선·광대역 가입자, handset inventory 조달, vendor financing과 supplier payment timing이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: Mobility, broadband, handset inventory procurement, software licensing vendor financing과 supplier payment terms를 함께 봅니다.",
    researchFocus: [
      "Mobility 무선 가입자",
      "Broadband",
      "Handset inventory procurement",
      "Vendor financing",
    ],
    riskVariables: [
      "Handset supplier financing 비용",
      "소프트웨어 라이선스 vendor financing",
      "부채·금리와 유동성",
      "경쟁·가입자 이탈",
    ],
    suggestedPrompts: [
      "AT&T의 Mobility 무선 가입자, Broadband, Handset inventory procurement가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "AT&T의 Mobility 무선 가입자와 Vendor financing가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "AT&T의 Handset supplier financing 비용, 소프트웨어 라이선스 vendor financing, 부채·금리와 유동성 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  TMO: {
    ticker: "TMO",
    companyName: "Thermo Fisher Scientific Inc.",
    companyNameKo: "써모 피셔",
    sectorKo: "생명과학 장비·진단",
    signature:
      "생명과학 도구, 진단·분석 장비, 서비스·소모품과 fuel·resin·steel 원가가 마진을 좌우합니다.",
    description:
      "기업 리포트: Life Sciences Solutions, Analytical Instruments, Specialty Diagnostics, Laboratory Products and Biopharma Services, commodity exposures와 transportation·construction costs를 함께 봅니다.",
    researchFocus: [
      "Life Sciences Solutions",
      "Analytical Instruments",
      "Specialty Diagnostics",
      "Lab Products·Biopharma Services",
    ],
    riskVariables: [
      "Fuel·resin·steel 가격 변동",
      "운송·건설·서비스 비용",
      "바이오파마 수요 둔화",
      "공급망·환율 리스크",
    ],
    suggestedPrompts: [
      "써모 피셔의 Life Sciences Solutions, Analytical Instruments, Specialty Diagnostics가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "써모 피셔의 Life Sciences Solutions와 Lab Products·Biopharma Services가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "써모 피셔의 Fuel·resin·steel 가격 변동, 운송·건설·서비스 비용, 바이오파마 수요 둔화 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  TMUS: {
    ticker: "TMUS",
    companyName: "T-Mobile US, Inc.",
    companyNameKo: "티모바일",
    sectorKo: "무선통신",
    signature:
      "무선 서비스·기기 판매, 네트워크 장비 투자, ECA financing과 비용 압력이 실적을 좌우합니다.",
    description:
      "기업 리포트: postpaid·prepaid wireless service, device sales, network equipment procurement, ECA facility와 cost pressure margin dilution을 함께 봅니다.",
    researchFocus: [
      "무선 서비스 매출",
      "기기 판매",
      "네트워크 장비 조달",
      "ECA financing",
    ],
    riskVariables: [
      "네트워크 장비 구매 금융",
      "비용 상승과 가격 전가",
      "기기 매출 믹스",
      "가입자 경쟁과 churn",
    ],
    suggestedPrompts: [
      "티모바일의 무선 서비스 매출, 기기 판매, 네트워크 장비 조달가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "티모바일의 무선 서비스 매출와 ECA financing가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "티모바일의 네트워크 장비 구매 금융, 비용 상승과 가격 전가, 기기 매출 믹스 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  TSLA: {
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    companyNameKo: "테슬라",
    sectorKo: "전기차·에너지",
    signature:
      "직접판매 EV, 차량 생산·재고, 부품 조달과 single-source supplier 의존이 마진을 좌우합니다.",
    description:
      "기업 리포트: vehicle sales, direct sales channel, vehicle production, finished goods inventory, global parts procurement와 single-source supplier risk를 함께 봅니다.",
    researchFocus: [
      "Vehicle sales",
      "Direct sales channel",
      "Vehicle production inventory",
      "Parts procurement",
    ],
    riskVariables: [
      "Single-source supplier 의존",
      "부품 부족과 공급망 차질",
      "재고 증가와 가격 압박",
      "수출 제한·물류 chokepoint",
    ],
    suggestedPrompts: [
      "테슬라의 직접판매 EV와 vehicle production이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "테슬라의 finished goods inventory와 parts procurement가 현금흐름과 매출총이익률에 어떤 의미인지 비교해줘.",
      "테슬라의 single-source supplier, 재고 증가, 공급망 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  TXN: {
    ticker: "TXN",
    companyName: "Texas Instruments Incorporated",
    companyNameKo: "텍사스 인스트루먼트",
    sectorKo: "아날로그 반도체",
    signature:
      "아날로그·임베디드 반도체, 자체 제조 투자, 부채·신용시설과 연금 할인율이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: Analog, Embedded Processing, 자체 wafer fab 투자, debt management, undrawn variable-rate credit facility와 pension discount rate를 함께 봅니다.",
    researchFocus: [
      "Analog 반도체",
      "Embedded Processing",
      "자체 wafer fab 투자",
      "Debt management",
    ],
    riskVariables: [
      "변동금리 credit facility",
      "연금 할인율 가정",
      "반도체 수요 사이클",
      "제조 capex와 재고",
    ],
    suggestedPrompts: [
      "텍사스인스트루먼트의 Analog와 Embedded Processing이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "텍사스인스트루먼트의 자체 제조 투자와 debt management가 현금흐름과 유동성에 어떤 의미인지 비교해줘.",
      "텍사스인스트루먼트의 금리, 연금 할인율, 반도체 사이클 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  UBER: {
    ticker: "UBER",
    companyName: "Uber Technologies, Inc.",
    companyNameKo: "우버",
    sectorKo: "모빌리티·배달 플랫폼",
    signature:
      "Mobility, Delivery, advertising·freight, 계절성과 trip volume이 segment revenue를 좌우합니다.",
    description:
      "기업 리포트: Mobility platform operations, Delivery platform operations, ride-sharing·food delivery, Q4 holiday seasonality와 trip volumes를 함께 봅니다.",
    researchFocus: [
      "Mobility platform",
      "Delivery platform",
      "Trip volumes",
      "Seasonality",
    ],
    riskVariables: [
      "Mobility·Delivery 계절성",
      "소비 수요와 trip volume 변동",
      "운전자·규제 비용",
      "경쟁과 take rate 압박",
    ],
    suggestedPrompts: [
      "우버의 Mobility platform, Delivery platform, Trip volumes가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "우버의 Mobility platform와 Seasonality가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "우버의 Mobility·Delivery 계절성, 소비 수요와 trip volume 변동, 운전자·규제 비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  UNH: {
    ticker: "UNH",
    companyName: "UnitedHealth Group Incorporated",
    companyNameKo: "유나이티드헬스",
    sectorKo: "관리의료·헬스케어 서비스",
    signature:
      "건강보험 underwriting, Optum 서비스, premium pricing과 의료비 예측 오차가 마진을 좌우합니다.",
    description:
      "기업 리포트: UnitedHealthcare 보험료, Optum services, benefits pricing, fixed premium cost recovery limitation과 healthcare cost forecast를 함께 봅니다.",
    researchFocus: [
      "UnitedHealthcare 보험료",
      "Optum services",
      "Benefits pricing",
      "Medical cost forecast",
    ],
    riskVariables: [
      "의료비 예측 초과",
      "고정 보험료 기간 내 비용 회수 한계",
      "가격 산정 방법론",
      "규제·Medicare 정책",
    ],
    suggestedPrompts: [
      "유나이티드헬스의 UnitedHealthcare 보험료, Optum services, Benefits pricing가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "유나이티드헬스의 UnitedHealthcare 보험료와 Medical cost forecast가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "유나이티드헬스의 의료비 예측 초과, 고정 보험료 기간 내 비용 회수 한계, 가격 산정 방법론 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  UNP: {
    ticker: "UNP",
    companyName: "Union Pacific Corporation",
    companyNameKo: "유니언 퍼시픽",
    sectorKo: "철도 운송",
    signature:
      "철도 화물 운송, core pricing, productivity·volume과 severe weather network exposure가 실적을 좌우합니다.",
    description:
      "기업 리포트: rail network operations, freight transportation, core pricing gains, productivity, volume growth와 severe weather·infrastructure maintenance를 함께 봅니다.",
    researchFocus: [
      "Rail network operations",
      "Freight transportation",
      "Core pricing·productivity",
      "Volume growth",
    ],
    riskVariables: [
      "Severe weather와 네트워크 차질",
      "연료·인건비 headwinds",
      "고객 수요와 volume 변동",
      "철도 인프라 유지 capex",
    ],
    suggestedPrompts: [
      "유니언 퍼시픽의 Rail network operations, Freight transportation, Core pricing·productivity가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "유니언 퍼시픽의 Rail network operations와 Volume growth가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "유니언 퍼시픽의 Severe weather와 네트워크 차질, 연료·인건비 headwinds, 고객 수요와 volume 변동 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  V: {
    ticker: "V",
    companyName: "Visa Inc.",
    companyNameKo: "비자",
    sectorKo: "결제 네트워크",
    signature:
      "결제 네트워크, cross-border volume, value-added services와 인재·소송 비용이 영업마진을 좌우합니다.",
    description:
      "기업 리포트: payments volume, cross-border volume, processed transactions, value-added services, personnel compensation과 litigation provision을 함께 봅니다.",
    researchFocus: [
      "Payments volume",
      "Cross-border volume",
      "Processed transactions",
      "Value-added services",
    ],
    riskVariables: [
      "인재 유치·유지 경쟁",
      "Personnel compensation 비용",
      "Litigation provision",
      "규제·수수료 압력",
    ],
    suggestedPrompts: [
      "비자의 payments volume, cross-border volume, value-added services가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "비자의 personnel compensation과 litigation provision이 operating margin에 어떤 영향을 주는지 비교해줘.",
      "비자의 인재 비용, 소송, 규제·수수료 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  VRTX: {
    ticker: "VRTX",
    companyName: "Vertex Pharmaceuticals Incorporated",
    companyNameKo: "버텍스",
    sectorKo: "바이오테크",
    signature:
      "CF 치료제, 신규 파이프라인, IRA mandatory rebates와 in-licensing 비용이 마진을 좌우합니다.",
    description:
      "기업 리포트: cystic fibrosis franchise, 신규 치료제 pipeline, government pricing compliance, drug reimbursement와 business development·in-licensing cost를 함께 봅니다.",
    researchFocus: [
      "Cystic fibrosis franchise",
      "신규 치료제 pipeline",
      "Government pricing compliance",
      "Business development·in-licensing",
    ],
    suggestedPrompts: [
      "버텍스의 CF 치료제와 신규 파이프라인이 매출 성장에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "버텍스의 IRA mandatory rebates와 in-licensing 비용이 gross margin과 operating margin에 어떤 의미인지 비교해줘.",
      "버텍스의 IRA, 환급 개혁, in-licensing 비용 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    riskVariables: [
      "IRA mandatory rebates",
      "Drug reimbursement reform",
      "In-licensing 비용 상승",
      "인재 확보와 임상·규제 리스크",
    ],
    questionChains: {},
  },
  VZ: {
    ticker: "VZ",
    companyName: "Verizon Communications Inc.",
    companyNameKo: "버라이즌",
    sectorKo: "통신",
    signature:
      "무선·광대역 서비스, spectrum license payments, 노동계약과 postretirement benefit 비용이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: wireless service, broadband, Auction 107 clearing costs, labor union renegotiation과 healthcare cost trend assumption을 함께 봅니다.",
    researchFocus: [
      "Wireless service",
      "Broadband",
      "Spectrum license payments",
      "Labor management",
    ],
    riskVariables: [
      "Auction clearing cost payments",
      "노동계약 재협상",
      "Healthcare cost trend assumption",
      "부채·금리와 capex",
    ],
    suggestedPrompts: [
      "버라이즌의 Wireless service, Broadband, Spectrum license payments가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "버라이즌의 Wireless service와 Labor management가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "버라이즌의 Auction clearing cost payments, 노동계약 재협상, Healthcare cost trend assumption 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  WDC: {
    ticker: "WDC",
    companyName: "Western Digital Corporation",
    companyNameKo: "웨스턴디지털",
    sectorKo: "스토리지·반도체",
    signature:
      "HDD 제조, 제품 판매, 부품 조달, 제조 원가와 데이터 저장장치 수요 사이클이 실적을 좌우합니다.",
    description:
      "기업 리포트: HDD·스토리지 제품 판매, 제조 운영, 부품 조달, 부채·자본투자와 최종수요·환율 변수를 함께 봅니다.",
    researchFocus: [
      "HDD 제조",
      "스토리지 제품 판매",
      "부품 조달",
      "제조 원가와 설비투자",
    ],
    riskVariables: [
      "최종수요와 스토리지 사이클",
      "공급망 차질",
      "환율과 지정학 리스크",
      "부채·금리와 유동성",
    ],
    suggestedPrompts: [
      "웨스턴디지털의 HDD 제조, 스토리지 제품 판매, 부품 조달이 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "웨스턴디지털의 제조 원가와 설비투자가 매출총이익률, 현금흐름, 부채 부담에 어떤 의미인지 비교해줘.",
      "웨스턴디지털의 최종수요, 공급망 차질, 환율·지정학 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  WELL: {
    ticker: "WELL",
    companyName: "Welltower Inc.",
    companyNameKo: "웰타워",
    sectorKo: "헬스케어 리츠",
    signature:
      "시니어 주거·의료 부동산, 부동산 인수·개발, 임대·자산관리와 자본시장 접근성이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: 헬스케어 부동산 포트폴리오, 시니어 주거 운영, 부동산 인수·개발, 부채·금리·규제 리스크를 함께 봅니다.",
    researchFocus: [
      "시니어 주거·의료 부동산",
      "부동산 인수와 처분",
      "개발·건설 프로젝트",
      "임대·자산관리",
    ],
    riskVariables: [
      "금리와 부채 비용",
      "자본시장 접근성",
      "규제 승인과 운영비",
      "입주율·신용위험",
    ],
    suggestedPrompts: [
      "웰타워의 시니어 주거·의료 부동산, 부동산 인수와 처분, 개발 프로젝트가 매출과 현금흐름을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "웰타워의 임대·자산관리와 자본시장 접근성이 운영현금흐름, 부채 부담, 성장 투자에 어떤 의미인지 비교해줘.",
      "웰타워의 금리와 부채 비용, 규제 승인, 입주율·신용위험 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
  WFC: {
    ticker: "WFC",
    companyName: "Wells Fargo & Company",
    companyNameKo: "웰스파고",
    sectorKo: "은행",
    signature:
      "순이자수익, 예금·대출, 카드·모기지, 외환·파생상품 노출과 신용비용이 실적을 좌우합니다.",
    description:
      "기업 리포트: consumer banking, commercial banking, deposits·loans, derivative assets/liabilities, foreign exchange contracts와 credit market exposure를 함께 봅니다.",
    researchFocus: ["순이자수익", "예금·대출", "카드·모기지", "외환·파생상품"],
    riskVariables: [
      "Foreign exchange derivative exposure",
      "신용비용과 경기 민감도",
      "예금 비용과 금리",
      "규제·운영 리스크",
    ],
    suggestedPrompts: [
      "웰스파고의 순이자수익, 예금·대출, 카드·모기지가 매출과 마진을 어떻게 만드는지 공시 기준으로 정리해줘.",
      "웰스파고의 순이자수익와 외환·파생상품가 현금흐름, 성장 투자, 비용 구조에 어떤 의미인지 비교해줘.",
      "웰스파고의 Foreign exchange derivative exposure, 신용비용과 경기 민감도, 예금 비용과 금리 리스크가 성장 thesis를 어떻게 흔드는지 정리해줘.",
    ],
    questionChains: {},
  },
} satisfies Record<string, CompanyResearchProfile>;
export const APPLE_RESEARCH_PROFILE = COMPANY_RESEARCH_PROFILES.AAPL;
export { APPLE_QUESTION_CHAINS };

export type SuggestedPromptSet = readonly string[];

export interface CompanyLandingUiCopy {
  // [공통 하드코딩 스키마]
  // - name/companyNameKo: 영문/한국어 회사명. 티커만 보이지 않도록 상세/목록 UI에서 함께 사용한다.
  // - description: 회사 비즈니스/영역 한 줄 요약(한국어)
  // - sector: 업종 라벨(한국어)
  // - core_strength: "핵심 성장 동력: 항목1, 항목2, 항목3"
  // - critical_risk: "주요 리스크 요인: 항목1, 항목2, 항목3"
  // - suggested_prompts: 회사 상세/채팅 빈 화면에 노출되는 한국어 추천 질문
  // 핵심 성장동력/리스크 항목은 공통적으로 3개씩 쓰되, 최소 2개 이상이어야 제안 질문이 안전하게 생성됨.
  name?: string;
  companyNameKo?: string;
  description?: string;
  sector?: string | null;
  core_strength?: string;
  critical_risk?: string;
  suggested_prompts?: SuggestedPromptSet;
}

function companyResearchProfileToLandingCopy(
  profile: CompanyResearchProfile,
): CompanyLandingUiCopy {
  return {
    name: profile.companyName,
    companyNameKo: profile.companyNameKo,
    sector: profile.sectorKo,
    core_strength: `리서치 초점: ${profile.researchFocus.join(", ")}`,
    critical_risk: `리스크 변수: ${profile.riskVariables.join(", ")}`,
    description: profile.description,
    suggested_prompts: profile.suggestedPrompts,
  };
}

const COMPANY_LANDING_UI_COPY = Object.fromEntries(
  Object.entries(COMPANY_RESEARCH_PROFILES).map(([ticker, profile]) => [
    ticker,
    companyResearchProfileToLandingCopy(profile),
  ]),
) as Record<string, CompanyLandingUiCopy>;

function normalizeTickerForCopy(ticker: string): string | null {
  const normalized = ticker.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function getCompanyLandingCopyForTicker(
  ticker: string,
): CompanyLandingUiCopy {
  const normalized = normalizeTickerForCopy(ticker);
  if (!normalized) return {};
  return COMPANY_LANDING_UI_COPY[normalized] ?? {};
}

export function hasCompanyLandingCopyForTicker(ticker: string): boolean {
  const normalized = normalizeTickerForCopy(ticker);
  return Boolean(normalized && COMPANY_LANDING_UI_COPY[normalized]);
}

export function listCompanyLandingCopyTickers(): string[] {
  return Object.keys(COMPANY_LANDING_UI_COPY).sort();
}

// UI guardrail: each Korean prompt must be concise to avoid compact layout overflow.
export const DEFAULT_SUGGESTED_PROMPTS: SuggestedPromptSet = [
  "핵심성장 동력이 뭔가요?",
  "핵심성장 동력은 지금 어떻게 되나요?",
  "주요리스크 요인은 어떤가요?",
];

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function parseListField(value?: string): string[] {
  if (!value) return [];
  // 하드코딩 텍스트 포맷 공통 규격:
  //   핵심 성장 동력: x, y, z
  //   주요 리스크 요인: a, b, c
  // 추천 질문은 위 형식에서 항목명을 추출해서 자동 생성한다.
  const normalized = value
    .replace(/^핵심 성장 동력:\s*/, "")
    .replace(/^핵심 성장 동력\s*:\s*/, "")
    .replace(/^주요 리스크 요인:\s*/, "")
    .replace(/^주요 리스크 요인\s*:\s*/, "")
    .replace(/^리서치 초점:\s*/, "")
    .replace(/^리서치 초점\s*:\s*/, "")
    .replace(/^리스크 변수:\s*/, "")
    .replace(/^리스크 변수\s*:\s*/, "");

  if (normalized.includes("\n") || normalized.includes(";")) {
    return normalized
      .split(/[\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return normalized
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function simplifyTerm(value: string): string {
  const cleaned = value
    .replace(/\(.*?\)/g, "")
    .replace(/\b및\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) {
    return "주요 사업 활동";
  }

  return cleaned;
}

function curatedPromptsForCopy(
  copy: CompanyLandingUiCopy,
): SuggestedPromptSet | null {
  const prompts = copy.suggested_prompts
    ?.map((prompt) => prompt.trim())
    .filter(Boolean);

  return prompts && prompts.length > 0 ? prompts : null;
}

function buildPromptsForTicker(ticker: string): SuggestedPromptSet {
  const copy = getCompanyLandingCopyForTicker(ticker);
  const curatedPrompts = curatedPromptsForCopy(copy);
  if (curatedPrompts) return curatedPrompts;

  const coreTerms = parseListField(copy.core_strength).map(simplifyTerm);
  const riskTerms = parseListField(copy.critical_risk).map(simplifyTerm);

  const coreA = coreTerms[0] ?? "핵심성장 동력";
  const coreB = coreTerms[1] ?? coreTerms[0] ?? "운영 효율";
  const riskA = riskTerms[0] ?? "주요리스크 요인";

  return [
    `핵심성장 동력인 '${coreA}'은(는) 어떤가요?`,
    `핵심성장 동력인 '${coreB}'은(는) 어떻게 되나요?`,
    `주요리스크 요인인 '${riskA}'은(는) 어떤가요?`,
  ];
}

export function getSuggestedPromptsForTickers(
  tickers: readonly string[],
): SuggestedPromptSet {
  const normalizedTickers = Array.from(
    new Set(tickers.map(normalizeTicker).filter(Boolean)),
  );

  if (normalizedTickers.length === 1) {
    return buildPromptsForTicker(normalizedTickers[0]);
  }

  if (normalizedTickers.length > 1) {
    return [
      "성장 동인을 비교해줘",
      "마진 흐름을 비교해줘",
      "핵심 리스크를 비교해줘",
    ];
  }

  return DEFAULT_SUGGESTED_PROMPTS;
}
