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
            title: "성장 논지에 어떤 의미야?",
            question:
              "Apple의 iPhone과 Services 매출 변화가 성장 논지에 어떤 의미인지 지지 근거와 우려 근거로 나눠줘.",
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
              "Apple 성장 논지를 가장 크게 흔들 수 있는 리스크를 공시 근거와 함께 우선순위로 정리해줘.",
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
      "Apple에 대한 성장 논지를 iPhone, Services, 마진, App Store 규제, 공급망 리스크로 나눠 점검해줘.",
    stages: [
      {
        id: "claim",
        label: "가설",
        nodes: [
          {
            id: "state-thesis",
            title: "내 thesis를 어떻게 쪼개?",
            question:
              "Apple 성장 논지를 iPhone 성장, Services 전환, 마진, 지역 수요, 규제 리스크로 쪼개줘.",
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
      "iPhone과 Services 생태계를 중심으로 매출을 만들고, 지역 수요와 App Store 규제가 성장 논지의 방향성을 좌우하는 플랫폼형 기업",
    description:
      "Apple은 iPhone과 Services를 중심으로 수익을 창출하며, Pro 모델 수요, App Store 수익 구조, Greater China 및 지역별 수요 변동, 공급망·관세·환율이 매출총이익률과 현금흐름 해석의 핵심 변수입니다.",
    researchFocus: [
      "iPhone 매출과 Pro 모델 수요의 가격·물량 기여",
      "Services 및 App Store 구독·거래형 수익 구조",
      "Greater China와 지역별 매출 흐름",
      "제품·Services 믹스가 매출총이익률에 미치는 영향",
      "R&D·SG&A 비용 효율성이 장기 마진에 미치는 효과",
    ],
    riskVariables: [
      "App Store 규제, 외부 결제 연동, 반독점 리스크",
      "중국·아시아권 외주 제조 및 공급망 집중",
      "관세·희토류·부품 조달 비용 상승 압력",
      "환율 변동, 최종수요 둔화, 지역별 iPhone 수요 편차",
    ],
    suggestedPrompts: [
      "Apple의 iPhone, Services, Mac, iPad, Wearables 수익 구조를 공시 기준으로 정리하고 최근 성장 동인을 매출총이익률 중심으로 설명해줘.",
      "Apple의 iPhone·Services 매출 비중, 지역별 성장 동인, R&D·SG&A 추세가 마진과 현금창출력에 어떻게 연결되는지 비교해줘.",
      "Apple의 App Store 규제, 공급망 집중도, Greater China 수요가 성장 논지를 훼손할 수 있는 리스크를 공시 근거로 우선순위화해줘.",
    ],
    questionChains: APPLE_QUESTION_CHAINS,
  },
  ABBV: {
    ticker: "ABBV",
    companyName: "AbbVie Inc.",
    companyNameKo: "애브비",
    sectorKo: "제약",
    signature:
      "Humira에서 Skyrizi·Rinvoq로의 매출 전환 속도와 Botox의 이익 기여도가 애브비의 핵심 성장 축을 만들고, IRA·Medicare 환경은 가격 전가력을 제한하는 제약 조건입니다.",
    description:
      "애브비는 Humira 이후 Skyrizi·Rinvoq로의 면역질환 매출 전환, Botox의 수익성 완충 효과, IRA·Medicare 가격 협상 체계가 현금흐름과 마진에 미치는 영향을 함께 읽어야 합니다.",
    researchFocus: [
      "Humira 의존도 축소 속도와 스위칭 리스크",
      "Skyrizi의 면역질환 성장 지속성",
      "Rinvoq의 적응증 확대와 경쟁 압력",
      "Botox의 미용의학 수익성",
    ],
    riskVariables: [
      "IRA·Medicare 가격 협상 및 환급 규칙 변화",
      "Humira 바이오시밀러 경쟁에 따른 가격 하방 압력",
      "특허·규제 변화와 파이프라인 가시성",
      "인건비와 영업·마케팅 비용 통제",
    ],
    suggestedPrompts: [
      "애브비의 Humira에서 Skyrizi·Rinvoq로의 매출 전환이 어떤 속도로 진행되고 있는지 공시 기준으로 정리해줘.",
      "Skyrizi·Rinvoq와 Botox의 매출·현금흐름 기여도가 매출총이익률과 비용 구조에 어떻게 다르게 반영되는지 비교해줘.",
      "IRA·Medicare 가격 협상, Humira 바이오시밀러 경쟁, 인건비 상승이 애브비의 성장 논지를 어떤 순서로 압박하는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  ABT: {
    ticker: "ABT",
    companyName: "Abbott Laboratories",
    companyNameKo: "애보트",
    sectorKo: "헬스케어",
    signature:
      "FreeStyle Libre 중심의 diabetes care와 diagnostics, nutrition, medical devices, established pharmaceuticals가 애보트의 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: FreeStyle Libre, diagnostics, nutrition, medical devices, established pharmaceuticals의 매출 믹스와 R&D·SG&A·제품 원가를 연결해 성장 논지를 점검합니다.",
    researchFocus: [
      "FreeStyle Libre 및 diabetes care 센서·소모재",
      "diagnostics(Alinity, molecular, point-of-care, rapid) 포트폴리오",
      "nutrition(성인·소아) 매출 구조와 수요 회복",
      "medical devices 세부 카테고리(vascular, heart, neuromodulation 등)",
      "established pharmaceuticals 지역별 성장 동인과 가격 정책",
    ],
    riskVariables: [
      "보험·정부 환급 정책 변화가 가격 전가력에 미치는 영향",
      "diagnostics 수요 변동과 segment 수익성 민감도",
      "환율·원재료·인건비 변동이 제품 원가와 매출총이익률에 미치는 압박",
      "R&D·SG&A 비용 확대가 현금흐름과 성장 속도에 미치는 영향",
      "규제 승인·공급망·재고 가용성 지연에 따른 출시 및 판매 변동성",
    ],
    suggestedPrompts: [
      "애보트에서 FreeStyle Libre, diagnostics, nutrition, medical devices, established pharmaceuticals의 매출 동인과 실적 변화를 공시 기준으로 비교해줘.",
      "애보트의 medical devices, diagnostics, nutrition을 segment별로 나눠 매출총이익률, 현금창출력, 비용 구조 차이를 정리해줘.",
      "애보트의 환율, 원가, R&D·SG&A 압박이 성장 논지를 어떻게 흔드는지 체크포인트 중심으로 공시 근거와 함께 정리해줘.",
    ],
    questionChains: {},
  },
  ADBE: {
    ticker: "ADBE",
    companyName: "Adobe Inc.",
    companyNameKo: "어도비",
    sectorKo: "소프트웨어·디지털 미디어",
    signature:
      "Creative Cloud, Document Cloud, Experience Cloud 포트폴리오를 기반으로 한 구독 성장과 AI 투자 강도가 실적의 핵심 축이며, 제3자 호스팅·데이터센터 비용이 마진 가이드로 작동합니다.",
    description:
      "기업 리포트: Creative Cloud, Document Cloud, Digital Media·Digital Experience·Experience Cloud 제품군의 성장 동인, Firefly 기반 AI 확산, 구독 수익 구조, 제3자 호스팅·데이터센터 및 AI 추론 비용이 매출총이익률에 미치는 영향을 함께 봅니다.",
    researchFocus: [
      "Creative Cloud",
      "Document Cloud",
      "Experience Cloud",
      "Digital Media",
      "Digital Experience",
      "Firefly",
      "구독형 수익(ARR)",
      "제3자 호스팅·AI 추론 비용",
      "제3자 파트너 의존도",
    ],
    riskVariables: [
      "제3자 호스팅·데이터센터 및 AI 추론 비용 부담",
      "구독 성장 둔화로 인한 매출확장 민감도",
      "영업·마케팅 비용 증가와 마진 탄력성",
      "AI 규제·보안·사회적 리스크",
      "전략적 파트너 조달·유통 정책 변화",
      "거시환경 및 환율 변동",
    ],
    suggestedPrompts: [
      "어도비에서 Creative Cloud, Document Cloud, Experience Cloud 포트폴리오 중 어떤 제품군이 구독 성장에 가장 크게 기여하는지 공시 기준으로 정리해줘.",
      "어도비의 Creative ARR, Document ARR, Firefly 적용 확대가 매출 확장과 현금흐름에 어떻게 반영되는지 공시 근거로 비교해줘.",
      "어도비의 제3자 호스팅·데이터센터 및 AI 추론 비용, 제3자 파트너 리스크, 영업·마케팅 비용 증가가 성장 논지에 미치는 리스크를 공시 기준으로 정리해줘.",
    ],
    questionChains: {},
  },
  ADI: {
    ticker: "ADI",
    companyName: "Analog Devices, Inc.",
    companyNameKo: "아날로그 디바이시스",
    sectorKo: "반도체",
    signature:
      "analog·mixed-signal과 power management 수요의 확대가 성장 논지의 핵심이며, industrial·automotive 수요의 속도와 공급망 조달 효율이 마진 경로를 좌우합니다.",
    description:
      "기업 리포트: analog·mixed-signal과 power management 포트폴리오를 중심으로 industrial·automotive 수요 전개, 공급망 조달 안정성, 재고 구매 약정, R&D·보상비 구조를 함께 점검합니다.",
    researchFocus: [
      "analog·mixed-signal 및 power management 수요",
      "industrial·automotive 수요 성장",
      "공급망 조달(납기·가격·품질) 안정성",
      "재고 구매 약정과 운영 자본 부담",
    ],
    riskVariables: [
      "핵심 조달처 납기·가격·품질 변동",
      "재고 구매 약정 부담과 재고 회전 저하",
      "industrial·automotive 수요 순환성",
      "R&D·인재 보상 비용 상승",
    ],
    suggestedPrompts: [
      "아날로그 디바이시스에서 analog·mixed-signal, power management, industrial·automotive 수요가 매출 성장을 각각 어떻게 견인하는지 공시 기준으로 정리해줘.",
      "아날로그 디바이시스의 industrial·automotive 수요 변화가 power management와 analog 제품군의 매출총이익률·현금흐름에 미치는 차이를 비교해줘.",
      "핵심 공급망 차질, 재고 구매 약정, R&D·보상비 구조가 ADI 성장 논지와 영업이익률에 어떤 압박을 주는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AMAT: {
    ticker: "AMAT",
    companyName: "Applied Materials, Inc.",
    companyNameKo: "어플라이드 머티어리얼즈",
    sectorKo: "반도체 장비",
    signature:
      "Semiconductor Systems의 wafer fab equipment 수요와 Applied Global Services 매출이 성장 논지의 핵심 축이고, 고객 투자 사이클과 R&D가 마진 경로를 좌우합니다.",
    description:
      "공시 기준 기업 리포트: 반도체 장비 수익화(wafer fab equipment), Applied Global Services(서비스·스페어·업그레이드), 고객 투자 사이클을 함께 보아 성장 논지와 수익성 변동을 추적합니다.",
    researchFocus: [
      "Semiconductor Systems와 Applied Global Services 수익 구조",
      "wafer fab equipment 수요와 고객 투자 주기",
      "서비스·스페어·업그레이드를 통한 매출 안정성",
      "R&D·수율·공급망이 마진 전달에 미치는 영향",
    ],
    riskVariables: [
      "China export controls와 인허가 지연이 주문과 수익성에 미치는 충격",
      "고객 주문 변동성 및 조달 병목으로 인한 반도체 장비 납기 리스크",
      "부품·원재료·운송비 변동과 수율 변동이 마진을 잠식할 가능성",
      "규제 준수 비용 및 법률 리스크가 영업 안정성에 미치는 부담",
    ],
    suggestedPrompts: [
      "어플라이드 머티어리얼즈에서 Semiconductor Systems(wafer fab equipment)와 Applied Global Services의 수익원이 공시 기준에서 어떻게 나뉘는지, 성장 논지와 어떤 연관인지 정리해줘.",
      "어플라이드 머티어리얼즈의 최근 공시 기준 Semiconductor Systems와 Applied Global Services 영업마진 추세를 비교하고, 성장 논지·비용 구조 차이를 구체적으로 설명해줘.",
      "어플라이드 머티어리얼즈의 China export controls, 고객 주문 변동, 공급망 리스크가 현금흐름, 마진, R&D 투자 여력에 어떤 순서로 영향을 주는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AMD: {
    ticker: "AMD",
    companyName: "Advanced Micro Devices, Inc.",
    companyNameKo: "에이엠디",
    sectorKo: "반도체·데이터센터",
    signature:
      "AI 인프라의 data center GPU와 EPYC 서버 CPU가 성장 축이며, Ryzen·Radeon은 수요 둔화 민감도가 큰 보조 축입니다. wafer·substrate 조달과 export controls가 마진·현금흐름 변동성의 핵심입니다.",
    description:
      "기업 리포트: data center GPU(Instinct MI300 계열)와 EPYC 채택률, Ryzen·Radeon 믹스, wafer·substrate 조달 상태, 미국 export controls 제약 경로를 함께 보며 성장성·마진·투자 부담을 연결해 해석합니다.",
    researchFocus: [
      "data center GPU(Instinct MI300)와 EPYC 수요",
      "Ryzen·Radeon의 출하·가격 전가력",
      "wafer·substrate 조달과 재고 전환 속도",
      "CSP 약정 구조와 AI 인프라 전환 속도",
    ],
    riskVariables: [
      "수출통제 국가군 변경으로 인한 고성능 data center GPU·EPYC 판매 제약",
      "wafer·substrate 조달 병목과 lead-time 연장",
      "CSP CAPEX 조정과 선수요 하락이 매출 타이밍에 미치는 영향",
      "Ryzen·Radeon 수요 변동이 마진·영업현금흐름 완충력을 떨어뜨리는 채널",
    ],
    suggestedPrompts: [
      "에이엠디에서 data center GPU·EPYC가 성장의 중심이고 Ryzen·Radeon이 어떤 변동축인지 공시 기준으로 분리해 정리해줘.",
      "에이엠디의 Instinct MI300 수요, wafer·substrate 조달, CSP 약정이 매출총이익률과 영업현금흐름에 어떤 경로로 반영되는지 비교해줘.",
      "에이엠디의 export controls, wafer·substrate 병목, CSP CAPEX 둔화가 성장 논지를 제약할 가능성이 높은 구간을 어떤 지표로 점검해야 하는지 정리해줘.",
    ],
    questionChains: {},
  },
  AMGN: {
    ticker: "AMGN",
    companyName: "Amgen Inc.",
    companyNameKo: "암젠",
    sectorKo: "바이오의약품",
    signature:
      "Enbrel, Prolia, Repatha, Otezla, Tepezza를 포함한 핵심 바이오의약품의 매출 가시성, Horizon 자산 통합 성과, 파이프라인 상업화와 제조·공급 효율이 성장 논지의 핵심을 이룹니다.",
    description:
      "기업 리포트: Enbrel·Prolia·Repatha·Otezla·Tepezza의 제품군 매출 흐름, Horizon 통합 성과, 파이프라인 상업화 속도, IRA·Medicare 및 biosimilar 환경이 매출총이익률과 현금흐름에 미치는 영향을 함께 봅니다.",
    researchFocus: [
      "Enbrel·Prolia 중심 매출 성장 동인",
      "Repatha·Otezla·Tepezza 포트폴리오 기여",
      "Horizon 자산 통합 성과",
      "파이프라인 상업화와 제조·공급망 효율",
    ],
    riskVariables: [
      "IRA·Medicare 가격 협상 및 환급 압력",
      "약가·리베이트 정책 변화",
      "biosimilar 진입과 가격 경쟁 심화",
      "규제 승인 일정 지연 및 임상 실패",
    ],
    suggestedPrompts: [
      "암젠에서 Enbrel·Prolia·Repatha·Otezla·Tepezza가 성장 논지를 어떻게 구성하는지, 공시 기준으로 매출 기여도를 정리해줘.",
      "암젠의 핵심 제품군 수익화, Horizon 통합 성과, 파이프라인 상업화 진행이 마진·현금흐름·투자 부담에 어떤 차이를 주는지 비교해줘.",
      "암젠의 IRA·Medicare 가격 협상, 약가·리베이트 압력, biosimilar 경쟁이 성장 논지에 미치는 부담 요인을 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AMZN: {
    ticker: "AMZN",
    companyName: "Amazon.com, Inc.",
    companyNameKo: "아마존",
    sectorKo: "이커머스·클라우드",
    signature:
      "North America·International, AWS, Prime, advertising, third-party seller services, fulfillment의 구조적 연동이 매출 성장·매출총이익률·현금흐름을 가르는 핵심입니다.",
    description:
      "기업 리포트: North America·International 리테일의 매출 구성, AWS의 사용량·요금·마진 구조, Prime 구독·advertising 성장, third-party seller services와 fulfillment 비용 구조를 공시 기준으로 함께 봅니다.",
    researchFocus: [
      "North America·International 리테일",
      "AWS 클라우드 서비스",
      "Prime·advertising",
      "third-party seller services 및 fulfillment 효율",
    ],
    riskVariables: [
      "인건비와 운영 효율 악화",
      "운송·에너지·포장재 비용 변동",
      "가격 전가력 약화와 리테일 경쟁 압박",
      "환율·규제·국가별 세제 변화에 따른 수익성 변동",
    ],
    suggestedPrompts: [
      "아마존의 North America·International 리테일, AWS, Prime, advertising, third-party seller services가 매출과 매출총이익률을 어떻게 분해해 만들고 있는지 공시 기준으로 정리해줘.",
      "아마존의 AWS와 North America·International 중 어떤 축이 영업이익률, 현금흐름, 투자 부담에 더 큰 변동성을 만들었는지 비교해줘.",
      "아마존의 인건비·운송·에너지·포장재 비용 압력, 환율·규제 리스크가 fulfillment와 third-party seller services 기반 성장 논지를 어떻게 제약하는지 공시 근거로 점검해줘.",
    ],
    questionChains: {},
  },
  ANET: {
    ticker: "ANET",
    companyName: "Arista Networks, Inc.",
    companyNameKo: "아리스타 네트웍스",
    sectorKo: "클라우드 네트워킹",
    signature:
      "CloudVision·AI networking 중심 포트폴리오와 데이터센터·캠퍼스 네트워킹 수요 축이 성장과 마진 방향을 함께 설명합니다.",
    description:
      "기업 리포트: CloudVision, Ethernet switching, AI networking의 제품·소프트웨어 결합 수요, data center와 campus switching의 투자 주기, 라이선스·서비스 비중 변화를 함께 보며 매출총이익률과 현금흐름을 점검합니다.",
    researchFocus: [
      "CloudVision 기반 AI networking 수익 구조",
      "Ethernet switching 데이터센터 수요",
      "campus switching 성장·교체 흐름",
      "cloud titans 고객군의 프로젝트 수주 주기",
      "부품 조달·재고 운영과 가격·마진 압력",
      "보안·운영 신뢰성 요구와 제품 업그레이드 수요",
    ],
    riskVariables: [
      "cloud titans CAPEX 변동과 데이터센터 투자 사이클",
      "Ethernet switching 가격경쟁 및 단가 하향 압력",
      "부품 조달 병목, 리드타임 지연",
      "보안·안정성 이슈가 수요 전환으로 연결될 위험",
    ],
    suggestedPrompts: [
      "아리스타 네트웍스의 CloudVision, EOS, AI networking 포트폴리오가 data center와 campus switching에서 어떤 비중으로 성장에 기여하는지 공시 기준으로 정리해줘.",
      "아리스타의 Ethernet switching 장비 판매, 소프트웨어 결합, 서비스 매출이 매출총이익률과 현금흐름에 어떤 구조로 반영되는지 비교해줘.",
      "아리스타의 cloud titans 수요 변동, 부품 조달 병목, 가격경쟁 리스크가 성장 논지를 어떻게 제약하거나 지지하는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AVGO: {
    ticker: "AVGO",
    companyName: "Broadcom Inc.",
    companyNameKo: "브로드컴",
    sectorKo: "반도체·인프라 소프트웨어",
    signature:
      "Broadcom의 핵심은 semiconductor solutions, infrastructure software, VMware, AI networking 축입니다. 성장 논지는 Broadcom이 AI networking, custom silicon, wireless, broadband 수요를 얼마나 빠르게 연결하느냐에 달려 있습니다.",
    description:
      "기업 리포트: Broadcom의 semiconductor solutions와 infrastructure software 매출이 어떻게 함께 성장을 만들어내는지, VMware 통합이 비용 구조와 현금흐름에 미치는 영향을 함께 봅니다.",
    researchFocus: [
      "semiconductor solutions 매출",
      "infrastructure software 수익성",
      "VMware 통합 효과",
      "AI networking 수요",
      "custom silicon, wireless, broadband 노출",
    ],
    riskVariables: [
      "VMware 통합 비용 절감 지속성",
      "총부채와 금리 부담",
      "고객 CAPEX 타이밍과 수요 변동",
      "수출규제 및 지정학·공급망 리스크",
    ],
    suggestedPrompts: [
      "Broadcom의 semiconductor solutions, infrastructure software, VMware 통합이 성장 논지에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "Broadcom의 AI networking, custom silicon, wireless, broadband 주문 변화가 매출총이익률과 영업현금흐름에 어떤 의미가 있는지 비교해줘.",
      "Broadcom의 VMware 통합 효과, 총부채·금리 부담, 고객 수요 변동이 성장 논지와 투자 부담에 어떤 제약을 주는지 공시 언어 중심으로 분석해줘.",
    ],
    questionChains: {},
  },
  AXP: {
    ticker: "AXP",
    companyName: "American Express Company",
    companyNameKo: "아메리칸 익스프레스",
    sectorKo: "결제·카드 네트워크",
    signature:
      "Card Member의 지출 활동, billed business에서 파생되는 discount revenue, card portfolio의 credit losses가 성장성과 마진 안정성을 동시에 결정합니다.",
    description:
      "기업 리포트: Card Member 지출과 이탈, 가맹점 네트워크 discount revenue, premium card 확대와 Membership Rewards 연계 효과, 신용 포트폴리오의 credit losses를 함께 봅니다.",
    researchFocus: [
      "Card Member 활동과 billed business 성장",
      "가맹점 기반 discount revenue 구조",
      "Membership Rewards와 premium card 유지율",
      "card portfolio의 credit losses 및 신용비용 추세",
    ],
    riskVariables: [
      "Card Member 지출 둔화와 가격 민감도 상승",
      "고금리 환경에서 가처분소득 둔화로 인한 거래·이익 압박",
      "Membership Rewards·보상비 상승과 premium card 비용 효율 저하",
      "credit losses 확대와 대출 포트폴리오 건전성 악화",
    ],
    suggestedPrompts: [
      "아메리칸 익스프레스의 Card Member 지출, billed business, 가맹점 discount revenue가 영업 실적과 어떤 채널로 연결되는지 공시 기준으로 정리해줘.",
      "아메리칸 익스프레스의 premium card·Membership Rewards 전략이 Card Member당 매출, 할인율, discount revenue에 어떤 실적 효과를 주는지 비교해줘.",
      "아메리칸 익스프레스의 금리·소비 환경 변화가 card portfolio와 credit losses에 미치는 영향이 성장 논지에 어떻게 반영되는지 파악해줘.",
    ],
    questionChains: {},
  },
  BAC: {
    ticker: "BAC",
    companyName: "Bank of America Corporation",
    companyNameKo: "뱅크오브아메리카",
    sectorKo: "은행",
    signature:
      "순이자수익(net interest income), Consumer Banking의 자금중개, Global Wealth & Investment Management의 수수료 기반 성장 구조가 핵심 축입니다.",
    description:
      "기업 리포트: Consumer Banking, Global Wealth & Investment Management, Global Banking, Global Markets 네 채널을 축으로 순이자수익(net interest income)과 수수료 수익을 조합해 성장을 설명합니다. deposits와 loans의 스프레드, 자본배분, 거래·자산운용 민감도를 함께 봅니다.",
    researchFocus: [
      "net interest income(순이자수익)과 Consumer Banking의 deposits·loans 조합",
      "Global Wealth & Investment Management의 자산운용·중개 수수료",
      "Global Banking의 기업금융·자본 조달 수수료",
      "Global Markets, 파생상품 거래, MBS·ABS 민감도",
    ],
    riskVariables: [
      "금리 경로 변화에 따른 deposits 비용과 loans 성장률 압력",
      "MBS·ABS 조기상환 및 공정가치 변동",
      "신용손실과 회수율 하락이 대출 포트폴리오 건전성에 미치는 영향",
      "규제 자본·유동성 규제 강도와 운영비·기술 비용 부담",
    ],
    suggestedPrompts: [
      "뱅크오브아메리카에서 Consumer Banking, Global Wealth & Investment Management, Global Banking, Global Markets가 순이자수익(net interest income), 수수료, 거래수익에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "뱅크오브아메리카의 deposits와 loans 변화가 net interest income에 미치는 영향과, MBS·ABS 운영이 자본과 수익성에 어떤 제약을 주는지 비교해줘.",
      "뱅크오브아메리카의 금리 민감도, MBS·ABS 조기상환 리스크, 규제 자본 부담이 성장 논지를 어떻게 흔드는지 채널별로 정리해줘.",
    ],
    questionChains: {},
  },
  BKNG: {
    ticker: "BKNG",
    companyName: "Booking Holdings Inc.",
    companyNameKo: "부킹 홀딩스",
    sectorKo: "온라인 여행",
    signature:
      "Booking.com, Priceline, Agoda, Rentalcars.com, OpenTable 등 핵심 플랫폼에서 room nights가 수익의 직접 축이 되고, merchant·agency 모델 효율과 advertising and other revenue가 마진을 결정합니다.",
    description:
      "기업 리포트: 예약 거래의 room nights 기반 흐름을 중심으로 Booking.com, Priceline, Agoda, Rentalcars.com, OpenTable의 비즈니스 구조를 점검하고, 성과형 마케팅 및 advertising and other revenue 흐름을 함께 추적해 성장성과 마진 지속성을 평가합니다.",
    researchFocus: [
      "room nights 성장, 플랫폼 트래픽·예약 전환, 수익 연계",
      "merchant·agency 모델별 매출 인식 경로",
      "Booking.com·Priceline·Agoda·Rentalcars.com·OpenTable 채널별 점유율 변화",
      "advertising and other revenue 및 성과형 마케팅 효율",
    ],
    riskVariables: [
      "국제 여행 수요와 room nights 변동성",
      "성과형 마케팅비 상승 및 고객획득 효율 둔화",
      "환율 변동과 현지 가격 경쟁력 압박",
      "여행 플랫폼 규제, 세무·데이터 규제, 파트너 정책 변화",
    ],
    suggestedPrompts: [
      "부킹 홀딩스에서 Booking.com, Priceline, Agoda, Rentalcars.com, OpenTable의 room nights 성장이 어떤 채널로 매출과 이익으로 연결되는지 공시 기준으로 정리해줘.",
      "부킹 홀딩스의 merchant와 agency 모델에서 수익·원가 경로와 현금흐름 차이를 비교해줘.",
      "부킹 홀딩스의 advertising and other revenue와 성과형 마케팅비가 성장 논지에 미치는 영향을 공시 흐름 기준으로 정리해줘.",
    ],
    questionChains: {},
  },
  BLK: {
    ticker: "BLK",
    companyName: "BlackRock, Inc.",
    companyNameKo: "블랙록",
    sectorKo: "자산운용",
    signature:
      "BlackRock은 AUM, 순유입, 상품 채널, 수수료 구조를 통해 수익 방향이 갈리는 글로벌 자산운용사입니다.",
    description:
      "기업 리포트: AUM와 순유입·순유출, iShares·ETF 기반 성장 동력, Aladdin·advisory 기반 수익, base fees와 performance fees의 조합을 함께 봅니다.",
    researchFocus: [
      "AUM와 순유입·순유출",
      "iShares·ETF 상품군",
      "Aladdin·advisory·기술 서비스",
      "base fees와 performance fees 분해",
    ],
    riskVariables: [
      "시장 가격 변동에 따른 AUM 및 순유입 민감도",
      "index 기반 vs active 기반 비중 변동과 수수료 압박",
      "인재 유지 비용 및 기술 투자 부담",
      "규제 강화와 고객 이탈 리스크",
    ],
    suggestedPrompts: [
      "BlackRock의 AUM, 순유입·순유출, iShares·ETF 상품 채널이 수수료 수익으로 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "BlackRock의 Aladdin과 advisory 사업이 어디서 수익으로 이어지며, base fees와 performance fees로 어떻게 나뉘는지 매출 구조적으로 설명해줘.",
      "BlackRock의 시장 사이클에서 성장 논지가 흔들리는 구간과 견조해지는 구간을 AUM, iShares, 수수료 조합 관점에서 정리해줘.",
    ],
    questionChains: {},
  },
  C: {
    ticker: "C",
    companyName: "Citigroup Inc.",
    companyNameKo: "씨티그룹",
    sectorKo: "은행",
    signature:
      "Citi의 핵심은 Banking·Markets·Wealth·Services에서 기인한 수익 구조이며, net interest income, credit costs, regulatory capital 운용이 이익 변동성을 좌우합니다.",
    description:
      "기업 리포트: Banking, Markets, Wealth, Services를 축으로 수익원과 비용 흐름을 분해하고, U.S. Personal Banking의 신용·유동성 특성과 자본 여력을 함께 분석해 실제 실적 전이를 확인합니다.",
    researchFocus: [
      "Banking, Markets, Wealth 수익 구조의 실제 연결",
      "U.S. Personal Banking 신용 포트폴리오와 수익성",
      "Treasury and Trade Solutions 및 글로벌 결제·자금조달 흐름",
      "Services, fee 기반 수익과 자산·부채 조달 믹스",
    ],
    riskVariables: [
      "credit costs 증가 시 수익성 및 자본 여력 훼손",
      "금리 경로 변화가 net interest income에 미치는 민감도",
      "Markets 손익 변동성과 수익 변동성 확대",
      "규제 환경 변화가 regulatory capital와 성장 투자 여력에 미치는 제약",
    ],
    suggestedPrompts: [
      "씨티그룹의 Banking, Markets, Wealth, Services 영업 구조를 공시 기준으로 나눠보고 수익·비용이 어느 라인에서 발생하는지 연결해줘.",
      "씨티그룹의 U.S. Personal Banking에서 대출 성장, 이탈, 신용 관리가 credit costs로 어떻게 이어지는지 공시 기준으로 점검해줘.",
      "씨티그룹의 Markets 손익과 net interest income 변화를 규제·자본 제약 관점에서 보고, regulatory capital과 배당 여력의 제약 요인을 정리해줘.",
    ],
    questionChains: {},
  },
  CAT: {
    ticker: "CAT",
    companyName: "Caterpillar Inc.",
    companyNameKo: "캐터필러",
    sectorKo: "산업기계",
    signature:
      "Construction Industries와 Resource Industries 수요, Energy & Transportation의 프로젝트 성격, Cat Financial 동반 판매가 실적의 구조적 변동축입니다. dealer inventory와 backlog가 수요 선행 신호로 작동하는지가 핵심입니다.",
    description:
      "기업 리포트: Construction Industries, Resource Industries, Energy & Transportation의 장비·부품·서비스 매출 연결, Cat Financial 자금조달 구조, dealer inventory와 backlog의 상호작용을 함께 분석합니다.",
    researchFocus: [
      "Construction Industries 프로젝트 수주·출하 모멘텀",
      "Resource Industries 광산 장비의 지역·사이클별 수요",
      "Energy & Transportation 엔진·시설 장비·정비 수요",
      "Cat Financial의 신용 조건과 장비 판매 연동",
    ],
    riskVariables: [
      "원자재·부품 가격 변동과 가격 전가력 둔화",
      "dealer inventory 조정 지연에 따른 생산·출하 제약",
      "backlog 축소와 프로젝트 지연으로 인한 매출 집행 충격",
      "Cat Financial 신용조건 변화로 인한 회수율·현금흐름 압박",
      "공급망·환율 변동이 장비 구성비와 마진에 미치는 영향",
    ],
    suggestedPrompts: [
      "캐터필러의 Construction Industries와 Resource Industries 수주·출하가 dealer inventory와 backlog 변화와 함께 실적에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "Cat Financial이 장비 리스·대출 조건에 어떻게 결합되어 고객 구매력, 회수율, 현금흐름에 영향을 주는지 구체적으로 설명해줘.",
      "Energy & Transportation 장비·부품·서비스 매출이 매출총이익률과 영업이익률 경로에 미치는 영향을 성장 논지 관점에서 정리해줘.",
    ],
    questionChains: {},
  },
  COST: {
    ticker: "COST",
    companyName: "Costco Wholesale Corporation",
    companyNameKo: "코스트코",
    sectorKo: "창고형 리테일",
    signature:
      "창고형 리테일(warehouse) 기반의 멤버십 모델에서 상품 회전율과 membership fees를 동시에 지탱해야 수익성이 유지됩니다.",
    description:
      "기업 리포트: 창고형 리테일 매출, membership fees, 상품 조달·물류비, 가격 전략이 매출총이익률·영업이익률에 어떻게 연결되는지 확인합니다. comparable sales, private label(Kirkland Signature) 비중, 점포·회원 확대 속도와 함께 성장의 질을 점검합니다.",
    researchFocus: [
      "membership fees와 멤버십 갱신율(renewal rate) 유지력",
      "창고형 리테일 매출 구조와 comparable sales 동향",
      "private label(Kirkland Signature) 상품 믹스와 마진 기여",
      "상품 조달·물류비, 연료·에너지비와 비용 관리",
    ],
    riskVariables: [
      "상품 원가 및 물류비 상승이 매출총이익률에 미치는 영향",
      "가격 경쟁 심화와 판매량·마진 압박",
      "comparable sales 둔화와 traffic 약화",
      "멤버십 갱신율(renewal rate) 하락에 따른 membership fees 수익성 리스크",
    ],
    suggestedPrompts: [
      "코스트코의 membership fees, 창고형 리테일 매출, warehouse 확장이 영업이익률에 어떤 경로로 반영되는지 공시 기준으로 정리해줘.",
      "코스트코의 comparable sales와 private label(Kirkland Signature) 매출 비중, 상품 조달·물류비가 원가 구조와 마진 방어에 미치는 영향을 분석해줘.",
      "코스트코의 renewal rate, 가격 전략, 비용 구조가 성장 논지의 지속성에 어떤 제약과 완충을 주는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  CSCO: {
    ticker: "CSCO",
    companyName: "Cisco Systems, Inc.",
    companyNameKo: "시스코",
    sectorKo: "네트워킹 장비",
    signature:
      "네트워크 성장은 AI infrastructure 수요가 견인하고, security·observability 믹스와 subscriptions 전환이 마진과 현금흐름 방향을 가릅니다.",
    description:
      "기업 리포트: networking(라우팅·스위칭·무선)과 AI infrastructure 성장, security·observability 수익 추이, subscriptions 전환, remaining performance obligations 및 deferred revenue의 선행성 신호를 함께 점검합니다.",
    researchFocus: [
      "networking와 AI infrastructure 성장 모멘텀",
      "security 및 observability 믹스 변화",
      "subscriptions 확대와 churn·renewal 민감도",
      "remaining performance obligations의 수익 선행성",
    ],
    riskVariables: [
      "AI demand 둔화가 네트워크 제품 mix와 매출총이익률로 전이되는 속도",
      "security와 observability에서 Splunk 소비 전환이 제품 수익성에 미치는 영향",
      "서비스 매출총이익률 하락 요인의 지속성",
      "컴포넌트 수급 및 제조 비용 변동이 주문 이행·가격 전가에 미치는 압박",
    ],
    suggestedPrompts: [
      "시스코의 networking 카테고리(라우팅·스위칭·무선)와 AI infrastructure가 매출 성장과 매출총이익률에 어떤 경로로 기여했는지 공시 기준으로 정리해줘.",
      "시스코의 security·observability 카테고리에서 Splunk가 on-premise에서 cloud subscriptions로 이동한 흐름이 수익 구성과 성장 동인에 어떤 영향을 줬는지 공시 근거로 비교해줘.",
      "시스코의 subscriptions, remaining performance obligations, deferred revenue가 향후 성장 가시성과 리스크 프레임을 어떻게 바꾸는지 점검해줘.",
    ],
    questionChains: {},
  },
  DE: {
    ticker: "DE",
    companyName: "Deere & Company",
    companyNameKo: "디어",
    sectorKo: "농업·건설 장비",
    signature:
      "Production & Precision Agriculture, Small Agriculture & Turf, Construction & Forestry의 판매 주기와 Financial Services의 신용 여건이 실적 민감도를 함께 결정합니다.",
    description:
      "기업 리포트: Production & Precision Agriculture, Small Agriculture & Turf, Construction & Forestry 수요 변동과 Financial Services 자금 여건을 함께 보며, 농산물 가격·금리 환경, dealer inventory, used equipment 회전까지 연결해 해석합니다.",
    researchFocus: [
      "Production & Precision Agriculture",
      "Small Agriculture & Turf",
      "Construction & Forestry",
      "Financial Services",
      "dealer inventory",
      "used equipment",
    ],
    riskVariables: [
      "농산물 가격 변동과 농가 현금흐름 연동",
      "금리·스프레드, 신용 포트폴리오, 신용손실",
      "정부 보조금·무역 정책 변화에 따른 지역 수요 변동",
      "dealer inventory 변동, used equipment 전환과 출하 타이밍 충돌",
    ],
    suggestedPrompts: [
      "디어의 Production & Precision Agriculture, Small Agriculture & Turf, Construction & Forestry가 매출 믹스와 매출총이익률에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "디어 Financial Services의 신용 포트폴리오, 금리 스프레드, 대손비, 자본비용이 장비 판매 사이클과 현금흐름에 어떤 영향을 주는지 공시 근거로 비교해줘.",
      "디어의 dealer inventory와 used equipment 흐름이 성장 논지의 선행 신호가 되는지, 그리고 농산물 가격·금리 조합이 실적 전개를 어떻게 바꾸는지 정리해줘.",
    ],
    questionChains: {},
  },
  DHR: {
    ticker: "DHR",
    companyName: "Danaher Corporation",
    companyNameKo: "다나허",
    sectorKo: "생명과학·진단",
    signature:
      "Life Sciences, Diagnostics, Biotechnology 축에서 장비·consumables·서비스로 이어지는 recurring revenue 구조가 실적 안정성의 핵심입니다.",
    description:
      "기업 리포트: Danaher는 Life Sciences와 Diagnostics에서 플랫폼 기반 장비를 쌓은 뒤 consumables와 서비스로 지속 수익을 확보하는 구조가 강합니다. Cepheid 계열 진단 자산, M&A 포트폴리오 조정, 가격 전가 속도, 공급 조달 안정성, 인건비 동향이 recurring revenue의 질과 마진 방어력을 좌우합니다.",
    researchFocus: [
      "Life Sciences",
      "Diagnostics",
      "Biotechnology",
      "Cepheid",
      "recurring revenue",
      "M&A·포트폴리오 전환",
    ],
    riskVariables: [
      "공급 병목 및 조달 리드타임이 진단 장비·consumables 가용성에 주는 충격",
      "인건비와 생산비 상승이 recurring revenue의 매출총이익률에 미치는 영향",
      "가격 전가 지연과 고객 비용 절감 압력에 대한 대응 속도",
      "규제·허가 환경 변화가 Cepheid 기반 수요 타이밍과 성장 논지에 미치는 영향",
    ],
    suggestedPrompts: [
      "Danaher의 Life Sciences, Diagnostics, Biotechnology 사업에서 recurring revenue가 장비·consumables·서비스로 어떻게 쌓이는지 공시 기준으로 정리해줘.",
      "다나허의 Cepheid 진단 라인업이 consumables 회수율, 장비 업그레이드 수요, 가격 전가와 어떻게 연결되는지 공시 기준으로 비교해줘.",
      "다나허의 공급 조달, 인건비, 가격 조정 속도가 성장 논지와 매출총이익률 방어에 미치는 제약을 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  DIS: {
    ticker: "DIS",
    companyName: "The Walt Disney Company",
    companyNameKo: "월트디즈니",
    sectorKo: "콘텐츠·체험형 엔터테인먼트",
    signature:
      "콘텐츠 IP와 체험 비즈니스를 중심으로 Parks, Experiences and Products, Entertainment, DTC가 각기 다른 성장 동인과 마진 경로를 만듭니다.",
    description:
      "기업 리포트: Parks, Experiences and Products, Entertainment, DTC(Disney+, Hulu)로 구분해 구독·광고·라이선스 수익을 추적하고, ESPN과 linear networks, content costs의 상호작용을 함께 봅니다.",
    researchFocus: [
      "Parks, Experiences and Products",
      "DTC(Disney+, Hulu)",
      "ESPN 중심 Entertainment",
      "linear networks와 광고·라이선스",
    ],
    riskVariables: [
      "Sports 권리 갱신 비용과 content costs 부담",
      "테마파크 방문객 복원 속도와 체류·객단가 민감도",
      "구독 플랫폼의 유지율, 가격 인상 수용도, 마케팅 효율",
      "선형 광고 시장 회복 속도와 ESPN·콘텐츠 편성 수익",
    ],
    suggestedPrompts: [
      "월트디즈니의 Parks, Experiences and Products, DTC(Disney+, Hulu), Entertainment가 수익과 마진을 어떻게 만드는지 공시 관점으로 정리해줘.",
      "Disney+, Hulu, ESPN, linear networks의 매출원(구독·광고·라이선스)과 content costs가 영업이익률에 미치는 영향을 비교해줘.",
      "월트디즈니의 Parks, Experiences and Products 수요 회복 속도, Sports 권리 비용, DTC 유지율 변화가 성장 논지의 제약 요인이 되는 이유를 정리해줘.",
    ],
    questionChains: {},
  },
  ETN: {
    ticker: "ETN",
    companyName: "Eaton Corporation plc",
    companyNameKo: "이튼",
    sectorKo: "전력관리·산업장비",
    signature:
      "Electrical Americas와 Electrical Global의 backlog가 매출 기반을 형성하고, Aerospace·eMobility·data center 성장성의 분기점을 함께 판단해야 합니다.",
    description:
      "기업 리포트: Electrical Americas, Electrical Global, Aerospace, eMobility 수요를 분리해 해석하고, backlog의 안정성, 매출총이익률, 현금흐름의 연결고리를 핵심 판단축으로 봅니다.",
    researchFocus: [
      "Electrical Americas·Electrical Global의 매출, backlog, 영업이익 구조",
      "Aerospace 수주 주기와 가격 전가력",
      "eMobility의 제품 믹스, 투자 지연, 수익성 민감도",
      "data center 전력 인프라와 electrification 수요 연계",
    ],
    riskVariables: [
      "공급망 변동과 원가 상방 압력이 마진에 미치는 영향",
      "backlog 전환 둔화가 영업이익률·현금흐름에 미치는 지연 효과",
      "Aerospace 프로젝트 일정 변화와 산업별 가동률 둔화 충격",
      "규제·환율·금리 환경이 eMobility·전력관리 장비 투자 판단에 미치는 제약",
    ],
    suggestedPrompts: [
      "Eaton의 Electrical Americas와 Electrical Global에서 backlog 증가가 매출 성장으로 얼마나 빠르게 연결되는지 세그먼트별로 공시 기준 정리해줘.",
      "Eaton의 Aerospace와 eMobility에서 매출총이익률, 영업이익률, 현금흐름이 수요 채널별로 어떻게 달라지는지 비교 분석해줘.",
      "Eaton의 data center와 electrification 주문이 성장 논지에 주는 실제 의미를, 가격 전가력과 backlog 지속성 관점에서 공시 근거로 점검해줘.",
    ],
    questionChains: {},
  },
  GILD: {
    ticker: "GILD",
    companyName: "Gilead Sciences, Inc.",
    companyNameKo: "길리어드",
    sectorKo: "바이오의약품",
    signature:
      "HIV(Biktarvy), oncology(Trodelvy), cell therapy, Veklury 수요가 실적의 좌우 축을 형성하며 IRA·Medicare 환급 환경이 성장 경로를 조정합니다.",
    description:
      "기업 리포트: HIV 포트폴리오(Biktarvy 중심), oncology 상업화(Trodelvy), cell therapy 상용화 속도, Veklury 수요가 매출 믹스에 미치는 영향을 IRA·Medicare 가격·환급 환경과 함께 해석합니다.",
    researchFocus: [
      "HIV 포트폴리오(Biktarvy 중심)와 매출 믹스",
      "oncology(Trodelvy) 상업화 속도와 승인·접근성",
      "cell therapy 제품군의 매출 전환과 현금회수율",
      "Veklury 수요 추이와 병원 수요 탄력성",
    ],
    riskVariables: [
      "IRA·Medicare 가격 협상 및 환급 구조 변화",
      "공급망 변동과 제조·물류 비용 압력",
      "HIV 제네릭, 경쟁 면역항암, 대체 치료제 확산",
      "보험 접근성 악화가 oncology 매출 전환율에 미치는 영향",
      "Veklury 수요 둔화와 시즌성 리스크",
    ],
    suggestedPrompts: [
      "길리어드의 HIV(Biktarvy 포함)와 Trodelvy 매출 조합이 매출 믹스에서 어떻게 이동했고 영업이익률에 어떤 영향을 줬는지 공시 기준으로 정리해줘.",
      "oncology에서 Trodelvy와 cell therapy 상업화 속도 차이가 현금흐름과 재투자 여력에 어떤 경로로 반영되는지 비교해줘.",
      "IRA·Medicare 정책 변화가 Veklury와 HIV·oncology 제품군의 순매출, 할인, 회수속도에 미치는 부담을 구체적으로 정리해줘.",
    ],
    questionChains: {},
  },
  GEV: {
    ticker: "GEV",
    companyName: "GE Vernova Inc.",
    companyNameKo: "GE 버노바",
    sectorKo: "전력·그리드 장비",
    signature:
      "Power, Wind, Electrification 3개 축이 결합되며 gas turbines, Grid 인프라, services에서 발생하는 순환 성장이 실적의 핵심입니다.",
    description:
      "기업 리포트: Power·Wind·Electrification으로 운영되는 구조에서 Power는 gas, nuclear, hydro 장비와 서비스를, Wind는 onshore/offshore turbine 플랫폼을, Electrification은 power transmission·grid automation·conversion·storage를 제공합니다. Equipment RPO와 Services RPO로 측정되는 backlog가 향후 매출·마진 선행지표가 되며, contract liabilities/contract assets와 PP&E 투자 강도가 현금흐름과 성장 속도를 바꿉니다.",
    researchFocus: [
      "Power·Wind·Electrification 실적 기여도",
      "RPO(backlog) 구성, 회수 속도, 대형 투자 프로젝트 영향",
      "gas turbines·트랜스포머·switchgear 중심의 services 수익성",
      "contract price adjustments와 PP&E 투자 사이의 비용 구조 전이",
    ],
    riskVariables: [
      "오프쇼어 Wind 프로젝트 비용·완료 일정 지연과 클레임 리스크",
      "tariff, 원자재·노동비 인플레이션이 가스 터빈·그리드 장비 마진에 미치는 압력",
      "장기 서비스 계약에 따른 contract liabilities/contract assets 변동성",
      "RPO 확대가 실제 현금화 속도로 이어지는지 여부",
    ],
    suggestedPrompts: [
      "GEV의 Power, Wind, Electrification별 RPO(Equipment RPO·Services RPO)와 backlog가 성장 논지에 어떻게 반영되는지, 영업성과로 이어지는 경로를 공시 기준으로 정리해줘.",
      "GE 버노바의 gas turbines, power transmission, Grid automation, storage 플랫폼과 services 매출이 매출총이익률·free cash flow에 미친 영향을 contract liabilities/contract assets 타이밍과 함께 비교해줘.",
      "오프쇼어 Wind와 대형 투자 프로젝트에서 발생하는 project execution, tariff, contract price adjustments 리스크가 마진과 성장 지속성에 어떤 부담으로 남는지 GEV 기준으로 정밀 점검해줘.",
    ],
    questionChains: {},
  },
  GLW: {
    ticker: "GLW",
    companyName: "Corning Incorporated",
    companyNameKo: "코닝",
    sectorKo: "특수소재·광통신",
    signature:
      "Optical Communications, Display Technologies, Specialty Materials, Hemlock의 실적 축이 매출 성장과 수익성 방향을 나눕니다.",
    description:
      "기업 리포트: Optical Communications는 AI·데이터센터 연결성 수요, Display Technologies는 환율 조정과 price increases, Specialty Materials는 Corning Gorilla Glass 중심의 프리미엄 수요, Hemlock and Emerging Growth Businesses는 폴리실리콘·solar module 확장을 통해 성장 논지를 구성합니다.",
    researchFocus: [
      "Optical Communications의 AI, datacenter interconnect, carrier·enterprise 수요",
      "Display Technologies의 환율 민감도와 price increases",
      "Specialty Materials와 Corning Gorilla Glass 수요 구조",
      "Hemlock and Emerging Growth Businesses의 폴리실리콘·태양광 성장축",
    ],
    riskVariables: [
      "일본 엔·FX 변동과 환산 영향",
      "원재료·장비 조달 병목과 제조 운영 차질",
      "Display·Optical Communications의 가격 경쟁과 가격 전가 한계",
      "Hemlock 램프업 비용 변동 및 최종시장 수요 둔화",
    ],
    suggestedPrompts: [
      "코닝의 Optical Communications(enterprise·carrier, generative AI 인프라 수요)이 매출 구조와 성장 논지에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "코닝의 Display Technologies에서 환율 조정과 price increases가 매출, 판매량, 단가 전달에 미치는 영향을 비교해줘.",
      "코닝의 Specialty Materials 중 Corning Gorilla Glass와 Hemlock and Emerging Growth Businesses(폴리실리콘·solar module)의 매출·비용 연결고리가 성장 논지와 현금흐름 판단에 어떤 의미가 있는지 정리해줘.",
    ],
    questionChains: {},
  },
  GOOG: {
    ticker: "GOOG",
    companyName: "Alphabet Inc.",
    companyNameKo: "알파벳",
    sectorKo: "검색·광고·클라우드",
    signature:
      "Google Search와 YouTube 광고, Google Cloud가 기본 수익동학을 만들고 AI 투자와 data center 확장이 매출총이익률·현금흐름·회수 속도에 동시에 작용합니다.",
    description:
      "기업 리포트: Google Search·YouTube 광고, Google Cloud, AI 전개, data center 운영비와 감가상각, TAC, 콘텐츠 획득 비용, Other Bets의 수익성·현금흐름 민감도를 함께 점검합니다.",
    researchFocus: [
      "Google Search·YouTube advertising",
      "Google Cloud",
      "AI data center 투자",
      "TAC 및 콘텐츠 획득 비용",
      "Other Bets",
    ],
    riskVariables: [
      "AI 경쟁 심화와 데이터센터 비용 가속",
      "TAC·콘텐츠 획득 비용 변동",
      "광고 규제·경쟁 심화와 가격 전가 한계",
      "공급망 이슈와 AI 칩·컴퓨트 비용 변동",
      "Other Bets 적자 지속 가능성",
    ],
    suggestedPrompts: [
      "Alphabet의 Google Search와 YouTube 광고가 매출 성장을 얼마나 견인했는지, 광고 단가·트래픽·비용 구조를 공시 기준으로 정리해줘.",
      "Google Cloud와 AI data center 투자 확대가 매출총이익률·현금흐름·현금성 비용 흐름에 어떤 방식으로 반영되는지 공시 기반으로 분석해줘.",
      "TAC, 콘텐츠 획득 비용, Other Bets의 손익이 Alphabet의 성장 논지에 미치는 영향을 채널별로 분리해 투자 포인트로 정리해줘.",
    ],
    questionChains: {},
  },
  GOOGL: {
    ticker: "GOOGL",
    companyName: "Alphabet Inc.",
    companyNameKo: "알파벳",
    sectorKo: "검색·광고·클라우드",
    signature:
      "Google Search와 YouTube, Google Cloud가 성장 축인 가운데, AI·data center 확장과 TAC가 영업 효율을 좌우하는 구조입니다.",
    description:
      "기업 리포트: Google Search·YouTube 광고(advertising), Google Cloud 성장성, AI 인프라 투자의 data center 부담, TAC, Other Bets의 현금 소모 특성을 함께 봅니다.",
    researchFocus: [
      "Google Search",
      "YouTube 광고",
      "Google Cloud",
      "AI·data center·TAC",
    ],
    riskVariables: [
      "AI 확산을 위한 data center CAPEX 및 운영비 증가",
      "TAC·라이선스 비용의 변동",
      "Google Search·YouTube 광고 경쟁 압력과 규제 노출",
      "Other Bets의 적자 지속과 현금흐름 소진",
    ],
    suggestedPrompts: [
      "알파벳의 Google Search, YouTube 광고(advertising), Google Cloud가 성장 논지를 구성하는 핵심 채널인지 공시 기준으로 정리해줘.",
      "알파벳의 AI 데이터 인프라와 data center 비용이 매출총이익률·영업이익률에 미치는 전달 경로를 공시 기준으로 점검해줘.",
      "알파벳의 Other Bets, TAC, 규제 변수 조합이 향후 성장 논지를 제약할 수 있는 실질 리스크를 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  GS: {
    ticker: "GS",
    companyName: "The Goldman Sachs Group, Inc.",
    companyNameKo: "골드만삭스",
    sectorKo: "투자은행 및 자산관리",
    signature:
      "Global Banking & Markets, Asset & Wealth Management, Platform Solutions가 수익 구조의 중심이며, 투자 사이클과 시장 변동이 성과의 방향을 결정합니다.",
    description:
      "기업 리포트: Global Banking & Markets에서 발생하는 투자은행 수수료, FICC·equities 거래 활동, Asset & Wealth Management의 AUM 성장, 그리고 Platform Solutions 연계 수익이 실적을 함께 좌우합니다.",
    researchFocus: [
      "Global Banking & Markets",
      "investment banking fees",
      "FICC 및 equities",
      "Asset & Wealth Management (AUM)",
      "Platform Solutions",
    ],
    riskVariables: [
      "금융시장 변동성에 따른 FICC·equities 실적 변동성",
      "거래·자문 사이클 둔화로 인한 investment banking fees 부담",
      "규제자본·유동성 요건 강화에 따른 성장 제약",
      "자산 유입/이탈에 따른 AUM 기반 수익 안정성",
    ],
    suggestedPrompts: [
      "골드만삭스의 Global Banking & Markets에서 investment banking fees와 FICC·equities 수익이 어떻게 발생하는지 공시 기준으로 정리해줘.",
      "골드만삭스의 Asset & Wealth Management에서 AUM 변화가 수수료 수익, 마진, 비용 구조에 어떤 영향을 주는지 공시 기준으로 분석해줘.",
      "골드만삭스의 Platform Solutions, 규제자본·유동성 요건, 시장 변동성이 성장 논지에 미치는 리스크 경로를 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  HON: {
    ticker: "HON",
    companyName: "Honeywell International Inc.",
    companyNameKo: "허니웰",
    sectorKo: "항공우주·산업 자동화·에너지 전환 솔루션",
    signature:
      "Aerospace Technologies와 Building Automation, Industrial Automation이 주도하는 Honeywell은 backlog와 aftermarket 전환 속도에 따라 실적 레버리지와 마진 안정성이 달라집니다.",
    description:
      "기업 리포트: Honeywell은 Aerospace Technologies, Building Automation, Industrial Automation, Energy and Sustainability Solutions로 사업 축을 구성하고 UOP 기반 프로젝트가 공정 효율성과 매출 변동 완충축에 기여합니다. backlog를 실질 매출·수금으로 전환하는 속도와 aftermarket 회수 구조가 성장 지속성과 현금흐름 안정성의 핵심 연결고리입니다.",
    researchFocus: [
      "Aerospace Technologies의 항공우주 제품·부품·유지보수 매출 연결",
      "Building Automation 및 Industrial Automation의 운영 효율화 수요",
      "Energy and Sustainability Solutions의 Energy, 유틸리티, 산업 고객 노출",
      "backlog 전환률, aftermarket 반복매출, 비용 구조 레버리지",
    ],
    riskVariables: [
      "가격 전가력 약화 구간의 원가 압박",
      "backlog 집행 지연으로 인한 분기 실적·현금흐름 변동",
      "aftermarket 수요 둔화가 고정비 흡수력에 미치는 영향",
      "규제·프로젝트 일정 변동이 Energy and Sustainability Solutions 집행에 미치는 리스크",
    ],
    suggestedPrompts: [
      "허니웰의 Aerospace Technologies, Building Automation, Industrial Automation이 각각 매출과 영업이익률에 기여하는 구조를 공시 기준으로 분해해줘.",
      "허니웰의 backlog와 UOP 매출이 매출 집행, 비용 구조, 현금흐름 안정성으로 어떻게 전달되는지 공시 근거로 비교해줘.",
      "허니웰의 가격 전가력, 원재료 비용, backlog 지속성이 성장 논지에 미치는 경로를 정리해줘.",
    ],
    questionChains: {},
  },
  IBM: {
    ticker: "IBM",
    companyName: "International Business Machines Corporation",
    companyNameKo: "아이비엠",
    sectorKo: "하이브리드 클라우드·AI",
    signature:
      "hybrid cloud, AI, Software, Consulting, Infrastructure가 결합되는 구조에서 mainframe 고객군의 transaction processing 전환이 성과의 분기점이 됩니다.",
    description:
      "기업 리포트: hybrid cloud와 AI 수요 속에서 Software, Consulting, Infrastructure 매출을 함께 보며, watsonx·Red Hat의 확장 지점, mainframe 기반 transaction processing 전환 속도, free cash flow 및 연금·이자비용 민감도를 함께 점검합니다.",
    researchFocus: [
      "hybrid cloud 및 AI 전환 수요",
      "watsonx와 Red Hat의 상업화 동인",
      "Software·Consulting·Infrastructure 매출 믹스",
      "mainframe에서의 transaction processing 전환과 margin 구조",
    ],
    riskVariables: [
      "연금 부담과 이자비용 변동성",
      "부채 구조 변화와 자금조달 비용",
      "컨설팅 프로젝트 지연 및 수요 둔화",
      "기술 전환 인력, 보상비, 이탈 비용",
    ],
    suggestedPrompts: [
      "아이비엠의 Software, Consulting, Infrastructure가 매출 성장과 free cash flow에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "아이비엠의 watsonx와 Red Hat이 hybrid cloud·AI 확장 국면에서 mainframe 고객의 transaction processing 전환과 수익성에 어떤 영향을 주는지 공시 기준으로 비교해줘.",
      "아이비엠의 연금·이자 비용, 프로젝트형 수요 변동이 성장 논지와 현금흐름 안정성에 어떤 제약을 주는지 정리해줘.",
    ],
    questionChains: {},
  },
  INTC: {
    ticker: "INTC",
    companyName: "Intel Corporation",
    companyNameKo: "인텔",
    sectorKo: "반도체·파운드리",
    signature:
      "Client Computing, Data Center and AI, Network and Edge가 매출의 방향을 정하고, Intel Foundry와 wafer 전략이 gross margin을 좌우합니다.",
    description:
      "기업 리포트: Client Computing, Data Center and AI, Network and Edge의 매출 동향과 물량·가격 추이를 읽고, Intel Foundry, wafer 가동 효율, process node 전환이 gross margin과 비용 구조에 미치는 연결 고리를 함께 봅니다.",
    researchFocus: [
      "Client Computing",
      "Data Center and AI",
      "Network and Edge",
      "Intel Foundry",
    ],
    riskVariables: [
      "Client Computing 수요 둔화와 가격 전가 압력",
      "Data Center and AI 수요 변동 및 AI 인프라 투자 타이밍",
      "Network and Edge 출하·ASP 민감도",
      "wafer 수율, process node 전환 속도, government incentives 안정성",
    ],
    suggestedPrompts: [
      "인텔의 Client Computing, Data Center and AI, Network and Edge가 분기별 매출과 현금흐름에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "인텔의 Intel Foundry와 wafer 가동률, process node 전환이 gross margin과 원가 구조에 미친 영향을 공시 근거로 비교해줘.",
      "인텔의 Data Center and AI 성장 논지에서 수요 사이클, 경쟁 구도, government incentives가 어떤 리스크 완충·압박 요인인지 공시 기준으로 정리해줘.",
    ],
    questionChains: {},
  },
  INTU: {
    ticker: "INTU",
    companyName: "Intuit, Inc.",
    companyNameKo: "인튜이트",
    sectorKo: "세무·회계·개인금융 소프트웨어",
    signature:
      "TurboTax, Credit Karma, QuickBooks, Mailchimp가 맞물린 플랫폼 구조에서 세무 시즌 집중도, SMB 구독 전환, AI·cloud 운영비가 수익의 질을 좌우합니다.",
    description:
      "기업 리포트: Intuit은 Consumer의 TurboTax·Credit Karma와 Global Business Solutions의 QuickBooks Online, payments, payroll, Mailchimp를 함께 봐야 합니다. 세무 시즌의 고객 유입, QuickBooks Online Accounting과 online services 확장, Credit Karma의 금융상품 매칭, AI 기반 자동화와 cloud 호스팅 비용이 매출총이익률과 영업 레버리지의 핵심 연결고리입니다.",
    researchFocus: [
      "TurboTax·Credit Karma·ProTax를 포함한 Consumer 플랫폼",
      "QuickBooks Online Accounting, payments, payroll, QuickBooks Capital",
      "Mailchimp와 Intuit Enterprise Suite의 SMB 고객 확장",
      "AI 기능, cloud 호스팅, fraud·보안 관리 비용",
    ],
    riskVariables: [
      "세무 시즌 집중도와 무료·저가 대체재 확대로 인한 가격 전가력 약화",
      "cloud·AI·데이터 처리 비용 상승에 따른 매출총이익률 압박",
      "identity 탈취, fraud, 보안 사고가 신뢰·규제비용으로 전이될 가능성",
      "payments·대출 오퍼링 확대에 따른 신용 손실과 금리 민감도",
    ],
    suggestedPrompts: [
      "인튜이트의 Consumer와 Global Business Solutions에서 TurboTax, Credit Karma, QuickBooks Online, Mailchimp가 매출과 영업이익률에 기여하는 구조를 공시 기준으로 정리해줘.",
      "QuickBooks Online Accounting, payments, payroll, QuickBooks Capital이 SMB 고객당 매출과 비용 구조를 어떻게 바꾸는지 공시 근거로 비교해줘.",
      "인튜이트의 AI 기능, cloud 호스팅, fraud·보안 리스크가 성장 논지와 free cash flow에 미치는 경로를 정리해줘.",
    ],
    questionChains: {},
  },
  ISRG: {
    ticker: "ISRG",
    companyName: "Intuitive Surgical, Inc.",
    companyNameKo: "인튜이티브 서지컬",
    sectorKo: "로봇 수술 플랫폼",
    signature:
      "da Vinci와 Ion 기반 플랫폼에서 procedure volume이 핵심 동인이며, Instruments & Accessories, Systems, Service가 매출 타이밍과 수익성 경로를 만듭니다.",
    description:
      "기업 리포트: Intuitive Surgical은 da Vinci Surgical System과 Ion endoluminal 플랫폼을 중심으로 수술 로봇 생태계를 운영합니다. procedure volume 증가는 Instruments & Accessories 반복매출과 Service 수익으로 직접 연결되고, Systems 매출은 신규 설치, operating lease, buyout 조합에 따라 인식 시점이 달라집니다. U.S./OUS 비중, 병원 지불 여력, 관세·규제·공급망 노출을 함께 봐야 합니다.",
    researchFocus: [
      "da Vinci 및 Ion procedure volume",
      "Instruments & Accessories 반복매출과 procedure 연동 구조",
      "Systems placement, operating lease, buyout에 따른 매출 인식",
      "Service 계약 수익과 설치대수 기반 유지수익성",
    ],
    riskVariables: [
      "병원 자본지출 둔화가 Systems placement와 procedure 증가율에 미치는 영향",
      "관세·무역 규제·OUS 승인 지연에 따른 비용 구조와 마진 변동",
      "부품·소재 공급망 병목이 Instruments & Accessories 공급에 미치는 충격",
      "신규 승인 지연, 가격 전가 한계, 경쟁 심화에 따른 da Vinci·Ion 성장 둔화",
    ],
    suggestedPrompts: [
      "Intuitive Surgical의 da Vinci와 Ion procedure volume이 Instruments & Accessories 및 Service 매출로 전환되는 구조를 공시 기준으로 정리해줘.",
      "Systems placement, operating lease, buyout 조합이 Intuitive Surgical의 매출 인식과 현금흐름에 미치는 차이를 비교해줘.",
      "관세, OUS 규제, 병원 자본지출 둔화가 Intuitive Surgical의 성장 논지와 마진에 주는 리스크를 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  JNJ: {
    ticker: "JNJ",
    companyName: "Johnson & Johnson",
    companyNameKo: "존슨앤드존슨",
    sectorKo: "제약·의료기기",
    signature:
      "Innovative Medicine와 MedTech가 맞물린 구조에서 Stelara, Darzalex, Tremfya, Carvykti의 처방 전환과 수술·병원 수요가 실적 방향을 좌우합니다.",
    description:
      "기업 리포트: Johnson & Johnson은 Innovative Medicine의 핵심 치료제와 MedTech의 수술·병원 채널을 함께 봐야 합니다. Stelara 바이오시밀러 경쟁, Darzalex·Tremfya·Carvykti의 적응증 확대, Abiomed를 포함한 MedTech 포트폴리오의 주문 회복이 매출총이익률과 현금흐름 전환 속도를 결정합니다.",
    researchFocus: [
      "Innovative Medicine과 MedTech의 매출·마진 기여도",
      "Stelara, Darzalex, Tremfya, Carvykti의 처방 확산 및 경쟁 압력",
      "Abiomed 포함 MedTech 포트폴리오의 병원 수요·수술 건수 민감도",
      "약가 협상, 리베이트, 소송·규제 비용이 현금흐름에 미치는 영향",
    ],
    riskVariables: [
      "Stelara 특허 만료와 바이오시밀러 경쟁 심화",
      "약가 정책·리베이트 변화에 따른 가격 전가력 약화",
      "MedTech 부품·운송·제조비용 상승과 병원 투자 지연",
      "임상 승인 지연, 제품 책임 소송, 규제 비용 확대",
    ],
    suggestedPrompts: [
      "존슨앤드존슨의 Innovative Medicine과 MedTech가 매출총이익률과 free cash flow에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "Stelara, Darzalex, Tremfya, Carvykti의 처방 확산과 경쟁 압력이 존슨앤드존슨의 성장 논지에 미치는 영향을 비교해줘.",
      "Abiomed를 포함한 MedTech 포트폴리오에서 병원 수요, 수술 건수, 제조비용이 마진에 전달되는 경로를 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  JPM: {
    ticker: "JPM",
    companyName: "JPMorgan Chase & Co.",
    companyNameKo: "JP모건체이스",
    sectorKo: "은행·자본시장",
    signature:
      "Consumer & Community Banking의 deposits·loans 기반 net interest income, Commercial & Investment Bank의 시장·자문 수익, Asset & Wealth Management의 AUM 수수료가 실적의 세 축입니다.",
    description:
      "기업 리포트: JPMorgan Chase는 Consumer & Community Banking, Commercial & Investment Bank, Asset & Wealth Management를 나눠 봐야 합니다. 예금 비용과 대출 수익률이 만드는 net interest income, card 및 credit costs, investment banking fees, trading 수익, AUM 기반 수수료가 금리·신용·시장 사이클에 따라 서로 다른 속도로 움직입니다.",
    researchFocus: [
      "Consumer & Community Banking의 deposits, loans, card business와 net interest income",
      "Commercial & Investment Bank의 investment banking fees와 market products",
      "Asset & Wealth Management의 AUM, advisory fees, 예금·대출 연계",
      "credit costs, allowance, 규제자본·유동성 요건",
    ],
    riskVariables: [
      "예금 비용 상승과 대출 성장 둔화에 따른 net interest income 압박",
      "경기 둔화와 신용 악화로 인한 credit costs 확대",
      "시장 변동성이 trading income과 investment banking fees에 미치는 영향",
      "규제자본·유동성 규제 강화에 따른 배당·자본환원 제약",
    ],
    suggestedPrompts: [
      "JP모건체이스의 Consumer & Community Banking에서 deposits, loans, card business가 net interest income과 credit costs로 연결되는 구조를 공시 기준으로 정리해줘.",
      "JP모건체이스의 Commercial & Investment Bank와 Asset & Wealth Management가 각각 investment banking fees, trading 수익, AUM 수수료를 만드는 경로를 비교해줘.",
      "JP모건체이스의 금리 민감도, credit costs, 규제자본 변화가 성장 논지와 자본환원 여력에 미치는 영향을 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  KLAC: {
    ticker: "KLAC",
    companyName: "KLA Corporation",
    companyNameKo: "케이엘에이",
    sectorKo: "반도체 공정 제어·검사 장비",
    signature:
      "wafer inspection, metrology, reticle inspection이 첨단 공정 수율을 좌우하고, installed base 기반 services가 반도체 투자 사이클의 변동성을 완충합니다.",
    description:
      "기업 리포트: KLA는 IC 제조 공정의 결함을 찾아 수율을 높이는 process control 장비와 software, data analytics를 제공합니다. Semiconductor Process Control의 wafer inspection·metrology, Specialty Semiconductor Process, PCB & Component Inspection, 그리고 유지보수·지원 services를 함께 보며 DRAM, foundry/logic, advanced packaging 투자 타이밍을 연결해서 읽어야 합니다.",
    researchFocus: [
      "Semiconductor Process Control의 wafer inspection·metrology 수요",
      "reticle inspection, software, data analytics의 공정 수율 기여",
      "installed base 기반 services와 매출총이익률 안정성",
      "DRAM, foundry/logic, advanced packaging 설비투자 사이클",
    ],
    riskVariables: [
      "고객의 capital equipment 조달 일정 지연·취소",
      "BIS 수출통제와 중국 고객 지원 제한",
      "부품 조달, 관세, 환율 변동에 따른 원가 압박",
      "상위 고객·지역 편중에 따른 수주와 현금흐름 변동성",
    ],
    suggestedPrompts: [
      "KLA의 Semiconductor Process Control에서 wafer inspection, metrology, reticle inspection이 매출총이익률에 기여하는 구조를 공시 기준으로 정리해줘.",
      "KLA의 services 매출이 installed base, 유지보수 수요, 현금흐름 안정성으로 연결되는 경로를 공시 근거로 설명해줘.",
      "DRAM, foundry/logic, advanced packaging 투자 사이클과 BIS 수출통제가 KLA의 성장 논지에 미치는 영향을 비교해줘.",
    ],
    questionChains: {},
  },
  KO: {
    ticker: "KO",
    companyName: "The Coca-Cola Company",
    companyNameKo: "코카콜라",
    sectorKo: "음료",
    signature:
      "concentrate와 finished beverage 판매, Trademark Coca-Cola, bottling partners 구조가 맞물리며 price/mix와 환율이 수익성의 방향을 정합니다.",
    description:
      "기업 리포트: Coca-Cola는 concentrate 원액 판매와 sparkling을 포함한 finished beverage 채널, bottling partners와 refranchising 구조를 함께 봐야 합니다. Trademark Coca-Cola의 브랜드력, 지역별 price/mix, 원재료·알루미늄 캔·PET·운송비가 매출총이익률과 현금흐름 방어력의 핵심 변수입니다.",
    researchFocus: [
      "concentrate와 finished beverage 수익 구조",
      "Trademark Coca-Cola, sparkling, non-sparkling 포트폴리오 믹스",
      "bottling partners, refranchising, 지역별 price/mix",
      "원재료·포장·운송비와 환율이 매출총이익률에 미치는 영향",
    ],
    riskVariables: [
      "원재료·포장·운송비 상승에 따른 매출총이익률 압박",
      "소비자 가격 민감도 상승으로 인한 price/mix 약화",
      "bottling partners 운영 효율 저하와 refranchising 지연",
      "환율 변동과 인플레이션이 지역별 가격 정책에 미치는 영향",
    ],
    suggestedPrompts: [
      "코카콜라의 concentrate와 finished beverage가 어떤 채널에서 매출화되는지 공시 기준으로 정리해줘.",
      "코카콜라의 Trademark Coca-Cola, sparkling 믹스, 지역별 price/mix가 매출총이익률에 미치는 영향을 공시 근거로 분석해줘.",
      "코카콜라의 bottling partners 구조와 refranchising이 비용 방어력과 현금흐름에 미치는 경로를 정리해줘.",
    ],
    questionChains: {},
  },
  LIN: {
    ticker: "LIN",
    companyName: "Linde plc",
    companyNameKo: "린데",
    sectorKo: "산업가스",
    signature:
      "onsite, merchant, packaged gases 계약 구조와 price/cost spread가 린데의 수익 안정성을 만들고, clean hydrogen·electronics 수요와 Engineering backlog가 성장 속도를 정합니다.",
    description:
      "기업 리포트: Linde는 onsite 장기공급, merchant 벌크, packaged gases 판매를 통해 산업·의료·전자·에너지 고객에게 산소, 질소, 수소, 헬륨, CO2, specialty gases를 공급합니다. 최소 구매량과 price escalation이 포함된 계약 구조, cost pass-through, clean hydrogen·electronics 노출, Engineering backlog 전환 속도를 함께 봐야 매출총이익률과 현금흐름의 질을 판단할 수 있습니다.",
    researchFocus: [
      "onsite, merchant, packaged gases별 계약 기간과 최소 구매 구조",
      "price/cost spread, cost pass-through, currency가 마진에 미치는 영향",
      "clean hydrogen, helium, CO2, electronics, specialty gases 수요",
      "Americas, EMEA, APAC 지역 믹스와 Engineering backlog 전환",
    ],
    riskVariables: [
      "천연가스·전력·원재료 가격 변동과 공급 차질",
      "cost pass-through 지연에 따른 price/cost spread 축소",
      "화학·에너지·제조·메탈 고객의 프로젝트 일정 지연",
      "환율 변동과 hedging 한계가 영업이익·현금흐름에 미치는 영향",
    ],
    suggestedPrompts: [
      "린데의 onsite, merchant, packaged gases 계약이 최소 구매량과 price escalation을 통해 수익 안정성을 만드는 구조를 공시 기준으로 정리해줘.",
      "린데의 price/cost spread, cost pass-through, currency가 매출총이익률과 영업이익에 미치는 영향을 지역별로 비교해줘.",
      "린데의 clean hydrogen, electronics, specialty gases 수요와 Engineering backlog가 성장 논지에 미치는 영향을 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  LLY: {
    ticker: "LLY",
    companyName: "Eli Lilly and Company",
    companyNameKo: "일라이 릴리",
    sectorKo: "제약",
    signature:
      "Mounjaro와 Zepbound 중심의 GLP-1 수요, manufacturing capacity 확장, 가격·환급 정책이 일라이 릴리의 성장 속도와 마진을 좌우합니다.",
    description:
      "기업 리포트: Eli Lilly는 Mounjaro와 Zepbound의 GLP-1/incretin 수요가 실적의 중심이며, Verzenio, Jardiance, Trulicity가 포트폴리오를 보완합니다. 제조 설비 증설과 공급 안정성, 미국·해외 realized price, 환급·약가 협의, 적응증 확대가 매출총이익률과 현금흐름 전환 속도를 결정합니다.",
    researchFocus: [
      "Mounjaro·Zepbound의 GLP-1 volume, realized price, 채널 믹스",
      "Verzenio, Jardiance, Trulicity의 포트폴리오 보완 역할",
      "manufacturing capacity 확장과 공급망 안정성",
      "환급 정책, 약가 협의, Bridge Program이 가격에 미치는 영향",
    ],
    riskVariables: [
      "Mounjaro·Zepbound 수요가 공급 능력을 초과할 때 발생하는 매출 인식 지연",
      "가격 협상과 reimbursement 변화에 따른 realized price 하락",
      "제조 품질·규제 이슈와 공급망 집중 구조",
      "GLP-1 경쟁 심화, 소송·평판 리스크, 적응증 승인 지연",
    ],
    suggestedPrompts: [
      "일라이 릴리의 Mounjaro와 Zepbound가 volume, realized price, manufacturing capacity를 통해 매출총이익률에 미치는 영향을 공시 기준으로 정리해줘.",
      "Verzenio, Jardiance, Trulicity가 GLP-1 중심 포트폴리오의 현금흐름 변동성을 어떻게 보완하는지 공시 근거로 비교해줘.",
      "일라이 릴리의 약가 협의, reimbursement, Bridge Program, 제조 확장이 성장 논지에 미치는 리스크 경로를 설명해줘.",
    ],
    questionChains: {},
  },
  LRCX: {
    ticker: "LRCX",
    companyName: "Lam Research Corporation",
    companyNameKo: "램리서치",
    sectorKo: "반도체 장비",
    signature:
      "etch, deposition, clean 중심의 wafer fabrication equipment와 CSBG installed base 서비스가 memory, foundry, logic CAPEX 사이클을 수익으로 전환합니다.",
    description:
      "기업 리포트: Lam Research는 wafer processing 장비와 customer support-related 매출을 함께 운영합니다. 신규 etch·deposition·clean 시스템, CSBG의 spares·upgrade·Reliant, installed base 서비스가 NAND, DRAM, foundry/logic 투자 흐름에 따라 서로 다른 속도로 움직이며 매출총이익률과 현금흐름을 결정합니다.",
    researchFocus: [
      "etch, deposition, clean 중심 wafer fabrication equipment",
      "NAND, DRAM, foundry, logic 고객 CAPEX 사이클",
      "CSBG installed base, spares, upgrades, Reliant 매출",
      "R&D 투자, 제조 효율, export controls가 gross margin에 미치는 영향",
    ],
    riskVariables: [
      "memory·foundry·logic 고객의 설비투자 지연과 주문 취소",
      "export controls, tariffs, 지역별 출하 제한에 따른 매출 인식 지연",
      "핵심 부품·자재 조달 병목과 공급망 비용 상승",
      "공정 전환 속도와 경쟁 심화가 제품 믹스·가격에 미치는 압박",
    ],
    suggestedPrompts: [
      "Lam Research의 etch, deposition, clean 장비가 NAND, DRAM, foundry/logic CAPEX 사이클과 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "Lam Research의 CSBG installed base, spares, upgrades, Reliant 매출이 매출총이익률과 현금흐름 안정성에 기여하는 구조를 설명해줘.",
      "export controls, tariffs, 공급망 병목이 Lam Research의 고객별 주문, 납기, gross margin에 미치는 영향을 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  MA: {
    ticker: "MA",
    companyName: "Mastercard Incorporated",
    companyNameKo: "마스터카드",
    sectorKo: "글로벌 결제 네트워크",
    signature:
      "gross dollar volume, switched transactions, cross-border volume이 네트워크 수수료를 만들고, value-added services와 rebates and incentives가 마진의 질을 결정합니다.",
    description:
      "기업 리포트: Mastercard는 payment network 수익과 value-added services and solutions를 함께 봐야 합니다. gross dollar volume(GDV), gross euro volume(GEV), switched transactions, cross-border volume이 domestic/cross-border assessments와 transaction processing assessments로 연결되고, issuer·merchant 대상 rebates and incentives 및 환율 영향이 순매출과 비용 구조를 동시에 움직입니다.",
    researchFocus: [
      "gross dollar volume, cross-border volume, switched transactions",
      "domestic/cross-border assessments와 transaction processing assessments",
      "value-added services and solutions의 성장과 마진 기여",
      "rebates and incentives, currency impact, issuer·acquirer 관계",
    ],
    riskVariables: [
      "환율 변동이 GDV·GEV와 volume-related rebates and incentives에 미치는 영향",
      "수수료 규제, merchant litigation, issuer·acquirer 협상력 변화",
      "정보보안 사고·서비스 중단이 거래 처리 신뢰에 미치는 충격",
      "AML/CFT, 경제제재, anti-corruption 규제 강화에 따른 비용 증가",
    ],
    suggestedPrompts: [
      "마스터카드의 gross dollar volume, cross-border volume, switched transactions가 payment network 수익으로 전환되는 구조를 공시 기준으로 정리해줘.",
      "마스터카드의 value-added services and solutions와 rebates and incentives가 순매출과 마진에 미치는 영향을 비교해줘.",
      "마스터카드의 merchant litigation, 수수료 규제, 정보보안 리스크가 성장 논지와 cross-border 수익성에 주는 영향을 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  MCD: {
    ticker: "MCD",
    companyName: "McDonald's Corporation",
    companyNameKo: "맥도날드",
    sectorKo: "글로벌 외식 프랜차이즈",
    signature:
      "franchised restaurants에서 발생하는 rent, royalty, initial fee가 수익의 중심이고, comparable sales, guest count, digital·delivery·loyalty가 franchise fee 성장 속도를 좌우합니다.",
    description:
      "기업 리포트: McDonald's는 대부분의 매장을 franchised restaurants로 운영하며 rent, royalty, initial fee, minimum rent가 안정적인 현금흐름을 만듭니다. company-operated restaurants는 원재료·인건비·운영 효율에 더 민감하고, comparable sales와 guest count, digital·delivery·loyalty 전환, EOTF 투자와 메뉴 가격 전략이 지역별 마진을 결정합니다.",
    researchFocus: [
      "franchised restaurants의 rent, royalty, initial fee 구조",
      "company-operated restaurants 마진과 운영 효율",
      "comparable sales, guest count, 메뉴 가격·믹스",
      "digital, delivery, loyalty, EOTF 투자 효과",
    ],
    riskVariables: [
      "beef, chicken, 감자, 포장재 가격 상승에 따른 점포 마진 압박",
      "인건비·물류·에너지 비용이 company-operated restaurants에 미치는 영향",
      "franchisee 수익성 악화가 리모델링·신규점 투자에 주는 제약",
      "보건·광고·고용 규제와 환율 변동에 따른 지역별 현금흐름 변동",
    ],
    suggestedPrompts: [
      "맥도날드의 franchised restaurants에서 rent, royalty, initial fee가 어떻게 발생하고 company-operated restaurants와 현금흐름 성격이 어떻게 다른지 공시 기준으로 정리해줘.",
      "맥도날드의 comparable sales와 guest count가 franchise fee 성장과 마진에 반영되는 경로를 지역별로 설명해줘.",
      "digital 주문, delivery, loyalty, EOTF 투자가 메뉴 믹스와 주문 단가, franchisee 수익성에 미치는 영향을 공시 근거로 분석해줘.",
    ],
    questionChains: {},
  },
  META: {
    ticker: "META",
    companyName: "Meta Platforms, Inc.",
    companyNameKo: "메타",
    sectorKo: "소셜 광고·AI",
    signature:
      "Family of Apps 광고는 impressions와 price per ad가 성장 축이고, Reality Labs와 AI·데이터센터 CapEx는 free cash flow 압박의 핵심 변수입니다.",
    description:
      "기업 리포트: Meta는 Facebook, Instagram, WhatsApp, Reels, Threads가 포함된 Family of Apps 광고와 Reality Labs 투자를 나눠 봐야 합니다. 광고 매출은 impressions, price per ad, Reels 수익화, 광고 믹스가 좌우하고, Reality Labs의 Quest·Horizon 손실과 AI 서버·데이터센터 CapEx가 감가상각과 현금흐름에 반영됩니다.",
    researchFocus: [
      "Family of Apps 광고 impressions와 price per ad",
      "Facebook, Instagram, WhatsApp, Reels, Threads의 참여도와 수익화",
      "Reality Labs의 Quest·Horizon 비용과 손실 추세",
      "AI 모델, 서버, 데이터센터 CapEx와 감가상각 부담",
    ],
    riskVariables: [
      "광고 수요 둔화와 price per ad 하락 압력",
      "Reality Labs 적자 지속과 Quest·Horizon 현금화 지연",
      "AI·데이터센터 CapEx, 전력비, 감가상각 증가",
      "프라이버시·규제 이슈가 타기팅 효율과 콘텐츠 운영에 미치는 영향",
    ],
    suggestedPrompts: [
      "메타의 Family of Apps에서 impressions, price per ad, Reels 수익화가 광고 매출과 마진에 연결되는 구조를 공시 기준으로 정리해줘.",
      "Reality Labs의 Quest·Horizon 투자와 AI·데이터센터 CapEx가 메타의 감가상각과 free cash flow에 미치는 영향을 설명해줘.",
      "Reels, Threads, Instagram, Facebook의 사용자 참여도 차이가 광고 단가와 광고 총량에 어떻게 반영되는지 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  MRK: {
    ticker: "MRK",
    companyName: "Merck & Co., Inc.",
    companyNameKo: "머크",
    sectorKo: "제약·백신·동물건강",
    signature:
      "Keytruda 중심 oncology가 수익의 핵심이고, Gardasil/Gardasil 9와 Animal Health가 완충축을 만들며 Winrevair와 pipeline 진척이 다음 성장 속도를 정합니다.",
    description:
      "기업 리포트: Merck는 Human Health의 oncology, 백신, Animal Health를 함께 봐야 합니다. Keytruda와 Lynparza/Lenvima 제휴 수익, Gardasil/Gardasil 9 백신 수요, Animal Health의 안정적 현금흐름, Winrevair 상업화와 patent·환급 압력이 매출총이익률과 재투자 여력을 좌우합니다.",
    researchFocus: [
      "Keytruda 중심 oncology 매출, 가격, 환급 동인",
      "Gardasil/Gardasil 9 백신 채널과 지역별 수요",
      "Animal Health 매출 안정성과 비용 방어 효과",
      "Winrevair 상업화, PAH pipeline, patent 만료 대응",
    ],
    riskVariables: [
      "Keytruda patent 만료와 바이오시밀러·경쟁 치료제 진입",
      "미국·유럽 약가·환급 정책 변화에 따른 가격 전가력 약화",
      "Gardasil 수요 둔화와 지역별 재고·채널 조정",
      "Winrevair 적응증 확대 지연과 pipeline 승인 실패",
    ],
    suggestedPrompts: [
      "머크의 Keytruda, Lynparza/Lenvima, Gardasil/Gardasil 9, Animal Health가 매출총이익률과 현금흐름을 만드는 경로를 공시 기준으로 정리해줘.",
      "Keytruda patent 만료, 약가·환급 압력, Gardasil 수요 변화가 머크의 성장 논지에 미치는 영향을 비교해줘.",
      "Winrevair와 PAH pipeline이 머크의 재투자 여력, 마진, oncology 의존도 완화에 어떤 의미가 있는지 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  MS: {
    ticker: "MS",
    companyName: "Morgan Stanley",
    companyNameKo: "모건스탠리",
    sectorKo: "투자은행·자산관리",
    signature:
      "Institutional Securities의 investment banking fees·trading 수익과 Wealth Management의 NNA·fee-based client assets가 실적 변동성과 안정성을 함께 만듭니다.",
    description:
      "기업 리포트: Morgan Stanley는 Institutional Securities, Wealth Management, Investment Management를 Integrated Firm 구조로 운영합니다. M&A·underwriting·자본시장 발행 수수료, equity·fixed income trading, E*TRADE를 포함한 Self-Directed 채널, Advisor-Led 자산 유입, fee-based client assets와 AUM 수수료율이 매출과 현금흐름의 핵심 연결고리입니다.",
    researchFocus: [
      "Institutional Securities의 advisory, underwriting, investment banking fees",
      "equity·fixed income trading과 시장 변동성",
      "Wealth Management의 NNA, fee-based client assets, E*TRADE 채널",
      "Investment Management의 AUM mix와 fee rate",
    ],
    riskVariables: [
      "M&A·자본시장 발행 사이클 둔화에 따른 investment banking fees 감소",
      "금리·환율·시장 변동성이 trading 수익에 미치는 영향",
      "NNA와 fee-based client assets 둔화로 인한 Wealth Management 수익 압박",
      "규제자본·유동성 요건 강화에 따른 Institutional Securities 확장 제약",
    ],
    suggestedPrompts: [
      "모건스탠리의 Institutional Securities에서 advisory, underwriting, trading 수익이 어떻게 나뉘는지 공시 기준으로 정리해줘.",
      "모건스탠리 Wealth Management의 NNA, fee-based client assets, E*TRADE 채널이 수수료 수익 안정성에 미치는 영향을 설명해줘.",
      "모건스탠리의 Integrated Firm 구조가 Institutional Securities, Wealth Management, Investment Management 사이의 수익 변동성을 어떻게 완충하는지 공시 근거로 분석해줘.",
    ],
    questionChains: {},
  },
  MSFT: {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    companyNameKo: "마이크로소프트",
    sectorKo: "소프트웨어·클라우드",
    signature:
      "Microsoft 365, Azure, Dynamics, LinkedIn, GitHub, Gaming이 구독·cloud·광고·콘텐츠 수익을 만들고, AI 인프라 CapEx가 마진과 free cash flow의 핵심 변수입니다.",
    description:
      "기업 리포트: Microsoft는 Productivity and Business Processes, Intelligent Cloud, More Personal Computing을 함께 봐야 합니다. Microsoft 365 Commercial, Dynamics 365, LinkedIn, Azure and other cloud services, GitHub, Windows, Search advertising, Gaming과 Activision Blizzard 편입 효과가 매출 축을 만들며, Copilot·Azure AI 수요와 데이터센터 CapEx가 매출총이익률과 감가상각 부담을 좌우합니다.",
    researchFocus: [
      "Microsoft 365 Commercial, Dynamics 365, LinkedIn의 구독·광고 수익",
      "Azure and other cloud services, GitHub, Copilot, Azure AI 수요",
      "Windows, Search advertising, Gaming, Activision Blizzard 믹스",
      "AI 데이터센터 CapEx, GPU·전력·감가상각 부담",
    ],
    riskVariables: [
      "AI 인프라 CapEx와 cost of revenue 증가에 따른 gross margin 압박",
      "데이터센터 부지, 전력, GPU·서버 공급 제약",
      "OpenAI 연계 수요와 RPO의 분기별 변동성",
      "반독점, 개인정보, 광고·데이터 규제가 cloud·LinkedIn 성장에 미치는 영향",
    ],
    suggestedPrompts: [
      "마이크로소프트의 Microsoft 365 Commercial, Azure, Dynamics 365, LinkedIn이 세그먼트별 매출과 영업이익에 기여하는 구조를 공시 기준으로 정리해줘.",
      "Azure AI, Copilot, GitHub 수요와 AI 데이터센터 CapEx가 gross margin과 free cash flow에 미치는 영향을 설명해줘.",
      "Windows, Search advertising, Gaming, Activision Blizzard가 Intelligent Cloud 투자 우선순위와 어떤 균형을 이루는지 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  MU: {
    ticker: "MU",
    companyName: "Micron Technology, Inc.",
    companyNameKo: "마이크론 테크놀로지",
    sectorKo: "메모리 반도체·스토리지",
    signature:
      "DRAM, NAND, HBM이 AI data center 수요와 맞물리며 bit shipments, average selling price, product mix가 매출총이익률과 영업 레버리지를 좌우합니다.",
    description:
      "기업 리포트: Micron은 DRAM, NAND, NOR, SSD·스토리지를 data center, mobile, client, automotive 고객에게 공급합니다. HBM과 data center DRAM 수요, average selling price, bit shipments, CMBU·CDBU·MCBU·AEBU 믹스, inventory write-downs 가능성, CapEx와 free cash flow의 균형을 함께 봐야 합니다.",
    researchFocus: [
      "DRAM·NAND·HBM 매출의 average selling price와 bit shipments",
      "CMBU, CDBU, MCBU, AEBU별 data center·mobile·client·automotive 믹스",
      "AI data center 수요와 HBM 공급 우선순위",
      "inventory write-downs, CapEx, free cash flow 전환",
    ],
    riskVariables: [
      "AI data center 투자 둔화에 따른 ASP 하락 압력",
      "공급 제약 완화 또는 수요 전환에 따른 bit shipments 둔화",
      "mobile·client 믹스 변화가 매출총이익률에 미치는 영향",
      "재고 회전 지연과 inventory write-downs 확대 가능성",
    ],
    suggestedPrompts: [
      "마이크론의 DRAM, NAND, HBM 매출이 average selling price와 bit shipments를 통해 어떻게 성장했는지 공시 기준으로 분해해줘.",
      "CMBU, CDBU, MCBU, AEBU별 고객 믹스가 마이크론의 gross margin과 free cash flow에 미치는 영향을 비교해줘.",
      "AI data center 수요, HBM 공급 우선순위, inventory write-downs, CapEx가 마이크론의 성장 논지에 주는 리스크를 정리해줘.",
    ],
    questionChains: {},
  },
  NEE: {
    ticker: "NEE",
    companyName: "NextEra Energy, Inc.",
    companyNameKo: "넥스트에라 에너지",
    sectorKo: "전력·재생에너지",
    signature:
      "FPL의 rate base 성장과 NextEra Energy Resources의 renewables backlog가 현금흐름의 두 축이며, tax credits와 조달비용이 투자 속도를 좌우합니다.",
    description:
      "기업 리포트: NextEra Energy는 규제형 유틸리티 FPL과 재생에너지 개발·운영 사업인 NextEra Energy Resources(NEER)를 나눠 봐야 합니다. FPL은 base rates, rate base, fuel cost recovery를 통해 안정적 수익을 만들고, NEER는 wind, solar, battery storage backlog와 장기 전력판매계약, PTC·ITC tax credits가 세후 이익과 현금흐름에 반영됩니다.",
    researchFocus: [
      "FPL의 base rates, rate base, ROE, fuel cost recovery",
      "NEER의 renewables backlog, wind, solar, battery storage 파이프라인",
      "장기 전력판매계약과 tax credits(PTC/ITC)의 이익 기여",
      "금리·조달비용이 대규모 전력·재생에너지 투자에 미치는 영향",
    ],
    riskVariables: [
      "FPSC rate proceeding 지연과 승인 조건 변화",
      "천연가스 가격 변동과 fuel cost recovery 시차",
      "PTC·ITC 정책 변화로 인한 tax credits 축소",
      "금리 상승과 조달 여건 악화가 프로젝트 경제성에 미치는 영향",
    ],
    suggestedPrompts: [
      "넥스트에라 에너지의 FPL이 base rates, rate base, fuel cost recovery를 통해 매출과 현금흐름을 만드는 구조를 공시 기준으로 정리해줘.",
      "NEER의 renewables backlog, wind·solar·battery storage 프로젝트, 장기 전력판매계약이 성장 논지에 미치는 영향을 설명해줘.",
      "PTC·ITC tax credits, 금리, 조달비용 변화가 넥스트에라 에너지의 free cash flow와 투자 속도에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  NFLX: {
    ticker: "NFLX",
    companyName: "Netflix, Inc.",
    companyNameKo: "넷플릭스",
    sectorKo: "스트리밍",
    signature:
      "paid memberships와 ARM, advertising tier가 매출을 만들고, content amortization과 live events·games 투자가 마진과 free cash flow를 좌우합니다.",
    description:
      "기업 리포트: Netflix는 paid memberships, ARM(average revenue per membership), 광고형 요금제, 콘텐츠 라이선스·제작비와 content amortization을 함께 봐야 합니다. live events, games, 광고 기술, 외화 노출과 hedging이 구독 성장 이후의 매출 믹스와 현금흐름 안정성을 결정합니다.",
    researchFocus: [
      "paid memberships, ARM, 요금제·지역 믹스",
      "advertising tier와 광고 기술·영업 확장",
      "content amortization, 콘텐츠 제작·라이선스 비용",
      "live events, games, foreign exchange, hedging",
    ],
    riskVariables: [
      "광고형 요금제 수익화 지연과 광고주 수요 둔화",
      "content amortization 추정 변경에 따른 영업이익 변동",
      "제작 파업·collective bargaining 이슈가 콘텐츠 출시 일정에 미치는 영향",
      "foreign exchange 변동과 hedging 한계가 매출·비용에 미치는 영향",
    ],
    suggestedPrompts: [
      "넷플릭스의 paid memberships, ARM, advertising tier가 매출 성장과 마진에 기여하는 구조를 공시 기준으로 정리해줘.",
      "content amortization과 콘텐츠 제작·라이선스 비용이 넷플릭스의 free cash flow에 미치는 영향을 설명해줘.",
      "live events, games, foreign exchange, hedging이 넷플릭스의 성장 논지와 비용 구조에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  NOW: {
    ticker: "NOW",
    companyName: "ServiceNow",
    companyNameKo: "서비스나우",
    sectorKo: "기업용 워크플로 SaaS",
    signature:
      "ServiceNow Platform이 ITSM, ITOM, CSM, Creator Workflows를 묶어 subscription revenue를 만들고, RPO와 net retention이 성장의 질을 보여줍니다.",
    description:
      "기업 리포트: ServiceNow는 ServiceNow Platform을 기반으로 ITSM, ITOM, CSM, Creator Workflows, GenAI 기능을 확장합니다. 구독 매출, RPO, net retention, 대형 엔터프라이즈 갱신과 모듈 업셀링을 함께 봐야 고객 확산이 매출총이익률과 free cash flow로 전환되는 속도를 판단할 수 있습니다.",
    researchFocus: [
      "subscription revenue와 RPO의 계약 지속성",
      "ITSM, ITOM, CSM 모듈 확장과 갱신 흐름",
      "Creator Workflows와 GenAI의 upsell·cross-sell 기여",
      "net retention, 대형 고객 수, 판매 사이클 변화",
    ],
    riskVariables: [
      "엔터프라이즈 IT 예산 둔화와 갱신 협상 장기화",
      "플랫폼 장애·보안 사고가 ITSM/ITOM 신뢰도에 미치는 영향",
      "GenAI와 Creator Workflows 투자 대비 net retention 개선 지연",
      "Salesforce, Microsoft, Atlassian 등 경쟁 스택의 번들 압박",
    ],
    suggestedPrompts: [
      "서비스나우의 subscription revenue, RPO, net retention이 고객 갱신과 모듈 확산을 어떻게 보여주는지 공시 기준으로 정리해줘.",
      "ITSM, ITOM, CSM, Creator Workflows가 ServiceNow Platform 안에서 upsell과 cross-sell로 연결되는 구조를 설명해줘.",
      "GenAI 투자, 대형 고객 판매 사이클, 경쟁 스택 압박이 서비스나우의 성장 논지와 마진에 미치는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  NVDA: {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    companyNameKo: "엔비디아",
    sectorKo: "반도체·AI 인프라",
    signature:
      "Data Center가 매출의 핵심이고 Blackwell, H100, H200, Grace Hopper, networking이 AI 인프라 수요를 매출총이익률로 전환합니다.",
    description:
      "기업 리포트: NVIDIA는 Data Center의 Compute & Networking과 Graphics를 나눠 봐야 합니다. Blackwell, H100, H200, Grace Hopper 출하와 pricing, networking 스위치·소프트웨어 결합, 대형 cloud 고객의 투자 속도, supply constraints와 export controls가 매출 인식과 gross margin을 좌우합니다.",
    researchFocus: [
      "Data Center의 Blackwell, H100, H200, Grace Hopper 출하와 가격",
      "Compute & Networking 내 networking, 스위치, 소프트웨어 기여",
      "Graphics 게임·전문 그래픽 매출의 완충 역할",
      "supply constraints, export controls, 대형 cloud 고객 주문 타이밍",
    ],
    riskVariables: [
      "미·중 export controls 강화에 따른 지역 매출 제한",
      "Blackwell·H100·H200·Grace Hopper 공급 제약과 패키징·HBM 병목",
      "대형 고객 데이터센터 투자 속도 변화에 따른 주문 타이밍 변동",
      "networking 번들·가격 전략 변화가 gross margin에 미치는 영향",
    ],
    suggestedPrompts: [
      "엔비디아의 Data Center에서 Blackwell, H100, H200, Grace Hopper가 매출과 gross margin으로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Compute & Networking의 networking, 스위치, 소프트웨어 결합이 엔비디아의 AI 인프라 성장 논지에 미치는 영향을 설명해줘.",
      "supply constraints와 export controls가 엔비디아의 대형 cloud 고객 주문, 가격, 납기에 주는 리스크를 공시 근거로 분석해줘.",
    ],
    questionChains: {},
  },
  ORCL: {
    ticker: "ORCL",
    companyName: "Oracle Corporation",
    companyNameKo: "오라클",
    sectorKo: "기업용 소프트웨어·클라우드",
    signature:
      "Oracle Cloud Infrastructure(OCI)와 cloud services and license support가 성장 축이고, RPO와 데이터센터 CapEx가 AI cloud 수요의 가시성을 보여줍니다.",
    description:
      "기업 리포트: Oracle은 OCI, cloud services and license support, cloud license and on-premise license, Cerner(Oracle Health)를 함께 봐야 합니다. AI 인프라 수요와 데이터베이스 cloud 전환, remaining performance obligations(RPO), 데이터센터 lease commitments와 CapEx, Cerner 통합 속도가 매출 성장과 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "Oracle Cloud Infrastructure(OCI)와 AI 인프라 수요",
      "cloud services and license support의 반복매출 구조",
      "cloud license and on-premise license 전환 속도",
      "Cerner(Oracle Health), RPO, 데이터센터 lease commitments와 CapEx",
    ],
    riskVariables: [
      "AI cloud 수요 둔화에 따른 OCI 성장률 하락",
      "데이터센터 lease commitments와 CapEx 확대에 따른 현금흐름 압박",
      "on-premise license 전환 지연과 license support 안정성 약화",
      "Cerner(Oracle Health) 통합 지연과 보건 규제 대응 비용",
    ],
    suggestedPrompts: [
      "오라클의 OCI와 cloud services and license support가 cloud license and on-premise license 구조를 통해 매출로 연결되는 경로를 공시 기준으로 정리해줘.",
      "오라클의 RPO, 데이터센터 lease commitments, CapEx가 AI cloud 성장과 free cash flow에 미치는 영향을 비교해줘.",
      "Cerner(Oracle Health) 통합이 오라클의 cloud services and license support 성장 논지에 주는 긍정·부정 변수를 설명해줘.",
    ],
    questionChains: {},
  },
  PEP: {
    ticker: "PEP",
    companyName: "PepsiCo, Inc.",
    companyNameKo: "펩시코",
    sectorKo: "식품·음료",
    signature:
      "Frito-Lay North America, Quaker Foods North America, PepsiCo Beverages North America의 price/mix와 volume, productivity savings가 수익성의 핵심입니다.",
    description:
      "기업 리포트: PepsiCo는 convenient foods 중심의 Frito-Lay North America, Quaker Foods North America, PepsiCo Beverages North America를 나눠 봐야 합니다. price/mix, volume, productivity savings, 원재료·포장재·물류비, 프로모션 강도가 세그먼트별 매출총이익률과 영업현금흐름을 결정합니다.",
    researchFocus: [
      "Frito-Lay North America의 convenient foods 수익성",
      "Quaker Foods North America의 카테고리 회복과 비용 구조",
      "PepsiCo Beverages North America의 price/mix와 volume",
      "productivity savings, commodity, packaging, 물류비 영향",
    ],
    riskVariables: [
      "농산물·설탕·시럽·포장재 비용 상승",
      "가격 인상 이후 volume 둔화와 프로모션 비용 증가",
      "productivity savings 달성 지연에 따른 마진 방어력 약화",
      "물류비·환율 변동이 지역별 영업비용에 미치는 영향",
    ],
    suggestedPrompts: [
      "펩시코의 Frito-Lay North America, Quaker Foods North America, PepsiCo Beverages North America가 매출과 마진을 만드는 방식의 차이를 공시 기준으로 정리해줘.",
      "펩시코의 price/mix와 volume 변화가 세그먼트별 매출총이익률에 미치는 영향을 비교해줘.",
      "productivity savings, commodity, packaging, 물류비가 펩시코의 영업현금흐름과 성장 논지에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  PFE: {
    ticker: "PFE",
    companyName: "Pfizer Inc.",
    companyNameKo: "화이자",
    sectorKo: "제약",
    signature:
      "Comirnaty·Paxlovid 전환기와 Seagen 결합 후 oncology 축, IRA 가격·리베이트, cost realignment가 화이자의 실적 민감도를 결정합니다.",
    description:
      "기업 리포트: Pfizer는 Comirnaty와 Paxlovid 이후의 revenue transition, Eliquis·Vyndaqel·Ibrance 같은 성숙 처방약, Seagen 인수로 강화된 oncology pipeline을 함께 봐야 합니다. COVID 자산 감소 속도, Seagen ADC 포트폴리오 기여, IRA 할인·reimbursement, cost realignment 진행률이 매출총이익률과 영업 레버리지의 핵심 변수입니다.",
    researchFocus: [
      "Comirnaty·Paxlovid의 revenue transition과 마진 영향",
      "Eliquis, Vyndaqel, Ibrance의 성숙 포트폴리오 유지력",
      "Seagen 통합 이후 oncology pipeline과 ADC 상업화",
      "IRA 할인·reimbursement와 cost realignment 효과",
    ],
    riskVariables: [
      "COVID 수요 감소를 Seagen·oncology 매출이 대체하는 속도",
      "IRA 할인·리베이트 변화가 Eliquis·Vyndaqel·Ibrance 마진에 미치는 압박",
      "oncology 승인 지연과 pipeline 실패가 R&D 회수에 미치는 영향",
      "cost realignment 지연과 순이자 비용 증가에 따른 투자 여력 축소",
    ],
    suggestedPrompts: [
      "화이자의 Comirnaty와 Paxlovid revenue transition이 매출총이익률과 현금흐름에 미치는 영향을 공시 기준으로 정리해줘.",
      "Seagen 결합 이후 화이자의 oncology pipeline과 ADC 포트폴리오가 매출·마진·R&D 비용에 연결되는 경로를 설명해줘.",
      "IRA 할인·reimbursement, cost realignment, 순이자 비용이 Eliquis·Vyndaqel·Ibrance의 성장 논지에 미치는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  PG: {
    ticker: "PG",
    companyName: "The Procter & Gamble Company",
    companyNameKo: "프록터앤드갬블",
    sectorKo: "생활소비재",
    signature:
      "Beauty, Grooming, Health Care, Fabric & Home Care, Baby·Feminine·Family Care의 organic sales와 price/mix, productivity가 수익성의 방향을 정합니다.",
    description:
      "기업 리포트: P&G는 Beauty, Grooming, Health Care, Fabric & Home Care, Baby·Feminine·Family Care별로 가격·물량·믹스와 마진 경로가 다릅니다. organic sales, price/mix, commodity costs, productivity, supplier procurement, take-or-pay 구매 약정, 공급망 금융(SCF)이 매출총이익률과 free cash flow의 핵심 연결고리입니다.",
    researchFocus: [
      "Beauty, Grooming, Health Care, Fabric & Home Care, Baby·Feminine·Family Care별 organic sales",
      "price/mix와 volume이 카테고리별 매출총이익률에 미치는 영향",
      "commodity costs, productivity, 포장·운송비 절감",
      "supplier procurement, take-or-pay, 공급망 금융(SCF)과 working capital",
    ],
    riskVariables: [
      "원자재·포장·운송비 상승이 price/mix를 상쇄할 가능성",
      "소비자 가격 저항과 프로모션 증가로 인한 organic sales 둔화",
      "take-or-pay 구매 약정이 수요 둔화 구간에서 고정비 부담으로 작동할 위험",
      "productivity 개선 지연과 SCF 비용 상승에 따른 현금흐름 압박",
    ],
    suggestedPrompts: [
      "프록터앤드갬블의 Beauty, Grooming, Health Care, Fabric & Home Care, Baby·Feminine·Family Care별 organic sales와 price/mix 차이를 공시 기준으로 정리해줘.",
      "commodity costs, productivity, 포장·운송비가 프록터앤드갬블의 매출총이익률과 free cash flow에 미치는 영향을 분석해줘.",
      "supplier procurement, take-or-pay 구매 약정, 공급망 금융(SCF)이 프록터앤드갬블의 working capital과 비용 구조에 주는 의미를 설명해줘.",
    ],
    questionChains: {},
  },
  PGR: {
    ticker: "PGR",
    companyName: "The Progressive Corporation",
    companyNameKo: "프로그레시브",
    sectorKo: "손해보험",
    signature:
      "personal auto와 commercial auto에서 pricing, underwriting, claims 운영이 combined ratio를 움직이고, policies in force와 investment income이 성장과 완충력을 보여줍니다.",
    description:
      "기업 리포트: Progressive는 personal auto와 commercial auto의 policies in force, 요율 조정, loss ratio, claims 비용, catastrophe losses를 함께 봐야 합니다. underwriting 성과는 combined ratio에 바로 드러나고, investment income은 보험영업 변동성을 일부 완충합니다.",
    researchFocus: [
      "personal auto policies in force와 pricing 추세",
      "commercial auto 포트폴리오와 underwriting 조건",
      "loss ratio, claims, expense ratio가 combined ratio에 미치는 영향",
      "catastrophe losses와 investment income의 순이익 완충 역할",
    ],
    riskVariables: [
      "personal auto 손해율 악화가 combined ratio를 압박하는 구조",
      "catastrophe losses 증가에 따른 지급보험금과 reserve 부담",
      "policies in force 둔화와 가격 경쟁 심화",
      "investment income 둔화가 underwriting 외 완충력을 약화할 가능성",
    ],
    suggestedPrompts: [
      "프로그레시브의 personal auto와 commercial auto에서 policies in force, pricing, loss ratio가 combined ratio로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Progressive의 claims, expense ratio, underwriting 성과와 investment income이 순이익을 어떻게 나눠 만드는지 설명해줘.",
      "catastrophe losses가 프로그레시브의 지급보험금, reserve, capital 여력에 미치는 영향을 personal auto와 commercial auto 기준으로 비교해줘.",
    ],
    questionChains: {},
  },
  PLTR: {
    ticker: "PLTR",
    companyName: "Palantir Technologies Inc.",
    companyNameKo: "팔란티어",
    sectorKo: "AI·데이터 소프트웨어 플랫폼",
    signature:
      "AIP, Gotham, Foundry, Apollo가 U.S. Government와 U.S. Commercial 계약 확장을 만들고, remaining deal value, RPO, billings가 성장의 질을 보여줍니다.",
    description:
      "기업 리포트: Palantir는 AIP, Gotham, Foundry, Apollo를 정부·상업 고객의 데이터 운영 플랫폼으로 제공합니다. U.S. Government와 U.S. Commercial의 대형 계약, remaining deal value, remaining performance obligations(RPO), billings, contract liabilities, SBC가 매출 인식과 영업현금흐름의 핵심 연결고리입니다.",
    researchFocus: [
      "AIP, Gotham, Foundry, Apollo의 플랫폼별 계약 확장",
      "U.S. Government와 U.S. Commercial 매출 믹스",
      "remaining deal value, RPO, billings, contract liabilities",
      "Strategic Commercial Contracts, 고객 신용, SBC 비용",
    ],
    riskVariables: [
      "U.S. Government 예산 지연과 대형 계약 인식 시점 변동",
      "Strategic Commercial Contracts 고객의 자금 조달·신용 리스크",
      "대형 고객 갱신 지연이 billings와 영업현금흐름에 미치는 영향",
      "SBC와 payroll-related 비용 증가에 따른 영업마진 압박",
    ],
    suggestedPrompts: [
      "팔란티어의 AIP, Gotham, Foundry, Apollo가 U.S. Government와 U.S. Commercial 계약에서 매출로 연결되는 경로를 공시 기준으로 정리해줘.",
      "remaining deal value, RPO, billings, contract liabilities가 팔란티어의 성장 지속성 판단에서 어떤 순서로 중요한지 설명해줘.",
      "U.S. Government 수주 일정, Strategic Commercial Contracts, SBC가 팔란티어의 영업마진과 현금흐름에 주는 리스크를 비교해줘.",
    ],
    questionChains: {},
  },
  PM: {
    ticker: "PM",
    companyName: "Philip Morris International",
    companyNameKo: "필립 모리스 인터내셔널",
    sectorKo: "담배·Smoke-Free 소비재",
    signature:
      "IQOS, ZYN, VEEV를 앞세운 smoke-free products 전환이 핵심이고, heated tobacco units 성장과 combustible cigarettes 감소 속도가 마진을 좌우합니다.",
    description:
      "기업 리포트: Philip Morris International은 비미국 중심 combustible cigarettes 사업에서 IQOS, ZYN, VEEV 기반 smoke-free products로 전환하고 있습니다. heated tobacco units, nicotine pouch, e-vapor의 지역별 확산, Altria Agreement 이후 미국 IQOS 상용화, excise taxes, 규제 승인, currency가 net revenue와 operating income margin의 핵심 변수입니다.",
    researchFocus: [
      "IQOS, ZYN, VEEV와 smoke-free products 매출 믹스",
      "heated tobacco units, nicotine pouch, e-vapor 출하와 지역별 전환",
      "combustible cigarettes volume 감소와 price/mix 방어",
      "excise taxes, FDA·EU·일본 규제, currency 영향",
    ],
    riskVariables: [
      "excise taxes 변화가 smoke-free products 가격 경쟁력에 미치는 영향",
      "FDA, EU, 일본 등 규제 승인·판매 제한에 따른 IQOS·ZYN 확산 지연",
      "combustible cigarettes 감소 속도를 smoke-free 전환이 따라가지 못할 위험",
      "currency 변동과 원료·담뱃잎 조달 비용 상승",
    ],
    suggestedPrompts: [
      "필립 모리스의 IQOS, ZYN, VEEV가 smoke-free products 매출 믹스와 operating income margin에 기여하는 구조를 공시 기준으로 정리해줘.",
      "heated tobacco units와 combustible cigarettes volume 변화가 Philip Morris의 price/mix와 gross profit에 미치는 영향을 비교해줘.",
      "excise taxes, FDA·EU·일본 규제, currency가 Philip Morris의 smoke-free 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  QCOM: {
    ticker: "QCOM",
    companyName: "QUALCOMM Incorporated",
    companyNameKo: "퀄컴",
    sectorKo: "모바일 반도체·라이선싱",
    signature:
      "QCT의 Snapdragon, modem, RF front-end 매출과 QTL의 per-unit royalty가 핵심이고, handset 의존도에서 automotive·IoT 확장으로 성장 축이 이동합니다.",
    description:
      "기업 리포트: Qualcomm은 QCT 반도체 사업과 QTL 기술 라이선싱을 나눠 봐야 합니다. Snapdragon 플랫폼, modem, RF front-end, automotive와 IoT 칩 매출, QTL의 특허 royalty, China OEM 라이선스 갱신, 고객의 자체 SoC 전환과 공급망 제약이 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "QCT의 Snapdragon, modem, RF front-end, handset 매출",
      "automotive와 IoT 확장, Snapdragon Digital Chassis·Dragonwing",
      "QTL per-unit royalty와 China OEM 라이선스 갱신",
      "고객 자체 SoC, 파운드리·조립 공급망, 규제 리스크",
    ],
    riskVariables: [
      "프리미엄 handset 출하·출시 타이밍 변동",
      "China OEM 비중, 수출통제, 라이선스 회수 지연",
      "QTL royalty rate/base 조정과 라이선스 분쟁",
      "고객 자체 SoC 전환과 경쟁 칩 채택에 따른 Snapdragon 점유율 하락",
    ],
    suggestedPrompts: [
      "퀄컴의 QCT와 QTL 매출이 Snapdragon, modem, RF front-end, per-unit royalty를 통해 어떻게 만들어지는지 공시 기준으로 정리해줘.",
      "퀄컴의 automotive와 IoT 확장이 handset 의존도를 얼마나 낮추는지 Snapdragon Digital Chassis와 Dragonwing 중심으로 설명해줘.",
      "China OEM 라이선스, 고객 자체 SoC, 파운드리 공급망 제약이 퀄컴의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  RTX: {
    ticker: "RTX",
    companyName: "RTX Corporation",
    companyNameKo: "알티엑스",
    sectorKo: "항공우주·방산",
    signature:
      "Collins Aerospace, Pratt & Whitney, Raytheon의 backlog와 aftermarket, defense contracts가 실적 가시성을 만들고 GTF 이슈와 cost growth가 마진 리스크를 좌우합니다.",
    description:
      "기업 리포트: RTX는 Collins Aerospace의 항공우주 부품·aftermarket, Pratt & Whitney의 PW1000G Geared Turbofan(GTF)·F135 엔진, Raytheon의 Patriot·AMRAAM·방산 시스템을 함께 봐야 합니다. 상업항공 회복, defense contracts와 backlog, Powder Metal Matter 관련 GTF 비용, FFP/FPI 계약의 cost growth가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Collins Aerospace의 제품·서비스 믹스와 aftermarket 수익",
      "Pratt & Whitney의 GTF, F135, shop visit, Powder Metal Matter 비용",
      "Raytheon의 Patriot, AMRAAM, GEM-T와 defense contracts backlog",
      "FFP/FPI 계약, cost growth, 공급망·microelectronics 제약",
    ],
    riskVariables: [
      "GTF 장기 운영 이슈와 Powder Metal Matter 관련 비용 확대",
      "FFP/FPI 계약의 원가 예측 실패와 cost growth",
      "레어어스·microelectronics 공급 차질과 납기 지연",
      "미국 정부 예산·contract definitization 지연에 따른 방산 매출 인식 변동",
    ],
    suggestedPrompts: [
      "RTX의 Collins Aerospace, Pratt & Whitney, Raytheon별 backlog와 aftermarket 수익이 매출 가시성에 미치는 영향을 공시 기준으로 정리해줘.",
      "Pratt & Whitney의 GTF, F135, Powder Metal Matter 비용이 RTX의 gross margin과 free cash flow에 미치는 영향을 설명해줘.",
      "Raytheon defense contracts에서 FFP/FPI 조건, cost growth, 정부 예산 지연이 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  SCHW: {
    ticker: "SCHW",
    companyName: "The Charles Schwab Corporation",
    companyNameKo: "찰스 슈왑",
    sectorKo: "브로커리지·자산관리",
    signature:
      "Investor Services와 Advisor Services에서 client assets, sweep deposits, net interest revenue, asset management fees가 금리와 고객 현금 배분에 민감하게 움직입니다.",
    description:
      "기업 리포트: Charles Schwab은 Investor Services와 Advisor Services의 client assets, bank deposits, sweep deposits, margin loans, trading revenue를 함께 봐야 합니다. net interest revenue는 balance sheet와 조달비용에 민감하고, asset management and administration fees는 money market funds, Mutual Fund OneSource, managed investing solutions의 잔고와 평균 수수료율에 연결됩니다.",
    researchFocus: [
      "Investor Services와 Advisor Services의 client assets 흐름",
      "net interest revenue, bank deposits, sweep deposits, margin loans",
      "asset management and administration fees와 money market funds",
      "trading revenue, order flow revenue, balance sheet funding sources",
    ],
    riskVariables: [
      "고객 현금이 sweep deposits에서 고수익 대체 상품으로 이동할 위험",
      "금리·조달비용 변화가 net interest margin에 미치는 영향",
      "trading revenue 변동성과 market volatility 둔화",
      "보상비·소프트웨어·규제비용 증가에 따른 운영비 압박",
    ],
    suggestedPrompts: [
      "찰스 슈왑의 Investor Services와 Advisor Services에서 client assets, bank deposits, sweep deposits가 net interest revenue로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Schwab money market funds, Mutual Fund OneSource, managed investing solutions가 asset management and administration fees에 기여하는 방식을 설명해줘.",
      "sweep deposits 이동, 금리 경로, trading revenue 변동이 찰스 슈왑의 성장 논지와 balance sheet에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  SPGI: {
    ticker: "SPGI",
    companyName: "S&P Global Inc.",
    companyNameKo: "S&P 글로벌",
    sectorKo: "금융정보·지수·벤치마크",
    signature:
      "Ratings의 issuance 민감 매출과 Market Intelligence, Commodity Insights, S&P Dow Jones Indices, Mobility의 subscription revenue가 포트폴리오 수익성을 나눠 만듭니다.",
    description:
      "기업 리포트: S&P Global은 Ratings, Market Intelligence, S&P Dow Jones Indices, Commodity Insights, Mobility를 함께 봐야 합니다. Ratings transaction revenue는 채권 issuance에 민감하고, Market Intelligence·Commodity Insights·Mobility의 subscription revenue, Indices의 asset-linked fees와 usage-based royalties가 반복매출과 시장 민감도를 조합합니다.",
    researchFocus: [
      "Ratings transaction revenue와 billed issuance",
      "Market Intelligence와 Commodity Insights subscription revenue",
      "S&P Dow Jones Indices의 asset-linked fees와 royalties",
      "Mobility 데이터·리콜·자동차 시장 노출",
    ],
    riskVariables: [
      "금리·신용환경 변화에 따른 issuance 둔화와 Ratings 매출 변동",
      "Indices AUM과 파생상품 거래량 감소에 따른 asset-linked fees 압박",
      "Mobility의 자동차 생산·중고차·리콜 데이터 수요 변동",
      "데이터 규제·AI 규제·투명성 요구 증가에 따른 비용 상승",
    ],
    suggestedPrompts: [
      "S&P Global Ratings의 transaction revenue와 non-transaction revenue가 billed issuance와 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "Market Intelligence, Commodity Insights, Mobility의 subscription revenue 성격과 S&P Dow Jones Indices의 asset-linked fees를 비교해줘.",
      "issuance 둔화, Indices AUM 변화, 자동차 데이터 수요가 S&P Global의 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  STX: {
    ticker: "STX",
    companyName: "Seagate Technology Holdings plc",
    companyNameKo: "씨게이트",
    sectorKo: "데이터 저장장치",
    signature:
      "nearline과 mass capacity storage가 데이터센터 수요를 흡수하고, exabytes shipped, average selling price, Mozaic HAMR 전환이 수익성을 좌우합니다.",
    description:
      "기업 리포트: Seagate는 cloud customers의 nearline HDD 수요, mass capacity storage, Mozaic·HAMR 기반 고용량 전환을 함께 봐야 합니다. Data Center와 Edge IoT 수요, exabytes shipped, average selling price, product mix, purchase commitments와 inventory 조정이 gross margin과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "nearline과 mass capacity storage 수요 구조",
      "Mozaic·HAMR 기반 고용량 제품 전환",
      "exabytes shipped, average selling price, product mix",
      "cloud customers, purchase commitments, inventory 부담",
    ],
    riskVariables: [
      "nearline 수요 변동에 따른 exabytes shipped와 주문 타이밍 민감도",
      "Mozaic·HAMR 양산·고객 인증 지연",
      "cloud customers 주문 변경으로 인한 재고 누적 또는 stockout",
      "purchase commitments와 고정비 구조가 수요 조정기에 현금흐름을 압박할 가능성",
    ],
    suggestedPrompts: [
      "씨게이트의 nearline HDD와 mass capacity storage 수요가 exabytes shipped, average selling price, gross margin으로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Mozaic·HAMR 전환과 cloud customers 수요가 씨게이트의 product mix와 성장 논지에 미치는 영향을 설명해줘.",
      "purchase commitments, inventory, 주문 취소·조정이 씨게이트의 free cash flow와 조달 효율에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  SYK: {
    ticker: "SYK",
    companyName: "Stryker Corporation",
    companyNameKo: "스트라이커",
    sectorKo: "의료기기",
    signature:
      "MedSurg and Neurotechnology와 Orthopaedics and Spine이 실적의 두 축이고, Mako procedure volume과 병원 capital spending이 임플란트·장비 수요를 좌우합니다.",
    description:
      "기업 리포트: Stryker는 MedSurg and Neurotechnology, Orthopaedics and Spine을 나눠 봐야 합니다. Mako Total Knee·Total Hip·Partial Knee procedure volume, implants 채택, 병원 장비 업그레이드, reimbursement와 병원 capital spending, product liability와 recall 리스크가 매출총이익률과 성장 속도의 핵심 변수입니다.",
    researchFocus: [
      "MedSurg and Neurotechnology의 수술기기·neurotechnology 믹스",
      "Orthopaedics and Spine의 implants, Mako procedure volume",
      "병원 capital spending, reimbursement, 장비 업그레이드 주기",
      "product liability, recall, 품질·규제 리스크",
    ],
    riskVariables: [
      "Mako와 핵심 implants procedure volume 둔화",
      "병원 capital spending 감소에 따른 신제품 채택 지연",
      "재료비·운송비 상승과 가격 인하 압박에 따른 마진 훼손",
      "product liability claim, recall, 규제 분쟁 확대",
    ],
    suggestedPrompts: [
      "스트라이커의 MedSurg and Neurotechnology와 Orthopaedics and Spine이 매출·영업이익을 만드는 방식의 차이를 공시 기준으로 정리해줘.",
      "Mako Total Knee, Total Hip, Partial Knee procedure volume이 implants 채택과 병원 장비 업그레이드 수요에 미치는 영향을 설명해줘.",
      "병원 capital spending, reimbursement, product liability, recall 리스크가 스트라이커의 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  T: {
    ticker: "T",
    companyName: "AT&T Inc.",
    companyNameKo: "AT&T",
    sectorKo: "통신",
    signature:
      "Mobility의 postpaid phone net adds·churn·ARPU와 Consumer Wireline의 fiber 확장, spectrum 투자와 debt reduction이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: AT&T는 Mobility, Consumer Wireline, Business Wireline을 나눠 봐야 합니다. postpaid phone net adds, churn, ARPU, AT&T Fiber와 Internet Air, spectrum 확보, vendor financing과 supplier financing, debt reduction이 service revenue와 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "Mobility의 postpaid phone net adds, churn, ARPU",
      "Consumer Wireline의 AT&T Fiber, Internet Air, fixed wireless",
      "Business Wireline legacy 서비스 축소와 비용 재배치",
      "spectrum 투자, vendor financing, supplier financing, debt reduction",
    ],
    riskVariables: [
      "postpaid churn 상승과 ARPU 방어력 약화",
      "legacy wireline 매출 감소와 고정비 재배치 지연",
      "spectrum·fiber 투자와 vendor financing이 FCF를 압박할 가능성",
      "부채 상환, 배당, 자사주 매입 간 자본배분 제약",
    ],
    suggestedPrompts: [
      "AT&T Mobility의 postpaid phone net adds, churn, ARPU가 service revenue와 free cash flow로 연결되는 구조를 공시 기준으로 정리해줘.",
      "AT&T Fiber, Internet Air, fixed wireless 확장이 Consumer Wireline 성장과 legacy 축소를 어떻게 상쇄하는지 설명해줘.",
      "spectrum 투자, vendor financing, supplier financing, debt reduction이 AT&T의 성장 논지와 자본배분에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  TMO: {
    ticker: "TMO",
    companyName: "Thermo Fisher Scientific Inc.",
    companyNameKo: "써모 피셔",
    sectorKo: "생명과학 장비·진단",
    signature:
      "Life Sciences Solutions, Analytical Instruments, Specialty Diagnostics, Laboratory Products and Biopharma Services가 pharma/biotech 수요와 임상연구 투자를 매출로 전환합니다.",
    description:
      "기업 리포트: Thermo Fisher는 Life Sciences Solutions의 bioproduction, Analytical Instruments의 chromatography·mass spectrometry·electron microscopy, Specialty Diagnostics의 clinical diagnostics, Laboratory Products and Biopharma Services의 pharma services·clinical research를 함께 봐야 합니다. China demand, pharma/biotech funding, government funding, 인수 통합과 공급망 비용이 성장과 마진의 핵심 변수입니다.",
    researchFocus: [
      "Life Sciences Solutions의 bioproduction과 genetic sciences",
      "Analytical Instruments의 chromatography, mass spectrometry, electron microscopy",
      "Specialty Diagnostics의 clinical diagnostics와 transplant diagnostics",
      "LPBS의 pharma services, clinical research, sterile fill finishing",
    ],
    riskVariables: [
      "China demand 둔화와 현지조달·규제 요구 강화",
      "pharma/biotech funding과 government funding 둔화",
      "tariffs, 환율, raw materials, energy, logistics 비용 상승",
      "인수 통합, 재구조화, 시설 통폐합에 따른 이익 변동성",
    ],
    suggestedPrompts: [
      "써모 피셔의 Life Sciences Solutions, Analytical Instruments, Specialty Diagnostics, LPBS가 매출과 마진을 만드는 방식의 차이를 공시 기준으로 정리해줘.",
      "bioproduction, clinical research, pharma services가 pharma/biotech funding 변화에 어떻게 반응하는지 설명해줘.",
      "China demand 둔화, government funding, tariffs·환율·물류비가 써모 피셔의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  TMUS: {
    ticker: "TMUS",
    companyName: "T-Mobile US, Inc.",
    companyNameKo: "티모바일",
    sectorKo: "무선통신",
    signature:
      "postpaid phone net adds, churn, ARPU, 5G spectrum 효율, fixed wireless 성장이 service revenue와 free cash flow의 핵심 driver입니다.",
    description:
      "기업 리포트: T-Mobile US는 postpaid·prepaid 무선 구독 기반 service revenue를 중심으로 봐야 합니다. postpaid phone net adds, churn, ARPU, 5G spectrum과 network integration, fixed wireless(5G Home Internet), customer acquisition costs와 device subsidy가 매출 질과 현금흐름을 결정합니다.",
    researchFocus: [
      "postpaid phone net adds와 churn",
      "ARPU와 service revenue mix",
      "5G spectrum, network integration, fixed wireless",
      "customer acquisition costs, device subsidy, free cash flow",
    ],
    riskVariables: [
      "요금 경쟁 심화에 따른 postpaid churn 압력",
      "customer acquisition costs와 device subsidy 상승",
      "5G spectrum·네트워크 투자 부담으로 인한 FCF 압박",
      "fixed wireless 성장 둔화와 ARPU 믹스 약화",
    ],
    suggestedPrompts: [
      "티모바일의 postpaid phone net adds, churn, ARPU가 service revenue와 free cash flow로 연결되는 구조를 공시 기준으로 정리해줘.",
      "5G spectrum, network integration, fixed wireless(5G Home Internet)가 티모바일의 마진과 성장 논지에 미치는 영향을 설명해줘.",
      "customer acquisition costs와 device subsidy가 티모바일의 churn 대응력과 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  TSLA: {
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    companyNameKo: "테슬라",
    sectorKo: "전기차·에너지",
    signature:
      "Model 3/Y와 Cybertruck deliveries, automotive gross margin, Energy Generation and Storage, FSD·Supercharger 수익화가 실적의 핵심 축입니다.",
    description:
      "기업 리포트: Tesla는 Model 3/Y, Cybertruck 중심 deliveries와 가격 정책, 배터리·원재료 비용, 제조 효율이 automotive gross margin을 좌우합니다. Energy Generation and Storage의 Megapack, Solar, Powerwall, FSD 옵션·구독, Supercharger, 보험·서비스, regulatory credits를 함께 봐야 자동차 외 수익과 free cash flow를 판단할 수 있습니다.",
    researchFocus: [
      "Model 3/Y, Cybertruck deliveries와 차량 믹스",
      "automotive gross margin, 가격 정책, 배터리·원재료 비용",
      "Energy Generation and Storage의 Megapack, Solar, Powerwall",
      "FSD, Supercharger, 보험·서비스, regulatory credits",
    ],
    riskVariables: [
      "가격 인하와 수요 둔화가 automotive gross margin에 미치는 압박",
      "Cybertruck ramp-up, 품질·보증·재고 리스크",
      "FSD 규제·안전 이슈와 소프트웨어 수익화 지연",
      "Megapack 프로젝트 일정·인허가 지연과 regulatory credits 둔화",
    ],
    suggestedPrompts: [
      "테슬라의 Model 3/Y와 Cybertruck deliveries가 automotive gross margin과 가격 정책에 연결되는 구조를 공시 기준으로 정리해줘.",
      "FSD, Supercharger, 보험·서비스가 테슬라의 반복성 수익과 free cash flow에 미치는 영향을 설명해줘.",
      "Energy Generation and Storage에서 Megapack, Solar, Powerwall과 regulatory credits가 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  TXN: {
    ticker: "TXN",
    companyName: "Texas Instruments Incorporated",
    companyNameKo: "텍사스 인스트루먼트",
    sectorKo: "아날로그·임베디드 반도체",
    signature:
      "Analog와 Embedded Processing, 300-mm wafer 제조역량, industrial·automotive 수요와 factory loading이 gross margin과 free cash flow를 좌우합니다.",
    description:
      "기업 리포트: Texas Instruments는 Analog의 power·signal chain과 Embedded Processing의 microcontrollers·processors를 중심으로 산업·자동차 고객에 노출됩니다. 300-mm wafer capacity expansion, 자체 fab·assembly/test, inventory 전략, factory loading, depreciation이 매출총이익률과 현금흐름의 핵심 연결고리입니다.",
    researchFocus: [
      "Analog와 Embedded Processing의 segment mix",
      "300-mm wafer capacity expansion과 LFAB ramp",
      "industrial, automotive, data center 수요와 출하량",
      "inventory days, factory loading, depreciation과 gross margin",
    ],
    riskVariables: [
      "산업·자동차 반도체 사이클 둔화에 따른 출하량 감소",
      "capacity expansion 선행과 factory loading 하락에 따른 gross margin 압박",
      "재고 일수 증가와 obsolete inventory 위험",
      "고객·distributor 구매 조정과 금리 상승에 따른 이자비용 부담",
    ],
    suggestedPrompts: [
      "텍사스 인스트루먼트의 Analog와 Embedded Processing 매출 믹스가 industrial·automotive 수요와 gross margin에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "300-mm wafer capacity expansion, LFAB ramp, factory loading이 TXN의 비용 구조와 free cash flow에 미치는 영향을 설명해줘.",
      "inventory days, distributor 구매 조정, depreciation 증가가 TXN의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  UBER: {
    ticker: "UBER",
    companyName: "Uber Technologies, Inc.",
    companyNameKo: "우버",
    sectorKo: "모빌리티·딜리버리 플랫폼",
    signature:
      "Mobility, Delivery, Freight가 Trips와 MAPCs를 gross bookings로 확장하고, take rate와 driver incentives 균형이 수익성과 free cash flow를 좌우합니다.",
    description:
      "기업 리포트: Uber는 Mobility ride, Delivery order, Freight load를 한 플랫폼에서 연결합니다. MAPCs, Trips, gross bookings, take rate, driver·courier incentives, 보험·결제 처리 비용, Freight 시장 사이클, autonomous vehicles와 독립 계약자 분류 규제가 매출총이익률과 adjusted EBITDA의 핵심 변수입니다.",
    researchFocus: [
      "Mobility, Delivery, Freight별 gross bookings와 take rate",
      "Trips, MAPCs, Revenue Margin, adjusted EBITDA",
      "driver incentives, courier incentives, 보험·결제 처리 비용",
      "Freight cycle, autonomous vehicles, 독립 계약자 규제",
    ],
    riskVariables: [
      "독립 계약자 분류와 노동 규제 변화에 따른 비용 구조 변화",
      "driver incentives 확대가 take rate와 수익성을 압박할 가능성",
      "보험료·결제 처리 비용 상승과 규제 준수 비용 증가",
      "Freight 경기 둔화와 autonomous vehicles 경쟁 확산",
    ],
    suggestedPrompts: [
      "우버의 Mobility, Delivery, Freight에서 Trips, MAPCs, gross bookings, take rate가 매출로 연결되는 구조를 공시 기준으로 정리해줘.",
      "driver incentives, courier incentives, 보험·결제 처리 비용이 우버의 adjusted EBITDA와 free cash flow에 미치는 영향을 설명해줘.",
      "독립 계약자 분류, Freight 사이클, autonomous vehicles가 우버의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  UNH: {
    ticker: "UNH",
    companyName: "UnitedHealth Group Incorporated",
    companyNameKo: "유나이티드헬스",
    sectorKo: "관리의료·헬스케어 서비스",
    signature:
      "UnitedHealthcare의 보험료·회원 믹스와 Optum Health, Optum Insight, Optum Rx의 운영 효율이 medical care ratio와 마진을 좌우합니다.",
    description:
      "기업 리포트: UnitedHealth는 보험 사업 UnitedHealthcare와 Optum Health, Optum Insight, Optum Rx를 함께 봐야 합니다. Commercial, Medicare Advantage, Medicaid 회원 믹스와 benefits pricing, medical care ratio, pharmacy care services, claim review·데이터 분석, 약가·rebate 구조가 매출과 영업이익의 핵심 연결고리입니다.",
    researchFocus: [
      "UnitedHealthcare의 Commercial, Medicare Advantage, Medicaid 회원 믹스",
      "medical care ratio와 benefits pricing",
      "Optum Health, Optum Insight의 care delivery·claim analytics",
      "Optum Rx와 pharmacy care services, rebate·약가 구조",
    ],
    riskVariables: [
      "의료비 이용률 상승이 medical care ratio를 악화할 가능성",
      "Medicare Advantage 보상 규칙과 risk adjustment 변화",
      "Medicaid 자격·정책 변화와 회원 믹스 변동",
      "pharmacy care services의 rebate·약가 규제와 데이터 운영 규제 강화",
    ],
    suggestedPrompts: [
      "유나이티드헬스의 UnitedHealthcare에서 Commercial, Medicare Advantage, Medicaid 회원 믹스와 benefits pricing이 medical care ratio로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Optum Health, Optum Insight, Optum Rx가 medical care ratio와 영업이익률을 어떻게 보완하는지 설명해줘.",
      "Medicare Advantage, Medicaid, pharmacy care services 규제 변화가 유나이티드헬스의 성장 논지와 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  UNP: {
    ticker: "UNP",
    companyName: "Union Pacific Corporation",
    companyNameKo: "유니언 퍼시픽",
    sectorKo: "철도 운송",
    signature:
      "carloads, traffic mix, fuel surcharge가 freight revenue를 만들고, network velocity와 operating ratio, labor agreements가 철도 운영 레버리지를 좌우합니다.",
    description:
      "기업 리포트: Union Pacific은 intermodal, coal, agricultural products, industrial 물동량과 carloads, ARC, price·mix, fuel surcharge를 함께 봐야 합니다. freight car velocity, terminal dwell, network velocity, operating ratio, labor agreements와 임금·연료비가 매출총이익률과 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "intermodal, coal, agricultural products carloads와 traffic mix",
      "freight revenue, ARC, price·mix, fuel surcharge",
      "network velocity, freight car velocity, terminal dwell, operating ratio",
      "labor agreements, 임금·연료비, 운영비 구조",
    ],
    riskVariables: [
      "intermodal 물동량 둔화와 국제 컨테이너 수요 변동",
      "coal 수요 감소와 natural gas 전환 압력",
      "fuel surcharge lag와 연료 가격 변동성",
      "labor agreements 갱신과 임금 상승이 operating ratio에 미치는 영향",
    ],
    suggestedPrompts: [
      "유니언 퍼시픽의 carloads, intermodal, coal, agricultural products mix가 freight revenue와 operating ratio에 연결되는 구조를 공시 기준으로 정리해줘.",
      "fuel surcharge, ARC, price·mix가 UNP의 매출과 free cash flow에 반영되는 순서를 설명해줘.",
      "network velocity, terminal dwell, labor agreements가 Union Pacific의 성장 논지와 운영비에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  V: {
    ticker: "V",
    companyName: "Visa Inc.",
    companyNameKo: "비자",
    sectorKo: "글로벌 결제 네트워크",
    signature:
      "payments volume과 processed transactions가 service revenues를 만들고, cross-border volume, Visa Direct, data processing revenues가 수익의 질을 가릅니다.",
    description:
      "기업 리포트: Visa는 payments volume, cross-border volume, processed transactions를 네트워크 수익으로 전환합니다. service revenues, data processing revenues, Visa Direct, value-added services, client incentives, issuer·merchant 관계, 수수료 규제와 보안 리스크를 함께 봐야 매출총이익률과 현금흐름을 판단할 수 있습니다.",
    researchFocus: [
      "payments volume, cross-border volume, processed transactions",
      "service revenues와 data processing revenues",
      "Visa Direct와 value-added services 성장",
      "client incentives, 환율, 수수료 규제, 보안 리스크",
    ],
    riskVariables: [
      "수수료 규제와 지급결제 환경 변화에 따른 가격 전가력 제한",
      "사이버보안 사고·결제 처리 장애가 processed transactions에 미치는 영향",
      "AML/CFT, 개인정보, 국가별 결제 규제에 따른 compliance 비용 증가",
      "travel·ecommerce 수요 변동에 따른 cross-border volume 둔화",
    ],
    suggestedPrompts: [
      "비자의 payments volume, cross-border volume, processed transactions가 service revenues와 data processing revenues로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Visa Direct와 value-added services가 비자의 매출총이익률과 현금흐름에 어떤 의미를 갖는지 설명해줘.",
      "client incentives, 수수료 규제, 보안 리스크가 비자의 성장 논지와 마진 안정성에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  VRTX: {
    ticker: "VRTX",
    companyName: "Vertex Pharmaceuticals Incorporated",
    companyNameKo: "버텍스",
    sectorKo: "바이오테크",
    signature:
      "Trikafta/Kaftrio와 ALYFTREK가 cystic fibrosis 매출축을 유지하고, CASGEVY와 Journavx가 non-CF 다각화와 pipeline 확장 속도를 보여줍니다.",
    description:
      "기업 리포트: Vertex는 cystic fibrosis 치료제 Trikafta/Kaftrio, ALYFTREK를 중심으로 수익을 만들며 CASGEVY, Journavx(VX-548/suzetrigine), povetacicept, inaxaplin 등 non-CF pipeline으로 확장을 시도합니다. reimbursement, label extension, collaboration revenues, CRISPR·Zai 등 제휴 구조가 매출 인식과 R&D 회수의 핵심 변수입니다.",
    researchFocus: [
      "Trikafta/Kaftrio, ALYFTREK의 cystic fibrosis 매출과 reimbursement",
      "CASGEVY 상업화와 SCD/TDT 접근성",
      "Journavx(VX-548/suzetrigine)와 non-CF pipeline",
      "collaboration revenues, CRISPR·Zai 제휴, in-licensing 비용",
    ],
    riskVariables: [
      "reimbursement 지연으로 CF·non-CF 제품 매출 인식이 늦어질 가능성",
      "CASGEVY와 Journavx 초기 상용화·처방 채택 리스크",
      "pipeline 임상 실패 또는 적응증 확대 지연",
      "세포·유전자치료 제조와 공급망 복잡성",
    ],
    suggestedPrompts: [
      "버텍스의 Trikafta/Kaftrio, ALYFTREK, CASGEVY, Journavx가 매출과 마진에 기여하는 구조를 공시 기준으로 정리해줘.",
      "reimbursement와 label extension이 Vertex의 cystic fibrosis franchise와 non-CF 다각화에 미치는 영향을 설명해줘.",
      "CASGEVY, Journavx, VX-548/suzetrigine, povetacicept, inaxaplin pipeline이 성장 논지와 R&D 리스크에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },
  VZ: {
    ticker: "VZ",
    companyName: "Verizon Communications Inc.",
    companyNameKo: "버라이즌",
    sectorKo: "통신",
    signature:
      "Consumer와 Business의 wireless service revenue는 postpaid phone net adds, churn, ARPA가 좌우하고, Fios·fixed wireless access·spectrum·debt가 FCF를 결정합니다.",
    description:
      "기업 리포트: Verizon은 Consumer와 Business를 나눠 postpaid phone net additions, postpaid phone churn, wireless retail postpaid ARPA, wireless service revenue를 봐야 합니다. Fios fiber broadband, fixed wireless access(FWA), Business mobility·IoT·보안 서비스, spectrum 확보 비용과 debt 구조가 network 투자와 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "Consumer와 Business revenue mix, wireless service revenue",
      "postpaid phone net additions, churn, ARPA",
      "Fios fiber broadband와 fixed wireless access(FWA)",
      "spectrum 확보 비용, debt, capex와 free cash flow",
    ],
    riskVariables: [
      "postpaid phone net additions 둔화와 churn 상승",
      "ARPA 하락이 wireless service revenue 방어에 미치는 압박",
      "Fios·FWA 확장 비용과 장비·유지비 증가",
      "spectrum 경쟁, debt 비용, 배당·network 투자 여력 제약",
    ],
    suggestedPrompts: [
      "버라이즌의 Consumer와 Business에서 postpaid phone net additions, churn, ARPA가 wireless service revenue에 연결되는 구조를 공시 기준으로 정리해줘.",
      "Fios fiber broadband와 fixed wireless access(FWA)가 Verizon의 broadband mix와 free cash flow에 미치는 영향을 설명해줘.",
      "spectrum 확보 비용과 debt 구조가 Verizon의 capex, 배당, 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  WDC: {
    ticker: "WDC",
    companyName: "Western Digital",
    companyNameKo: "웨스턴디지털",
    sectorKo: "HDD·데이터 스토리지",
    signature:
      "Cloud HDD 수요와 exabytes sold, average selling price per exabyte가 수익성을 좌우하고, Sandisk/Flash 분리 이후 HDD 집중도가 더 선명해졌습니다.",
    description:
      "기업 리포트: Western Digital은 Cloud, Client, Consumer end market에서 HDD 기반 스토리지를 공급합니다. Cloud 고객의 nearline·대용량 HDD 수요, exabytes sold, average selling price, inventory, 상위 고객 집중도, Sandisk와 Flash 비즈니스 분리 이후의 비용 구조가 gross margin과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Cloud HDD 수요와 exabytes sold",
      "average selling price per exabyte와 product mix",
      "Sandisk/Flash 분리 이후 HDD 비용 구조",
      "inventory, 상위 cloud customers 집중도, 공급망 비용",
    ],
    riskVariables: [
      "Cloud 고객 주문 변동과 상위 고객 집중도 리스크",
      "HDD 단일 사업 집중에 따른 대체기술·가격 압박",
      "inventory 조정 실패와 공급망 비용 상승",
      "Sandisk 지분·분리 관련 손익과 차입 구조 변동성",
    ],
    suggestedPrompts: [
      "웨스턴디지털의 Cloud HDD 수요가 exabytes sold와 average selling price per exabyte를 통해 gross margin에 미치는 영향을 공시 기준으로 정리해줘.",
      "Sandisk/Flash 분리 이후 Western Digital의 HDD 집중 구조와 비용 구조 변화가 성장 논지에 미치는 영향을 설명해줘.",
      "cloud customers 집중도, inventory, 공급망 비용이 Western Digital의 free cash flow와 가격 협상력에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  WELL: {
    ticker: "WELL",
    companyName: "Welltower Inc.",
    companyNameKo: "웰타워",
    sectorKo: "헬스케어 리츠",
    signature:
      "Seniors Housing Operating, Triple-net, Outpatient Medical의 NOI 구조에서 occupancy, rate growth, rent escalators, operator concentration이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: Welltower는 Seniors Housing Operating의 resident fees and services, Triple-net lease의 fixed·contingent rent escalators, Outpatient Medical 포트폴리오 재배치를 함께 봐야 합니다. same-store NOI, occupancy, rate growth, operator concentration, interest expense와 자산 매각·재투자 타이밍이 AFFO와 성장 논지의 핵심 변수입니다.",
    researchFocus: [
      "Seniors Housing Operating의 occupancy, rate growth, resident fees and services",
      "Triple-net lease의 rent escalators와 임차인 mix",
      "Outpatient Medical 매각·재투자와 same-store NOI",
      "operator concentration, interest expense, AFFO 민감도",
    ],
    riskVariables: [
      "occupancy 둔화와 rate growth 정체가 same-store NOI를 압박할 가능성",
      "operator concentration과 운영사 재무건전성 악화",
      "rent escalators 조건 미충족에 따른 rental income 둔화",
      "금리 상승과 interest expense 증가, 자산 매각·재투자 지연",
    ],
    suggestedPrompts: [
      "웰타워의 Seniors Housing Operating, Triple-net, Outpatient Medical이 same-store NOI와 AFFO를 만드는 구조를 공시 기준으로 정리해줘.",
      "occupancy, rate growth, resident fees and services, rent escalators가 웰타워의 현금흐름에 전달되는 경로를 설명해줘.",
      "operator concentration, interest expense, Outpatient Medical 매각·재투자가 웰타워의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  ACN: {
    ticker: "ACN",
    companyName: "Accenture",
    companyNameKo: "액센추어",
    sectorKo: "IT 컨설팅·Managed Services",
    signature:
      "Consulting과 Managed Services bookings가 매출 전환 속도를 나누고, GenAI·cloud·security 수요와 utilization·attrition이 contract profitability를 좌우합니다.",
    description:
      "기업 리포트: Accenture는 Strategy & Consulting, Technology, Operations, Song, Industry X를 Reinvention Services로 묶어 제공합니다. Consulting과 Managed Services의 bookings 전환 속도, Americas·EMEA·Asia Pacific 지역 수요, CMT·Financial Services·Health & Public Service·Products·Resources 산업군, utilization, workforce, voluntary attrition, payroll·subcontractor 비용이 영업이익률의 핵심 변수입니다.",
    researchFocus: [
      "Consulting과 Managed Services bookings·매출 전환 속도",
      "GenAI, cloud, security, Industry X 수요",
      "Americas, EMEA, Asia Pacific과 산업군별 성장",
      "utilization, workforce, attrition, contract profitability",
    ],
    riskVariables: [
      "단기 Consulting 수요 둔화와 Managed Services 대형계약 전환 지연",
      "utilization·스킬 매칭 실패와 compensation pressure",
      "FX 변동과 지역별 고객 IT 예산 둔화",
      "보안 사고, ecosystem partner 협업 약화, AI 제휴 실패",
    ],
    suggestedPrompts: [
      "액센추어의 Consulting과 Managed Services bookings가 매출과 영업이익률로 전환되는 속도의 차이를 공시 기준으로 정리해줘.",
      "GenAI, cloud, security, Industry X 수요가 액센추어의 지역·산업군별 성장에 미치는 영향을 설명해줘.",
      "utilization, workforce, voluntary attrition, payroll·subcontractor 비용이 contract profitability에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  ADP: {
    ticker: "ADP",
    companyName: "Automatic Data Processing",
    companyNameKo: "애드피",
    sectorKo: "인적자본 관리",
    signature:
      "Employer Services와 PEO Services가 payroll·HCM 수익을 만들고, bookings, retention, pays per control, client funds 운용 수익이 실적 민감도를 결정합니다.",
    description:
      "기업 리포트: ADP는 Employer Services와 PEO Services를 통해 payroll, HCM, HR Outsourcing, Global Solutions를 제공합니다. new business bookings, client retention, pays per control, average worksite employees, PEO zero-margin benefits pass-through, interest on funds held for clients와 client funds liquidity가 매출과 마진의 핵심 변수입니다.",
    researchFocus: [
      "Employer Services의 bookings, retention, pays per control",
      "PEO Services의 worksite employees와 benefits pass-through",
      "client funds balances와 interest on funds held for clients",
      "ADP Indemnity, workers' compensation, client funds liquidity",
    ],
    riskVariables: [
      "고용 둔화가 pays per control과 new business bookings에 미치는 영향",
      "PEO zero-margin benefits pass-through 확대에 따른 마진 희석",
      "금리 변동이 interest on funds held for clients에 미치는 영향",
      "client funds 운용·단기 조달시장 변동에 따른 유동성 리스크",
    ],
    suggestedPrompts: [
      "ADP의 Employer Services와 PEO Services가 payroll, HCM, HR Outsourcing 매출을 만드는 구조를 공시 기준으로 정리해줘.",
      "new business bookings, retention, pays per control, interest on funds held for clients가 ADP의 이익률에 연결되는 경로를 설명해줘.",
      "PEO Services의 worksite employees, benefits pass-through, ADP Indemnity 비용이 ADP의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  APH: {
    ticker: "APH",
    companyName: "Amphenol",
    companyNameKo: "앰페놀",
    sectorKo: "커넥터·케이블·센서",
    signature:
      "Harsh Environment Solutions, Communications Solutions, Interconnect and Sensor Systems가 communications, aerospace, defense, automotive 수요와 acquisitions 통합 성과를 매출로 전환합니다.",
    description:
      "기업 리포트: Amphenol은 interconnect, cable, sensor, antenna 제품을 Harsh Environment Solutions, Communications Solutions, Interconnect and Sensor Systems로 제공합니다. RF·광학·고속 인터커넥트, ruggedized connector, cable assemblies, sensor 포트폴리오가 aerospace, defense, automotive, communications, IT/datacom 고객 수요에 연결되고 acquisitions 통합이 제품군과 고객 기반을 넓힙니다.",
    researchFocus: [
      "Harsh Environment Solutions의 ruggedized interconnect와 방산·항공우주 수요",
      "Communications Solutions의 RF, optical, high-speed interconnect, cable, antenna",
      "Interconnect and Sensor Systems의 sensor, backplane, cable assemblies",
      "automotive, aerospace, defense, communications end market과 acquisitions 통합",
    ],
    riskVariables: [
      "원재료·부품·물류비 상승에 따른 gross margin 압박",
      "제한 공급원 의존과 조달 지연",
      "FX 변동과 지역별 제조·고객 수요 변동",
      "acquisitions 통합 과정의 생산·인력·시스템 정렬 리스크",
    ],
    suggestedPrompts: [
      "앰페놀의 Harsh Environment Solutions, Communications Solutions, Interconnect and Sensor Systems가 aerospace, defense, automotive, communications 수요에 연결되는 구조를 공시 기준으로 정리해줘.",
      "RF·광학·고속 interconnect, cable assemblies, sensor 제품군이 앰페놀의 gross margin과 현금흐름에 미치는 영향을 설명해줘.",
      "acquisitions 통합, 제한 공급원 의존, 원재료·물류비가 앰페놀의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  BA: {
    ticker: "BA",
    companyName: "The Boeing Company",
    companyNameKo: "보잉",
    sectorKo: "항공우주·국방",
    signature:
      "Commercial Airplanes, Defense Space & Security, Global Services의 backlog를 production rate와 free cash flow로 얼마나 빠르게 전환하는지가 핵심입니다.",
    description:
      "기업 리포트: Boeing은 Commercial Airplanes의 737 MAX·787 생산·인도, Defense Space & Security의 방산·우주 계약 집행, Global Services의 정비·부품·디지털 지원 수익을 함께 봐야 합니다. backlog, production rate, certification, supplier quality, 납기 지연과 free cash flow 전환 속도가 실적의 핵심 변수입니다.",
    researchFocus: [
      "Commercial Airplanes의 737 MAX와 787 backlog·production rate",
      "Defense Space & Security 계약 집행과 비용 초과",
      "Global Services의 정비·부품·운항지원 수익",
      "certification, supplier quality, 납기와 free cash flow",
    ],
    riskVariables: [
      "supplier quality 악화와 생산 차질",
      "certification 지연 및 안전·규제 대응 비용",
      "backlog 소진 지연과 인도 병목",
      "방산 고정가격 계약 비용 초과와 Global Services 회수 지연",
    ],
    suggestedPrompts: [
      "보잉의 Commercial Airplanes, Defense Space & Security, Global Services별 매출 구성과 backlog 전환 경로를 공시 기준으로 정리해줘.",
      "737 MAX와 787의 production rate, certification, supplier quality가 보잉의 매출과 free cash flow에 미치는 영향을 설명해줘.",
      "방산 계약 비용 초과, 납기 지연, Global Services 회수 지연이 보잉의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  BK: {
    ticker: "BK",
    companyName: "The Bank of New York Mellon Corporation",
    companyNameKo: "뱅크 오브 뉴욕 멜론",
    sectorKo: "수탁은행·자산관리",
    signature:
      "Securities Services, Market and Wealth Services, Investment and Wealth Management의 AUC/A·AUM 기반 fee revenue와 net interest income이 수익의 핵심입니다.",
    description:
      "기업 리포트: BNY Mellon은 Securities Services의 custody·fund services, Market and Wealth Services의 payments·clearance·collateral, Investment and Wealth Management의 AUM 수수료를 함께 봐야 합니다. assets under custody/administration(AUC/A), assets under management(AUM), deposit beta, net interest income, 시장 변동성과 결제·클리어링 운영 리스크가 실적을 좌우합니다.",
    researchFocus: [
      "Securities Services의 AUC/A 기반 fee revenue",
      "Market and Wealth Services의 payments, clearance, collateral management",
      "Investment and Wealth Management의 AUM과 수수료율",
      "net interest income, deposit beta, 예금 mix",
    ],
    riskVariables: [
      "금리·deposit beta 변화에 따른 net interest income 민감도",
      "시장 하락이 AUC/A·AUM 기반 fee revenue에 미치는 영향",
      "자본·유동성·AML 규제 강화에 따른 비용 증가",
      "사이버·결제·클리어링 운영 인프라 리스크",
    ],
    suggestedPrompts: [
      "BNY Mellon의 Securities Services, Market and Wealth Services, Investment and Wealth Management별 fee revenue와 net interest income 발생 구조를 공시 기준으로 정리해줘.",
      "AUC/A와 AUM이 BNY Mellon의 수수료 수익과 현금흐름으로 전환되는 경로를 설명해줘.",
      "deposit beta, 금리 경로, 결제·클리어링 운영 리스크가 BNY Mellon의 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  BMY: {
    ticker: "BMY",
    companyName: "Bristol Myers Squibb",
    companyNameKo: "브리스틀마이어스 스크리브",
    sectorKo: "제약",
    signature:
      "Eliquis와 Revlimid의 LOE·가격 압력을 Opdivo, Breyanzi, Camzyos, Opdualag 성장과 pipeline 실행으로 얼마나 상쇄하느냐가 핵심입니다.",
    description:
      "기업 리포트: Bristol Myers Squibb는 Eliquis, Revlimid 같은 Legacy Portfolio와 Opdivo, Breyanzi, Camzyos, Opdualag 중심 Growth Portfolio를 함께 봐야 합니다. LOE, 가격·환급 압력, acquired IPRD와 무형자산 상각, mezigdomide·iberdomide·obexelimab 등 pipeline 이벤트가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Eliquis·Revlimid LOE와 가격·환급 압력",
      "Opdivo, Breyanzi, Camzyos, Opdualag 성장 포트폴리오",
      "acquired IPRD, 무형자산 상각, IPRD impairment",
      "mezigdomide, iberdomide, obexelimab, iza-bren pipeline",
    ],
    riskVariables: [
      "Eliquis 특허 분쟁과 제네릭 진입",
      "Revlimid 포함 Legacy Portfolio의 LOE 전환 가속",
      "미국 약가 정책과 list price 압박",
      "acquired IPRD 비용 변동성과 pipeline 실패 가능성",
    ],
    suggestedPrompts: [
      "브리스틀마이어스 스크리브의 Eliquis와 Revlimid LOE 압력을 Opdivo, Breyanzi, Camzyos, Opdualag가 얼마나 상쇄하는지 공시 기준으로 정리해줘.",
      "acquired IPRD, 무형자산 상각, IPRD impairment가 BMY의 영업이익률과 free cash flow에 미치는 영향을 설명해줘.",
      "mezigdomide, iberdomide, obexelimab, iza-bren pipeline 이벤트가 성장 논지와 R&D 리스크에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },

  BX: {
    ticker: "BX",
    companyName: "Blackstone",
    companyNameKo: "블랙스톤",
    sectorKo: "대체 자산운용",
    signature:
      "Real Estate, Private Equity, Credit & Insurance, Multi-Asset Investing의 AUM·Fee-Earning AUM·perpetual capital이 FRE와 performance revenues를 만듭니다.",
    description:
      "기업 리포트: Blackstone은 Real Estate, Private Equity, Credit & Insurance, Multi-Asset Investing을 통해 management and advisory fees, FRE, performance revenues, realizations를 만듭니다. AUM, Fee-Earning AUM, perpetual capital AUM, deployment, inflows, realized·unrealized 성과와 Net Realizations가 배당 여력과 distributable earnings(DE)의 핵심 변수입니다.",
    researchFocus: [
      "Real Estate, Private Equity, Credit & Insurance, Multi-Asset Investing별 AUM",
      "Fee-Earning AUM, perpetual capital, management fees",
      "FRE, performance revenues, realizations, Net Realizations",
      "deployment, inflows, valuation, DE와 배당 여력",
    ],
    riskVariables: [
      "금리·신용 스프레드 변화와 부동산 가치 조정",
      "realizations 지연에 따른 performance revenues와 DE 변동",
      "Credit & Insurance 유동성 스트레스와 손실 위험",
      "운용사·보험 플랫폼 규제 변화와 fund raising 둔화",
    ],
    suggestedPrompts: [
      "블랙스톤의 Real Estate, Private Equity, Credit & Insurance, Multi-Asset Investing별 AUM과 Fee-Earning AUM이 FRE로 연결되는 구조를 공시 기준으로 정리해줘.",
      "performance revenues, realizations, Net Realizations가 블랙스톤의 distributable earnings와 배당 여력에 미치는 영향을 설명해줘.",
      "금리, 부동산 가치 조정, fund raising 둔화가 블랙스톤의 성장 논지와 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CB: {
    ticker: "CB",
    companyName: "Chubb Limited",
    companyNameKo: "처브",
    sectorKo: "보험",
    signature:
      "North America Commercial P&C와 Overseas General의 combined ratio, catastrophe losses, reserve development가 underwriting income과 net investment income의 질을 좌우합니다.",
    description:
      "기업 리포트: Chubb는 North America Commercial P&C, North America Personal P&C, Overseas General, Global Reinsurance, Life Insurance를 함께 운영합니다. P&C underwriting income, Life segment income, net investment income, combined ratio, catastrophe losses와 reserve development가 보험료 성장보다 더 중요한 수익성 판단 지표입니다.",
    researchFocus: [
      "North America Commercial P&C와 Personal P&C underwriting income",
      "Overseas General의 combined ratio와 catastrophe losses",
      "reserve development와 Global Reinsurance 완충 효과",
      "Life Insurance segment income과 net investment income",
    ],
    riskVariables: [
      "catastrophe losses 증가에 따른 combined ratio 악화",
      "favorable reserve development 둔화 또는 adverse reserve development",
      "금리·크레딧 환경 변화로 인한 net investment income 변동",
      "요율 반영 지연과 리스크 선별 실패에 따른 손해율 악화",
    ],
    suggestedPrompts: [
      "처브의 North America Commercial P&C와 Overseas General에서 combined ratio, catastrophe losses, reserve development가 underwriting income에 미치는 영향을 공시 기준으로 정리해줘.",
      "P&C underwriting income, Life segment income, net investment income이 Chubb의 순이익을 어떻게 나눠 만드는지 설명해줘.",
      "Global Reinsurance, reserve development, catastrophe losses가 처브의 성장 논지와 자본 여력에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CDNS: {
    ticker: "CDNS",
    companyName: "Cadence Design Systems",
    companyNameKo: "카덴스",
    sectorKo: "EDA·반도체 설계 소프트웨어",
    signature:
      "Core EDA, Functional Verification, Digital IC, Semiconductor IP, Cadence.AI가 반도체 설계 복잡도와 backlog를 recurring revenue로 전환합니다.",
    description:
      "기업 리포트: Cadence는 EDA 소프트웨어, Design IP, hardware emulation·prototyping, system design analysis를 제공합니다. Core EDA, Functional Verification, Digital IC Design and Signoff, Semiconductor IP, Cadence.AI와 AgentStack, backlog와 RPO, 하드웨어 납품 타이밍이 매출 인식과 gross margin의 핵심 변수입니다.",
    researchFocus: [
      "Core EDA와 Digital IC Design and Signoff",
      "Functional Verification, hardware emulation, prototyping",
      "Semiconductor IP와 Design IP mix",
      "Cadence.AI, AgentStack, backlog, recurring revenue",
    ],
    riskVariables: [
      "AI·반도체 설계 투자 사이클 둔화",
      "hardware emulation 납품 지연과 부품 원가 상승",
      "backlog 회수 속도와 RPO 전환 지연",
      "수출통제·지정학 리스크와 환율 변동",
    ],
    suggestedPrompts: [
      "카덴스의 Core EDA, Functional Verification, Digital IC, Semiconductor IP가 recurring revenue와 업프론트 수익으로 나뉘는 구조를 공시 기준으로 정리해줘.",
      "hardware emulation과 prototyping 납품 타이밍이 Cadence의 매출 인식과 gross margin에 미치는 영향을 설명해줘.",
      "Cadence.AI, AgentStack, backlog, RPO가 카덴스의 성장 논지와 반도체 설계 수요에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },

  CEG: {
    ticker: "CEG",
    companyName: "Constellation Energy",
    companyNameKo: "컨스텔레이션 에너지",
    sectorKo: "원자력·전력",
    signature:
      "nuclear generation과 C&I load, power prices, hedging, production tax credits가 수익성을 만들고 Crane Clean Energy Center가 장기 전력수요 논지를 보강합니다.",
    description:
      "기업 리포트: Constellation Energy는 nuclear generation, 천연가스·재생자원, retail·wholesale 전력 판매를 함께 봐야 합니다. capacity factor, C&I load, power prices, hedging 프로그램, market-based rates와 regulated rates, production tax credits, Crane Clean Energy Center와 장기 PPA가 현금흐름 안정성의 핵심 변수입니다.",
    researchFocus: [
      "nuclear generation capacity factor와 fleet mix",
      "C&I load, retail load, wholesale load와 power prices",
      "hedging 프로그램과 market-based rates·regulated rates",
      "Crane Clean Energy Center, 장기 PPA, production tax credits",
    ],
    riskVariables: [
      "power prices 하락과 변동성 확대",
      "capacity market·regulated rates 규제 변화",
      "production tax credits 축소 또는 적용 조건 변화",
      "Crane Clean Energy Center 재가동·승인 지연과 C&I 가격 경쟁",
    ],
    suggestedPrompts: [
      "컨스텔레이션 에너지의 nuclear generation capacity factor와 C&I load가 power prices·hedging을 거쳐 수익성에 반영되는 구조를 공시 기준으로 정리해줘.",
      "Crane Clean Energy Center, 장기 PPA, production tax credits가 Constellation Energy의 성장 논지와 현금흐름 안정성에 미치는 영향을 설명해줘.",
      "market-based rates, capacity market, regulated rates 변화가 CEG의 마진과 리스크 관리에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  CMCSA: {
    ticker: "CMCSA",
    companyName: "Comcast Corporation",
    companyNameKo: "컴캐스트",
    sectorKo: "미디어·통신",
    signature:
      "Connectivity & Platforms의 broadband·wireless와 Content & Experiences의 Peacock·studios·theme parks가 서로 다른 수익 사이클을 만듭니다.",
    description:
      "기업 리포트: Comcast는 Xfinity, Comcast Business, Sky 기반 broadband·wireless·video·voice와 NBCUniversal의 Peacock, studios, theme parks를 함께 봐야 합니다. broadband 가입자 경쟁, wireless line 성장, cord-cutting, Peacock 유료 가입자와 광고, 스포츠 권리·콘텐츠 제작비, theme parks 방문객과 신규 파크 투자 회수가 영업 레버리지의 핵심 변수입니다.",
    researchFocus: [
      "Connectivity & Platforms의 broadband, wireless, video, voice",
      "Content & Experiences의 Peacock, Media, Studios, Theme Parks",
      "broadband 가입자, wireless lines, cord-cutting",
      "광고, 스포츠 권리, 콘텐츠 제작비, theme parks 투자 회수",
    ],
    riskVariables: [
      "5G·fiber 경쟁 심화에 따른 broadband 가입자 압박",
      "cord-cutting과 DTC/OTT 경쟁에 따른 video·광고 수익 둔화",
      "스포츠 권리·콘텐츠 제작비 상승과 Peacock 수익화 지연",
      "DOCSIS 4.0·FTTH capex와 theme parks 투자 회수 지연",
    ],
    suggestedPrompts: [
      "컴캐스트의 Connectivity & Platforms에서 broadband, wireless, video가 매출과 EBITDA를 만드는 구조를 공시 기준으로 정리해줘.",
      "Peacock, Studios, Theme Parks가 Content & Experiences의 성장 논지와 비용 구조에 미치는 영향을 설명해줘.",
      "broadband 경쟁, cord-cutting, 스포츠 권리 비용, theme parks capex가 컴캐스트의 free cash flow에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CME: {
    ticker: "CME",
    companyName: "CME Group",
    companyNameKo: "씨엠이 그룹",
    sectorKo: "파생상품 거래소",
    signature:
      "futures·options 거래, clearing, market data가 결합된 모델에서 average daily volume, transaction fees, collateral 효율이 실적 레버리지를 만듭니다.",
    description:
      "기업 리포트: CME Group은 CME Globex 기반 futures·options 거래, central counterparty clearing, market data, BrokerTec·EBS cash markets를 함께 운영합니다. interest rate products, average daily volume, average rate per contract, transaction fees, market data subscriptions, collateral·margin 관리가 매출과 운영 리스크의 핵심 변수입니다.",
    researchFocus: [
      "futures·options volume과 average rate per contract",
      "interest rate products, SOFR·Treasury 거래량",
      "clearing, collateral, margin, default risk 관리",
      "market data subscriptions, BrokerTec, EBS cash markets",
    ],
    riskVariables: [
      "시장 변동성·금리 사이클 변화에 따른 ADV 변동",
      "transaction fee 경쟁과 product mix 변화",
      "clearing member 집중도와 margin call·default 리스크",
      "규제·사이버보안·거래 시스템 장애 리스크",
    ],
    suggestedPrompts: [
      "씨엠이 그룹의 futures·options average daily volume과 average rate per contract가 clearing and transaction fees로 연결되는 구조를 공시 기준으로 정리해줘.",
      "interest rate products, SOFR·Treasury 거래량이 CME의 수익성과 마진에 미치는 영향을 설명해줘.",
      "BrokerTec, EBS, market data subscriptions, collateral·margin 운영이 CME의 성장 논지와 리스크에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },

  CMI: {
    ticker: "CMI",
    companyName: "Cummins",
    companyNameKo: "커민스",
    sectorKo: "상용차 엔진·전력 솔루션",
    signature:
      "Engine, Components, Distribution, Power Systems, Accelera 다섯 축에서 heavy-duty truck, off-highway, emissions regulations, warranty costs가 수익성을 좌우합니다.",
    description:
      "기업 리포트: Cummins는 Engine, Components, Distribution, Power Systems, Accelera를 통해 상용차 엔진, 배출가스 처리, 발전 시스템, 서비스·부품, electrified power와 electrolyzers를 제공합니다. heavy-duty truck, medium-duty bus, off-highway, power generation 수요, emissions regulations, warranty programs와 warranty costs가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Engine, Components, Distribution, Power Systems, Accelera별 매출·마진",
      "heavy-duty truck, off-highway, power generation 수요",
      "emissions regulations와 Emission solutions 가격 전가력",
      "Accelera의 electrolyzers·electrified power와 warranty costs",
    ],
    riskVariables: [
      "heavy-duty truck와 off-highway 수요 둔화",
      "emissions regulations 인증 지연과 개발비 증가",
      "warranty costs 확대와 품질·수리 정책 부담",
      "Accelera 초기 상업화 비용과 electrolyzers 수요 변동",
    ],
    suggestedPrompts: [
      "커민스의 Engine, Components, Distribution, Power Systems, Accelera가 매출과 EBITDA를 만드는 구조를 공시 기준으로 정리해줘.",
      "emissions regulations와 Emission solutions가 heavy-duty truck·off-highway 가격 전가력과 gross margin에 미치는 영향을 설명해줘.",
      "warranty costs, Accelera electrolyzers, Power Systems 수요가 커민스의 성장 논지와 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  COF: {
    ticker: "COF",
    companyName: "Capital One Financial Corporation",
    companyNameKo: "캐피털 원",
    sectorKo: "카드·소비자금융",
    signature:
      "Credit Card가 수익의 중심이고 Consumer Banking·Commercial Banking, Discover acquisition, allowance for credit losses와 charge-offs가 실적 변동성을 만듭니다.",
    description:
      "기업 리포트: Capital One은 Credit Card, Consumer Banking, Commercial Banking을 나눠 봐야 합니다. Domestic·International card 대출, deposits, auto lending, commercial loan mix, net interest income, net interest margin, allowance for credit losses, charge-offs, Discover acquisition와 Brex acquisition 통합비용이 수익성과 자본 여력의 핵심 변수입니다.",
    researchFocus: [
      "Credit Card의 net interest income, charge-offs, allowance for credit losses",
      "Consumer Banking의 deposits, auto lending, net interest margin",
      "Commercial Banking의 commercial loans와 unfunded commitments",
      "Discover acquisition, Brex acquisition, 통합비용·무형자산 상각",
    ],
    riskVariables: [
      "카드 charge-offs와 allowance for credit losses 확대",
      "예금 비용 상승과 loan yield 둔화에 따른 NIM 압박",
      "Discover 통합 비용, 결제 네트워크 전환, 신용 포트폴리오 재표준화",
      "consumer·commercial loan modifications 증가와 신용 사이클 둔화",
    ],
    suggestedPrompts: [
      "캐피털 원의 Credit Card, Consumer Banking, Commercial Banking이 net interest income과 net interest margin을 만드는 구조를 공시 기준으로 정리해줘.",
      "allowance for credit losses, charge-offs, net charge-off rate가 Capital One의 카드 포트폴리오 리스크를 어떻게 보여주는지 설명해줘.",
      "Discover acquisition과 Brex acquisition이 캐피털 원의 비용 구조, 무형자산, 결제 네트워크 성장 논지에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  COP: {
    ticker: "COP",
    companyName: "ConocoPhillips",
    companyNameKo: "코노코필립스",
    sectorKo: "에너지·E&P",
    signature:
      "Lower 48 단기 개발 효율과 Alaska Willow, Canada Surmont·Montney, LNG off-take가 production volumes와 realized prices를 통해 현금흐름을 만듭니다.",
    description:
      "기업 리포트: ConocoPhillips는 Lower 48, Alaska, Canada, EMEA, Asia Pacific 생산 포트폴리오를 운영합니다. Lower 48 short-cycle drilling, Alaska Willow, Canada Surmont·Montney, LNG 프로젝트와 off-take, proved reserves, reserve replacement, capital expenditures, production costs, WTI·Brent·Henry Hub realized prices가 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "Lower 48 short-cycle drilling과 production volumes",
      "Alaska Willow와 Western North Slope 개발 일정",
      "Canada Surmont·Montney, EMEA, Asia Pacific 생산 믹스",
      "LNG off-take, proved reserves, capital expenditures, realized prices",
    ],
    riskVariables: [
      "WTI·Brent·Henry Hub 가격 하락에 따른 realized prices 압박",
      "field decline과 drilling 효율 저하로 인한 production 감소",
      "Willow capex·schedule 지연과 인허가·환경 소송 리스크",
      "royalty·세금·환경 규제와 operating costs 상승",
    ],
    suggestedPrompts: [
      "코노코필립스의 Lower 48, Alaska, Canada, EMEA, Asia Pacific 생산 포트폴리오가 production volumes와 realized prices로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Alaska Willow, Canada Surmont·Montney, LNG off-take가 ConocoPhillips의 장기 성장 논지와 capital expenditures에 미치는 영향을 설명해줘.",
      "proved reserves, reserve replacement, production costs, WTI·Brent·Henry Hub 가격 변동이 코노코필립스의 free cash flow에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CRWD: {
    ticker: "CRWD",
    companyName: "CrowdStrike",
    companyNameKo: "크라우드스트라이크",
    sectorKo: "사이버보안",
    signature:
      "Falcon platform의 endpoint security, cloud security, identity protection 모듈 확장이 subscription revenue, ARR, net retention의 핵심 동력입니다.",
    description:
      "기업 리포트: CrowdStrike는 Falcon platform과 Security Cloud를 기반으로 endpoint security, cloud security, identity protection, incident response를 제공합니다. subscription revenue, ARR, net retention, module adoption, per-endpoint·per-module 가격 구조, outage/remediation 신뢰 회복 비용이 성장성과 마진의 핵심 변수입니다.",
    researchFocus: [
      "Falcon platform subscription revenue와 ARR",
      "endpoint security, cloud security, identity protection module adoption",
      "net retention, renewal, per-endpoint·per-module 가격 구조",
      "incident response, outage/remediation, 고객 신뢰 회복 비용",
    ],
    riskVariables: [
      "고객 renewal 둔화와 net retention 약화",
      "module adoption 둔화에 따른 expansion 성장 둔화",
      "보안 사고·outage/remediation 이슈가 신뢰와 비용에 미치는 영향",
      "AI·cloud 보안 인력 확보와 경쟁 심화",
    ],
    suggestedPrompts: [
      "크라우드스트라이크의 Falcon platform에서 endpoint security, cloud security, identity protection 모듈이 subscription revenue와 ARR로 연결되는 구조를 공시 기준으로 정리해줘.",
      "ARR, net retention, module adoption이 CrowdStrike의 구독 확장성을 어떻게 보여주는지 설명해줘.",
      "outage/remediation, incident response, 보안 신뢰 리스크가 크라우드스트라이크의 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  CVS: {
    ticker: "CVS",
    companyName: "CVS Health",
    companyNameKo: "CVS 헬스",
    sectorKo: "헬스케어·약국·보험",
    signature:
      "Health Care Benefits의 Aetna 보험손익과 Health Services·Pharmacy & Consumer Wellness의 Caremark pharmacy claims가 medical benefit ratio와 마진을 좌우합니다.",
    description:
      "기업 리포트: CVS Health는 Health Care Benefits(Aetna), Health Services(Caremark), Pharmacy & Consumer Wellness를 함께 봐야 합니다. Medicare Advantage, medical benefit ratio, pharmacy claims, 리베이트·약가 구조, store optimization, Aetna 멤버십과 약국 채널 교차효과가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Aetna Health Care Benefits와 medical benefit ratio",
      "Caremark Health Services의 pharmacy claims와 리베이트 구조",
      "Pharmacy & Consumer Wellness와 store optimization",
      "Medicare Advantage, 멤버십 유지, 약국·보험 교차효과",
    ],
    riskVariables: [
      "의료 이용률 상승에 따른 medical benefit ratio 악화",
      "Medicare Advantage 보상·risk adjustment 변화",
      "pharmacy claims 정산·리베이트 규제와 약가 압박",
      "store optimization이 접근성·오프라인 처방 트래픽에 미치는 영향",
    ],
    suggestedPrompts: [
      "CVS Health의 Health Care Benefits(Aetna), Health Services(Caremark), Pharmacy & Consumer Wellness가 매출과 마진을 만드는 구조를 공시 기준으로 정리해줘.",
      "Medicare Advantage와 medical benefit ratio가 CVS의 보험손익과 현금흐름에 미치는 영향을 설명해줘.",
      "pharmacy claims, 리베이트, store optimization이 CVS의 성장 논지와 비용 구조에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CVX: {
    ticker: "CVX",
    companyName: "Chevron Corporation",
    companyNameKo: "셰브론",
    sectorKo: "에너지·석유·가스",
    signature:
      "Upstream의 Permian·Tengizchevroil 생산과 LNG, Downstream refining margins, proved reserves와 capital expenditures 배분이 실적 민감도를 결정합니다.",
    description:
      "기업 리포트: Chevron은 Upstream 탐사·생산, LNG, Downstream 정유·마케팅을 함께 봐야 합니다. Permian 생산, Tengizchevroil 가동률, LNG 가격·offtake, commodity prices, refining margins, proved reserves, capital expenditures와 자본환원 정책이 operating cash flow와 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "Upstream의 Permian과 Tengizchevroil 생산",
      "LNG 가격 연동, offtake, 글로벌 가스 수요",
      "Downstream refining margins와 정제 수요",
      "proved reserves, capital expenditures, 자본환원",
    ],
    riskVariables: [
      "원유·천연가스 commodity prices 변동성",
      "refining margins 축소와 정제 수요 둔화",
      "Tengizchevroil 운영·증설 지연과 LNG offtake 변동",
      "proved reserves 하향 조정과 capex 부담 확대",
    ],
    suggestedPrompts: [
      "셰브론의 Upstream, LNG, Downstream 수익 경로가 commodity prices와 refining margins로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Permian과 Tengizchevroil이 Chevron의 생산량, operating cash flow, capital expenditures에 미치는 영향을 설명해줘.",
      "proved reserves, LNG offtake, refining margins, capex 배분이 셰브론의 성장 논지와 자본환원에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  DUK: {
    ticker: "DUK",
    companyName: "Duke Energy Corporation",
    companyNameKo: "듀크 에너지",
    sectorKo: "전력·천연가스 유틸리티",
    signature:
      "Electric Utilities and Infrastructure와 Gas Utilities and Infrastructure의 rate base 성장, regulated rates, fuel cost recovery가 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: Duke Energy는 전력 EU&I와 가스 GU&I를 운영하는 규제형 유틸리티입니다. rate base, rate case, regulated rates, fuel cost recovery, purchased power, storm costs, coal ash, capital plan과 금리·이자비용이 매출 인식과 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "EU&I와 GU&I의 rate base 확대와 regulated rates",
      "fuel cost recovery, purchased power, 연료 가격 변동",
      "storm costs 회수와 coal ash 규제 비용",
      "capital plan, 금리, 투자비 회수 속도",
    ],
    riskVariables: [
      "rate case 승인 지연과 ROE 조정",
      "fuel cost recovery 비용 인정 지연 또는 부인",
      "storm costs와 coal ash 회수 불확실성",
      "capital plan 확대와 금리 상승에 따른 FCF 압박",
    ],
    suggestedPrompts: [
      "듀크 에너지의 EU&I와 GU&I에서 rate base, regulated rates, ROE가 매출과 현금흐름에 연결되는 구조를 공시 기준으로 정리해줘.",
      "fuel cost recovery, storm costs, coal ash 비용 회수가 Duke Energy의 free cash flow에 미치는 영향을 설명해줘.",
      "capital plan, rate case, 금리 상승이 듀크 에너지의 성장 논지와 배당 여력에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  EQIX: {
    ticker: "EQIX",
    companyName: "Equinix",
    companyNameKo: "이퀴닉스",
    sectorKo: "데이터센터·클라우드 인프라",
    signature:
      "IBX data centers의 colocation·interconnection과 xScale 확장이 recurring revenues, MRR, occupancy, AFFO를 만드는 핵심 축입니다.",
    description:
      "기업 리포트: Equinix는 IBX data centers와 xScale을 통해 colocation, interconnection, managed infrastructure를 제공합니다. recurring revenues, MRR, cabinet occupancy, interconnection density, churn, power availability와 power costs, high-density AI·cloud 수요, capex와 AFFO 전환 속도가 성장성과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "IBX colocation, interconnection, managed infrastructure recurring revenues",
      "MRR, cabinet occupancy, churn, MRR per Cabinet",
      "xScale, AI·cloud high-power density 수요",
      "power availability, power costs, capex, AFFO",
    ],
    riskVariables: [
      "power availability 제약과 전력비 상승",
      "high-density AI 수요에 따른 capex 부담 확대",
      "IBX 장애·SLA 위반·사이버 사고 리스크",
      "고객 churn과 MRR 성장률 둔화",
    ],
    suggestedPrompts: [
      "이퀴닉스의 IBX colocation, interconnection, managed infrastructure가 recurring revenues와 MRR을 만드는 구조를 공시 기준으로 정리해줘.",
      "xScale, AI·cloud high-density 수요, power availability가 Equinix의 occupancy와 AFFO에 미치는 영향을 설명해줘.",
      "power costs, churn, capex, IBX 운영 리스크가 이퀴닉스의 성장 논지와 현금흐름에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  FCX: {
    ticker: "FCX",
    companyName: "Freeport-McMoRan Inc.",
    companyNameKo: "프리포트맥모란",
    sectorKo: "구리·비철금속 채굴",
    signature:
      "Grasberg, North America copper mines, South America 광산의 copper·gold·molybdenum 생산과 ore grades, unit net cash costs, capital expenditures가 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: Freeport-McMoRan은 Grasberg, North America, South America 광산에서 copper, gold, molybdenum을 생산하고 smelting을 거쳐 판매합니다. by-product mix, ore grades, 회수율, smelting 효율, unit net cash costs, capital expenditures, 인도네시아·남미 규제와 로열티 체계가 매출총이익률과 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "Grasberg, North America copper mines, South America 산출량",
      "copper, gold, molybdenum by-product mix",
      "ore grades, 회수율, smelting 효율과 unit net cash costs",
      "capital expenditures, 가동률, 인허가·로열티 구조",
    ],
    riskVariables: [
      "구리·금·몰리보든 가격 변동",
      "Grasberg·북미·남미 광산의 ore grades 저하",
      "인도네시아·남미 정치·규제·세금·로열티 리스크",
      "에너지·물류·부품·정비 비용 상승에 따른 unit net cash costs 압박",
    ],
    suggestedPrompts: [
      "프리포트맥모란의 Grasberg, North America copper mines, South America 광산에서 copper, gold, molybdenum 생산이 매출로 연결되는 구조를 공시 기준으로 정리해줘.",
      "ore grades, 회수율, smelting 효율이 FCX의 unit net cash costs와 gross margin에 미치는 영향을 설명해줘.",
      "capital expenditures, 인허가·로열티, 광산별 가동률이 FCX의 성장 논지와 free cash flow에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  FDX: {
    ticker: "FDX",
    companyName: "FedEx Corporation",
    companyNameKo: "페덱스",
    sectorKo: "물류·운송",
    signature:
      "FedEx Express, FedEx Ground, FedEx Freight의 package volume, yield, fuel surcharge를 DRIVE와 Network 2.0 cost savings로 얼마나 흡수하느냐가 핵심입니다.",
    description:
      "기업 리포트: FedEx는 Express, Ground, Freight의 패키지·화물 물동량과 yield를 함께 봐야 합니다. package volume, fuel surcharge, purchased transportation, Network 2.0, DRIVE cost savings, aircraft fleet 운용, FedEx Freight 분리 계획과 global trade policy가 영업이익과 free cash flow의 핵심 변수입니다.",
    researchFocus: [
      "FedEx Express와 Ground의 package volume, yield",
      "FedEx Freight의 freight pounds, yield, 분리 계획",
      "Network 2.0와 DRIVE cost savings",
      "fuel surcharge, aircraft fleet, purchased transportation 비용",
    ],
    riskVariables: [
      "Network 2.0와 DRIVE 실행 지연",
      "FedEx Freight spin-off 비용과 조건 변화",
      "fuel surcharge와 purchased transportation rate 변동",
      "global trade policy, 계절성, aircraft fleet 운용 제약",
    ],
    suggestedPrompts: [
      "페덱스의 FedEx Express, FedEx Ground, FedEx Freight에서 package volume, yield, fuel surcharge가 매출과 영업이익에 연결되는 구조를 공시 기준으로 정리해줘.",
      "Network 2.0와 DRIVE cost savings가 페덱스의 비용 구조와 free cash flow에 미치는 영향을 설명해줘.",
      "FedEx Freight spin-off, aircraft fleet 운용, global trade policy가 페덱스의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  GD: {
    ticker: "GD",
    companyName: "General Dynamics Corporation",
    companyNameKo: "제너럴 다이내믹스",
    sectorKo: "항공우주·국방",
    signature:
      "Aerospace, Marine Systems, Combat Systems, Technologies의 backlog와 contract mix가 매출과 마진을 좌우하고, Gulfstream과 Columbia-class가 핵심 동력입니다.",
    description:
      "기업 리포트: General Dynamics는 Gulfstream 중심 Aerospace, Columbia-class·Virginia-class 잠수함의 Marine Systems, 군용차량·무기체계의 Combat Systems, C5ISR·IT services의 Technologies를 함께 봐야 합니다. funded·unfunded backlog, Gulfstream deliveries, shipbuilding industrial base, fixed-price·cost-reimbursable contract mix가 operating margin과 cash conversion의 핵심 변수입니다.",
    researchFocus: [
      "Aerospace의 Gulfstream deliveries, book-to-bill, backlog",
      "Marine Systems의 Columbia-class, Virginia-class, John Lewis-class",
      "Combat Systems의 군용차량·무기체계 수요",
      "Technologies의 C5ISR, IT services, contract mix",
    ],
    riskVariables: [
      "국방 예산 승인 지연과 funded backlog 전환 리스크",
      "shipbuilding 산업 기반 압박과 공급망 지연",
      "Gulfstream 공급망·인도 일정 변동",
      "fixed-price 계약 원가 상승과 장기 프로그램 일정 지연",
    ],
    suggestedPrompts: [
      "제너럴 다이내믹스의 Aerospace, Marine Systems, Combat Systems, Technologies별 backlog와 operating margin 차이를 공시 기준으로 정리해줘.",
      "Gulfstream deliveries와 Aerospace backlog가 GD의 현금흐름과 마진에 미치는 영향을 설명해줘.",
      "Columbia-class·Virginia-class 잠수함, shipbuilding 공급망, fixed-price contract mix가 GD의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  GE: {
    ticker: "GE",
    companyName: "General Electric",
    companyNameKo: "제너럴 일렉트릭",
    sectorKo: "항공우주·엔진",
    signature:
      "GE Aerospace의 Commercial Engines & Services와 Defense & Propulsion Technologies에서 LEAP, shop visits, spare parts, services backlog가 실적을 좌우합니다.",
    description:
      "기업 리포트: GE는 GE Aerospace 중심으로 상업용 엔진, 방산 추진체계, 장기 서비스 계약을 운영합니다. LEAP 엔진 납기, Commercial Engines & Services의 shop visits와 spare parts, Defense & Propulsion Technologies 주문, services backlog, long-term service agreements와 supply chain 병목이 segment margin과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Commercial Engines & Services의 LEAP, shop visits, spare parts",
      "Defense & Propulsion Technologies 주문과 방산 예산 집행",
      "services backlog, RPO, long-term service agreements",
      "supplier delivery performance, 재료·부품 공급망, MRO 네트워크",
    ],
    riskVariables: [
      "LEAP·CFM 엔진 부품 공급 제약과 납기 지연",
      "shop visits 일정 지연과 spare parts 가용성 부족",
      "방산 예산·수출 승인·계약 일정 변동",
      "장기 서비스 계약 손익 조정과 tariff·공급망 비용 압박",
    ],
    suggestedPrompts: [
      "GE Aerospace의 Commercial Engines & Services에서 LEAP 납기, shop visits, spare parts가 매출과 segment profit에 연결되는 구조를 공시 기준으로 정리해줘.",
      "services backlog와 long-term service agreements가 GE의 현금흐름과 마진 안정성에 미치는 영향을 설명해줘.",
      "supply chain 병목과 Defense & Propulsion Technologies 예산·계약 일정이 GE의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  HCA: {
    ticker: "HCA",
    companyName: "HCA Healthcare",
    companyNameKo: "HCA 헬스케어",
    sectorKo: "병원 운영·헬스케어 서비스",
    signature:
      "same facility equivalent admissions, revenue per equivalent admission, payer mix가 병원 수요와 수익성의 방향을 보여주고 인건비·charity care가 마진을 좌우합니다.",
    description:
      "HCA Healthcare는 병원, ambulatory surgery centers, emergency room visits, inpatient·outpatient surgeries를 함께 운영합니다. admissions, same facility equivalent admissions, acuity, payer mix, Medicare·Medicaid·managed care, 인건비, supplies, charity care와 uncompensated care가 매출과 operating cash flow의 핵심 변수입니다.",
    researchFocus: [
      "same facility admissions와 equivalent admissions",
      "revenue per equivalent admission, acuity, payer mix",
      "emergency room visits, inpatient surgeries, outpatient surgeries",
      "인건비, supplies, charity care, Medicare·Medicaid 보상",
    ],
    riskVariables: [
      "managed care 재협상과 payer mix 악화",
      "인건비와 supplies 비용 상승",
      "charity care와 uncompensated care 확대",
      "Medicare·Medicaid 보상 정책 변화와 지역별 수요 충격",
    ],
    suggestedPrompts: [
      "HCA의 same facility admissions, equivalent admissions, revenue per equivalent admission이 매출 성장으로 연결되는 구조를 공시 기준으로 정리해줘.",
      "payer mix, Medicare, Medicaid, managed care가 HCA의 마진과 현금흐름에 미치는 영향을 설명해줘.",
      "인건비, supplies, charity care, emergency room visits 변화가 HCA의 비용 구조와 현금흐름 리스크에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  ICE: {
    ticker: "ICE",
    companyName: "Intercontinental Exchange",
    companyNameKo: "인터컨티넨탈 익스체인지",
    sectorKo: "금융시장 인프라",
    signature:
      "Exchanges, Fixed Income and Data Services, Mortgage Technology가 transaction revenue와 recurring revenue를 나눠 만들며 clearing과 data services가 안정성을 보강합니다.",
    description:
      "기업 리포트: ICE는 futures·options와 energy products 중심 Exchanges, fixed income data·CDS clearing, Mortgage Technology의 Encompass·MERS·Simplifile을 함께 운영합니다. transaction revenue, recurring revenue, clearing, data and connectivity, Ellie Mae·Encompass 기반 mortgage workflow, regulatory approvals와 market data fee 심사가 매출과 마진의 핵심 변수입니다.",
    researchFocus: [
      "Exchanges의 futures, options, energy products, clearing",
      "Fixed Income and Data Services의 CDS clearing과 data services",
      "Mortgage Technology의 Encompass, MERS, Simplifile",
      "recurring revenue와 transaction revenue mix",
    ],
    riskVariables: [
      "clearing member default와 collateral haircut 리스크",
      "파생상품·에너지·금리 변동성 둔화에 따른 거래량 감소",
      "market data fee 심사와 SEC·CFPB·FFIEC 규제",
      "mortgage origination 둔화와 데이터 보안 비용 증가",
    ],
    suggestedPrompts: [
      "ICE의 Exchanges, Fixed Income and Data Services, Mortgage Technology가 recurring revenue와 transaction revenue를 만드는 구조를 공시 기준으로 정리해줘.",
      "energy futures, CDS clearing, Encompass mortgage workflow가 ICE의 매출 안정성과 마진에 미치는 영향을 설명해줘.",
      "clearing 규제, market data fee 심사, mortgage cycle이 ICE의 성장 논지와 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  LMT: {
    ticker: "LMT",
    companyName: "Lockheed Martin Corporation",
    companyNameKo: "록히드 마틴",
    sectorKo: "항공우주·국방",
    signature:
      "Aeronautics, Missiles and Fire Control, Rotary and Mission Systems, Space의 backlog와 fixed-price contracts 실행력이 이익률을 좌우합니다.",
    description:
      "기업 리포트: Lockheed Martin은 F-35 중심 Aeronautics, PAC-3·THAAD의 Missiles and Fire Control, Rotary and Mission Systems, 위성·방위 추적의 Space를 운영합니다. backlog, fixed-price contracts, cost-plus 계약, classified programs, reach-forward loss, supply chain과 수출통제가 revenue recognition과 cash conversion의 핵심 변수입니다.",
    researchFocus: [
      "F-35와 Aeronautics backlog",
      "PAC-3, THAAD, tactical missile과 Missiles and Fire Control",
      "Rotary and Mission Systems 장기 운영·유지 계약",
      "Space, classified programs, fixed-price contract mix",
    ],
    riskVariables: [
      "F-35 및 대형 국방 프로그램 조달 지연",
      "fixed-price contracts 비용 초과와 reach-forward loss",
      "supply chain, 부품 인증, 사이버·수출통제 부담",
      "classified programs 범위 변경과 회수 속도 지연",
    ],
    suggestedPrompts: [
      "록히드 마틴의 Aeronautics, Missiles and Fire Control, Rotary and Mission Systems, Space별 backlog와 수익 경로를 공시 기준으로 정리해줘.",
      "F-35와 fixed-price contracts가 revenue recognition, profit booking, free cash flow에 미치는 영향을 설명해줘.",
      "classified programs, reach-forward loss, supply chain 이슈가 Lockheed Martin의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  LOW: {
    ticker: "LOW",
    companyName: "Lowe's Companies, Inc.",
    companyNameKo: "로우즈",
    sectorKo: "소매·주거개선",
    signature: "DIY와 Pro customer 수요를 매장·온라인·설치 서비스로 흡수하며, comparable sales의 ticket·transaction 분해와 merchandising·supply chain 실행이 마진을 좌우하는 주거개선 소매업체.",
    description: "로우즈는 주거 개선 제품, 건축 자재, 하드웨어, 가전, 정원, 설치 서비스와 장비 렌탈을 매장과 온라인 채널로 판매합니다. 공시 해석에서는 comparable sales를 평균 ticket과 transactions로 나눠 가격·믹스와 방문 수요를 분리해 보고, Pro customer와 DIY 고객의 수요 차이가 merchandising, fulfillment, gross margin에 어떻게 반영되는지 확인해야 합니다. 주택 거래 둔화, 금리, 주택 가격, 노후 주택 개보수 수요, 공급망과 last-mile delivery 비용이 매출총이익률과 영업 레버리지의 핵심 변수입니다.",
    researchFocus: [
      "comparable sales를 ticket, transactions, product mix로 분해한 수요 해석",
      "Pro customer, DIY 고객, online sales, 설치 서비스가 매출총이익률에 미치는 차이",
      "merchandising, pricing, shrink, supply chain 비용이 gross margin에 반영되는 방식",
      "housing turnover, home price, repair/remodel 수요가 프로젝트성 매출로 이어지는 경로"
    ],
    riskVariables: [
      "고금리와 주택 거래 둔화로 인한 대형 주거개선 프로젝트 지연",
      "원자재·운송·last-mile delivery 비용 상승과 shrink 증가에 따른 gross margin 압박",
      "Pro customer 수요 둔화 또는 DIY 트래픽 감소에 따른 comparable sales 약화",
      "인건비, 매장 운영비, fulfillment 투자 부담이 operating margin을 낮출 가능성"
    ],
    suggestedPrompts: [
      "로우즈의 comparable sales를 ticket와 transactions로 나눠 최근 수요가 가격·믹스인지 방문 회복인지 설명해줘.",
      "Pro customer와 DIY 고객이 로우즈의 merchandising, online sales, 설치 서비스 수익성에 미치는 차이를 공시 기준으로 정리해줘.",
      "주택 거래, 금리, 공급망, shrink가 로우즈의 gross margin과 영업현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  MAR: {
    ticker: "MAR",
    companyName: "Marriott International",
    companyNameKo: "메리어트 인터내셔널",
    sectorKo: "호텔·여행",
    signature: "asset-light 호텔 네트워크에서 Franchise fees, Base management fees, Incentive management fees가 RevPAR·객실 순증·Bonvoy 충성도와 맞물리는 글로벌 호텔 운영사.",
    description: "메리어트는 호텔을 직접 보유하기보다 franchising, management, licensing 계약으로 브랜드와 운영 시스템을 확장하는 asset-light 구조입니다. 공시 해석에서는 Franchise fees와 Base management fees가 객실 수 증가와 RevPAR 회복에 얼마나 민감한지, Incentive management fees가 호텔 오너의 수익성 개선을 얼마나 반영하는지, Marriott Bonvoy와 co-branded credit card 수수료가 브랜드 락인과 반복 수요를 어떻게 강화하는지를 봐야 합니다. Owned, leased, and other 비중은 작지만 경기 변동과 비용 부담이 직접 반영되므로 fee business와 분리해 확인하는 편이 좋습니다.",
    researchFocus: [
      "Franchise fees, Base management fees, Incentive management fees의 성장률과 RevPAR 연결",
      "Marriott Bonvoy, co-branded credit card, loyalty 수수료가 gross fee revenues에 기여하는 방식",
      "rooms pipeline, conversion, net rooms growth가 장기 fee base로 전환되는 속도",
      "Owned, leased, and other 호텔의 비용 부담과 fee 중심 사업 대비 수익성 차이"
    ],
    riskVariables: [
      "RevPAR, occupancy, ADR 둔화로 fee growth가 약해질 가능성",
      "호텔 오너의 자금조달 환경 악화와 개발 지연에 따른 pipeline 전환 리스크",
      "Bonvoy 가치 약화, 대체 숙박 플랫폼, 호텔 체인 경쟁으로 인한 브랜드 수수료 압박",
      "직접 운영·임차 호텔의 인건비, 임대료, 자본비용 부담"
    ],
    suggestedPrompts: [
      "메리어트의 Franchise fees, Base management fees, Incentive management fees가 RevPAR과 객실 순증에 어떻게 연결되는지 최근 filing 기준으로 정리해줘.",
      "Marriott Bonvoy와 co-branded credit card 수수료가 메리어트의 fee business를 어떻게 보강하는지 공시 근거로 설명해줘.",
      "메리어트의 rooms pipeline과 호텔 오너 자금조달 리스크가 장기 fee base에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  MCK: {
    ticker: "MCK",
    companyName: "McKesson Corporation",
    companyNameKo: "맥케슨",
    sectorKo: "의료 유통·헬스케어 솔루션",
    signature: "North American Pharmaceutical 유통을 축으로 specialty·oncology practice, RxTS, Medical-Surgical까지 묶어 의약품 접근성·재고·상환 데이터를 관리하는 헬스케어 유통사.",
    description: "맥케슨은 North American Pharmaceutical에서 branded, generic, specialty, biosimilar, OTC 의약품 유통을 담당하고 ClarusONE과 SynerGx를 통해 generic 조달과 재고 효율을 관리합니다. Oncology & Multispecialty는 종양 전문 진료 네트워크와 specialty 의약품을 연결하고, Prescription Technology Solutions는 처방 접근성, 가격 투명성, 환자 지원 흐름을 PBM·약국·제약사와 연결합니다. Medical-Surgical Solutions는 비급성 의료기관에 소모품과 물류 서비스를 제공하는 축입니다. 공시 해석에서는 단순 매출 규모보다 낮은 마진의 유통 사업 안에서 specialty mix, 340B·rebate model 분쟁, opioid 합의·소송 비용, Medical-Surgical 분리 추진이 이익률과 현금흐름에 미치는 영향을 함께 봐야 합니다.",
    researchFocus: [
      "North American Pharmaceutical의 branded·generic·specialty·biosimilar 물량 구성과 gross profit rate",
      "ClarusONE·SynerGx를 통한 generic 조달 효율과 재고 회전",
      "Oncology & Multispecialty의 practice network, specialty 의약품, infusion 서비스 확장",
      "RxTS의 prescription access, affordability, life sciences 서비스 수익 기여"
    ],
    riskVariables: [
      "opioid litigation 및 관련 세금·충당부채 변동",
      "340B, rebate model, PBM·제약사 계약 관련 규제·소송",
      "generic price deflation이나 고객 계약 갱신에 따른 유통 마진 압박",
      "Medical-Surgical Solutions 분리 및 restructuring 비용"
    ],
    suggestedPrompts: [
      "맥케슨의 North American Pharmaceutical에서 specialty·generic mix가 매출보다 이익률에 어떤 영향을 주는지 최근 filing 기준으로 정리해줘.",
      "ClarusONE, SynerGx, RxTS가 맥케슨의 조달·처방 접근성·환자 지원 흐름을 어떻게 나누어 담당하는지 공시 근거로 설명해줘.",
      "맥케슨의 opioid, 340B, rebate model, Medical-Surgical 분리 리스크가 현금흐름과 비용 항목에 미치는 영향을 정리해줘.",
    ],
    questionChains: {},
  },

  MO: {
    ticker: "MO",
    companyName: "Altria Group, Inc.",
    companyNameKo: "알트리아",
    sectorKo: "담배",
    signature: "Marlboro 중심 Smokeable Products 현금창출력과 on!·NJOY 중심 Oral Tobacco Products 전환이 동시에 평가되는 미국 담배 기업.",
    description: "알트리아는 미국 내 Marlboro 중심 Smokeable Products가 현금흐름의 핵심이고, on!와 NJOY를 통해 Oral Tobacco Products 편입을 늘리며 포트폴리오 전환 속도를 조절하는 구조입니다. 공시 해석에서는 판매량 감소 국면에서 가격 인상이 어디까지 마진을 방어하는지, excise taxes와 주별 과세 체계가 가격 결정권을 얼마나 제한하는지, FDA 규제가 NJOY·on! 확장 경로에 어떤 제약을 만드는지를 함께 확인해야 합니다.",
    researchFocus: [
      "Marlboro 중심 Smokeable Products의 출하량, retail share, 가격 인상 효과",
      "on! nicotine pouches의 판매량 증가와 Oral Tobacco Products 마진 기여",
      "NJOY 전자담배 포트폴리오가 reduced-risk 전환에서 맡는 역할",
      "excise taxes와 주별 규제가 가격 결정권·프로모션·유통 채널에 미치는 영향"
    ],
    riskVariables: [
      "미국 흡연 수요 둔화에 따른 Smokeable Products 판매량 감소",
      "연방·주 excise taxes 인상 및 과세 체계 변경",
      "FDA 승인, 라벨, 마케팅·유통 규칙 강화에 따른 NJOY·on! 확장 제약",
      "Smokeable Products 현금창출 감소 속도가 Oral Tobacco Products 성장보다 빨라지는 전환 리스크"
    ],
    suggestedPrompts: [
      "알트리아의 최근 filing 기준으로 Marlboro 판매량 감소를 가격 인상이 얼마나 상쇄하고 있는지 정리해줘.",
      "on!와 NJOY가 알트리아의 Oral Tobacco Products 전환에서 각각 어떤 지표로 확인되는지 공시 근거로 보여줘.",
      "알트리아의 excise taxes와 FDA 규제가 pricing, 프로모션, 영업현금흐름에 미치는 영향을 정리해줘.",
    ],
    questionChains: {},
  },

  NEM: {
    ticker: "NEM",
    companyName: "Newmont Corporation",
    companyNameKo: "뉴몬트",
    sectorKo: "금속·채굴",
    signature: "금 생산을 중심으로 구리·은·납·아연 부산물까지 함께 팔며, 광산별 grade·throughput·CAS/AISC와 대형 프로젝트 집행이 현금흐름을 좌우하는 글로벌 금광 기업.",
    description: "뉴몬트는 Boddington, Tanami, Lihir, Cadia, Cerro Negro, Ahafo 같은 주요 광산과 Nevada Gold Mines 지분, Pueblo Viejo·Fruta del Norte 지분 노출을 통해 금과 동반 금속을 생산합니다. 공시 해석에서는 평균 실현 금값만 보는 것보다 광산별 ore grade, mill throughput, recovery, stripping, sustaining capital이 CAS와 AISC에 어떻게 반영되는지 확인해야 합니다. Ahafo North, Tanami, Cadia, Lihir 관련 개발·확장·mine sequencing은 장기 생산량과 자본집행 리스크를 동시에 보여주는 지점입니다.",
    researchFocus: [
      "금, 구리, 은, 납, 아연 가격 변화가 realized price와 매출 믹스에 미치는 영향",
      "Boddington, Tanami, Lihir, Cadia, Cerro Negro, Ahafo의 생산량·grade·throughput·recovery 차이",
      "CAS, AISC, sustaining capital, stripping cost가 광산별 현금마진에 반영되는 방식",
      "Ahafo North, Tanami, Cadia, Lihir 프로젝트와 Nevada Gold Mines·Pueblo Viejo 지분 노출"
    ],
    riskVariables: [
      "금 가격 하락 또는 구리·은 등 부산물 가격 변동에 따른 현금흐름 민감도",
      "에너지, 시약, 운송, 노동, 장비 비용 상승에 따른 CAS/AISC 압박",
      "광산별 grade 저하, mill downtime, weather, geotechnical 이슈로 인한 생산 차질",
      "가나 royalty·stability agreement, 호주·캐나다 달러 등 세금·환율·국가 리스크"
    ],
    suggestedPrompts: [
      "뉴몬트의 주요 광산별 생산량, grade, throughput 변화가 CAS와 AISC에 어떻게 반영되는지 최근 filing 기준으로 정리해줘.",
      "Ahafo North, Tanami, Cadia, Lihir 관련 프로젝트가 뉴몬트의 장기 생산량과 자본지출에 미치는 영향을 설명해줘.",
      "뉴몬트의 금 가격, 부산물 가격, 가나 royalty, 환율 리스크가 영업현금흐름에 미치는 경로를 비교해줘.",
    ],
    questionChains: {},
  },

  PH: {
    ticker: "PH",
    companyName: "Parker-Hannifin Corporation",
    companyNameKo: "파커 하니핀",
    sectorKo: "산업 설비",
    signature: "Motion & Control 기술을 Diversified Industrial과 Aerospace Systems에 공급하며, 주문잔고·가격 전가·제품 믹스가 마진을 좌우하는 산업·항공 부품 기업.",
    description: "파커 하니핀은 hydraulic, pneumatic, filtration, sealing, fluid connector, motion control 같은 Motion & Control 제품을 산업 장비와 항공우주 고객에게 공급합니다. Diversified Industrial은 공장 자동화, HVAC/냉동, 에너지, 운송, 일반 산업 장비 수요에 노출되고, Aerospace Systems는 commercial OEM, defense, aftermarket 주문과 장기 프로그램 비중이 큽니다. 공시 해석에서는 backlog가 다음 매출로 전환되는 속도, 가격 인상이 재료비·물류비를 얼마나 상쇄하는지, Meggitt 인수 이후 항공 포트폴리오와 시너지 비용이 segment operating margin에 어떻게 반영되는지 봐야 합니다.",
    researchFocus: [
      "Diversified Industrial의 북미·국제 수요와 in-plant 장비, HVAC/냉동, 에너지 고객 노출",
      "Aerospace Systems의 commercial OEM, defense, aftermarket 주문 구성과 backlog 전환",
      "가격 전가, 제품 믹스, 재료비 상승이 segment operating income에 미치는 영향",
      "Meggitt 통합 이후 항공 포트폴리오, 시너지, restructuring 비용 흐름"
    ],
    riskVariables: [
      "원자재·부품·물류 비용 상승을 가격 인상으로 충분히 상쇄하지 못할 위험",
      "공급망 차질, 항공 OEM 생산 지연, defense 프로그램 일정 변경",
      "산업 설비 수요 둔화와 distributor 재고 조정에 따른 주문 감소",
      "Meggitt 통합, restructuring, 환율·금리 노출이 마진 개선 속도를 늦출 가능성"
    ],
    suggestedPrompts: [
      "파커 하니핀의 Diversified Industrial과 Aerospace Systems 매출·마진을 최근 filing 기준으로 나눠 설명해줘.",
      "Aerospace Systems의 OEM, defense, aftermarket 주문과 backlog가 향후 매출 가시성에 어떤 의미를 갖는지 정리해줘.",
      "파커 하니핀의 가격 전가, 재료비, Meggitt 통합 비용이 segment operating margin에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  PLD: {
    ticker: "PLD",
    companyName: "Prologis, Inc.",
    companyNameKo: "프로로그리스",
    sectorKo: "부동산",
    signature: "글로벌 logistics real estate 포트폴리오의 occupancy·same-store NOI와 Strategic Capital, data center power pipeline을 함께 보는 산업용 REIT.",
    description: "프로로그리스는 전자상거래, 리테일, 제조, 3PL 고객에게 물류 부동산을 임대하는 글로벌 logistics real estate REIT입니다. 공시 해석에서는 occupancy와 rent change가 same-store NOI와 Core FFO에 어떻게 연결되는지, development starts와 stabilizations가 향후 임대수익으로 전환되는 속도, Strategic Capital의 fee·promote 수익이 부동산 임대수익과 다른 변동성을 갖는지를 분리해서 봐야 합니다. 최근에는 data center power pipeline과 에너지 관련 사업도 물류 네트워크의 전력·입지 가치와 연결되는 확장 축입니다.",
    researchFocus: [
      "occupancy, rent change, same-store NOI가 Core FFO에 반영되는 경로",
      "development starts, stabilizations, build-to-suit 프로젝트가 장기 임대수익으로 전환되는 속도",
      "Strategic Capital의 AUM, fee, promote 수익과 Real Estate 임대수익의 차이",
      "data center power pipeline, solar, energy storage가 물류 부동산 입지 가치에 더하는 효과"
    ],
    riskVariables: [
      "금리 상승과 credit spread 확대로 인한 부채비용·재자금조달 부담",
      "occupancy 하락 또는 same-store NOI 둔화에 따른 Core FFO 압박",
      "개발 프로젝트 지연, 임차인 확보 지연, build-to-suit 비용 초과",
      "Strategic Capital 성과보수와 자산매각 수익의 경기·거래시장 민감도"
    ],
    suggestedPrompts: [
      "프로로그리스의 occupancy, rent change, same-store NOI가 Core FFO에 어떻게 연결되는지 최근 filing 기준으로 정리해줘.",
      "development starts와 stabilizations가 프로로그리스의 향후 임대수익과 자본배분에 미치는 영향을 설명해줘.",
      "Strategic Capital과 data center power pipeline이 프로로그리스의 전통적인 logistics real estate 수익과 어떻게 다른지 비교해줘.",
    ],
    questionChains: {},
  },

  PNC: {
    ticker: "PNC",
    companyName: "PNC Financial Services Group, Inc.",
    companyNameKo: "PNC 파이낸셜 서비스",
    sectorKo: "은행·자산운용",
    signature: "소매은행, Corporate & Institutional Banking, Asset Management를 묶어 NII/NIM, 예금 비용, CRE 신용 리스크, FirstBank 통합 효과를 함께 봐야 하는 대형 지역은행.",
    description: "PNC는 소매은행, Corporate & Institutional Banking, Asset Management 수익을 기반으로 대출·예금·수수료 사업을 운영합니다. 공시 해석에서는 NII와 NIM이 금리 경로, deposit beta, 대출 믹스, 비이자예금 비중에 어떻게 반응하는지 확인해야 합니다. FirstBank 통합은 대출·예금 기반을 키우는 요인이지만 통합 비용, IT·통제 체계, 신용 포트폴리오 변화도 같이 따라옵니다. CRE, 특히 오피스 노출과 consumer credit quality는 provision, ACL, net charge-off 경로로 은행 이익 변동성을 만드는 핵심 지점입니다.",
    researchFocus: [
      "NII, NIM, deposit beta, 비이자예금 비중이 이자수익성에 미치는 영향",
      "Retail Banking, Corporate & Institutional Banking, Asset Management의 수익 믹스와 비용 구조",
      "FirstBank 통합 이후 loans, deposits, branch footprint, expense synergy 변화",
      "CRE·오피스와 consumer portfolio의 ACL, provision, net charge-off 흐름"
    ],
    riskVariables: [
      "금리 인하·상승 국면에서 예금 비용과 NIM이 기대와 다르게 움직일 위험",
      "CRE·오피스 신용 악화와 consumer delinquency 증가에 따른 credit loss 확대",
      "FirstBank 통합 과정의 비용 초과, 시스템 전환, 통제 리스크",
      "uninsured deposits, wholesale funding, liquidity coverage 관련 자금조달 압박"
    ],
    suggestedPrompts: [
      "PNC의 NII와 NIM을 deposit beta, 대출 믹스, 비이자예금 비중으로 나눠 최근 filing 기준으로 설명해줘.",
      "FirstBank 통합이 PNC의 loans, deposits, 비용 구조, 신용 리스크에 어떤 변화를 만들었는지 정리해줘.",
      "PNC의 CRE·오피스와 consumer credit risk가 ACL, provision, net charge-off에 어떻게 반영되는지 분석해줘.",
    ],
    questionChains: {},
  },

  PWR: {
    ticker: "PWR",
    companyName: "Quanta Services, Inc.",
    companyNameKo: "퀀타 서비스",
    sectorKo: "전력·유틸리티 인프라",
    signature: "Electric Infrastructure Solutions와 Underground Utility and Infrastructure Solutions에서 전력망·재생에너지·가스 유틸리티 공사를 수행하며, backlog와 계약 믹스가 매출 가시성과 마진 변동성을 좌우하는 인프라 시공사.",
    description: "퀀타 서비스는 전력 송전·배전, 변전소, grid hardening, storm restoration, 재생에너지 연계 인프라, 가스 유틸리티와 파이프라인 무결성 공사를 수행합니다. Electric Infrastructure Solutions는 전력망 현대화, 송전망 증설, Renewable Energy Infrastructure 연계 수요에 민감하고, Underground Utility and Infrastructure Solutions는 가스 유틸리티 교체·보수와 산업 인프라 프로젝트가 중심입니다. 공시 해석에서는 backlog와 RPO가 매출로 전환되는 속도, fixed-price·unit-price·cost-plus 계약 믹스, 자재·장비·숙련 인력 가용성이 project margin과 운전자본에 미치는 영향을 함께 봐야 합니다.",
    researchFocus: [
      "Electric Infrastructure Solutions의 전력망 현대화, 송전·변전, grid hardening 수요",
      "Renewable Energy Infrastructure와 태양광·풍력·배터리 저장 프로젝트의 전력망 연결 공사",
      "Underground Utility and Infrastructure Solutions의 가스 유틸리티, pipeline integrity, 산업 인프라 노출",
      "backlog, RPO, fixed-price·unit-price·cost-plus 계약 믹스가 매출과 마진에 반영되는 방식"
    ],
    riskVariables: [
      "fixed-price 대형 프로젝트의 견적 오류, 일정 지연, change order 회수 실패",
      "전력 유틸리티·재생에너지 고객의 자본지출, 금리, 인센티브 변화",
      "철강·전선·장비·하도급 비용 상승과 숙련 인력 부족",
      "기상 악화, 자연재해, 허가·규제 지연에 따른 생산성 저하와 운전자본 부담"
    ],
    suggestedPrompts: [
      "퀀타 서비스의 Electric Infrastructure Solutions와 Underground Utility and Infrastructure Solutions가 매출·마진에서 어떻게 다른지 최근 filing 기준으로 정리해줘.",
      "backlog와 RPO가 퀀타 서비스의 향후 매출 가시성을 보여주는 방식과 한계를 설명해줘.",
      "fixed-price 계약, 자재 조달, 숙련 인력 부족이 퀀타 서비스의 project margin과 현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  SBUX: {
    ticker: "SBUX",
    companyName: "Starbucks Corporation",
    companyNameKo: "스타벅스",
    sectorKo: "커피·외식",
    signature: "company-operated stores와 licensed stores, comparable store sales의 transaction·ticket 분해, Starbucks Rewards·Mobile Order and Pay가 매장 수익성과 브랜드 반복 구매를 좌우하는 글로벌 커피 체인.",
    description: "스타벅스는 company-operated stores에서 음료·푸드 매출을 직접 인식하고, licensed stores에서는 로열티와 제품 공급 수익을 얻는 구조입니다. 공시 해석에서는 comparable store sales를 transactions와 ticket으로 나눠 트래픽 둔화와 가격·믹스 효과를 구분하고, Back to Starbucks 운영 재편이 매장 노동, 속도, 고객 경험, 영업이익률에 어떤 변화를 만드는지 확인해야 합니다. Starbucks Rewards, Starbucks Card, Mobile Order and Pay는 반복 구매와 디지털 주문 믹스를 보여주는 핵심 지표이고, 원두·유제품·관세·인건비 부담은 매장 마진에 직접 반영됩니다.",
    researchFocus: [
      "company-operated stores와 licensed stores의 매출 인식·마진 구조 차이",
      "comparable store sales의 transactions, ticket, 지역별 mix 변화",
      "Back to Starbucks 운영 재편, 매장 폐점·전환, Siren System 투자 효과",
      "Starbucks Rewards, Starbucks Card, Mobile Order and Pay가 주문 빈도와 디지털 믹스에 미치는 영향"
    ],
    riskVariables: [
      "거래건수 감소를 가격·믹스 개선만으로 상쇄하지 못할 위험",
      "원두, 유제품, 물류, 관세, 매장 인건비 상승에 따른 store margin 압박",
      "중국·국제 시장 경쟁 심화와 licensed partner 성과 부진",
      "점포 재편, 노조 이슈, 운영 속도 개선 실패로 인한 브랜드 경험 약화"
    ],
    suggestedPrompts: [
      "스타벅스의 company-operated stores와 licensed stores가 매출과 마진에서 어떻게 다른지 최근 filing 기준으로 정리해줘.",
      "comparable store sales를 transactions와 ticket으로 나눠 스타벅스의 트래픽과 가격·믹스 흐름을 설명해줘.",
      "Starbucks Rewards, Mobile Order and Pay, Back to Starbucks 운영 재편이 매장 수익성에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  SNPS: {
    ticker: "SNPS",
    companyName: "Synopsys, Inc.",
    companyNameKo: "시놉시스",
    sectorKo: "반도체 설계 자동화·EDA",
    signature: "EDA와 Design IP를 기반으로 칩 설계·검증 흐름을 장악하고, Ansys 통합으로 simulation & analysis와 AI-driven design 포트폴리오를 확장한 반도체 설계 소프트웨어 기업.",
    description: "시놉시스는 Design Automation, Design IP, simulation & analysis 제품을 통해 반도체와 전자 시스템 설계 고객의 개발 흐름에 깊게 들어가 있습니다. 공시 해석에서는 시간기반 라이선스, upfront, maintenance and service 매출 믹스가 backlog와 현금흐름으로 어떻게 이어지는지 봐야 합니다. Ansys 통합은 multiphysics simulation, EDA, AI-driven design 결합을 강화하는 축이지만 통합 비용, 부채·이자비용, 상각 부담도 같이 따라옵니다. Software Integrity 처분 이후에는 EDA·IP·simulation 중심의 핵심 설계 플랫폼 수익성에 더 집중해 보는 구조입니다.",
    researchFocus: [
      "Design Automation의 EDA 라이선스, verification, AI-driven design 수요",
      "Design IP의 processor, interface, security IP 수요와 고객 tape-out 일정",
      "Ansys 통합 이후 simulation & analysis, multiphysics, semiconductor workflow 결합 효과",
      "time-based, upfront, maintenance and service 매출 믹스와 backlog 전환 속도"
    ],
    riskVariables: [
      "반도체 고객의 설계 착수 지연과 대형 고객 구매 타이밍 변동",
      "미국 수출 통제와 중국·지역별 규제로 인한 EDA·IP 판매 제약",
      "Ansys 통합 지연, 부채·이자비용, 상각 부담에 따른 현금흐름 압박",
      "Design IP 경쟁 심화, IP 분쟁, 사이버 보안 사고로 인한 신뢰도 훼손"
    ],
    suggestedPrompts: [
      "시놉시스의 Design Automation과 Design IP가 매출 인식과 마진에서 어떻게 다른지 최근 filing 기준으로 설명해줘.",
      "Ansys 통합이 EDA, simulation & analysis, AI-driven design 포트폴리오에 어떤 변화를 주는지 공시 근거로 정리해줘.",
      "시놉시스의 backlog, time-based 라이선스, upfront 매출, 수출 통제 리스크가 현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  SO: {
    ticker: "SO",
    companyName: "Southern Company",
    companyNameKo: "서던 컴퍼니",
    sectorKo: "규제형 전력·가스 유틸리티",
    signature: "Alabama Power, Georgia Power, Mississippi Power, Southern Power, Southern Company Gas의 regulated utility 구조에서 rate base, fuel cost recovery, Vogtle 비용 회수가 현금흐름을 좌우하는 남동부 유틸리티.",
    description: "서던 컴퍼니는 규제형 전력 유틸리티와 천연가스 유통, 도매 전력 사업을 함께 운영합니다. 공시 해석에서는 전력 판매량보다 rate case, allowed ROE, fuel cost recovery, storm cost recovery, AFUDC와 같은 규제 회수 메커니즘이 earnings와 cash flow에 어떤 시차로 반영되는지 보는 것이 중요합니다. Georgia Power의 Vogtle Units 3·4는 상업운전 이후 rate base와 세액공제·비용 회수 논리로 이어지는 핵심 자산이고, Alabama Power와 Georgia Power의 연료비·폭풍복구비 회수 체계는 단기 현금흐름 변동을 설명하는 지점입니다.",
    researchFocus: [
      "Alabama Power와 Georgia Power의 rate case, allowed ROE, rate base 확대 경로",
      "fuel cost recovery, storm cost recovery, Rate ECR 등 규제 회수 메커니즘",
      "Vogtle Units 3·4의 rate base 반영, PTC, 공동 소유 비용 정산",
      "Southern Power의 PPA와 Southern Company Gas의 천연가스 유통 수익 안정성"
    ],
    riskVariables: [
      "PSC 요율 승인 지연, allowed ROE 하향, 비용 회수 조건 변경",
      "연료 가격 변동과 fuel cost recovery 시차에 따른 운전자본 부담",
      "허리케인·폭풍 피해 복구 비용과 회수 일정 불확실성",
      "Vogtle 관련 비용 조정, 장기금리 상승, 대규모 자본지출 부담"
    ],
    suggestedPrompts: [
      "서던 컴퍼니의 Alabama Power와 Georgia Power rate case가 rate base와 allowed ROE에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "Vogtle Units 3·4의 rate base 반영, PTC, 비용 회수 구조가 현금흐름에 미치는 영향을 설명해줘.",
      "fuel cost recovery와 storm cost recovery가 서던 컴퍼니의 단기 이익과 운전자본에 어떤 시차를 만드는지 분석해줘.",
    ],
    questionChains: {},
  },

  TJX: {
    ticker: "TJX",
    companyName: "The TJX Companies, Inc.",
    companyNameKo: "TJX",
    sectorKo: "오프프라이스 소매",
    signature: "Marmaxx, HomeGoods, TJX Canada, TJX International을 통해 off-price 재고 조달력과 빠른 회전율을 수익화하며, comp sales와 merchandise margin이 핵심인 할인 소매업체.",
    description: "TJX는 TJ Maxx, Marshalls, Sierra, HomeGoods, Winners, Homesense, TK Maxx 같은 off-price 브랜드를 운영합니다. 공시 해석에서는 comp sales를 고객 거래와 평균 장바구니로 나눠 방문 빈도와 구매 믹스를 구분하고, merchandise margin, markdown, freight, shrink, SG&A 레버리지가 segment profit margin에 어떻게 반영되는지 확인해야 합니다. 온라인 비중보다 매장 방문 경험과 opportunistic buying이 핵심이라, 재고 조달 환경과 소비자의 value-seeking 성향이 실적의 중요한 선행 신호입니다.",
    researchFocus: [
      "Marmaxx, HomeGoods, TJX Canada, TJX International의 comp sales와 segment profit margin 차이",
      "merchandise margin, markon, markdown, freight, shrink가 gross margin에 미치는 영향",
      "off-price buying 조직이 브랜드 재고, closeout, opportunistic inventory를 확보하는 방식",
      "점포 수, selling square footage, e-commerce 보조 역할, 환율이 지역별 실적에 주는 영향"
    ],
    riskVariables: [
      "브랜드 재고 조달 환경 악화 또는 상품 믹스 실패에 따른 traffic 둔화",
      "freight, 임금, shrink, markdown 증가로 인한 merchandise margin 압박",
      "캐나다·유럽·호주 환율 변동과 해외 소비 둔화",
      "관세, 무역정책, 공급망 병목이 구매 원가와 재고 회전율에 미치는 영향"
    ],
    suggestedPrompts: [
      "TJX의 Marmaxx, HomeGoods, TJX Canada, TJX International을 comp sales와 segment margin 기준으로 비교해줘.",
      "TJX의 merchandise margin, markdown, freight, shrink가 off-price 수익성에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "off-price 재고 조달력과 소비자 value-seeking 성향이 TJX의 traffic과 평균 장바구니에 미치는 영향을 설명해줘.",
    ],
    questionChains: {},
  },

  TT: {
    ticker: "TT",
    companyName: "Trane Technologies plc",
    companyNameKo: "트레인 테크놀로지스",
    sectorKo: "HVAC·운송 냉동",
    signature: "Trane의 Commercial·Residential HVAC와 Thermo King 운송 냉동을 묶어, bookings·backlog·서비스 매출·refrigerant 전환이 마진을 좌우하는 기후 솔루션 기업.",
    description: "트레인 테크놀로지스는 Trane 브랜드의 Commercial HVAC와 Residential HVAC, Thermo King의 Transport Refrigeration, 그리고 서비스·부품·임대 솔루션으로 매출을 만듭니다. 공시 해석에서는 Commercial HVAC의 bookings와 backlog가 장비·서비스 매출로 전환되는 속도, Residential HVAC가 금리와 주택 수요에 받는 압력, Transport Refrigeration이 트럭·트레일러·콜드체인 투자 사이클에 반응하는 방식을 나눠 봐야 합니다. refrigerant 규제 전환, 원자재·부품 비용, 가격 전가, 설치 인력과 공급망은 gross margin의 핵심 변수입니다.",
    researchFocus: [
      "Commercial HVAC의 bookings, backlog, service attachment, 에너지 효율화 수요",
      "Residential HVAC의 금리·주택경기·refrigerant 전환 민감도",
      "Thermo King Transport Refrigeration의 트럭·트레일러·콜드체인 장비 수요",
      "가격 전가, 원자재·물류 비용, 지역별 Americas·EMEA·APAC 마진 차이"
    ],
    riskVariables: [
      "Commercial HVAC backlog 전환 지연 또는 고객 프로젝트 취소",
      "Residential HVAC 수요 둔화와 refrigerant 규제 전환 비용",
      "Transport Refrigeration의 운송 장비 교체 사이클 약화",
      "관세, 원자재, 물류, 환율 변동이 가격 전가보다 빠르게 마진을 압박할 위험"
    ],
    suggestedPrompts: [
      "트레인의 Commercial HVAC, Residential HVAC, Thermo King Transport Refrigeration을 bookings와 backlog 기준으로 비교해줘.",
      "refrigerant 규제 전환과 금리 환경이 트레인의 Residential HVAC 수요와 마진에 미치는 영향을 설명해줘.",
      "트레인의 서비스 매출, 가격 전가, 원자재·물류 비용이 gross margin에 어떻게 반영되는지 공시 기준으로 정리해줘.",
    ],
    questionChains: {},
  },

  USB: {
    ticker: "USB",
    companyName: "U.S. Bancorp",
    companyNameKo: "유에스뱅코프",
    sectorKo: "은행·결제",
    signature: "NII/NIM과 예금 비용, Payments 수수료, CRE·consumer credit, CET1 자본완충력을 같이 봐야 하는 결제 비중 높은 미국 대형 은행.",
    description: "U.S. Bancorp는 Wealth, Corporate, Commercial and Institutional Banking, Consumer and Business Banking, Payment Services를 함께 운영하는 다각화 은행입니다. 공시 해석에서는 대출 성장보다 NII와 NIM이 deposit beta, 예금 믹스, securities reinvestment, funding cost에 어떻게 반응하는지가 중요합니다. Payments는 카드·상거래 결제 수수료로 은행 수익을 보완하지만 소비 지출, merchant volume, charge-off와도 연결됩니다. CRE, 신용카드, consumer loan의 ACL과 net charge-off, 그리고 CET1·liquidity position은 배당·자사주·성장 여력을 판단하는 핵심 변수입니다.",
    researchFocus: [
      "NII, NIM, deposit beta, funding cost가 순이자수익에 반영되는 방식",
      "Payment Services의 merchant acquiring, card, corporate payment 수수료 흐름",
      "상업대출, CRE, 주택담보, 신용카드 포트폴리오의 credit quality와 ACL",
      "CET1, capital return, liquidity, securities portfolio가 대차대조표 여력에 주는 의미"
    ],
    riskVariables: [
      "예금 비용 상승 또는 비이자예금 감소로 인한 NIM 압박",
      "CRE와 신용카드 연체·charge-off 증가에 따른 provision 확대",
      "Payments 거래량 둔화, merchant mix 변화, 규제 비용 증가",
      "BTIG 같은 인수·통합 실행, 자본규제, 유동성 규제 변화"
    ],
    suggestedPrompts: [
      "U.S. Bancorp의 NII와 NIM을 deposit beta, funding cost, securities reinvestment 관점에서 최근 filing 기준으로 정리해줘.",
      "Payment Services가 U.S. Bancorp의 은행 수익성을 어떻게 보완하고 어떤 경기 민감도를 갖는지 설명해줘.",
      "U.S. Bancorp의 CRE, 신용카드, ACL, CET1 지표를 연결해 신용 리스크와 자본 여력을 분석해줘.",
    ],
    questionChains: {},
  },

  WM: {
    ticker: "WM",
    companyName: "Waste Management, Inc.",
    companyNameKo: "웨이스트 매니지먼트",
    sectorKo: "폐기물·환경 서비스",
    signature: "collection, transfer, landfill, recycling, renewable natural gas를 묶어 price-over-volume과 disposal yield, commodity price, RNG 프로젝트가 마진을 좌우하는 북미 폐기물 처리 기업.",
    description: "웨이스트 매니지먼트는 주거·상업·산업 폐기물 collection, transfer station, landfill disposal, recycling processing, renewable energy 사업을 운영합니다. 공시 해석에서는 collection and disposal의 average yield와 volume을 분리해 price-over-volume이 실제로 유지되는지 확인해야 합니다. Recycling Processing and Sales는 재활용 원재료 가격과 처리량에 민감하고, Renewable Energy는 landfill gas를 RNG·전력으로 전환하는 프로젝트의 가동률과 RINs·RECs 가격이 중요합니다. Healthcare Solutions와 인수 통합은 수익원 확대 요인이지만 운송·인력·정비·환경 규제 비용도 함께 따라옵니다.",
    researchFocus: [
      "collection and disposal의 average yield, volume, churn, route density 변화",
      "landfill, transfer station, disposal fee, special waste mix가 마진에 미치는 영향",
      "Recycling Processing and Sales의 commodity price, processing spread, 물량 흐름",
      "Renewable Energy의 landfill gas, RNG, RINs, RECs 프로젝트 가동과 수익 기여"
    ],
    riskVariables: [
      "경기 둔화와 건설·산업 활동 약화에 따른 collection volume 감소",
      "임금, 연료, 차량 정비, 보험 비용 상승으로 인한 operating cost 압박",
      "재활용 원재료 가격과 RNG·RINs·RECs 가격 변동",
      "landfill permit, PFAS, leachate, environmental remediation 관련 규제 비용"
    ],
    suggestedPrompts: [
      "웨이스트 매니지먼트의 collection and disposal에서 average yield와 volume이 매출과 마진에 어떻게 다르게 반영되는지 정리해줘.",
      "Recycling Processing and Sales와 Renewable Energy가 commodity price, RNG, RINs, RECs 가격에 얼마나 민감한지 공시 기준으로 설명해줘.",
      "landfill permit, PFAS, 연료·인건비 상승이 웨이스트 매니지먼트의 현금흐름과 비용 구조에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  WMB: {
    ticker: "WMB",
    companyName: "Williams Companies, Inc.",
    companyNameKo: "윌리엄스",
    sectorKo: "천연가스 인프라·미드스트림",
    signature: "Transco 중심 Transmission & Gulf of Mexico의 firm reservation 수익과 Northeast G&P·West gathering·processing, Gas & NGL Marketing 스프레드가 현금흐름을 나누는 천연가스 미드스트림 기업.",
    description: "윌리엄스는 Transco와 Northwest Pipeline 같은 장거리 천연가스 운송·저장 자산, Northeast G&P와 West의 gathering·processing, Gas & NGL Marketing을 운영합니다. 공시 해석에서는 Transmission & Gulf of Mexico의 firm capacity reservation과 FERC 요율 구조가 fee-based 현금흐름을 얼마나 안정화하는지, gathering·processing 물량과 MVC가 생산지역의 가스 흐름을 어떻게 반영하는지 봐야 합니다. Gas & NGL Marketing은 basis spread, 계절성, derivative mark-to-market에 따라 변동성이 커서 안정적인 운송·저장 수익과 분리해 판단해야 합니다.",
    researchFocus: [
      "Transco, Northwest Pipeline, MountainWest 운송·저장 수익과 FERC rate 구조",
      "Northeast G&P의 Marcellus·Utica gathering, processing, MVC 물량",
      "West segment의 gathering·processing, Deepwater Gulf, Louisiana Energy Gateway 노출",
      "Gas & NGL Marketing의 basis spread, NGL 가격, derivative 손익 변동"
    ],
    riskVariables: [
      "FERC 승인, rate case, 프로젝트 허가 지연에 따른 확장 일정 리스크",
      "gathering·processing 물량 감소와 생산자 drilling activity 둔화",
      "건설비 상승, 연결 프로젝트 지연, 환경·토지 사용 규제",
      "NGL 가격, basis spread, 파생상품 평가손익, 계절성 수요 변동"
    ],
    suggestedPrompts: [
      "윌리엄스의 Transco 중심 Transmission 수익이 firm reservation과 FERC 요율 구조로 어떻게 안정화되는지 설명해줘.",
      "Northeast G&P와 West의 gathering·processing 물량, MVC, 생산지역 노출이 실적에 미치는 영향을 비교해줘.",
      "Gas & NGL Marketing의 basis spread와 derivative 손익이 윌리엄스의 안정적인 pipeline cash flow와 어떻게 다른지 정리해줘.",
    ],
    questionChains: {},
  },

  XOM: {
    ticker: "XOM",
    companyName: "Exxon Mobil Corporation",
    companyNameKo: "엑손모빌",
    sectorKo: "통합 에너지",
    signature: "Upstream의 Permian·Guyana·LNG 물량, Energy Products 정제 스프레드, Chemical·Specialty Products 마진, Low Carbon Solutions 투자 속도를 함께 봐야 하는 통합 에너지 기업.",
    description: "엑손모빌은 Upstream, Energy Products, Chemical Products, Specialty Products, Low Carbon Solutions를 통해 원유·가스 생산부터 정제·화학·특수제품까지 통합 운영합니다. 공시 해석에서는 유가만 보는 것보다 Permian과 Guyana 생산량, LNG 프로젝트, refinery utilization, crack spread, chemical margin, specialty product mix가 영업현금흐름을 어떻게 나누는지 확인해야 합니다. Pioneer 통합과 advantaged assets 확대는 upstream volume과 비용 구조를 바꾸는 축이고, Low Carbon Solutions는 carbon capture, hydrogen, low-emission fuels 상업화 속도와 정책 지원이 수익성의 관건입니다.",
    researchFocus: [
      "Upstream의 Permian, Guyana, LNG 생산량·realization·unit cost 변화",
      "Energy Products의 정제 처리량, refinery utilization, crack spread, trading 결과",
      "Chemical Products와 Specialty Products의 제품 믹스, feedstock cost, margin cycle",
      "Low Carbon Solutions의 carbon capture, hydrogen, low-emission fuels 투자와 상업화 조건"
    ],
    riskVariables: [
      "원유·천연가스 가격 급락과 지역별 realized price 약화",
      "정제·화학 스프레드 축소와 feedstock cost 변동",
      "Permian, Guyana, LNG 프로젝트 지연 또는 비용 초과",
      "Low Carbon Solutions 정책 지원 약화, 탄소 규제, litigation·환경 리스크"
    ],
    suggestedPrompts: [
      "엑손모빌의 Upstream에서 Permian, Guyana, LNG가 생산량과 현금흐름에 미치는 영향을 최근 filing 기준으로 정리해줘.",
      "Energy Products, Chemical Products, Specialty Products의 스프레드와 제품 믹스가 엑손모빌 마진에 어떻게 반영되는지 설명해줘.",
      "Low Carbon Solutions와 기존 oil & gas 사업의 자본지출, 정책 의존도, 현금흐름 성격을 비교해줘.",
    ],
    questionChains: {},
  },

  WFC: {
    ticker: "WFC",
    companyName: "Wells Fargo & Company",
    companyNameKo: "웰스파고",
    sectorKo: "은행",
    signature: "NII/NIM, deposits, consumer banking, CRE·C&I credit, asset cap·consent order 해소 이후 비용 구조와 자본배분을 함께 봐야 하는 미국 대형 은행.",
    description: "웰스파고는 Consumer Banking, Commercial Banking, Corporate & Investment Banking, Wealth & Investment Management를 운영하는 대형 은행입니다. 공시 해석에서는 NII와 NIM이 deposits, loan mix, securities yield, funding cost에 어떻게 반응하는지 보고, consumer banking의 신용카드·모기지·자동차 대출과 CRE·C&I 포트폴리오의 allowance와 net charge-off를 함께 확인해야 합니다. 과거 asset cap과 consent orders는 성장 제약과 compliance cost를 만든 핵심 변수였고, 관련 해소 이후에도 통제·리스크 관리 비용과 자본배분 정상화 속도를 따로 점검해야 합니다.",
    researchFocus: [
      "NII, NIM, deposits, loan mix, funding cost가 순이자수익에 미치는 영향",
      "consumer banking의 신용카드, mortgage, auto loan, retail fee 흐름",
      "CRE, C&I, credit card, auto portfolio의 ACL, provision, net charge-off 변화",
      "asset cap, FRB·OCC·CFPB consent orders 해소 이후 compliance cost와 capital return"
    ],
    riskVariables: [
      "예금 비용 상승과 loan growth 둔화에 따른 NIM 압박",
      "CRE·C&I·신용카드 charge-off 증가와 provision 확대",
      "consent order 이후에도 남는 운영·통제·compliance 비용",
      "금리·환율·파생상품·capital rule 변화가 자본배분과 수익성에 미치는 영향"
    ],
    suggestedPrompts: [
      "웰스파고의 NII와 NIM을 deposits, loan mix, funding cost 관점에서 최근 filing 기준으로 정리해줘.",
      "CRE, C&I, credit card, auto, mortgage 포트폴리오별 credit loss와 allowance 흐름을 비교해줘.",
      "asset cap과 consent order 해소 이후 웰스파고의 compliance cost, 자본배분, 자사주 정책에 남은 체크포인트를 설명해줘.",
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
  "AI 데이터센터 투자 확대는 어떤 기업에 가장 큰 수혜인가요?",
  "메모리 가격 상승은 어떤 반도체 기업에 유리한가요?",
  "소비 둔화에도 마진을 방어할 수 있는 기업은 어디인가요?",
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

  const coreA = coreTerms[0] ?? "핵심 성장 동력";
  const coreB = coreTerms[1] ?? coreTerms[0] ?? "운영 효율";
  const riskA = riskTerms[0] ?? "주요 리스크 요인";

  return [
    `'${coreA}' 관련 실적 흐름을 공시 기준으로 정리해줘.`,
    `'${coreB}'가 매출·마진·현금흐름에 미치는 영향을 설명해줘.`,
    `'${riskA}' 리스크가 어떤 항목으로 나타나는지 확인해줘.`,
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
