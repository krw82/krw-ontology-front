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
      "아이폰과 서비스 생태계를 중심으로 매출을 만들고, 지역 수요와 앱스토어 규제가 성장 논지의 방향성을 좌우하는 플랫폼형 기업",
    description:
      "애플은 아이폰과 서비스를 중심으로 수익을 창출하며, 프로 모델 수요, 앱스토어 수익 구조, 중화권 및 지역별 수요 변동, 공급망·관세·환율이 매출총이익률과 현금흐름 해석의 핵심 변수입니다.",
    researchFocus: [
      "아이폰 매출과 프로 모델 수요의 가격·물량 기여",
      "서비스 및 앱스토어 구독·거래형 수익 구조",
      "중화권과 지역별 매출 흐름",
      "제품·서비스 믹스가 매출총이익률에 미치는 영향",
      "연구개발·판관비 비용 효율성이 장기 마진에 미치는 효과",
    ],
    riskVariables: [
      "앱스토어 규제, 외부 결제 연동, 반독점 리스크",
      "중국·아시아권 외주 제조 및 공급망 집중",
      "관세·희토류·부품 조달 비용 상승 압력",
      "환율 변동, 최종수요 둔화, 지역별 아이폰 수요 편차",
    ],
    suggestedPrompts: [
      "애플의 아이폰, 서비스, 맥, 아이패드, 웨어러블 수익 구조를 공시 기준으로 정리하고 최근 성장 동인을 매출총이익률 중심으로 설명해줘.",
      "애플의 아이폰·서비스 매출 비중, 지역별 성장 동인, 연구개발·판관비 추세가 마진과 현금창출력에 어떻게 연결되는지 비교해줘.",
      "애플의 앱스토어 규제, 공급망 집중도, 중화권 수요가 성장 논지를 훼손할 수 있는 리스크를 공시 근거로 우선순위화해줘.",
    ],
    questionChains: APPLE_QUESTION_CHAINS,
  },
  ABBV: {
    ticker: "ABBV",
    companyName: "AbbVie Inc.",
    companyNameKo: "애브비",
    sectorKo: "제약",
    signature:
      "휴미라에서 스카이리치·린버크로의 매출 전환 속도와 보톡스의 이익 기여도가 애브비의 핵심 성장 축을 만들고, IRA·메디케어 환경은 가격 전가력을 제한하는 제약 조건입니다.",
    description:
      "애브비는 휴미라 이후 스카이리치·린버크로의 면역질환 매출 전환, 보톡스의 수익성 완충 효과, IRA·메디케어 가격 협상 체계가 현금흐름과 마진에 미치는 영향을 함께 읽어야 합니다.",
    researchFocus: [
      "휴미라 의존도 축소 속도와 스위칭 리스크",
      "스카이리치의 면역질환 성장 지속성",
      "린버크의 적응증 확대와 경쟁 압력",
      "보톡스의 미용의학 수익성",
    ],
    riskVariables: [
      "IRA·메디케어 가격 협상 및 환급 규칙 변화",
      "휴미라 바이오시밀러 경쟁에 따른 가격 하방 압력",
      "특허·규제 변화와 파이프라인 가시성",
      "인건비와 영업·마케팅 비용 통제",
    ],
    suggestedPrompts: [
      "애브비의 휴미라에서 스카이리치·린버크로의 매출 전환이 어떤 속도로 진행되고 있는지 공시 기준으로 정리해줘.",
      "스카이리치·린버크와 보톡스의 매출·현금흐름 기여도가 매출총이익률과 비용 구조에 어떻게 다르게 반영되는지 비교해줘.",
      "IRA·메디케어 가격 협상, 휴미라 바이오시밀러 경쟁, 인건비 상승이 애브비의 성장 논지를 어떤 순서로 압박하는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  ABT: {
    ticker: "ABT",
    companyName: "Abbott Laboratories",
    companyNameKo: "애보트",
    sectorKo: "헬스케어",
    signature:
      "프리스타일 리브레 중심의 당뇨 관리와 진단, 영양, 의료기기, 기존 의약품이 애보트의 성장과 마진을 좌우합니다.",
    description:
      "기업 리포트: 프리스타일 리브레, 진단, 영양, 의료기기, 기존 의약품의 매출 믹스와 연구개발·판관비·제품 원가를 연결해 성장 논지를 점검합니다.",
    researchFocus: [
      "프리스타일 리브레 및 당뇨 관리 센서·소모재",
      "진단(알리니티, 분자진단, 현장진단, 신속진단) 포트폴리오",
      "영양(성인·소아) 매출 구조와 수요 회복",
      "의료기기 세부 분야(혈관 치료, 심장 치료, 신경조절 등)",
      "기존 의약품 지역별 성장 동인과 가격 정책",
    ],
    riskVariables: [
      "보험·정부 환급 정책 변화가 가격 전가력에 미치는 영향",
      "진단 수요 변동과 사업부 수익성 민감도",
      "환율·원재료·인건비 변동이 제품 원가와 매출총이익률에 미치는 압박",
      "연구개발·판관비 비용 확대가 현금흐름과 성장 속도에 미치는 영향",
      "규제 승인·공급망·재고 가용성 지연에 따른 출시 및 판매 변동성",
    ],
    suggestedPrompts: [
      "애보트에서 프리스타일 리브레, 진단, 영양, 의료기기, 기존 의약품의 매출 동인과 실적 변화를 공시 기준으로 비교해줘.",
      "애보트의 의료기기, 진단, 영양을 사업부별로 나눠 매출총이익률, 현금창출력, 비용 구조 차이를 정리해줘.",
      "애보트의 환율, 원가, 연구개발·판관비 압박이 성장 논지를 어떻게 흔드는지 체크포인트 중심으로 공시 근거와 함께 정리해줘.",
    ],
    questionChains: {},
  },
  ADBE: {
    ticker: "ADBE",
    companyName: "Adobe Inc.",
    companyNameKo: "어도비",
    sectorKo: "소프트웨어·디지털 미디어",
    signature:
      "크리에이티브 클라우드, 도큐먼트 클라우드, 익스피리언스 클라우드 포트폴리오를 기반으로 한 구독 성장과 AI 투자 강도가 실적의 핵심 축이며, 제3자 호스팅·데이터센터 비용이 마진 가이드로 작동합니다.",
    description:
      "기업 리포트: 크리에이티브 클라우드, 도큐먼트 클라우드, 디지털 미디어·디지털 경험·익스피리언스 클라우드 제품군의 성장 동인, 파이어플라이 기반 AI 확산, 구독 수익 구조, 제3자 호스팅·데이터센터 및 AI 추론 비용이 매출총이익률에 미치는 영향을 함께 봅니다.",
    researchFocus: [
      "크리에이티브 클라우드",
      "도큐먼트 클라우드",
      "익스피리언스 클라우드",
      "디지털 미디어",
      "디지털 경험",
      "파이어플라이",
      "구독형 수익(연간 반복매출)",
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
      "어도비에서 크리에이티브 클라우드, 도큐먼트 클라우드, 익스피리언스 클라우드 포트폴리오 중 어떤 제품군이 구독 성장에 가장 크게 기여하는지 공시 기준으로 정리해줘.",
      "어도비의 크리에이티브 연간 반복매출, 도큐먼트 연간 반복매출, 파이어플라이 적용 확대가 매출 확장과 현금흐름에 어떻게 반영되는지 공시 근거로 비교해줘.",
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
      "아날로그·혼합신호와 전력관리 수요의 확대가 성장 논지의 핵심이며, 산업·자동차 수요의 속도와 공급망 조달 효율이 마진 경로를 좌우합니다.",
    description:
      "기업 리포트: 아날로그·혼합신호와 전력관리 포트폴리오를 중심으로 산업·자동차 수요 전개, 공급망 조달 안정성, 재고 구매 약정, 연구개발·보상비 구조를 함께 점검합니다.",
    researchFocus: [
      "아날로그·혼합신호 및 전력관리 수요",
      "산업·자동차 수요 성장",
      "공급망 조달(납기·가격·품질) 안정성",
      "재고 구매 약정과 운영 자본 부담",
    ],
    riskVariables: [
      "핵심 조달처 납기·가격·품질 변동",
      "재고 구매 약정 부담과 재고 회전 저하",
      "산업·자동차 수요 순환성",
      "연구개발·인재 보상 비용 상승",
    ],
    suggestedPrompts: [
      "아날로그 디바이시스에서 아날로그·혼합신호, 전력관리, 산업·자동차 수요가 매출 성장을 각각 어떻게 견인하는지 공시 기준으로 정리해줘.",
      "아날로그 디바이시스의 산업·자동차 수요 변화가 전력관리와 아날로그 제품군의 매출총이익률·현금흐름에 미치는 차이를 비교해줘.",
      "핵심 공급망 차질, 재고 구매 약정, 연구개발·보상비 구조가 ADI 성장 논지와 영업이익률에 어떤 압박을 주는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AMAT: {
    ticker: "AMAT",
    companyName: "Applied Materials, Inc.",
    companyNameKo: "어플라이드 머티어리얼즈",
    sectorKo: "반도체 장비",
    signature:
      "반도체 시스템의 웨이퍼 제조 장비 수요와 글로벌 서비스 매출이 성장 논지의 핵심 축이고, 고객 투자 사이클과 연구개발이 마진 경로를 좌우합니다.",
    description:
      "공시 기준 기업 리포트: 반도체 장비 수익화(웨이퍼 제조 장비), 글로벌 서비스(서비스·예비부품·업그레이드), 고객 투자 사이클을 함께 보아 성장 논지와 수익성 변동을 추적합니다.",
    researchFocus: [
      "반도체 시스템과 글로벌 서비스 수익 구조",
      "웨이퍼 제조 장비 수요와 고객 투자 주기",
      "서비스·예비부품·업그레이드를 통한 매출 안정성",
      "연구개발·수율·공급망이 마진 전달에 미치는 영향",
    ],
    riskVariables: [
      "중국 수출통제와 인허가 지연이 주문과 수익성에 미치는 충격",
      "고객 주문 변동성 및 조달 병목으로 인한 반도체 장비 납기 리스크",
      "부품·원재료·운송비 변동과 수율 변동이 마진을 잠식할 가능성",
      "규제 준수 비용 및 법률 리스크가 영업 안정성에 미치는 부담",
    ],
    suggestedPrompts: [
      "어플라이드 머티어리얼즈에서 반도체 시스템(웨이퍼 제조 장비)와 글로벌 서비스의 수익원이 공시 기준에서 어떻게 나뉘는지, 성장 논지와 어떤 연관인지 정리해줘.",
      "어플라이드 머티어리얼즈의 최근 공시 기준 반도체 시스템과 글로벌 서비스 영업마진 추세를 비교하고, 성장 논지·비용 구조 차이를 구체적으로 설명해줘.",
      "어플라이드 머티어리얼즈의 중국 수출통제, 고객 주문 변동, 공급망 리스크가 현금흐름, 마진, 연구개발 투자 여력에 어떤 순서로 영향을 주는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AMD: {
    ticker: "AMD",
    companyName: "Advanced Micro Devices, Inc.",
    companyNameKo: "에이엠디",
    sectorKo: "반도체·데이터센터",
    signature:
      "AI 인프라의 데이터센터 GPU와 에픽 서버 CPU가 성장 축이며, 라이젠·라데온은 수요 둔화 민감도가 큰 보조 축입니다. 웨이퍼·기판 조달과 수출통제가 마진·현금흐름 변동성의 핵심입니다.",
    description:
      "기업 리포트: 데이터센터 GPU(인스팅트 MI300 계열)와 에픽 채택률, 라이젠·라데온 믹스, 웨이퍼·기판 조달 상태, 미국 수출통제 제약 경로를 함께 보며 성장성·마진·투자 부담을 연결해 해석합니다.",
    researchFocus: [
      "데이터센터 GPU(인스팅트 MI300)와 에픽 수요",
      "라이젠·라데온의 출하·가격 전가력",
      "웨이퍼·기판 조달과 재고 전환 속도",
      "클라우드 고객사 약정 구조와 AI 인프라 전환 속도",
    ],
    riskVariables: [
      "수출통제 국가군 변경으로 인한 고성능 데이터센터 GPU·에픽 판매 제약",
      "웨이퍼·기판 조달 병목과 납기 연장",
      "클라우드 고객사 설비투자 조정과 선수요 하락이 매출 타이밍에 미치는 영향",
      "라이젠·라데온 수요 변동이 마진·영업현금흐름 완충력을 떨어뜨리는 채널",
    ],
    suggestedPrompts: [
      "에이엠디에서 데이터센터 GPU·에픽이 성장의 중심이고 라이젠·라데온이 어떤 변동축인지 공시 기준으로 분리해 정리해줘.",
      "에이엠디의 인스팅트 MI300 수요, 웨이퍼·기판 조달, 클라우드 고객사 약정이 매출총이익률과 영업현금흐름에 어떤 경로로 반영되는지 비교해줘.",
      "에이엠디의 수출통제, 웨이퍼·기판 병목, 클라우드 고객사 설비투자 둔화가 성장 논지를 제약할 가능성이 높은 구간을 어떤 지표로 점검해야 하는지 정리해줘.",
    ],
    questionChains: {},
  },
  AMGN: {
    ticker: "AMGN",
    companyName: "Amgen Inc.",
    companyNameKo: "암젠",
    sectorKo: "바이오의약품",
    signature:
      "엔브렐, 프롤리아, 레파타, 오테즐라, 테페자를 포함한 핵심 바이오의약품의 매출 가시성, 호라이즌 자산 통합 성과, 파이프라인 상업화와 제조·공급 효율이 성장 논지의 핵심을 이룹니다.",
    description:
      "기업 리포트: 엔브렐·프롤리아·레파타·오테즐라·테페자의 제품군 매출 흐름, 호라이즌 통합 성과, 파이프라인 상업화 속도, IRA·메디케어 및 바이오시밀러 환경이 매출총이익률과 현금흐름에 미치는 영향을 함께 봅니다.",
    researchFocus: [
      "엔브렐·프롤리아 중심 매출 성장 동인",
      "레파타·오테즐라·테페자 포트폴리오 기여",
      "호라이즌 자산 통합 성과",
      "파이프라인 상업화와 제조·공급망 효율",
    ],
    riskVariables: [
      "IRA·메디케어 가격 협상 및 환급 압력",
      "약가·리베이트 정책 변화",
      "바이오시밀러 진입과 가격 경쟁 심화",
      "규제 승인 일정 지연 및 임상 실패",
    ],
    suggestedPrompts: [
      "암젠에서 엔브렐·프롤리아·레파타·오테즐라·테페자가 성장 논지를 어떻게 구성하는지, 공시 기준으로 매출 기여도를 정리해줘.",
      "암젠의 핵심 제품군 수익화, 호라이즌 통합 성과, 파이프라인 상업화 진행이 마진·현금흐름·투자 부담에 어떤 차이를 주는지 비교해줘.",
      "암젠의 IRA·메디케어 가격 협상, 약가·리베이트 압력, 바이오시밀러 경쟁이 성장 논지에 미치는 부담 요인을 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AMZN: {
    ticker: "AMZN",
    companyName: "Amazon.com, Inc.",
    companyNameKo: "아마존",
    sectorKo: "이커머스·클라우드",
    signature:
      "북미·해외, AWS, 프라임, 광고, 제3자 판매자 서비스, 주문처리의 구조적 연동이 매출 성장·매출총이익률·현금흐름을 가르는 핵심입니다.",
    description:
      "기업 리포트: 북미·해외 리테일의 매출 구성, AWS의 사용량·요금·마진 구조, 프라임 구독·광고 성장, 제3자 판매자 서비스와 주문처리 비용 구조를 공시 기준으로 함께 봅니다.",
    researchFocus: [
      "북미·해외 리테일",
      "AWS 클라우드 서비스",
      "프라임·광고",
      "제3자 판매자 서비스 및 주문처리 효율",
    ],
    riskVariables: [
      "인건비와 운영 효율 악화",
      "운송·에너지·포장재 비용 변동",
      "가격 전가력 약화와 리테일 경쟁 압박",
      "환율·규제·국가별 세제 변화에 따른 수익성 변동",
    ],
    suggestedPrompts: [
      "아마존의 북미·해외 리테일, AWS, 프라임, 광고, 제3자 판매자 서비스가 매출과 매출총이익률을 어떻게 분해해 만들고 있는지 공시 기준으로 정리해줘.",
      "아마존의 AWS와 북미·해외 중 어떤 축이 영업이익률, 현금흐름, 투자 부담에 더 큰 변동성을 만들었는지 비교해줘.",
      "아마존의 인건비·운송·에너지·포장재 비용 압력, 환율·규제 리스크가 주문처리와 제3자 판매자 서비스 기반 성장 논지를 어떻게 제약하는지 공시 근거로 점검해줘.",
    ],
    questionChains: {},
  },
  ANET: {
    ticker: "ANET",
    companyName: "Arista Networks, Inc.",
    companyNameKo: "아리스타 네트웍스",
    sectorKo: "클라우드 네트워킹",
    signature:
      "클라우드비전·AI 네트워킹 중심 포트폴리오와 데이터센터·캠퍼스 네트워킹 수요 축이 성장과 마진 방향을 함께 설명합니다.",
    description:
      "기업 리포트: 클라우드비전, 이더넷 스위칭, AI 네트워킹의 제품·소프트웨어 결합 수요, 데이터센터와 캠퍼스 스위칭의 투자 주기, 라이선스·서비스 비중 변화를 함께 보며 매출총이익률과 현금흐름을 점검합니다.",
    researchFocus: [
      "클라우드비전 기반 AI 네트워킹 수익 구조",
      "이더넷 스위칭 데이터센터 수요",
      "캠퍼스 스위칭 성장·교체 흐름",
      "대형 클라우드 고객군의 프로젝트 수주 주기",
      "부품 조달·재고 운영과 가격·마진 압력",
      "보안·운영 신뢰성 요구와 제품 업그레이드 수요",
    ],
    riskVariables: [
      "대형 클라우드 고객 설비투자 변동과 데이터센터 투자 사이클",
      "이더넷 스위칭 가격경쟁 및 단가 하향 압력",
      "부품 조달 병목, 리드타임 지연",
      "보안·안정성 이슈가 수요 전환으로 연결될 위험",
    ],
    suggestedPrompts: [
      "아리스타 네트웍스의 클라우드비전, EOS, AI 네트워킹 포트폴리오가 데이터센터와 캠퍼스 스위칭에서 어떤 비중으로 성장에 기여하는지 공시 기준으로 정리해줘.",
      "아리스타의 이더넷 스위칭 장비 판매, 소프트웨어 결합, 서비스 매출이 매출총이익률과 현금흐름에 어떤 구조로 반영되는지 비교해줘.",
      "아리스타의 대형 클라우드 고객 수요 변동, 부품 조달 병목, 가격경쟁 리스크가 성장 논지를 어떻게 제약하거나 지지하는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  AVGO: {
    ticker: "AVGO",
    companyName: "Broadcom Inc.",
    companyNameKo: "브로드컴",
    sectorKo: "반도체·인프라 소프트웨어",
    signature:
      "브로드컴의 핵심은 반도체 솔루션, 인프라 소프트웨어, VM웨어, AI 네트워킹 축입니다. 성장 논지는 브로드컴이 AI 네트워킹, 맞춤형 반도체, 무선, 브로드밴드 수요를 얼마나 빠르게 연결하느냐에 달려 있습니다.",
    description:
      "기업 리포트: 브로드컴의 반도체 솔루션과 인프라 소프트웨어 매출이 어떻게 함께 성장을 만들어내는지, VM웨어 통합이 비용 구조와 현금흐름에 미치는 영향을 함께 봅니다.",
    researchFocus: [
      "반도체 솔루션 매출",
      "인프라 소프트웨어 수익성",
      "VM웨어 통합 효과",
      "AI 네트워킹 수요",
      "맞춤형 반도체, 무선, 브로드밴드 노출",
    ],
    riskVariables: [
      "VM웨어 통합 비용 절감 지속성",
      "총부채와 금리 부담",
      "고객 설비투자 타이밍과 수요 변동",
      "수출규제 및 지정학·공급망 리스크",
    ],
    suggestedPrompts: [
      "브로드컴의 반도체 솔루션, 인프라 소프트웨어, VM웨어 통합이 성장 논지에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "브로드컴의 AI 네트워킹, 맞춤형 반도체, 무선, 브로드밴드 주문 변화가 매출총이익률과 영업현금흐름에 어떤 의미가 있는지 비교해줘.",
      "브로드컴의 VM웨어 통합 효과, 총부채·금리 부담, 고객 수요 변동이 성장 논지와 투자 부담에 어떤 제약을 주는지 공시 언어 중심으로 분석해줘.",
    ],
    questionChains: {},
  },
  AXP: {
    ticker: "AXP",
    companyName: "American Express Company",
    companyNameKo: "아메리칸 익스프레스",
    sectorKo: "결제·카드 네트워크",
    signature:
      "카드회원의 지출 활동, 청구 거래액에서 파생되는 가맹점 수수료 매출, 카드 포트폴리오의 신용손실이 성장성과 마진 안정성을 동시에 결정합니다.",
    description:
      "기업 리포트: 카드회원 지출과 이탈, 가맹점 네트워크 가맹점 수수료 매출, 프리미엄 카드 확대와 멤버십 리워드 연계 효과, 신용 포트폴리오의 신용손실를 함께 봅니다.",
    researchFocus: [
      "카드회원 활동과 청구 거래액 성장",
      "가맹점 기반 가맹점 수수료 매출 구조",
      "멤버십 리워드와 프리미엄 카드 유지율",
      "카드 포트폴리오의 신용손실 및 신용비용 추세",
    ],
    riskVariables: [
      "카드회원 지출 둔화와 가격 민감도 상승",
      "고금리 환경에서 가처분소득 둔화로 인한 거래·이익 압박",
      "멤버십 리워드·보상비 상승과 프리미엄 카드 비용 효율 저하",
      "신용손실 확대와 대출 포트폴리오 건전성 악화",
    ],
    suggestedPrompts: [
      "아메리칸 익스프레스의 카드회원 지출, 청구 거래액, 가맹점 가맹점 수수료 매출이 영업 실적과 어떤 채널로 연결되는지 공시 기준으로 정리해줘.",
      "아메리칸 익스프레스의 프리미엄 카드·멤버십 리워드 전략이 카드회원당 매출, 할인율, 가맹점 수수료 매출에 어떤 실적 효과를 주는지 비교해줘.",
      "아메리칸 익스프레스의 금리·소비 환경 변화가 카드 포트폴리오와 신용손실에 미치는 영향이 성장 논지에 어떻게 반영되는지 파악해줘.",
    ],
    questionChains: {},
  },
  BAC: {
    ticker: "BAC",
    companyName: "Bank of America Corporation",
    companyNameKo: "뱅크오브아메리카",
    sectorKo: "은행",
    signature:
      "순이자수익, 소비자금융의 자금중개, 글로벌 자산관리의 수수료 기반 성장 구조가 핵심 축입니다.",
    description:
      "기업 리포트: 소비자금융, 글로벌 자산관리, 글로벌 은행, 글로벌 마켓 네 채널을 축으로 순이자수익과 수수료 수익을 조합해 성장을 설명합니다. 예금과 대출의 스프레드, 자본배분, 거래·자산운용 민감도를 함께 봅니다.",
    researchFocus: [
      "순이자수익과 소비자금융의 예금·대출 조합",
      "글로벌 자산관리의 자산운용·중개 수수료",
      "글로벌 은행의 기업금융·자본 조달 수수료",
      "글로벌 마켓, 파생상품 거래, MBS·ABS 민감도",
    ],
    riskVariables: [
      "금리 경로 변화에 따른 예금 비용과 대출 성장률 압력",
      "MBS·ABS 조기상환 및 공정가치 변동",
      "신용손실과 회수율 하락이 대출 포트폴리오 건전성에 미치는 영향",
      "규제 자본·유동성 규제 강도와 운영비·기술 비용 부담",
    ],
    suggestedPrompts: [
      "뱅크오브아메리카에서 소비자금융, 글로벌 자산관리, 글로벌 은행, 글로벌 마켓이 순이자수익, 수수료, 거래수익에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "뱅크오브아메리카의 예금과 대출 변화가 순이자수익에 미치는 영향과, MBS·ABS 운영이 자본과 수익성에 어떤 제약을 주는지 비교해줘.",
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
      "Booking.com, Priceline, Agoda, Rentalcars.com, OpenTable 등 핵심 플랫폼에서 숙박일수가 수익의 직접 축이 되고, 가맹점·대행 모델 효율과 광고 및 기타 매출이 마진을 결정합니다.",
    description:
      "기업 리포트: 예약 거래의 숙박일수 기반 흐름을 중심으로 Booking.com, Priceline, Agoda, Rentalcars.com, OpenTable의 비즈니스 구조를 점검하고, 성과형 마케팅 및 광고 및 기타 매출 흐름을 함께 추적해 성장성과 마진 지속성을 평가합니다.",
    researchFocus: [
      "숙박일수 성장, 플랫폼 트래픽·예약 전환, 수익 연계",
      "가맹점·대행 모델별 매출 인식 경로",
      "Booking.com·Priceline·Agoda·Rentalcars.com·OpenTable 채널별 점유율 변화",
      "광고 및 기타 매출 및 성과형 마케팅 효율",
    ],
    riskVariables: [
      "국제 여행 수요와 숙박일수 변동성",
      "성과형 마케팅비 상승 및 고객획득 효율 둔화",
      "환율 변동과 현지 가격 경쟁력 압박",
      "여행 플랫폼 규제, 세무·데이터 규제, 파트너 정책 변화",
    ],
    suggestedPrompts: [
      "부킹 홀딩스에서 Booking.com, Priceline, Agoda, Rentalcars.com, OpenTable의 숙박일수 성장이 어떤 채널로 매출과 이익으로 연결되는지 공시 기준으로 정리해줘.",
      "부킹 홀딩스의 가맹점과 대행 모델에서 수익·원가 경로와 현금흐름 차이를 비교해줘.",
      "부킹 홀딩스의 광고 및 기타 매출과 성과형 마케팅비가 성장 논지에 미치는 영향을 공시 흐름 기준으로 정리해줘.",
    ],
    questionChains: {},
  },
  BLK: {
    ticker: "BLK",
    companyName: "BlackRock, Inc.",
    companyNameKo: "블랙록",
    sectorKo: "자산운용",
    signature:
      "블랙록은 운용자산, 순유입, 상품 채널, 수수료 구조를 통해 수익 방향이 갈리는 글로벌 자산운용사입니다.",
    description:
      "기업 리포트: 운용자산과 순유입·순유출, iShares·ETF 기반 성장 동력, Aladdin·자문 기반 수익, 기본 수수료와 성과 수수료의 조합을 함께 봅니다.",
    researchFocus: [
      "운용자산과 순유입·순유출",
      "iShares·ETF 상품군",
      "Aladdin·자문·기술 서비스",
      "기본 수수료와 성과 수수료 분해",
    ],
    riskVariables: [
      "시장 가격 변동에 따른 운용자산 및 순유입 민감도",
      "지수 기반 vs 액티브 기반 비중 변동과 수수료 압박",
      "인재 유지 비용 및 기술 투자 부담",
      "규제 강화와 고객 이탈 리스크",
    ],
    suggestedPrompts: [
      "블랙록의 운용자산, 순유입·순유출, iShares·ETF 상품 채널이 수수료 수익으로 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "블랙록의 Aladdin과 자문 사업이 어디서 수익으로 이어지며, 기본 수수료와 성과 수수료로 어떻게 나뉘는지 매출 구조적으로 설명해줘.",
      "블랙록의 시장 사이클에서 성장 논지가 흔들리는 구간과 견조해지는 구간을 운용자산, iShares, 수수료 조합 관점에서 정리해줘.",
    ],
    questionChains: {},
  },
  C: {
    ticker: "C",
    companyName: "Citigroup Inc.",
    companyNameKo: "씨티그룹",
    sectorKo: "은행",
    signature:
      "씨티의 핵심은 은행·마켓·자산관리·서비스에서 기인한 수익 구조이며, 순이자수익, 신용 비용, 규제 자본 운용이 이익 변동성을 좌우합니다.",
    description:
      "기업 리포트: 은행, 마켓, 자산관리, 서비스를 축으로 수익원과 비용 흐름을 분해하고, 미국 개인금융의 신용·유동성 특성과 자본 여력을 함께 분석해 실제 실적 전이를 확인합니다.",
    researchFocus: [
      "은행, 마켓, 자산관리 수익 구조의 실제 연결",
      "미국 개인금융 신용 포트폴리오와 수익성",
      "재무·무역 솔루션 및 글로벌 결제·자금조달 흐름",
      "서비스, 수수료 기반 수익과 자산·부채 조달 믹스",
    ],
    riskVariables: [
      "신용 비용 증가 시 수익성 및 자본 여력 훼손",
      "금리 경로 변화가 순이자수익에 미치는 민감도",
      "마켓 손익 변동성과 수익 변동성 확대",
      "규제 환경 변화가 규제 자본과 성장 투자 여력에 미치는 제약",
    ],
    suggestedPrompts: [
      "씨티그룹의 은행, 마켓, 자산관리, 서비스 영업 구조를 공시 기준으로 나눠보고 수익·비용이 어느 라인에서 발생하는지 연결해줘.",
      "씨티그룹의 미국 개인금융에서 대출 성장, 이탈, 신용 관리가 신용비용으로 어떻게 이어지는지 공시 기준으로 점검해줘.",
      "씨티그룹의 마켓 손익과 순이자수익 변화를 규제·자본 제약 관점에서 보고, 규제 자본과 배당 여력의 제약 요인을 정리해줘.",
    ],
    questionChains: {},
  },
  CAT: {
    ticker: "CAT",
    companyName: "Caterpillar Inc.",
    companyNameKo: "캐터필러",
    sectorKo: "산업기계",
    signature:
      "건설산업과 자원산업 수요, 에너지·운송의 프로젝트 성격, 캣 금융 동반 판매가 실적의 구조적 변동축입니다. 딜러 재고와 수주잔고가 수요 선행 신호로 작동하는지가 핵심입니다.",
    description:
      "기업 리포트: 건설산업, 자원산업, 에너지·운송의 장비·부품·서비스 매출 연결, 캣 금융 자금조달 구조, 딜러 재고와 수주잔고의 상호작용을 함께 분석합니다.",
    researchFocus: [
      "건설산업 프로젝트 수주·출하 모멘텀",
      "자원산업 광산 장비의 지역·사이클별 수요",
      "에너지·운송 엔진·시설 장비·정비 수요",
      "캣 금융의 신용 조건과 장비 판매 연동",
    ],
    riskVariables: [
      "원자재·부품 가격 변동과 가격 전가력 둔화",
      "딜러 재고 조정 지연에 따른 생산·출하 제약",
      "수주잔고 축소와 프로젝트 지연으로 인한 매출 집행 충격",
      "캣 금융 신용조건 변화로 인한 회수율·현금흐름 압박",
      "공급망·환율 변동이 장비 구성비와 마진에 미치는 영향",
    ],
    suggestedPrompts: [
      "캐터필러의 건설산업과 자원산업 수주·출하가 딜러 재고와 수주잔고 변화와 함께 실적에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "캣 금융이 장비 리스·대출 조건에 어떻게 결합되어 고객 구매력, 회수율, 현금흐름에 영향을 주는지 구체적으로 설명해줘.",
      "에너지·운송 장비·부품·서비스 매출이 매출총이익률과 영업이익률 경로에 미치는 영향을 성장 논지 관점에서 정리해줘.",
    ],
    questionChains: {},
  },
  COST: {
    ticker: "COST",
    companyName: "Costco Wholesale Corporation",
    companyNameKo: "코스트코",
    sectorKo: "창고형 리테일",
    signature:
      "창고형 리테일 기반의 멤버십 모델에서 상품 회전율과 멤버십 수수료를 동시에 지탱해야 수익성이 유지됩니다.",
    description:
      "기업 리포트: 창고형 리테일 매출, 멤버십 수수료, 상품 조달·물류비, 가격 전략이 매출총이익률·영업이익률에 어떻게 연결되는지 확인합니다. 비교매장매출, 자체브랜드(커클랜드 시그니처) 비중, 점포·회원 확대 속도와 함께 성장의 질을 점검합니다.",
    researchFocus: [
      "멤버십 수수료와 멤버십 갱신율(갱신율) 유지력",
      "창고형 리테일 매출 구조와 비교매장매출 동향",
      "자체브랜드(커클랜드 시그니처) 상품 믹스와 마진 기여",
      "상품 조달·물류비, 연료·에너지비와 비용 관리",
    ],
    riskVariables: [
      "상품 원가 및 물류비 상승이 매출총이익률에 미치는 영향",
      "가격 경쟁 심화와 판매량·마진 압박",
      "비교매장매출 둔화와 트래픽 약화",
      "멤버십 갱신율(갱신율) 하락에 따른 멤버십 수수료 수익성 리스크",
    ],
    suggestedPrompts: [
      "코스트코의 멤버십 수수료, 창고형 리테일 매출, 창고형 매장 확장이 영업이익률에 어떤 경로로 반영되는지 공시 기준으로 정리해줘.",
      "코스트코의 비교매장매출과 자체브랜드(커클랜드 시그니처) 매출 비중, 상품 조달·물류비가 원가 구조와 마진 방어에 미치는 영향을 분석해줘.",
      "코스트코의 갱신율, 가격 전략, 비용 구조가 성장 논지의 지속성에 어떤 제약과 완충을 주는지 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  CSCO: {
    ticker: "CSCO",
    companyName: "Cisco Systems, Inc.",
    companyNameKo: "시스코",
    sectorKo: "네트워킹 장비",
    signature:
      "네트워크 성장은 AI 인프라 수요가 견인하고, 보안·관측성 믹스와 구독 전환이 마진과 현금흐름 방향을 가릅니다.",
    description:
      "기업 리포트: 네트워킹(라우팅·스위칭·무선)과 AI 인프라 성장, 보안·관측성 수익 추이, 구독 전환, 잔여수행의무 및 이연매출의 선행성 신호를 함께 점검합니다.",
    researchFocus: [
      "네트워킹과 AI 인프라 성장 모멘텀",
      "보안 및 관측성 믹스 변화",
      "구독 확대와 이탈률·갱신 민감도",
      "잔여수행의무의 수익 선행성",
    ],
    riskVariables: [
      "AI 수요 둔화가 네트워크 제품 믹스와 매출총이익률로 전이되는 속도",
      "보안과 관측성에서 Splunk 소비 전환이 제품 수익성에 미치는 영향",
      "서비스 매출총이익률 하락 요인의 지속성",
      "컴포넌트 수급 및 제조 비용 변동이 주문 이행·가격 전가에 미치는 압박",
    ],
    suggestedPrompts: [
      "시스코의 네트워킹 카테고리(라우팅·스위칭·무선)와 AI 인프라가 매출 성장과 매출총이익률에 어떤 경로로 기여했는지 공시 기준으로 정리해줘.",
      "시스코의 보안·관측성 카테고리에서 Splunk가 온프레미스에서 클라우드 구독으로 이동한 흐름이 수익 구성과 성장 동인에 어떤 영향을 줬는지 공시 근거로 비교해줘.",
      "시스코의 구독, 잔여수행의무, 이연매출이 향후 성장 가시성과 리스크 프레임을 어떻게 바꾸는지 점검해줘.",
    ],
    questionChains: {},
  },
  DE: {
    ticker: "DE",
    companyName: "Deere & Company",
    companyNameKo: "디어",
    sectorKo: "농업·건설 장비",
    signature:
      "생산·정밀농업, 소형농업·잔디관리, 건설·임업의 판매 주기와 금융 서비스의 신용 여건이 실적 민감도를 함께 결정합니다.",
    description:
      "기업 리포트: 생산·정밀농업, 소형농업·잔디관리, 건설·임업 수요 변동과 금융 서비스 자금 여건을 함께 보며, 농산물 가격·금리 환경, 딜러 재고, 중고 장비 회전까지 연결해 해석합니다.",
    researchFocus: [
      "생산·정밀농업",
      "소형농업·잔디관리",
      "건설·임업",
      "금융 서비스",
      "딜러 재고",
      "중고 장비",
    ],
    riskVariables: [
      "농산물 가격 변동과 농가 현금흐름 연동",
      "금리·스프레드, 신용 포트폴리오, 신용손실",
      "정부 보조금·무역 정책 변화에 따른 지역 수요 변동",
      "딜러 재고 변동, 중고 장비 전환과 출하 타이밍 충돌",
    ],
    suggestedPrompts: [
      "디어의 생산·정밀농업, 소형농업·잔디관리, 건설·임업가 매출 믹스와 매출총이익률에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "디어 금융 서비스의 신용 포트폴리오, 금리 스프레드, 대손비, 자본비용이 장비 판매 사이클과 현금흐름에 어떤 영향을 주는지 공시 근거로 비교해줘.",
      "디어의 딜러 재고와 중고 장비 흐름이 성장 논지의 선행 신호가 되는지, 그리고 농산물 가격·금리 조합이 실적 전개를 어떻게 바꾸는지 정리해줘.",
    ],
    questionChains: {},
  },
  DHR: {
    ticker: "DHR",
    companyName: "Danaher Corporation",
    companyNameKo: "다나허",
    sectorKo: "생명과학·진단",
    signature:
      "생명과학, 진단, 바이오공정 축에서 장비·소모품·서비스로 이어지는 반복매출 구조가 실적 안정성의 핵심입니다.",
    description:
      "기업 리포트: 다나허는 생명과학과 진단에서 플랫폼 기반 장비를 쌓은 뒤 소모품과 서비스로 지속 수익을 확보하는 구조가 강합니다. Cepheid 계열 진단 자산, M&A 포트폴리오 조정, 가격 전가 속도, 공급 조달 안정성, 인건비 동향이 반복매출의 질과 마진 방어력을 좌우합니다.",
    researchFocus: [
      "생명과학",
      "진단",
      "바이오공정",
      "Cepheid",
      "반복매출",
      "M&A·포트폴리오 전환",
    ],
    riskVariables: [
      "공급 병목 및 조달 리드타임이 진단 장비·소모품 가용성에 주는 충격",
      "인건비와 생산비 상승이 반복매출의 매출총이익률에 미치는 영향",
      "가격 전가 지연과 고객 비용 절감 압력에 대한 대응 속도",
      "규제·허가 환경 변화가 Cepheid 기반 수요 타이밍과 성장 논지에 미치는 영향",
    ],
    suggestedPrompts: [
      "다나허의 생명과학, 진단, 바이오공정 사업에서 반복매출이 장비·소모품·서비스로 어떻게 쌓이는지 공시 기준으로 정리해줘.",
      "다나허의 Cepheid 진단 라인업이 소모품 회수율, 장비 업그레이드 수요, 가격 전가와 어떻게 연결되는지 공시 기준으로 비교해줘.",
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
      "콘텐츠 IP와 체험 비즈니스를 중심으로 파크·체험·제품, 엔터테인먼트, DTC가 각기 다른 성장 동인과 마진 경로를 만듭니다.",
    description:
      "기업 리포트: 파크·체험·제품, 엔터테인먼트, DTC(Disney+, Hulu)로 구분해 구독·광고·라이선스 수익을 추적하고, ESPN과 선형 네트워크, 콘텐츠 비용의 상호작용을 함께 봅니다.",
    researchFocus: [
      "파크·체험·제품",
      "DTC(Disney+, Hulu)",
      "ESPN 중심 엔터테인먼트",
      "선형 네트워크와 광고·라이선스",
    ],
    riskVariables: [
      "스포츠 중계권 갱신 비용과 콘텐츠 비용 부담",
      "테마파크 방문객 복원 속도와 체류·객단가 민감도",
      "구독 플랫폼의 유지율, 가격 인상 수용도, 마케팅 효율",
      "선형 광고 시장 회복 속도와 ESPN·콘텐츠 편성 수익",
    ],
    suggestedPrompts: [
      "월트디즈니의 파크·체험·제품, DTC(Disney+, Hulu), 엔터테인먼트가 수익과 마진을 어떻게 만드는지 공시 관점으로 정리해줘.",
      "Disney+, Hulu, ESPN, 선형 네트워크의 매출원(구독·광고·라이선스)과 콘텐츠 비용이 영업이익률에 미치는 영향을 비교해줘.",
      "월트디즈니의 파크·체험·제품 수요 회복 속도, 스포츠 중계권 비용, DTC 유지율 변화가 성장 논지의 제약 요인이 되는 이유를 정리해줘.",
    ],
    questionChains: {},
  },
  ETN: {
    ticker: "ETN",
    companyName: "Eaton Corporation plc",
    companyNameKo: "이튼",
    sectorKo: "전력관리·산업장비",
    signature:
      "미주 전기 사업과 글로벌 전기 사업의 수주잔고가 매출 기반을 형성하고, 항공우주·전기차 모빌리티·데이터센터 성장성의 분기점을 함께 판단해야 합니다.",
    description:
      "기업 리포트: 미주 전기 사업, 글로벌 전기 사업, 항공우주, 전기차 모빌리티 수요를 분리해 해석하고, 수주잔고의 안정성, 매출총이익률, 현금흐름의 연결고리를 핵심 판단축으로 봅니다.",
    researchFocus: [
      "미주 전기 사업·글로벌 전기 사업의 매출, 수주잔고, 영업이익 구조",
      "항공우주 수주 주기와 가격 전가력",
      "전기차 모빌리티의 제품 믹스, 투자 지연, 수익성 민감도",
      "데이터센터 전력 인프라와 전기화 수요 연계",
    ],
    riskVariables: [
      "공급망 변동과 원가 상방 압력이 마진에 미치는 영향",
      "수주잔고 전환 둔화가 영업이익률·현금흐름에 미치는 지연 효과",
      "항공우주 프로젝트 일정 변화와 산업별 가동률 둔화 충격",
      "규제·환율·금리 환경이 전기차 모빌리티·전력관리 장비 투자 판단에 미치는 제약",
    ],
    suggestedPrompts: [
      "이튼의 미주 전기 사업과 글로벌 전기 사업에서 수주잔고 증가가 매출 성장으로 얼마나 빠르게 연결되는지 세그먼트별로 공시 기준으로 정리해줘.",
      "이튼의 항공우주와 전기차 모빌리티에서 매출총이익률, 영업이익률, 현금흐름이 수요 채널별로 어떻게 달라지는지 비교 분석해줘.",
      "이튼의 데이터센터와 전기화 주문이 성장 논지에 주는 실제 의미를, 가격 전가력과 수주잔고 지속성 관점에서 공시 근거로 점검해줘.",
    ],
    questionChains: {},
  },
  GILD: {
    ticker: "GILD",
    companyName: "Gilead Sciences, Inc.",
    companyNameKo: "길리어드",
    sectorKo: "바이오의약품",
    signature:
      "HIV(Biktarvy), 종양학(Trodelvy), 세포치료, Veklury 수요가 실적의 좌우 축을 형성하며 IRA·메디케어 환급 환경이 성장 경로를 조정합니다.",
    description:
      "기업 리포트: HIV 포트폴리오(Biktarvy 중심), 종양학 상업화(Trodelvy), 세포치료 상용화 속도, Veklury 수요가 매출 믹스에 미치는 영향을 IRA·메디케어 가격·환급 환경과 함께 해석합니다.",
    researchFocus: [
      "HIV 포트폴리오(Biktarvy 중심)와 매출 믹스",
      "종양학(Trodelvy) 상업화 속도와 승인·접근성",
      "세포치료 제품군의 매출 전환과 현금회수율",
      "Veklury 수요 추이와 병원 수요 탄력성",
    ],
    riskVariables: [
      "IRA·메디케어 가격 협상 및 환급 구조 변화",
      "공급망 변동과 제조·물류 비용 압력",
      "HIV 제네릭, 경쟁 면역항암, 대체 치료제 확산",
      "보험 접근성 악화가 종양학 매출 전환율에 미치는 영향",
      "Veklury 수요 둔화와 시즌성 리스크",
    ],
    suggestedPrompts: [
      "길리어드의 HIV(Biktarvy 포함)와 Trodelvy 매출 조합이 매출 믹스에서 어떻게 이동했고 영업이익률에 어떤 영향을 줬는지 공시 기준으로 정리해줘.",
      "종양학에서 Trodelvy와 세포치료 상업화 속도 차이가 현금흐름과 재투자 여력에 어떤 경로로 반영되는지 비교해줘.",
      "IRA·메디케어 정책 변화가 Veklury와 HIV·종양학 제품군의 순매출, 할인, 회수속도에 미치는 부담을 구체적으로 정리해줘.",
    ],
    questionChains: {},
  },
  GEV: {
    ticker: "GEV",
    companyName: "GE Vernova Inc.",
    companyNameKo: "GE 버노바",
    sectorKo: "전력·그리드 장비",
    signature:
      "전력, 풍력, 전기화 3개 축이 결합되며 가스터빈, 그리드 인프라, 서비스에서 발생하는 순환 성장이 실적의 핵심입니다.",
    description:
      "기업 리포트: 전력·풍력·전기화 사업으로 운영되는 구조에서 전력은 가스·원자력·수력 장비와 서비스를, 풍력은 육상·해상 터빈 플랫폼을, 전기화는 송전·그리드 자동화·전력 변환·스토리지를 제공합니다. 장비 잔여수행의무와 서비스 잔여수행의무로 측정되는 수주잔고가 향후 매출·마진 선행지표가 되며, 계약부채/계약자산과 PP&E 투자 강도가 현금흐름과 성장 속도를 바꿉니다.",
    researchFocus: [
      "전력·풍력·전기화 실적 기여도",
      "잔여수행의무(수주잔고) 구성, 회수 속도, 대형 투자 프로젝트 영향",
      "가스터빈·트랜스포머·개폐장치 중심의 서비스 수익성",
      "계약가격 조정과 PP&E 투자 사이의 비용 구조 전이",
    ],
    riskVariables: [
      "오프쇼어 풍력 프로젝트 비용·완료 일정 지연과 클레임 리스크",
      "관세, 원자재·노동비 인플레이션이 가스 터빈·그리드 장비 마진에 미치는 압력",
      "장기 서비스 계약에 따른 계약부채/계약자산 변동성",
      "잔여수행의무 확대가 실제 현금화 속도로 이어지는지 여부",
    ],
    suggestedPrompts: [
      "GE 버노바의 전력, 풍력, 전기화별 잔여수행의무(장비 잔여수행의무·서비스 잔여수행의무)와 수주잔고가 성장 논지에 어떻게 반영되는지, 영업성과로 이어지는 경로를 공시 기준으로 정리해줘.",
      "GE 버노바의 가스터빈, 송전, 그리드 자동화, 스토리지 플랫폼과 서비스 매출이 매출총이익률·잉여 현금흐름에 미친 영향을 계약부채/계약자산 타이밍과 함께 비교해줘.",
      "오프쇼어 풍력과 대형 투자 프로젝트에서 발생하는 프로젝트 집행, 관세, 계약가격 조정 리스크가 마진과 성장 지속성에 어떤 부담으로 남는지 GE 버노바 기준으로 정밀 점검해줘.",
    ],
    questionChains: {},
  },
  GLW: {
    ticker: "GLW",
    companyName: "Corning Incorporated",
    companyNameKo: "코닝",
    sectorKo: "특수소재·광통신",
    signature:
      "광통신, 디스플레이 기술, 특수소재, 헴록의 실적 축이 매출 성장과 수익성 방향을 나눕니다.",
    description:
      "기업 리포트: 광통신은 AI·데이터센터 연결성 수요, 디스플레이 기술은 환율 조정과 가격 인상, 특수소재는 고릴라 글래스 중심의 프리미엄 수요, 헴록 및 신성장 사업은 폴리실리콘·태양광 모듈 확장을 통해 성장 논지를 구성합니다.",
    researchFocus: [
      "광통신의 AI, 데이터센터 상호연결, 통신사·기업 수요",
      "디스플레이 기술의 환율 민감도와 가격 인상",
      "특수소재와 고릴라 글래스 수요 구조",
      "헴록 및 신성장 사업의 폴리실리콘·태양광 성장축",
    ],
    riskVariables: [
      "일본 엔·FX 변동과 환산 영향",
      "원재료·장비 조달 병목과 제조 운영 차질",
      "디스플레이·광통신의 가격 경쟁과 가격 전가 한계",
      "헴록 램프업 비용 변동 및 최종시장 수요 둔화",
    ],
    suggestedPrompts: [
      "코닝의 광통신(기업·통신사·생성형 AI 인프라 수요)이 매출 구조와 성장 논지에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "코닝의 디스플레이 기술에서 환율 조정과 가격 인상이 매출, 판매량, 단가 전달에 미치는 영향을 비교해줘.",
      "코닝의 특수소재 중 고릴라 글래스와 헴록 및 신성장 사업(폴리실리콘·태양광 모듈)의 매출·비용 연결고리가 성장 논지와 현금흐름 판단에 어떤 의미가 있는지 정리해줘.",
    ],
    questionChains: {},
  },
  GOOG: {
    ticker: "GOOG",
    companyName: "Alphabet Inc.",
    companyNameKo: "알파벳",
    sectorKo: "검색·광고·클라우드",
    signature:
      "구글 검색과 유튜브 광고, 구글 클라우드가 기본 수익동학을 만들고 AI 투자와 데이터센터 확장이 매출총이익률·현금흐름·회수 속도에 동시에 작용합니다.",
    description:
      "기업 리포트: 구글 검색·유튜브 광고, 구글 클라우드, AI 전개, 데이터센터 운영비와 감가상각, 트래픽획득비용, 콘텐츠 획득 비용, 기타 사업의 수익성·현금흐름 민감도를 함께 점검합니다.",
    researchFocus: [
      "구글 검색·유튜브 광고",
      "구글 클라우드",
      "AI 데이터센터 투자",
      "트래픽획득비용 및 콘텐츠 획득 비용",
      "기타 사업",
    ],
    riskVariables: [
      "AI 경쟁 심화와 데이터센터 비용 가속",
      "트래픽획득비용·콘텐츠 획득 비용 변동",
      "광고 규제·경쟁 심화와 가격 전가 한계",
      "공급망 이슈와 AI 칩·컴퓨트 비용 변동",
      "기타 사업 적자 지속 가능성",
    ],
    suggestedPrompts: [
      "알파벳의 구글 검색과 유튜브 광고가 매출 성장을 얼마나 견인했는지, 광고 단가·트래픽·비용 구조를 공시 기준으로 정리해줘.",
      "구글 클라우드와 AI 데이터센터 투자 확대가 매출총이익률·현금흐름·현금성 비용 흐름에 어떤 방식으로 반영되는지 공시 기반으로 분석해줘.",
      "트래픽획득비용, 콘텐츠 획득 비용, 기타 사업의 손익이 알파벳의 성장 논지에 미치는 영향을 채널별로 분리해 투자 포인트로 정리해줘.",
    ],
    questionChains: {},
  },
  GOOGL: {
    ticker: "GOOGL",
    companyName: "Alphabet Inc.",
    companyNameKo: "알파벳",
    sectorKo: "검색·광고·클라우드",
    signature:
      "구글 검색과 유튜브, 구글 클라우드가 성장 축인 가운데, AI·데이터센터 확장과 트래픽획득비용이 영업 효율을 좌우하는 구조입니다.",
    description:
      "기업 리포트: 구글 검색·유튜브 광고(광고), 구글 클라우드 성장성, AI 인프라 투자의 데이터센터 부담, 트래픽획득비용, 기타 사업의 현금 소모 특성을 함께 봅니다.",
    researchFocus: [
      "구글 검색",
      "유튜브 광고",
      "구글 클라우드",
      "AI·데이터센터·트래픽획득비용",
    ],
    riskVariables: [
      "AI 확산을 위한 데이터센터 설비투자 및 운영비 증가",
      "트래픽획득비용·라이선스 비용의 변동",
      "구글 검색·유튜브 광고 경쟁 압력과 규제 노출",
      "기타 사업의 적자 지속과 현금흐름 소진",
    ],
    suggestedPrompts: [
      "알파벳의 구글 검색, 유튜브 광고(광고), 구글 클라우드가 성장 논지를 구성하는 핵심 채널인지 공시 기준으로 정리해줘.",
      "알파벳의 AI 데이터 인프라와 데이터센터 비용이 매출총이익률·영업이익률에 미치는 전달 경로를 공시 기준으로 점검해줘.",
      "알파벳의 기타 사업, 트래픽획득비용, 규제 변수 조합이 향후 성장 논지를 제약할 수 있는 실질 리스크를 공시 근거로 정리해줘.",
    ],
    questionChains: {},
  },
  GS: {
    ticker: "GS",
    companyName: "The Goldman Sachs Group, Inc.",
    companyNameKo: "골드만삭스",
    sectorKo: "투자은행 및 자산관리",
    signature:
      "글로벌 은행·마켓, 자산·자산관리, 플랫폼 솔루션이 수익 구조의 중심이며, 투자 사이클과 시장 변동이 성과의 방향을 결정합니다.",
    description:
      "기업 리포트: 글로벌 은행·마켓에서 발생하는 투자은행 수수료, 채권·외환·원자재·주식 거래 활동, 자산·자산관리의 운용자산 성장, 그리고 플랫폼 솔루션 연계 수익이 실적을 함께 좌우합니다.",
    researchFocus: [
      "글로벌 은행·마켓",
      "투자은행 수수료",
      "FICC 및 equities",
      "자산·자산관리 (운용자산)",
      "플랫폼 솔루션",
    ],
    riskVariables: [
      "금융시장 변동성에 따른 채권·외환·원자재·주식 실적 변동성",
      "거래·자문 사이클 둔화로 인한 투자은행 수수료 부담",
      "규제자본·유동성 요건 강화에 따른 성장 제약",
      "자산 유입/이탈에 따른 운용자산 기반 수익 안정성",
    ],
    suggestedPrompts: [
      "골드만삭스의 글로벌 은행·마켓에서 투자은행 수수료와 채권·외환·원자재·주식 수익이 어떻게 발생하는지 공시 기준으로 정리해줘.",
      "골드만삭스의 자산·자산관리에서 운용자산 변화가 수수료 수익, 마진, 비용 구조에 어떤 영향을 주는지 공시 기준으로 분석해줘.",
      "골드만삭스의 플랫폼 솔루션, 규제자본·유동성 요건, 시장 변동성이 성장 논지에 미치는 리스크 경로를 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  HON: {
    ticker: "HON",
    companyName: "Honeywell International Inc.",
    companyNameKo: "허니웰",
    sectorKo: "항공우주·산업 자동화·에너지 전환 솔루션",
    signature:
      "항공우주 기술와 빌딩 자동화, 산업 자동화이 주도하는 허니웰은 수주잔고와 애프터마켓 전환 속도에 따라 실적 레버리지와 마진 안정성이 달라집니다.",
    description:
      "기업 리포트: 허니웰은 항공우주 기술, 빌딩 자동화, 산업 자동화, 에너지 및 지속가능성 솔루션로 사업 축을 구성하고 UOP 기반 프로젝트가 공정 효율성과 매출 변동 완충축에 기여합니다. 수주잔고를 실질 매출·수금으로 전환하는 속도와 애프터마켓 회수 구조가 성장 지속성과 현금흐름 안정성의 핵심 연결고리입니다.",
    researchFocus: [
      "항공우주 기술의 항공우주 제품·부품·유지보수 매출 연결",
      "빌딩 자동화 및 산업 자동화의 운영 효율화 수요",
      "에너지 및 지속가능성 솔루션의 에너지, 유틸리티, 산업 고객 노출",
      "수주잔고 전환률, 애프터마켓 반복매출, 비용 구조 레버리지",
    ],
    riskVariables: [
      "가격 전가력 약화 구간의 원가 압박",
      "수주잔고 집행 지연으로 인한 분기 실적·현금흐름 변동",
      "애프터마켓 수요 둔화가 고정비 흡수력에 미치는 영향",
      "규제·프로젝트 일정 변동이 에너지 및 지속가능성 솔루션 집행에 미치는 리스크",
    ],
    suggestedPrompts: [
      "허니웰의 항공우주 기술, 빌딩 자동화, 산업 자동화이 각각 매출과 영업이익률에 기여하는 구조를 공시 기준으로 분해해줘.",
      "허니웰의 수주잔고와 UOP 매출이 매출 집행, 비용 구조, 현금흐름 안정성으로 어떻게 전달되는지 공시 근거로 비교해줘.",
      "허니웰의 가격 전가력, 원재료 비용, 수주잔고 지속성이 성장 논지에 미치는 경로를 정리해줘.",
    ],
    questionChains: {},
  },
  IBM: {
    ticker: "IBM",
    companyName: "International Business Machines Corporation",
    companyNameKo: "아이비엠",
    sectorKo: "하이브리드 클라우드·AI",
    signature:
      "하이브리드 클라우드, AI, 소프트웨어, 컨설팅, 인프라가 결합되는 구조에서 메인프레임 고객군의 거래 처리 전환이 성과의 분기점이 됩니다.",
    description:
      "기업 리포트: 하이브리드 클라우드와 AI 수요 속에서 소프트웨어, 컨설팅, 인프라 매출을 함께 보며, watsonx·Red Hat의 확장 지점, 메인프레임 기반 거래 처리 전환 속도, 잉여 현금흐름 및 연금·이자비용 민감도를 함께 점검합니다.",
    researchFocus: [
      "하이브리드 클라우드 및 AI 전환 수요",
      "watsonx와 Red Hat의 상업화 동인",
      "소프트웨어·컨설팅·인프라 매출 믹스",
      "메인프레임에서의 거래 처리 전환과 마진 구조",
    ],
    riskVariables: [
      "연금 부담과 이자비용 변동성",
      "부채 구조 변화와 자금조달 비용",
      "컨설팅 프로젝트 지연 및 수요 둔화",
      "기술 전환 인력, 보상비, 이탈 비용",
    ],
    suggestedPrompts: [
      "아이비엠의 소프트웨어, 컨설팅, 인프라가 매출 성장과 잉여 현금흐름에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "아이비엠의 watsonx와 Red Hat이 하이브리드 클라우드·AI 확장 국면에서 메인프레임 고객의 거래 처리 전환과 수익성에 어떤 영향을 주는지 공시 기준으로 비교해줘.",
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
      "클라이언트 컴퓨팅, 데이터센터 및 AI, 네트워크 및 엣지가 매출의 방향을 정하고, 인텔 파운드리와 웨이퍼 전략이 매출총이익률을 좌우합니다.",
    description:
      "기업 리포트: 클라이언트 컴퓨팅, 데이터센터 및 AI, 네트워크 및 엣지의 매출 동향과 물량·가격 추이를 읽고, 인텔 파운드리, 웨이퍼 가동 효율, 공정 노드 전환이 매출총이익률과 비용 구조에 미치는 연결 고리를 함께 봅니다.",
    researchFocus: [
      "클라이언트 컴퓨팅",
      "데이터센터 및 AI",
      "네트워크 및 엣지",
      "인텔 파운드리",
    ],
    riskVariables: [
      "클라이언트 컴퓨팅 수요 둔화와 가격 전가 압력",
      "데이터센터 및 AI 수요 변동 및 AI 인프라 투자 타이밍",
      "네트워크 및 엣지 출하·ASP 민감도",
      "웨이퍼 수율, 공정 노드 전환 속도, 정부 인센티브 안정성",
    ],
    suggestedPrompts: [
      "인텔의 클라이언트 컴퓨팅, 데이터센터 및 AI, 네트워크 및 엣지가 분기별 매출과 현금흐름에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "인텔의 인텔 파운드리와 웨이퍼 가동률, 공정 노드 전환이 매출총이익률과 원가 구조에 미친 영향을 공시 근거로 비교해줘.",
      "인텔의 데이터센터 및 AI 성장 논지에서 수요 사이클, 경쟁 구도, 정부 인센티브가 어떤 리스크 완충·압박 요인인지 공시 기준으로 정리해줘.",
    ],
    questionChains: {},
  },
  INTU: {
    ticker: "INTU",
    companyName: "Intuit, Inc.",
    companyNameKo: "인튜이트",
    sectorKo: "세무·회계·개인금융 소프트웨어",
    signature:
      "터보택스, 크레딧 카르마, QuickBooks, 메일침프가 맞물린 플랫폼 구조에서 세무 시즌 집중도, SMB 구독 전환, AI·클라우드 운영비가 수익의 질을 좌우합니다.",
    description:
      "기업 리포트: 인튜이트는 소비자의 터보택스·크레딧 카르마와 글로벌 비즈니스 솔루션의 퀵북스 온라인, 결제, 급여 처리, 메일침프를 함께 봐야 합니다. 세무 시즌의 고객 유입, 퀵북스 온라인 회계와 온라인 서비스 확장, 크레딧 카르마의 금융상품 매칭, AI 기반 자동화와 클라우드 호스팅 비용이 매출총이익률과 영업 레버리지의 핵심 연결고리입니다.",
    researchFocus: [
      "터보택스·크레딧 카르마·ProTax를 포함한 소비자 플랫폼",
      "퀵북스 온라인 회계, 결제, 급여 처리, 퀵북스 캐피털",
      "메일침프와 인튜이트 Enterprise Suite의 SMB 고객 확장",
      "AI 기능, 클라우드 호스팅, 사기·보안 관리 비용",
    ],
    riskVariables: [
      "세무 시즌 집중도와 무료·저가 대체재 확대로 인한 가격 전가력 약화",
      "클라우드·AI·데이터 처리 비용 상승에 따른 매출총이익률 압박",
      "신원 도용, 사기, 보안 사고가 신뢰·규제비용으로 전이될 가능성",
      "결제·대출 오퍼링 확대에 따른 신용 손실과 금리 민감도",
    ],
    suggestedPrompts: [
      "인튜이트의 소비자와 글로벌 비즈니스 솔루션에서 터보택스, 크레딧 카르마, 퀵북스 온라인, 메일침프가 매출과 영업이익률에 기여하는 구조를 공시 기준으로 정리해줘.",
      "퀵북스 온라인 회계, 결제, 급여 처리, 퀵북스 캐피털이 SMB 고객당 매출과 비용 구조를 어떻게 바꾸는지 공시 근거로 비교해줘.",
      "인튜이트의 AI 기능, 클라우드 호스팅, 사기·보안 리스크가 성장 논지와 잉여 현금흐름에 미치는 경로를 정리해줘.",
    ],
    questionChains: {},
  },
  ISRG: {
    ticker: "ISRG",
    companyName: "Intuitive Surgical, Inc.",
    companyNameKo: "인튜이티브 서지컬",
    sectorKo: "로봇 수술 플랫폼",
    signature:
      "다빈치와 Ion 기반 플랫폼에서 시술 건수가 핵심 동인이며, 기구·부속품, 시스템, 서비스가 매출 타이밍과 수익성 경로를 만듭니다.",
    description:
      "기업 리포트: 인튜이티브 서지컬은 다빈치 수술 System과 Ion endoluminal 플랫폼을 중심으로 수술 로봇 생태계를 운영합니다. 시술 건수 증가는 기구·부속품 반복매출과 서비스 수익으로 직접 연결되고, 시스템 매출은 신규 설치, 영업 리스, 매입전환 조합에 따라 인식 시점이 달라집니다. 미국·해외 비중, 병원 지불 여력, 관세·규제·공급망 노출을 함께 봐야 합니다.",
    researchFocus: [
      "다빈치 및 Ion 시술 건수",
      "기구·부속품 반복매출과 시술 연동 구조",
      "시스템 설치, 영업 리스, 매입전환에 따른 매출 인식",
      "서비스 계약 수익과 설치대수 기반 유지수익성",
    ],
    riskVariables: [
      "병원 자본지출 둔화가 시스템 설치와 시술 증가율에 미치는 영향",
      "관세·무역 규제·해외 승인 지연에 따른 비용 구조와 마진 변동",
      "부품·소재 공급망 병목이 기구·부속품 공급에 미치는 충격",
      "신규 승인 지연, 가격 전가 한계, 경쟁 심화에 따른 다빈치·Ion 성장 둔화",
    ],
    suggestedPrompts: [
      "인튜이티브 서지컬의 다빈치와 Ion 시술 건수가 기구·부속품 및 서비스 매출로 전환되는 구조를 공시 기준으로 정리해줘.",
      "시스템 설치, 영업 리스, 매입전환 조합이 인튜이티브 서지컬의 매출 인식과 현금흐름에 미치는 차이를 비교해줘.",
      "관세, OUS 규제, 병원 자본지출 둔화가 인튜이티브 서지컬의 성장 논지와 마진에 주는 리스크를 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  JNJ: {
    ticker: "JNJ",
    companyName: "Johnson & Johnson",
    companyNameKo: "존슨앤드존슨",
    sectorKo: "제약·의료기기",
    signature:
      "혁신의약품과 의료기술이 맞물린 구조에서 Stelara, Darzalex, Tremfya, Carvykti의 처방 전환과 수술·병원 수요가 실적 방향을 좌우합니다.",
    description:
      "기업 리포트: 존슨앤드존슨은 혁신의약품의 핵심 치료제와 의료기술의 수술·병원 채널을 함께 봐야 합니다. Stelara 바이오시밀러 경쟁, Darzalex·Tremfya·Carvykti의 적응증 확대, Abiomed를 포함한 의료기술 포트폴리오의 주문 회복이 매출총이익률과 현금흐름 전환 속도를 결정합니다.",
    researchFocus: [
      "혁신의약품과 의료기술의 매출·마진 기여도",
      "Stelara, Darzalex, Tremfya, Carvykti의 처방 확산 및 경쟁 압력",
      "Abiomed 포함 의료기술 포트폴리오의 병원 수요·수술 건수 민감도",
      "약가 협상, 리베이트, 소송·규제 비용이 현금흐름에 미치는 영향",
    ],
    riskVariables: [
      "Stelara 특허 만료와 바이오시밀러 경쟁 심화",
      "약가 정책·리베이트 변화에 따른 가격 전가력 약화",
      "의료기술 부품·운송·제조비용 상승과 병원 투자 지연",
      "임상 승인 지연, 제품 책임 소송, 규제 비용 확대",
    ],
    suggestedPrompts: [
      "존슨앤드존슨의 혁신의약품과 의료기술이 매출총이익률과 잉여 현금흐름에 어떻게 기여하는지 공시 기준으로 정리해줘.",
      "Stelara, Darzalex, Tremfya, Carvykti의 처방 확산과 경쟁 압력이 존슨앤드존슨의 성장 논지에 미치는 영향을 비교해줘.",
      "Abiomed를 포함한 의료기술 포트폴리오에서 병원 수요, 수술 건수, 제조비용이 마진에 전달되는 경로를 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  JPM: {
    ticker: "JPM",
    companyName: "JPMorgan Chase & Co.",
    companyNameKo: "JP모건체이스",
    sectorKo: "은행·자본시장",
    signature:
      "소비자·커뮤니티 은행의 예금·대출 기반 순이자수익, 상업·투자은행의 시장·자문 수익, 자산·자산관리의 운용자산 수수료가 실적의 세 축입니다.",
    description:
      "기업 리포트: JPMorgan Chase는 소비자·커뮤니티 은행, 상업·투자은행, 자산·자산관리를 나눠 봐야 합니다. 예금 비용과 대출 수익률이 만드는 순이자수익, 카드 및 신용 비용, 투자은행 수수료, 거래 수익, 운용자산 기반 수수료가 금리·신용·시장 사이클에 따라 서로 다른 속도로 움직입니다.",
    researchFocus: [
      "소비자·커뮤니티 은행의 예금, 대출, 카드 사업과 순이자수익",
      "상업·투자은행의 투자은행 수수료와 시장 제품",
      "자산·자산관리의 운용자산, 자문 수수료, 예금·대출 연계",
      "신용비용과 대손충당금, 규제자본·유동성 요건",
    ],
    riskVariables: [
      "예금 비용 상승과 대출 성장 둔화에 따른 순이자수익 압박",
      "경기 둔화와 신용 악화로 인한 신용 비용 확대",
      "시장 변동성이 거래 수익과 투자은행 수수료에 미치는 영향",
      "규제자본·유동성 규제 강화에 따른 배당·자본환원 제약",
    ],
    suggestedPrompts: [
      "JP모건체이스의 소비자·커뮤니티 은행에서 예금, 대출, 카드 사업이 순이자수익과 신용비용으로 연결되는 구조를 공시 기준으로 정리해줘.",
      "JP모건체이스의 상업·투자은행과 자산·자산관리가 각각 투자은행 수수료, 거래 수익, 운용자산 수수료를 만드는 경로를 비교해줘.",
      "JP모건체이스의 금리 민감도, 신용 비용, 규제자본 변화가 성장 논지와 자본환원 여력에 미치는 영향을 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  KLAC: {
    ticker: "KLAC",
    companyName: "KLA Corporation",
    companyNameKo: "케이엘에이",
    sectorKo: "반도체 공정 제어·검사 장비",
    signature:
      "웨이퍼 검사·계측·레티클 검사가 첨단 공정 수율을 좌우하고, 설치 기반 서비스가 반도체 투자 사이클의 변동성을 완충합니다.",
    description:
      "기업 리포트: 케이엘에이는 IC 제조 공정의 결함을 찾아 수율을 높이는 공정 제어 장비와 소프트웨어, 데이터 분석 기능을 제공합니다. 반도체 공정 제어의 웨이퍼 검사·계측, 특수 반도체 공정, PCB·부품 검사, 그리고 유지보수·지원 서비스를 함께 보며 DRAM, 파운드리·로직, 첨단 패키징 투자 타이밍을 연결해서 읽어야 합니다.",
    researchFocus: [
      "반도체 공정 제어의 웨이퍼 검사·계측 수요",
      "레티클 검사, 소프트웨어, 데이터 분석의 공정 수율 기여",
      "설치 기반 서비스와 매출총이익률 안정성",
      "DRAM, 파운드리·로직, 첨단 패키징 설비투자 사이클",
    ],
    riskVariables: [
      "고객의 자본장비 조달 일정 지연·취소",
      "BIS 수출통제와 중국 고객 지원 제한",
      "부품 조달, 관세, 환율 변동에 따른 원가 압박",
      "상위 고객·지역 편중에 따른 수주와 현금흐름 변동성",
    ],
    suggestedPrompts: [
      "케이엘에이의 반도체 공정 제어에서 웨이퍼 검사·계측·레티클 검사가 매출총이익률에 기여하는 구조를 공시 기준으로 정리해줘.",
      "케이엘에이의 서비스 매출이 설치 기반, 유지보수 수요, 현금흐름 안정성으로 연결되는 경로를 공시 근거로 설명해줘.",
      "DRAM, 파운드리·로직, 첨단 패키징 투자 사이클과 BIS 수출통제가 케이엘에이의 성장 논지에 미치는 영향을 비교해줘.",
    ],
    questionChains: {},
  },
  KO: {
    ticker: "KO",
    companyName: "The Coca-Cola Company",
    companyNameKo: "코카콜라",
    sectorKo: "음료",
    signature:
      "원액과 완제품 음료 판매, 코카콜라 브랜드, 병입 파트너 구조가 맞물리며 가격/믹스와 환율이 수익성의 방향을 정합니다.",
    description:
      "기업 리포트: 코카콜라는 원액 판매와 탄산음료를 포함한 완제품 음료 채널, 병입 파트너와 재프랜차이즈화 구조를 함께 봐야 합니다. 코카콜라 브랜드의 브랜드력, 지역별 가격/믹스, 원재료·알루미늄 캔·PET·운송비가 매출총이익률과 현금흐름 방어력의 핵심 변수입니다.",
    researchFocus: [
      "원액과 완제품 음료 수익 구조",
      "코카콜라 브랜드, 탄산음료, 비탄산음료 포트폴리오 믹스",
      "병입 파트너, 재프랜차이즈화, 지역별 가격/믹스",
      "원재료·포장·운송비와 환율이 매출총이익률에 미치는 영향",
    ],
    riskVariables: [
      "원재료·포장·운송비 상승에 따른 매출총이익률 압박",
      "소비자 가격 민감도 상승으로 인한 가격/믹스 약화",
      "병입 파트너 운영 효율 저하와 재프랜차이즈화 지연",
      "환율 변동과 인플레이션이 지역별 가격 정책에 미치는 영향",
    ],
    suggestedPrompts: [
      "코카콜라의 원액과 완제품 음료가 어떤 채널에서 매출로 전환되는지 공시 기준으로 정리해줘.",
      "코카콜라의 코카콜라 브랜드, 탄산음료 믹스, 지역별 가격/믹스가 매출총이익률에 미치는 영향을 공시 근거로 분석해줘.",
      "코카콜라의 병입 파트너 구조와 재프랜차이즈화가 비용 방어력과 현금흐름에 미치는 경로를 정리해줘.",
    ],
    questionChains: {},
  },
  LIN: {
    ticker: "LIN",
    companyName: "Linde plc",
    companyNameKo: "린데",
    sectorKo: "산업가스",
    signature:
      "현장공급, 가맹점, 패키지 가스 계약 구조와 가격/비용 스프레드가 린데의 수익 안정성을 만들고, 세정 수소·전자 수요와 엔지니어링 수주잔고가 성장 속도를 정합니다.",
    description:
      "기업 리포트: Linde는 현장 장기공급, 가맹점 벌크, 패키지 가스 판매를 통해 산업·의료·전자·에너지 고객에게 산소, 질소, 수소, 헬륨, CO2, 특수가스를 공급합니다. 최소 구매량과 가격 조정이 포함된 계약 구조, 비용 전가, 세정 수소·전자 노출, 엔지니어링 수주잔고 전환 속도를 함께 봐야 매출총이익률과 현금흐름의 질을 판단할 수 있습니다.",
    researchFocus: [
      "현장공급, 가맹점, 패키지 가스별 계약 기간과 최소 구매 구조",
      "가격/비용 스프레드, 비용 전가, 환율이 마진에 미치는 영향",
      "세정 수소, 헬륨, CO2, 전자, 특수가스 수요",
      "미주, 유럽·중동·아프리카, 아시아태평양 지역 믹스와 엔지니어링 수주잔고 전환",
    ],
    riskVariables: [
      "천연가스·전력·원재료 가격 변동과 공급 차질",
      "비용 전가 지연에 따른 가격/비용 스프레드 축소",
      "화학·에너지·제조·메탈 고객의 프로젝트 일정 지연",
      "환율 변동과 헤지 한계가 영업이익·현금흐름에 미치는 영향",
    ],
    suggestedPrompts: [
      "린데의 현장공급, 가맹점, 패키지 가스 계약이 최소 구매량과 가격 조정을 통해 수익 안정성을 만드는 구조를 공시 기준으로 정리해줘.",
      "린데의 가격/비용 스프레드, 비용 전가, 환율이 매출총이익률과 영업이익에 미치는 영향을 지역별로 비교해줘.",
      "린데의 세정 수소, 전자, 특수가스 수요와 엔지니어링 수주잔고가 성장 논지에 미치는 영향을 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  LLY: {
    ticker: "LLY",
    companyName: "Eli Lilly and Company",
    companyNameKo: "일라이 릴리",
    sectorKo: "제약",
    signature:
      "Mounjaro와 Zepbound 중심의 GLP-1 수요, 제조 생산능력 확장, 가격·환급 정책이 일라이 릴리의 성장 속도와 마진을 좌우합니다.",
    description:
      "기업 리포트: Eli Lilly는 Mounjaro와 Zepbound의 GLP-1/incretin 수요가 실적의 중심이며, Verzenio, Jardiance, Trulicity가 포트폴리오를 보완합니다. 제조 설비 증설과 공급 안정성, 미국·해외 실현 가격, 환급·약가 협의, 적응증 확대가 매출총이익률과 현금흐름 전환 속도를 결정합니다.",
    researchFocus: [
      "Mounjaro·Zepbound의 GLP-1 물량, 실현 가격, 채널 믹스",
      "Verzenio, Jardiance, Trulicity의 포트폴리오 보완 역할",
      "제조 생산능력 확장과 공급망 안정성",
      "환급 정책, 약가 협의, 브릿지 프로그램이 가격에 미치는 영향",
    ],
    riskVariables: [
      "Mounjaro·Zepbound 수요가 공급 능력을 초과할 때 발생하는 매출 인식 지연",
      "가격 협상과 환급 변화에 따른 실현 가격 하락",
      "제조 품질·규제 이슈와 공급망 집중 구조",
      "GLP-1 경쟁 심화, 소송·평판 리스크, 적응증 승인 지연",
    ],
    suggestedPrompts: [
      "일라이 릴리의 Mounjaro와 Zepbound가 물량, 실현 가격, 제조 생산능력을 통해 매출총이익률에 미치는 영향을 공시 기준으로 정리해줘.",
      "Verzenio, Jardiance, Trulicity가 GLP-1 중심 포트폴리오의 현금흐름 변동성을 어떻게 보완하는지 공시 근거로 비교해줘.",
      "일라이 릴리의 약가 협의, 환급, 브릿지 프로그램, 제조 확장이 성장 논지에 미치는 리스크 경로를 설명해줘.",
    ],
    questionChains: {},
  },
  LRCX: {
    ticker: "LRCX",
    companyName: "Lam Research Corporation",
    companyNameKo: "램리서치",
    sectorKo: "반도체 장비",
    signature:
      "식각, 증착, 세정 중심의 웨이퍼 제조 장비와 고객지원 사업부 설치 기반 서비스가 메모리, 파운드리, 로직 설비투자 사이클을 수익으로 전환합니다.",
    description:
      "기업 리포트: 램리서치는 웨이퍼 공정 장비와 고객지원 관련 매출을 함께 운영합니다. 신규 식각·증착·세정 시스템, 고객지원 사업부의 예비부품·업그레이드·릴라이언트, 설치 기반 서비스가 NAND, DRAM, 파운드리·로직 투자 흐름에 따라 서로 다른 속도로 움직이며 매출총이익률과 현금흐름을 결정합니다.",
    researchFocus: [
      "식각, 증착, 세정 중심 웨이퍼 제조 장비",
      "NAND, DRAM, 파운드리, 로직 고객 설비투자 사이클",
      "고객지원 사업부 설치 기반, 예비부품, 업그레이드, 릴라이언트 매출",
      "연구개발 투자, 제조 효율, 수출통제가 매출총이익률에 미치는 영향",
    ],
    riskVariables: [
      "메모리·파운드리·로직 고객의 설비투자 지연과 주문 취소",
      "수출통제, 관세, 지역별 출하 제한에 따른 매출 인식 지연",
      "핵심 부품·자재 조달 병목과 공급망 비용 상승",
      "공정 전환 속도와 경쟁 심화가 제품 믹스·가격에 미치는 압박",
    ],
    suggestedPrompts: [
      "램리서치의 식각, 증착, 세정 장비가 NAND, DRAM, 파운드리·로직 설비투자 사이클과 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "램리서치의 고객지원 사업부 설치 기반, 예비부품, 업그레이드, 릴라이언트 매출이 매출총이익률과 현금흐름 안정성에 기여하는 구조를 설명해줘.",
      "수출통제, 관세, 공급망 병목이 램리서치의 고객별 주문, 납기, 매출총이익률에 미치는 영향을 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  MA: {
    ticker: "MA",
    companyName: "Mastercard Incorporated",
    companyNameKo: "마스터카드",
    sectorKo: "글로벌 결제 네트워크",
    signature:
      "총 달러 거래액, 스위치 처리 거래, 국경간 거래액이 네트워크 수수료를 만들고, 부가가치 서비스, 리베이트와 인센티브가 마진의 질을 결정합니다.",
    description:
      "기업 리포트: 마스터카드는 결제 네트워크 수익과 부가가치 서비스·솔루션을 함께 봐야 합니다. 총 달러 거래액(GDV), 총 유로 거래액(GEV), 스위치 처리 거래, 국경간 거래액이 국내·국경간 평가수수료와 거래 처리 평가수수료로 연결되고, 발급사·가맹점 대상 리베이트와 인센티브 및 환율 영향이 순매출과 비용 구조를 동시에 움직입니다.",
    researchFocus: [
      "총 달러 거래액, 국경간 거래액, 스위치 처리 거래",
      "국내·국경간 평가수수료와 거래 처리 평가수수료",
      "부가가치 서비스와 솔루션의 성장과 마진 기여",
      "리베이트와 인센티브, 환율 영향, 발급사·매입사 관계",
    ],
    riskVariables: [
      "환율 변동이 총거래액(GDV)·총 유로 거래액(GEV)와 물량 연동 리베이트 및 인센티브에 미치는 영향",
      "수수료 규제, 가맹점 litigation, 발급사·매입사 협상력 변화",
      "정보보안 사고·서비스 중단이 거래 처리 신뢰에 미치는 충격",
      "AML/CFT, 경제제재, anti-corruption 규제 강화에 따른 비용 증가",
    ],
    suggestedPrompts: [
      "마스터카드의 총 달러 거래액, 국경간 거래액, 스위치 처리 거래가 결제 네트워크 수익으로 전환되는 구조를 공시 기준으로 정리해줘.",
      "마스터카드의 부가가치 서비스와 솔루션과 리베이트와 인센티브가 순매출과 마진에 미치는 영향을 비교해줘.",
      "마스터카드의 가맹점 litigation, 수수료 규제, 정보보안 리스크가 성장 논지와 국경간 수익성에 주는 영향을 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  MCD: {
    ticker: "MCD",
    companyName: "McDonald's Corporation",
    companyNameKo: "맥도날드",
    sectorKo: "글로벌 외식 프랜차이즈",
    signature:
      "프랜차이즈 매장에서 발생하는 임대료, 로열티, 초기 수수료가 수익의 중심이고, 비교매장매출, 방문객 수, 디지털·배송·로열티 프로그램가 프랜차이즈 수수료 성장 속도를 좌우합니다.",
    description:
      "기업 리포트: 맥도날드는 대부분의 매장을 프랜차이즈 매장으로 운영하며 임대료, 로열티, 초기 수수료, 최소 임대료가 안정적인 현금흐름을 만듭니다. 직영 매장은 원재료·인건비·운영 효율에 더 민감하고, 비교매장매출과 방문객 수, 디지털·배송·로열티 프로그램 전환, EOTF 투자와 메뉴 가격 전략이 지역별 마진을 결정합니다.",
    researchFocus: [
      "프랜차이즈 매장의 임대료, 로열티, 초기 수수료 구조",
      "직영 매장 마진과 운영 효율",
      "비교매장매출, 방문객 수, 메뉴 가격·믹스",
      "디지털, 배송, 로열티 프로그램, EOTF 투자 효과",
    ],
    riskVariables: [
      "소고기·닭고기, 감자, 포장재 가격 상승에 따른 점포 마진 압박",
      "인건비·물류·에너지 비용이 직영 매장에 미치는 영향",
      "가맹점주 수익성 악화가 리모델링·신규점 투자에 주는 제약",
      "보건·광고·고용 규제와 환율 변동에 따른 지역별 현금흐름 변동",
    ],
    suggestedPrompts: [
      "맥도날드의 프랜차이즈 매장에서 임대료, 로열티, 초기 수수료가 어떻게 발생하고 직영 매장과 현금흐름 성격이 어떻게 다른지 공시 기준으로 정리해줘.",
      "맥도날드의 비교매장매출과 방문객 수가 프랜차이즈 수수료 성장과 마진에 반영되는 경로를 지역별로 설명해줘.",
      "디지털 주문, 배송, 로열티 프로그램, EOTF 투자가 메뉴 믹스와 주문 단가, 가맹점주 수익성에 미치는 영향을 공시 근거로 분석해줘.",
    ],
    questionChains: {},
  },
  META: {
    ticker: "META",
    companyName: "Meta Platforms, Inc.",
    companyNameKo: "메타",
    sectorKo: "소셜 광고·AI",
    signature:
      "앱 패밀리 광고는 노출수와 광고당 가격가 성장 축이고, 리얼리티 랩스와 AI·데이터센터 설비투자는 잉여 현금흐름 압박의 핵심 변수입니다.",
    description:
      "기업 리포트: Meta는 페이스북, 인스타그램, 왓츠앱, 릴스, Threads가 포함된 앱 패밀리 광고와 리얼리티 랩스 투자를 나눠 봐야 합니다. 광고 매출은 노출수, 광고당 가격, 릴스 수익화, 광고 믹스가 좌우하고, 리얼리티 랩스의 Quest·호라이즌 손실과 AI 서버·데이터센터 설비투자가 감가상각과 현금흐름에 반영됩니다.",
    researchFocus: [
      "앱 패밀리 광고 노출수와 광고당 가격",
      "페이스북, 인스타그램, 왓츠앱, 릴스, Threads의 참여도와 수익화",
      "리얼리티 랩스의 Quest·호라이즌 비용과 손실 추세",
      "AI 모델, 서버, 데이터센터 설비투자와 감가상각 부담",
    ],
    riskVariables: [
      "광고 수요 둔화와 광고당 가격 하락 압력",
      "리얼리티 랩스 적자 지속과 Quest·호라이즌 현금화 지연",
      "AI·데이터센터 설비투자, 전력비, 감가상각 증가",
      "프라이버시·규제 이슈가 타기팅 효율과 콘텐츠 운영에 미치는 영향",
    ],
    suggestedPrompts: [
      "메타의 앱 패밀리에서 노출수, 광고당 가격, 릴스 수익화가 광고 매출과 마진에 연결되는 구조를 공시 기준으로 정리해줘.",
      "리얼리티 랩스의 Quest·호라이즌 투자와 AI·데이터센터 설비투자가 메타의 감가상각과 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "릴스, Threads, 인스타그램, 페이스북의 사용자 참여도 차이가 광고 단가와 광고 총량에 어떻게 반영되는지 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  MRK: {
    ticker: "MRK",
    companyName: "Merck & Co., Inc.",
    companyNameKo: "머크",
    sectorKo: "제약·백신·동물건강",
    signature:
      "Keytruda 중심 종양학이 수익의 핵심이고, Gardasil/Gardasil 9와 동물건강이 완충축을 만들며 Winrevair와 파이프라인 진척이 다음 성장 속도를 정합니다.",
    description:
      "기업 리포트: Merck는 인체의약품의 종양학, 백신, 동물건강을 함께 봐야 합니다. Keytruda와 Lynparza/Lenvima 제휴 수익, Gardasil/Gardasil 9 백신 수요, 동물건강의 안정적 현금흐름, Winrevair 상업화와 특허·환급 압력이 매출총이익률과 재투자 여력을 좌우합니다.",
    researchFocus: [
      "Keytruda 중심 종양학 매출, 가격, 환급 동인",
      "Gardasil/Gardasil 9 백신 채널과 지역별 수요",
      "동물건강 매출 안정성과 비용 방어 효과",
      "Winrevair 상업화, PAH 파이프라인, 특허 만료 대응",
    ],
    riskVariables: [
      "Keytruda 특허 만료와 바이오시밀러·경쟁 치료제 진입",
      "미국·유럽 약가·환급 정책 변화에 따른 가격 전가력 약화",
      "Gardasil 수요 둔화와 지역별 재고·채널 조정",
      "Winrevair 적응증 확대 지연과 파이프라인 승인 실패",
    ],
    suggestedPrompts: [
      "머크의 Keytruda, Lynparza/Lenvima, Gardasil/Gardasil 9, 동물건강이 매출총이익률과 현금흐름을 만드는 경로를 공시 기준으로 정리해줘.",
      "Keytruda 특허 만료, 약가·환급 압력, Gardasil 수요 변화가 머크의 성장 논지에 미치는 영향을 비교해줘.",
      "Winrevair와 PAH 파이프라인이 머크의 재투자 여력, 마진, 종양학 의존도 완화에 어떤 의미가 있는지 공시 근거로 설명해줘.",
    ],
    questionChains: {},
  },
  MS: {
    ticker: "MS",
    companyName: "Morgan Stanley",
    companyNameKo: "모건스탠리",
    sectorKo: "투자은행·자산관리",
    signature:
      "기관증권의 투자은행 수수료·거래 수익과 자산관리의 NNA·수수료 기반 고객 자산이 실적 변동성과 안정성을 함께 만듭니다.",
    description:
      "기업 리포트: 모건스탠리는 기관증권, 자산관리, 투자 관리를 통합 금융회사 구조로 운영합니다. M&A·인수·자본시장 발행 수수료, 주식·채권 거래, E*TRADE를 포함한 자기주도형 채널, 자문형 자산 유입, 수수료 기반 고객 자산과 운용자산 수수료율이 매출과 현금흐름의 핵심 연결고리입니다.",
    researchFocus: [
      "기관증권의 자문, 인수, 투자은행 수수료",
      "주식·채권 거래과 시장 변동성",
      "자산관리의 NNA, 수수료 기반 고객 자산, E*TRADE 채널",
      "투자 관리의 운용자산 믹스와 수수료 비율",
    ],
    riskVariables: [
      "M&A·자본시장 발행 사이클 둔화에 따른 투자은행 수수료 감소",
      "금리·환율·시장 변동성이 거래 수익에 미치는 영향",
      "NNA와 수수료 기반 고객 자산 둔화로 인한 자산관리 수익 압박",
      "규제자본·유동성 요건 강화에 따른 기관증권 확장 제약",
    ],
    suggestedPrompts: [
      "모건스탠리의 기관증권에서 자문, 인수, 거래 수익이 어떻게 나뉘는지 공시 기준으로 정리해줘.",
      "모건스탠리 자산관리의 NNA, 수수료 기반 고객 자산, E*TRADE 채널이 수수료 수익 안정성에 미치는 영향을 설명해줘.",
      "모건스탠리의 통합 금융회사 구조가 기관증권, 자산관리, 투자 관리 사이의 수익 변동성을 어떻게 완충하는지 공시 근거로 분석해줘.",
    ],
    questionChains: {},
  },
  MSFT: {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    companyNameKo: "마이크로소프트",
    sectorKo: "소프트웨어·클라우드",
    signature:
      "마이크로소프트 365, 애저, 다이내믹스, 링크드인, GitHub, 게임이 구독·클라우드·광고·콘텐츠 수익을 만들고, AI 인프라 설비투자가 마진과 잉여 현금흐름의 핵심 변수입니다.",
    description:
      "기업 리포트: 마이크로소프트는 생산성 및 비즈니스 프로세스, 인텔리전트 클라우드, 개인 컴퓨팅을 함께 봐야 합니다. 마이크로소프트 365 상업용, 다이내믹스 365, 링크드인, 애저 및 기타 클라우드 서비스, GitHub, 윈도우, 검색 광고, 게임과 Activision Blizzard 편입 효과가 매출 축을 만들며, Copilot·애저 AI 수요와 데이터센터 설비투자가 매출총이익률과 감가상각 부담을 좌우합니다.",
    researchFocus: [
      "마이크로소프트 365 상업용, 다이내믹스 365, 링크드인의 구독·광고 수익",
      "애저 및 기타 클라우드 서비스, GitHub, Copilot, 애저 AI 수요",
      "윈도우, 검색 광고, 게임, Activision Blizzard 믹스",
      "AI 데이터센터 설비투자, GPU·전력·감가상각 부담",
    ],
    riskVariables: [
      "AI 인프라 설비투자와 매출원가 증가에 따른 매출총이익률 압박",
      "데이터센터 부지, 전력, GPU·서버 공급 제약",
      "OpenAI 연계 수요와 잔여수행의무의 분기별 변동성",
      "반독점, 개인정보, 광고·데이터 규제가 클라우드·링크드인 성장에 미치는 영향",
    ],
    suggestedPrompts: [
      "마이크로소프트의 마이크로소프트 365 상업용, 애저, 다이내믹스 365, 링크드인이 세그먼트별 매출과 영업이익에 기여하는 구조를 공시 기준으로 정리해줘.",
      "애저 AI, Copilot, GitHub 수요와 AI 데이터센터 설비투자가 매출총이익률과 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "윈도우, 검색 광고, 게임, Activision Blizzard가 인텔리전트 클라우드 투자 우선순위와 어떤 균형을 이루는지 공시 근거로 비교해줘.",
    ],
    questionChains: {},
  },
  MU: {
    ticker: "MU",
    companyName: "Micron Technology, Inc.",
    companyNameKo: "마이크론 테크놀로지",
    sectorKo: "메모리 반도체·스토리지",
    signature:
      "DRAM, NAND, HBM이 AI 데이터센터 수요와 맞물리며 비트 출하량, 평균 판매 가격, 제품 믹스가 매출총이익률과 영업 레버리지를 좌우합니다.",
    description:
      "기업 리포트: Micron은 DRAM, NAND, NOR, SSD·스토리지를 데이터센터, 모바일, 클라이언트, 자동차 고객에게 공급합니다. HBM과 데이터센터 DRAM 수요, 평균 판매 가격, 비트 출하량, CMBU·CDBU·MCBU·AEBU 믹스, 재고 평가손 가능성, 설비투자와 잉여 현금흐름의 균형을 함께 봐야 합니다.",
    researchFocus: [
      "DRAM·NAND·HBM 매출의 평균 판매 가격과 비트 출하량",
      "CMBU, CDBU, MCBU, AEBU별 데이터센터·모바일·클라이언트·자동차 믹스",
      "AI 데이터센터 수요와 HBM 공급 우선순위",
      "재고 평가손, 설비투자, 잉여 현금흐름 전환",
    ],
    riskVariables: [
      "AI 데이터센터 투자 둔화에 따른 ASP 하락 압력",
      "공급 제약 완화 또는 수요 전환에 따른 비트 출하량 둔화",
      "모바일·클라이언트 믹스 변화가 매출총이익률에 미치는 영향",
      "재고 회전 지연과 재고 평가손 확대 가능성",
    ],
    suggestedPrompts: [
      "마이크론의 DRAM, NAND, HBM 매출이 평균 판매 가격과 비트 출하량를 통해 어떻게 성장했는지 공시 기준으로 분해해줘.",
      "CMBU, CDBU, MCBU, AEBU별 고객 믹스가 마이크론의 매출총이익률과 잉여 현금흐름에 미치는 영향을 비교해줘.",
      "AI 데이터센터 수요, HBM 공급 우선순위, 재고 평가손, 설비투자가 마이크론의 성장 논지에 주는 리스크를 정리해줘.",
    ],
    questionChains: {},
  },
  NEE: {
    ticker: "NEE",
    companyName: "NextEra Energy, Inc.",
    companyNameKo: "넥스트에라 에너지",
    sectorKo: "전력·재생에너지",
    signature:
      "FPL의 요금기반자산 성장과 넥스트에라 에너지 자원의 재생에너지 수주잔고가 현금흐름의 두 축이며, 세금 크레딧과 조달비용이 투자 속도를 좌우합니다.",
    description:
      "기업 리포트: 넥스트에라 에너지는 규제형 유틸리티 FPL과 재생에너지 개발·운영 사업인 넥스트에라 에너지 자원(NEER를 나눠 봐야 합니다. FPL은 기준요금, 요금기반자산, 연료비 회수를 통해 안정적 수익을 만들고, NEER는 풍력, 태양광, 배터리 스토리지 수주잔고와 장기 전력판매계약, PTC·ITC 세금 크레딧이 세후 이익과 현금흐름에 반영됩니다.",
    researchFocus: [
      "FPL의 기준요금, 요금기반자산, ROE, 연료비 회수",
      "NEER의 재생에너지 수주잔고, 풍력, 태양광, 배터리 스토리지 파이프라인",
      "장기 전력판매계약과 세금 크레딧(PTC/ITC)의 이익 기여",
      "금리·조달비용이 대규모 전력·재생에너지 투자에 미치는 영향",
    ],
    riskVariables: [
      "FPSC 요금 심사 지연과 승인 조건 변화",
      "천연가스 가격 변동과 연료비 회수 시차",
      "PTC·ITC 정책 변화로 인한 세금 크레딧 축소",
      "금리 상승과 조달 여건 악화가 프로젝트 경제성에 미치는 영향",
    ],
    suggestedPrompts: [
      "넥스트에라 에너지의 FPL이 기준요금, 요금기반자산, 연료비 회수를 통해 매출과 현금흐름을 만드는 구조를 공시 기준으로 정리해줘.",
      "NEER의 재생에너지 수주잔고, 풍력·태양광·배터리 스토리지 프로젝트, 장기 전력판매계약이 성장 논지에 미치는 영향을 설명해줘.",
      "PTC·ITC 세금 크레딧, 금리, 조달비용 변화가 넥스트에라 에너지의 잉여 현금흐름과 투자 속도에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  NFLX: {
    ticker: "NFLX",
    companyName: "Netflix, Inc.",
    companyNameKo: "넷플릭스",
    sectorKo: "스트리밍",
    signature:
      "유료 멤버십과 ARM, 광고 요금제가 매출을 만들고, 콘텐츠 상각과 라이브 이벤트·게임 투자가 마진과 잉여 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: 넷플릭스는 유료 멤버십, ARM(멤버십당 평균 매출), 광고형 요금제, 콘텐츠 라이선스·제작비와 콘텐츠 상각을 함께 봐야 합니다. 라이브 이벤트, 게임, 광고 기술, 외화 노출과 헤지가 구독 성장 이후의 매출 믹스와 현금흐름 안정성을 결정합니다.",
    researchFocus: [
      "유료 멤버십, ARM, 요금제·지역 믹스",
      "광고 요금제와 광고 기술·영업 확장",
      "콘텐츠 상각, 콘텐츠 제작·라이선스 비용",
      "라이브 이벤트, 게임, 환율, 헤지",
    ],
    riskVariables: [
      "광고형 요금제 수익화 지연과 광고주 수요 둔화",
      "콘텐츠 상각 추정 변경에 따른 영업이익 변동",
      "제작 파업·단체교섭 이슈가 콘텐츠 출시 일정에 미치는 영향",
      "환율 변동과 헤지 한계가 매출·비용에 미치는 영향",
    ],
    suggestedPrompts: [
      "넷플릭스의 유료 멤버십, ARM, 광고 요금제가 매출 성장과 마진에 기여하는 구조를 공시 기준으로 정리해줘.",
      "콘텐츠 상각과 콘텐츠 제작·라이선스 비용이 넷플릭스의 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "라이브 이벤트, 게임, 환율, 헤지가 넷플릭스의 성장 논지와 비용 구조에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  NOW: {
    ticker: "NOW",
    companyName: "ServiceNow",
    companyNameKo: "서비스나우",
    sectorKo: "기업용 워크플로 SaaS",
    signature:
      "서비스나우 플랫폼이 ITSM, ITOM, CSM, Creator 워크플로를 묶어 구독 매출을 만들고, 잔여수행의무와 순 고객 유지율이 성장의 질을 보여줍니다.",
    description:
      "기업 리포트: 서비스나우는 서비스나우 플랫폼을 기반으로 ITSM, ITOM, CSM, Creator 워크플로, 생성형 AI 기능을 확장합니다. 구독 매출, 잔여수행의무, 순 고객 유지율, 대형 엔터프라이즈 갱신과 모듈 업셀링을 함께 봐야 고객 확산이 매출총이익률과 잉여 현금흐름으로 전환되는 속도를 판단할 수 있습니다.",
    researchFocus: [
      "구독 매출과 잔여수행의무의 계약 지속성",
      "ITSM, ITOM, CSM 모듈 확장과 갱신 흐름",
      "Creator 워크플로와 생성형 AI의 업셀·크로스셀 기여",
      "순 고객 유지율, 대형 고객 수, 판매 사이클 변화",
    ],
    riskVariables: [
      "엔터프라이즈 IT 예산 둔화와 갱신 협상 장기화",
      "플랫폼 장애·보안 사고가 ITSM/ITOM 신뢰도에 미치는 영향",
      "생성형 AI와 Creator 워크플로 투자 대비 순 고객 유지율 개선 지연",
      "Salesforce, Microsoft, Atlassian 등 경쟁 스택의 번들 압박",
    ],
    suggestedPrompts: [
      "서비스나우의 구독 매출, 잔여수행의무, 순 고객 유지율이 고객 갱신과 모듈 확산을 어떻게 보여주는지 공시 기준으로 정리해줘.",
      "ITSM, ITOM, CSM, Creator 워크플로가 서비스나우 플랫폼 안에서 업셀·크로스셀로 연결되는 구조를 설명해줘.",
      "생성형 AI 투자, 대형 고객 판매 사이클, 경쟁 스택 압박이 서비스나우의 성장 논지와 마진에 미치는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  NVDA: {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    companyNameKo: "엔비디아",
    sectorKo: "반도체·AI 인프라",
    signature:
      "데이터센터가 매출의 핵심이고 블랙웰, H100, H200, Grace 호퍼, 네트워킹이 AI 인프라 수요를 매출총이익률로 전환합니다.",
    description:
      "기업 리포트: 엔비디아는 데이터센터의 컴퓨팅·네트워킹과 그래픽을 나눠 봐야 합니다. 블랙웰, H100, H200, Grace 호퍼 출하와 가격정책, 네트워킹 스위치·소프트웨어 결합, 대형 클라우드 고객의 투자 속도, 공급 제약과 수출통제가 매출 인식과 매출총이익률을 좌우합니다.",
    researchFocus: [
      "데이터센터의 블랙웰, H100, H200, Grace 호퍼 출하와 가격",
      "컴퓨팅·네트워킹 내 네트워킹, 스위치, 소프트웨어 기여",
      "그래픽 게임·전문 그래픽 매출의 완충 역할",
      "공급 제약, 수출통제, 대형 클라우드 고객 주문 타이밍",
    ],
    riskVariables: [
      "미·중 수출통제 강화에 따른 지역 매출 제한",
      "블랙웰·H100·H200·Grace 호퍼 공급 제약과 패키징·HBM 병목",
      "대형 고객 데이터센터 투자 속도 변화에 따른 주문 타이밍 변동",
      "네트워킹 번들·가격 전략 변화가 매출총이익률에 미치는 영향",
    ],
    suggestedPrompts: [
      "엔비디아의 데이터센터에서 블랙웰, H100, H200, Grace 호퍼가 매출과 매출총이익률로 연결되는 구조를 공시 기준으로 정리해줘.",
      "컴퓨팅·네트워킹의 네트워킹, 스위치, 소프트웨어 결합이 엔비디아의 AI 인프라 성장 논지에 미치는 영향을 설명해줘.",
      "공급 제약과 수출통제가 엔비디아의 대형 클라우드 고객 주문, 가격, 납기에 주는 리스크를 공시 근거로 분석해줘.",
    ],
    questionChains: {},
  },
  ORCL: {
    ticker: "ORCL",
    companyName: "Oracle Corporation",
    companyNameKo: "오라클",
    sectorKo: "기업용 소프트웨어·클라우드",
    signature:
      "오라클 클라우드 인프라(OCI)와 클라우드 서비스 및 라이선스 지원이 성장 축이고, 잔여수행의무와 데이터센터 설비투자가 AI 클라우드 수요의 가시성을 보여줍니다.",
    description:
      "기업 리포트: 오라클은 OCI, 클라우드 서비스 및 라이선스 지원, 클라우드 라이선스 및 온프레미스 라이선스, Cerner(오라클 헬스케어)를 함께 봐야 합니다. AI 인프라 수요와 데이터베이스 클라우드 전환, 잔여수행의무, 데이터센터 리스 약정과 설비투자, Cerner 통합 속도가 매출 성장과 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "오라클 클라우드 인프라(OCI)와 AI 인프라 수요",
      "클라우드 서비스 및 라이선스 지원의 반복매출 구조",
      "클라우드 라이선스 및 온프레미스 라이선스 전환 속도",
      "Cerner(오라클 헬스케어), 잔여수행의무, 데이터센터 리스 약정과 설비투자",
    ],
    riskVariables: [
      "AI 클라우드 수요 둔화에 따른 OCI 성장률 하락",
      "데이터센터 리스 약정과 설비투자 확대에 따른 현금흐름 압박",
      "온프레미스 라이선스 전환 지연과 라이선스 지원 안정성 약화",
      "Cerner(오라클 헬스케어) 통합 지연과 보건 규제 대응 비용",
    ],
    suggestedPrompts: [
      "오라클의 OCI와 클라우드 서비스 및 라이선스 지원이 클라우드 라이선스 및 온프레미스 라이선스 구조를 통해 매출로 연결되는 경로를 공시 기준으로 정리해줘.",
      "오라클의 잔여수행의무, 데이터센터 리스 약정, 설비투자가 AI 클라우드 성장과 잉여 현금흐름에 미치는 영향을 비교해줘.",
      "Cerner(오라클 헬스케어) 통합이 오라클의 클라우드 서비스 및 라이선스 지원 성장 논지에 주는 긍정·부정 변수를 설명해줘.",
    ],
    questionChains: {},
  },
  PEP: {
    ticker: "PEP",
    companyName: "PepsiCo, Inc.",
    companyNameKo: "펩시코",
    sectorKo: "식품·음료",
    signature:
      "Frito-Lay 북미, 퀘이커 푸즈 북미, 펩시코 음료 북미의 가격/믹스와 물량, 생산성 절감이 수익성의 핵심입니다.",
    description:
      "기업 리포트: 펩시코는 간편식 중심의 Frito-Lay 북미, 퀘이커 푸즈 북미, 펩시코 음료 북미를 나눠 봐야 합니다. 가격/믹스, 물량, 생산성 절감, 원재료·포장재·물류비, 프로모션 강도가 세그먼트별 매출총이익률과 영업현금흐름을 결정합니다.",
    researchFocus: [
      "Frito-Lay 북미의 간편식 수익성",
      "퀘이커 푸즈 북미의 카테고리 회복과 비용 구조",
      "펩시코 음료 북미의 가격/믹스와 물량",
      "생산성 절감, 원자재, 패키징, 물류비 영향",
    ],
    riskVariables: [
      "농산물·설탕·시럽·포장재 비용 상승",
      "가격 인상 이후 물량 둔화와 프로모션 비용 증가",
      "생산성 절감 달성 지연에 따른 마진 방어력 약화",
      "물류비·환율 변동이 지역별 영업비용에 미치는 영향",
    ],
    suggestedPrompts: [
      "펩시코의 Frito-Lay 북미, 퀘이커 푸즈 북미, 펩시코 음료 북미가 매출과 마진을 만드는 방식의 차이를 공시 기준으로 정리해줘.",
      "펩시코의 가격/믹스와 물량 변화가 세그먼트별 매출총이익률에 미치는 영향을 비교해줘.",
      "생산성 절감, 원자재, 패키징, 물류비가 펩시코의 영업현금흐름과 성장 논지에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  PFE: {
    ticker: "PFE",
    companyName: "Pfizer Inc.",
    companyNameKo: "화이자",
    sectorKo: "제약",
    signature:
      "Comirnaty·Paxlovid 전환기와 Seagen 결합 후 종양학 축, IRA 가격·리베이트, 비용 재조정이 화이자의 실적 민감도를 결정합니다.",
    description:
      "기업 리포트: 화이자는 Comirnaty와 Paxlovid 이후의 매출 전환, Eliquis·Vyndaqel·Ibrance 같은 성숙 처방약, Seagen 인수로 강화된 종양학 파이프라인을 함께 봐야 합니다. COVID 자산 감소 속도, Seagen ADC 포트폴리오 기여, IRA 할인·환급, 비용 재조정 진행률이 매출총이익률과 영업 레버리지의 핵심 변수입니다.",
    researchFocus: [
      "Comirnaty·Paxlovid의 매출 전환과 마진 영향",
      "Eliquis, Vyndaqel, Ibrance의 성숙 포트폴리오 유지력",
      "Seagen 통합 이후 종양학 파이프라인과 ADC 상업화",
      "IRA 할인·환급과 비용 재조정 효과",
    ],
    riskVariables: [
      "COVID 수요 감소를 Seagen·종양학 매출이 대체하는 속도",
      "IRA 할인·리베이트 변화가 Eliquis·Vyndaqel·Ibrance 마진에 미치는 압박",
      "종양학 승인 지연과 파이프라인 실패가 연구개발 회수에 미치는 영향",
      "비용 재조정 지연과 순이자 비용 증가에 따른 투자 여력 축소",
    ],
    suggestedPrompts: [
      "화이자의 Comirnaty와 Paxlovid 매출 전환이 매출총이익률과 현금흐름에 미치는 영향을 공시 기준으로 정리해줘.",
      "Seagen 결합 이후 화이자의 종양학 파이프라인과 ADC 포트폴리오가 매출·마진·연구개발 비용에 연결되는 경로를 설명해줘.",
      "IRA 할인·환급, 비용 재조정, 순이자 비용이 Eliquis·Vyndaqel·Ibrance의 성장 논지에 미치는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  PG: {
    ticker: "PG",
    companyName: "The Procter & Gamble Company",
    companyNameKo: "프록터앤드갬블",
    sectorKo: "생활소비재",
    signature:
      "뷰티, 그루밍, 헬스케어 관리, 패브릭·홈케어, 베이비·여성·패밀리케어의 유기적 판매와 가격/믹스, 생산성이 수익성의 방향을 정합니다.",
    description:
      "기업 리포트: P&G는 뷰티, 그루밍, 헬스케어 관리, 패브릭·홈케어, 베이비·여성·패밀리케어별로 가격·물량·믹스와 마진 경로가 다릅니다. 유기적 판매, 가격/믹스, 원자재 비용, 생산성, 공급업체 조달, 의무구매 구매 약정, 공급망 금융(SCF)이 매출총이익률과 잉여 현금흐름의 핵심 연결고리입니다.",
    researchFocus: [
      "뷰티, 그루밍, 헬스케어 관리, 패브릭·홈케어, 베이비·여성·패밀리케어별 유기적 판매",
      "가격/믹스와 물량이 카테고리별 매출총이익률에 미치는 영향",
      "원자재 비용, 생산성, 포장·운송비 절감",
      "공급업체 조달, 의무구매, 공급망 금융(SCF)과 운전자본",
    ],
    riskVariables: [
      "원자재·포장·운송비 상승이 가격/믹스를 상쇄할 가능성",
      "소비자 가격 저항과 프로모션 증가로 인한 유기적 판매 둔화",
      "의무구매 구매 약정이 수요 둔화 구간에서 고정비 부담으로 작동할 위험",
      "생산성 개선 지연과 SCF 비용 상승에 따른 현금흐름 압박",
    ],
    suggestedPrompts: [
      "프록터앤드갬블의 뷰티, 그루밍, 헬스케어 관리, 패브릭·홈케어, 베이비·여성·패밀리케어별 유기적 판매와 가격/믹스 차이를 공시 기준으로 정리해줘.",
      "원자재 비용, 생산성, 포장·운송비가 프록터앤드갬블의 매출총이익률과 잉여 현금흐름에 미치는 영향을 분석해줘.",
      "공급업체 조달, 의무구매 구매 약정, 공급망 금융(SCF)이 프록터앤드갬블의 운전자본과 비용 구조에 주는 의미를 설명해줘.",
    ],
    questionChains: {},
  },
  PGR: {
    ticker: "PGR",
    companyName: "The Progressive Corporation",
    companyNameKo: "프로그레시브",
    sectorKo: "손해보험",
    signature:
      "개인용 자동차와 상업용 자동차에서 가격정책, 인수, 보험금 청구 운영이 합산비율을 움직이고, 보유계약 수와 투자 수익이 성장과 완충력을 보여줍니다.",
    description:
      "기업 리포트: 프로그레시브는 개인용 자동차와 상업용 자동차의 보유계약 수, 요율 조정, 손해율, 보험금 청구 비용, 대형재해 손실를 함께 봐야 합니다. 인수 성과는 합산비율에 바로 드러나고, 투자 수익은 보험영업 변동성을 일부 완충합니다.",
    researchFocus: [
      "개인용 자동차 보유계약 수와 가격정책 추세",
      "상업용 자동차 포트폴리오와 인수 조건",
      "손해율, 보험금 청구, 비용 비율이 합산비율에 미치는 영향",
      "대형재해 손실와 투자 수익의 순이익 완충 역할",
    ],
    riskVariables: [
      "개인용 자동차 손해율 악화가 합산비율을 압박하는 구조",
      "대형재해 손실 증가에 따른 지급보험금과 준비금 부담",
      "보유계약 수 둔화와 가격 경쟁 심화",
      "투자 수익 둔화가 인수 외 완충력을 약화할 가능성",
    ],
    suggestedPrompts: [
      "프로그레시브의 개인용 자동차와 상업용 자동차에서 보유계약 수, 가격정책, 손해율이 합산비율로 연결되는 구조를 공시 기준으로 정리해줘.",
      "프로그레시브의 보험금 청구, 비용 비율, 인수 성과와 투자 수익이 순이익을 어떻게 나눠 만드는지 설명해줘.",
      "대형재해 손실이 프로그레시브의 지급보험금, 준비금, 자본 여력에 미치는 영향을 개인용 자동차와 상업용 자동차 기준으로 비교해줘.",
    ],
    questionChains: {},
  },
  PLTR: {
    ticker: "PLTR",
    companyName: "Palantir Technologies Inc.",
    companyNameKo: "팔란티어",
    sectorKo: "AI·데이터 소프트웨어 플랫폼",
    signature:
      "AIP, Gotham, 파운드리, Apollo가 미국 정부와 미국 상업용 계약 확장을 만들고, 잔여계약이치, 잔여수행의무, 청구액이 성장의 질을 보여줍니다.",
    description:
      "기업 리포트: Palantir는 AIP, Gotham, 파운드리, Apollo를 정부·상업 고객의 데이터 운영 플랫폼으로 제공합니다. 미국 정부와 미국 상업용의 대형 계약, 잔여계약이치, 잔여수행의무, 청구액, 계약부채, SBC가 매출 인식과 영업현금흐름의 핵심 연결고리입니다.",
    researchFocus: [
      "AIP, Gotham, 파운드리, Apollo의 플랫폼별 계약 확장",
      "미국 정부와 미국 상업용 매출 믹스",
      "잔여계약이치, 잔여수행의무, 청구액, 계약부채",
      "전략 상업용 계약, 고객 신용, SBC 비용",
    ],
    riskVariables: [
      "미국 정부 예산 지연과 대형 계약 인식 시점 변동",
      "전략 상업용 계약 고객의 자금 조달·신용 리스크",
      "대형 고객 갱신 지연이 청구액와 영업현금흐름에 미치는 영향",
      "SBC와 급여 처리-관련 비용 증가에 따른 영업마진 압박",
    ],
    suggestedPrompts: [
      "팔란티어의 AIP, Gotham, 파운드리, Apollo가 미국 정부와 미국 상업용 계약에서 매출로 연결되는 경로를 공시 기준으로 정리해줘.",
      "잔여계약이치, 잔여수행의무, 청구액, 계약부채가 팔란티어의 성장 지속성 판단에서 어떤 순서로 중요한지 설명해줘.",
      "미국 정부 수주 일정, 전략 상업용 계약, SBC가 팔란티어의 영업마진과 현금흐름에 주는 리스크를 비교해줘.",
    ],
    questionChains: {},
  },
  PM: {
    ticker: "PM",
    companyName: "Philip Morris International",
    companyNameKo: "필립 모리스 인터내셔널",
    sectorKo: "담배·Smoke-Free 소비재",
    signature:
      "IQOS, ZYN, VEEV를 앞세운 스모크프리 제품 전환이 핵심이고, 가열담배 출하량 성장과 연소담배 감소 속도가 마진을 좌우합니다.",
    description:
      "기업 리포트: 필립모리스 인터내셔널은 비미국 중심 연소담배 사업에서 IQOS, ZYN, VEEV 기반 스모크프리 제품으로 전환하고 있습니다. 가열담배 출하량, 니코틴 파우치, 전자담배의 지역별 확산, Altria Agreement 이후 미국 IQOS 상용화, 소비세, 규제 승인, 환율이 순 매출과 영업이익 마진의 핵심 변수입니다.",
    researchFocus: [
      "IQOS, ZYN, VEEV와 스모크프리 제품 매출 믹스",
      "가열담배 출하량, 니코틴 파우치, 전자담배 출하와 지역별 전환",
      "연소담배 물량 감소와 가격/믹스 방어",
      "소비세, FDA·EU·일본 규제, 환율 영향",
    ],
    riskVariables: [
      "소비세 변화가 스모크프리 제품 가격 경쟁력에 미치는 영향",
      "FDA, EU, 일본 등 규제 승인·판매 제한에 따른 IQOS·ZYN 확산 지연",
      "연소담배 감소 속도를 스모크프리 전환이 따라가지 못할 위험",
      "환율 변동과 원료·담뱃잎 조달 비용 상승",
    ],
    suggestedPrompts: [
      "필립 모리스의 IQOS, ZYN, VEEV가 스모크프리 제품 매출 믹스와 영업이익 마진에 기여하는 구조를 공시 기준으로 정리해줘.",
      "가열담배 출하량와 연소담배 물량 변화가 필립모리스의 가격/믹스와 총 이익에 미치는 영향을 비교해줘.",
      "소비세, FDA·EU·일본 규제, 환율이 필립모리스의 스모크프리 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  QCOM: {
    ticker: "QCOM",
    companyName: "QUALCOMM Incorporated",
    companyNameKo: "퀄컴",
    sectorKo: "모바일 반도체·라이선싱",
    signature:
      "QCT의 Snapdragon, 모뎀, RF 프런트엔드 매출과 QTL의 단위당 로열티가 핵심이고, 스마트폰 의존도에서 자동차·IoT 확장으로 성장 축이 이동합니다.",
    description:
      "기업 리포트: Qualcomm은 QCT 반도체 사업과 QTL 기술 라이선싱을 나눠 봐야 합니다. Snapdragon 플랫폼, 모뎀, RF 프런트엔드, 자동차와 IoT 칩 매출, QTL의 특허 로열티, 중국 OEM 라이선스 갱신, 고객의 자체 SoC 전환과 공급망 제약이 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "QCT의 Snapdragon, 모뎀, RF 프런트엔드, 스마트폰 매출",
      "자동차와 IoT 확장, Snapdragon 디지털 섀시·Dragonwing",
      "QTL 단위당 로열티와 중국 OEM 라이선스 갱신",
      "고객 자체 SoC, 파운드리·조립 공급망, 규제 리스크",
    ],
    riskVariables: [
      "프리미엄 스마트폰 출하·출시 타이밍 변동",
      "중국 OEM 비중, 수출통제, 라이선스 회수 지연",
      "QTL 로열티 비율/기본 조정과 라이선스 분쟁",
      "고객 자체 SoC 전환과 경쟁 칩 채택에 따른 Snapdragon 점유율 하락",
    ],
    suggestedPrompts: [
      "퀄컴의 QCT와 QTL 매출이 Snapdragon, 모뎀, RF 프런트엔드, 단위당 로열티를 통해 어떻게 만들어지는지 공시 기준으로 정리해줘.",
      "퀄컴의 자동차와 IoT 확장이 스마트폰 의존도를 얼마나 낮추는지 Snapdragon 디지털 섀시와 Dragonwing 중심으로 설명해줘.",
      "중국 OEM 라이선스, 고객 자체 SoC, 파운드리 공급망 제약이 퀄컴의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  RTX: {
    ticker: "RTX",
    companyName: "RTX Corporation",
    companyNameKo: "알티엑스",
    sectorKo: "항공우주·방산",
    signature:
      "Collins 항공우주, Pratt & Whitney, Raytheon의 수주잔고와 애프터마켓, 방산 계약이 실적 가시성을 만들고 GTF 이슈와 비용 증가가 마진 리스크를 좌우합니다.",
    description:
      "기업 리포트: 알티엑스는 Collins 항공우주의 항공우주 부품·애프터마켓, Pratt & Whitney의 PW1000G Geared Turbofan(GTF)·F135 엔진, Raytheon의 Patriot·AMRAAM·방산 시스템을 함께 봐야 합니다. 상업항공 회복, 방산 계약과 수주잔고, Powder Metal Matter 관련 GTF 비용, FFP/FPI 계약의 비용 증가가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Collins 항공우주의 제품·서비스 믹스와 애프터마켓 수익",
      "Pratt & Whitney의 GTF, F135, 정비 방문, Powder Metal Matter 비용",
      "Raytheon의 Patriot, AMRAAM, GEM-T와 방산 계약 수주잔고",
      "FFP/FPI 계약, 비용 성장, 공급망·micro전자 제약",
    ],
    riskVariables: [
      "GTF 장기 운영 이슈와 Powder Metal Matter 관련 비용 확대",
      "FFP/FPI 계약의 원가 예측 실패와 비용 성장",
      "레어어스·micro전자 공급 차질과 납기 지연",
      "미국 정부 예산·계약 계약 확정 지연에 따른 방산 매출 인식 변동",
    ],
    suggestedPrompts: [
      "알티엑스의 Collins 항공우주, Pratt & Whitney, Raytheon별 수주잔고와 애프터마켓 수익이 매출 가시성에 미치는 영향을 공시 기준으로 정리해줘.",
      "Pratt & Whitney의 GTF, F135, Powder Metal Matter 비용이 알티엑스의 매출총이익률과 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "Raytheon 방산 계약에서 FFP/FPI 조건, 비용 성장, 정부 예산 지연이 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  SCHW: {
    ticker: "SCHW",
    companyName: "The Charles Schwab Corporation",
    companyNameKo: "찰스 슈왑",
    sectorKo: "브로커리지·자산관리",
    signature:
      "투자자 서비스와 자문 서비스에서 고객 자산, 스윕 예금, 순 이자 매출, 자산관리 수수료가 금리와 고객 현금 배분에 민감하게 움직입니다.",
    description:
      "기업 리포트: Charles Schwab은 투자자 서비스와 자문 서비스의 고객 자산, 은행 예금, 스윕 예금, 마진 대출, 거래 매출을 함께 봐야 합니다. 순 이자 매출은 재무상태표와 조달비용에 민감하고, 자산관리 및 관리 수수료는 머니마켓펀드, Mutual Fund OneSource, 관리형 투자 솔루션의 잔고와 평균 수수료율에 연결됩니다.",
    researchFocus: [
      "투자자 서비스와 자문 서비스의 고객 자산 흐름",
      "순 이자 매출, 은행 예금, 스윕 예금, 마진 대출",
      "자산관리 및 관리 수수료와 머니마켓펀드",
      "거래 매출, 주문흐름 매출, 재무상태표 자금조달 sources",
    ],
    riskVariables: [
      "고객 현금이 스윕 예금에서 고수익 대체 상품으로 이동할 위험",
      "금리·조달비용 변화가 순 이자 마진에 미치는 영향",
      "거래 매출 변동성과 시장 volatility 둔화",
      "보상비·소프트웨어·규제비용 증가에 따른 운영비 압박",
    ],
    suggestedPrompts: [
      "찰스 슈왑의 투자자 서비스와 자문 서비스에서 고객 자산, 은행 예금, 스윕 예금가 순 이자 매출로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Schwab 머니마켓펀드, Mutual Fund OneSource, 관리형 투자 솔루션이 자산관리 및 관리 수수료에 기여하는 방식을 설명해줘.",
      "스윕 예금 이동, 금리 경로, 거래 매출 변동이 찰스 슈왑의 성장 논지와 재무상태표에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  SPGI: {
    ticker: "SPGI",
    companyName: "S&P Global Inc.",
    companyNameKo: "S&P 글로벌",
    sectorKo: "금융정보·지수·벤치마크",
    signature:
      "신용평가의 발행 민감 매출과 시장 인텔리전스, 원자재 인사이트, S&P Dow Jones 지수, 모빌리티의 구독 매출이 포트폴리오 수익성을 나눠 만듭니다.",
    description:
      "기업 리포트: S&P 글로벌은 신용평가, 시장 인텔리전스, S&P Dow Jones 지수, 원자재 인사이트, 모빌리티를 함께 봐야 합니다. 신용평가 거래 매출은 채권 발행에 민감하고, 시장 인텔리전스·원자재 인사이트·모빌리티의 구독 매출, 지수의 운용자산 연동 수수료와 사용량 기반 로열티가 반복매출과 시장 민감도를 조합합니다.",
    researchFocus: [
      "신용평가 거래 매출과 청구 발행액",
      "시장 인텔리전스와 원자재 인사이트 구독 매출",
      "S&P Dow Jones 지수의 운용자산 연동 수수료와 royalties",
      "모빌리티 데이터·리콜·자동차 시장 노출",
    ],
    riskVariables: [
      "금리·신용환경 변화에 따른 발행 둔화와 신용평가 매출 변동",
      "지수 운용자산과 파생상품 거래량 감소에 따른 운용자산 연동 수수료 압박",
      "모빌리티의 자동차 생산·중고차·리콜 데이터 수요 변동",
      "데이터 규제·AI 규제·투명성 요구 증가에 따른 비용 상승",
    ],
    suggestedPrompts: [
      "S&P 글로벌 신용평가의 거래 매출과 non-거래 매출이 청구 발행액와 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "시장 인텔리전스, 원자재 인사이트, 모빌리티의 구독 매출 성격과 S&P Dow Jones 지수의 운용자산 연동 수수료를 비교해줘.",
      "발행 둔화, 지수 운용자산 변화, 자동차 데이터 수요가 S&P 글로벌의 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  STX: {
    ticker: "STX",
    companyName: "Seagate Technology Holdings plc",
    companyNameKo: "씨게이트",
    sectorKo: "데이터 저장장치",
    signature:
      "니어라인과 대용량 스토리지가 데이터센터 수요를 흡수하고, 엑사바이트 출하량, 평균 판매 가격, Mozaic HAMR 전환이 수익성을 좌우합니다.",
    description:
      "기업 리포트: Seagate는 클라우드 고객의 니어라인 하드디스크 수요, 대용량 스토리지, Mozaic·HAMR 기반 고용량 전환을 함께 봐야 합니다. 데이터센터와 Edge IoT 수요, 엑사바이트 출하량, 평균 판매 가격, 제품 믹스, 구매 약정과 재고 조정이 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "니어라인과 대용량 스토리지 수요 구조",
      "Mozaic·HAMR 기반 고용량 제품 전환",
      "엑사바이트 출하량, 평균 판매 가격, 제품 믹스",
      "클라우드 고객, 구매 약정, 재고 부담",
    ],
    riskVariables: [
      "니어라인 수요 변동에 따른 엑사바이트 출하량와 주문 타이밍 민감도",
      "Mozaic·HAMR 양산·고객 인증 지연",
      "클라우드 고객 주문 변경으로 인한 재고 누적 또는 품절",
      "구매 약정과 고정비 구조가 수요 조정기에 현금흐름을 압박할 가능성",
    ],
    suggestedPrompts: [
      "씨게이트의 니어라인 하드디스크와 대용량 스토리지 수요가 엑사바이트 출하량, 평균 판매 가격, 매출총이익률로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Mozaic·HAMR 전환과 클라우드 고객 수요가 씨게이트의 제품 믹스와 성장 논지에 미치는 영향을 설명해줘.",
      "구매 약정, 재고, 주문 취소·조정이 씨게이트의 잉여 현금흐름과 조달 효율에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  SYK: {
    ticker: "SYK",
    companyName: "Stryker Corporation",
    companyNameKo: "스트라이커",
    sectorKo: "의료기기",
    signature:
      "의료·수술 및 신경기술와 정형외과·척추이 실적의 두 축이고, Mako 시술 건수와 병원 자본 지출이 임플란트·장비 수요를 좌우합니다.",
    description:
      "기업 리포트: 스트라이커는 의료·수술 및 신경기술, 정형외과·척추을 나눠 봐야 합니다. Mako 무릎 전치환·고관절 전치환·부분 무릎치환 시술 건수, 임플란트 채택, 병원 장비 업그레이드, 환급과 병원 자본 지출, 제품 책임와 리콜 리스크가 매출총이익률과 성장 속도의 핵심 변수입니다.",
    researchFocus: [
      "의료·수술 및 신경기술의 수술기기·neurotechnology 믹스",
      "정형외과·척추의 임플란트, Mako 시술 건수",
      "병원 자본 지출, 환급, 장비 업그레이드 주기",
      "제품 책임, 리콜, 품질·규제 리스크",
    ],
    riskVariables: [
      "Mako와 핵심 임플란트 시술 건수 둔화",
      "병원 자본 지출 감소에 따른 신제품 채택 지연",
      "재료비·운송비 상승과 가격 인하 압박에 따른 마진 훼손",
      "제품 책임 claim, 리콜, 규제 분쟁 확대",
    ],
    suggestedPrompts: [
      "스트라이커의 의료·수술 및 신경기술와 정형외과·척추이 매출·영업이익을 만드는 방식의 차이를 공시 기준으로 정리해줘.",
      "Mako 무릎 전치환, 고관절 전치환, 부분 무릎치환 시술 건수가 임플란트 채택과 병원 장비 업그레이드 수요에 미치는 영향을 설명해줘.",
      "병원 자본 지출, 환급, 제품 책임, 리콜 리스크가 스트라이커의 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  T: {
    ticker: "T",
    companyName: "AT&T Inc.",
    companyNameKo: "AT&T",
    sectorKo: "통신",
    signature:
      "모빌리티의 후불 휴대폰 순 순증·이탈률·ARPU와 소비자 유선의 광섬유 확장, 주파수 투자와 부채 축소가 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: AT&T는 모빌리티, 소비자 유선, 비즈니스 유선을 나눠 봐야 합니다. 후불 휴대폰 순 순증, 이탈률, ARPU, AT&T Fiber와 Internet Air, 주파수 확보, 공급업체 금융과 공급업체 금융, 부채 축소가 서비스 매출과 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "모빌리티의 후불 휴대폰 순 순증, 이탈률, ARPU",
      "소비자 유선의 AT&T Fiber, Internet Air, 고정 무선",
      "비즈니스 유선 레거시 서비스 축소와 비용 재배치",
      "주파수 투자, 공급업체 금융, 공급업체 금융, 부채 축소",
    ],
    riskVariables: [
      "후불 이탈률 상승과 ARPU 방어력 약화",
      "레거시 wireline 매출 감소와 고정비 재배치 지연",
      "주파수·광섬유 투자와 공급업체 금융이 잉여현금흐름을 압박할 가능성",
      "부채 상환, 배당, 자사주 매입 간 자본배분 제약",
    ],
    suggestedPrompts: [
      "AT&T 모빌리티의 후불 휴대폰 순 순증, 이탈률, ARPU가 서비스 매출과 잉여 현금흐름으로 연결되는 구조를 공시 기준으로 정리해줘.",
      "AT&T Fiber, Internet Air, 고정 무선 확장이 소비자 유선 성장과 레거시 축소를 어떻게 상쇄하는지 설명해줘.",
      "주파수 투자, 공급업체 금융, 공급업체 금융, 부채 축소가 AT&T의 성장 논지와 자본배분에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  TMO: {
    ticker: "TMO",
    companyName: "Thermo Fisher Scientific Inc.",
    companyNameKo: "써모 피셔",
    sectorKo: "생명과학 장비·진단",
    signature:
      "생명과학 솔루션, 분석기기, 전문진단, 실험실 제품·바이오파마 서비스가 제약·바이오테크 수요와 임상연구 투자를 매출로 전환합니다.",
    description:
      "기업 리포트: Thermo Fisher는 생명과학 솔루션의 바이오생산, 분석기기의 크로마토그래피·질량분석·전자현미경, 전문진단의 임상진단, 실험실 제품·바이오파마 서비스의 제약 서비스·임상 연구를 함께 봐야 합니다. 중국 수요, 제약·바이오테크 자금조달, 정부 자금지원, 인수 통합과 공급망 비용이 성장과 마진의 핵심 변수입니다.",
    researchFocus: [
      "생명과학 솔루션의 바이오생산과 유전과학",
      "분석기기의 크로마토그래피, 질량분석, 전자현미경",
      "전문진단의 임상진단와 이식진단",
      "LPBS의 제약 서비스, 임상 연구, 무균 충전·마감",
    ],
    riskVariables: [
      "중국 수요 둔화와 현지조달·규제 요구 강화",
      "제약·바이오테크 자금조달과 정부 자금지원 둔화",
      "관세, 환율, 원재료, 에너지, 물류 비용 상승",
      "인수 통합, 재구조화, 시설 통폐합에 따른 이익 변동성",
    ],
    suggestedPrompts: [
      "써모 피셔의 생명과학 솔루션, 분석기기, 전문진단, LPBS가 매출과 마진을 만드는 방식의 차이를 공시 기준으로 정리해줘.",
      "바이오생산, 임상 연구, 제약 서비스가 제약·바이오테크 자금조달 변화에 어떻게 반응하는지 설명해줘.",
      "중국 수요 둔화, 정부 자금지원, 관세·환율·물류비가 써모 피셔의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  TMUS: {
    ticker: "TMUS",
    companyName: "T-Mobile US, Inc.",
    companyNameKo: "티모바일",
    sectorKo: "무선통신",
    signature:
      "후불 휴대폰 순 순증, 이탈률, ARPU, 5G 주파수 효율, 고정 무선 성장이 서비스 매출과 잉여 현금흐름의 핵심 driver입니다.",
    description:
      "기업 리포트: 티모바일는 후불·prepaid 무선 구독 기반 서비스 매출을 중심으로 봐야 합니다. 후불 휴대폰 순 순증, 이탈률, ARPU, 5G 주파수과 네트워크 integration, 고정 무선(5G 홈 Internet), 고객 인수 비용과 device subsidy가 매출 질과 현금흐름을 결정합니다.",
    researchFocus: [
      "후불 휴대폰 순 순증와 이탈률",
      "ARPU와 서비스 매출 믹스",
      "5G 주파수, 네트워크 integration, 고정 무선",
      "고객 인수 비용, device subsidy, 잉여 현금흐름",
    ],
    riskVariables: [
      "요금 경쟁 심화에 따른 후불 이탈률 압력",
      "고객 인수 비용과 device subsidy 상승",
      "5G 주파수·네트워크 투자 부담으로 인한 잉여현금흐름 압박",
      "고정 무선 성장 둔화와 ARPU 믹스 약화",
    ],
    suggestedPrompts: [
      "티모바일의 후불 휴대폰 순 순증, 이탈률, ARPU가 서비스 매출과 잉여 현금흐름으로 연결되는 구조를 공시 기준으로 정리해줘.",
      "5G 주파수, 네트워크 integration, 고정 무선(5G 홈 Internet)가 티모바일의 마진과 성장 논지에 미치는 영향을 설명해줘.",
      "고객 인수 비용과 device subsidy가 티모바일의 이탈률 대응력과 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  TSLA: {
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    companyNameKo: "테슬라",
    sectorKo: "전기차·에너지",
    signature:
      "모델 3/Y와 사이버트럭 deliveries, 자동차 매출총이익률, 에너지 Generation 및 Storage, 완전자율주행·슈퍼차저 수익화가 실적의 핵심 축입니다.",
    description:
      "기업 리포트: 테슬라는 모델 3/Y, 사이버트럭 중심 deliveries와 가격 정책, 배터리·원재료 비용, 제조 효율이 자동차 매출총이익률을 좌우합니다. 에너지 Generation 및 Storage의 Megapack, Solar, Powerwall, 완전자율주행 옵션·구독, 슈퍼차저, 보험·서비스, 규제 크레딧를 함께 봐야 자동차 외 수익과 잉여 현금흐름을 판단할 수 있습니다.",
    researchFocus: [
      "모델 3/Y, 사이버트럭 deliveries와 차량 믹스",
      "자동차 매출총이익률, 가격 정책, 배터리·원재료 비용",
      "에너지 Generation 및 Storage의 Megapack, Solar, Powerwall",
      "완전자율주행, 슈퍼차저, 보험·서비스, 규제 크레딧",
    ],
    riskVariables: [
      "가격 인하와 수요 둔화가 자동차 매출총이익률에 미치는 압박",
      "사이버트럭 ramp-up, 품질·보증·재고 리스크",
      "완전자율주행 규제·안전 이슈와 소프트웨어 수익화 지연",
      "Megapack 프로젝트 일정·인허가 지연과 규제 크레딧 둔화",
    ],
    suggestedPrompts: [
      "테슬라의 모델 3/Y와 사이버트럭 deliveries가 자동차 매출총이익률과 가격 정책에 연결되는 구조를 공시 기준으로 정리해줘.",
      "완전자율주행, 슈퍼차저, 보험·서비스가 테슬라의 반복 수익과 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "에너지 Generation 및 Storage에서 Megapack, Solar, Powerwall과 규제 크레딧이 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  TXN: {
    ticker: "TXN",
    companyName: "Texas Instruments Incorporated",
    companyNameKo: "텍사스 인스트루먼트",
    sectorKo: "아날로그·임베디드 반도체",
    signature:
      "Analog와 Embedded 처리, 300-mm wafer 제조역량, 산업·자동차 수요와 factory loading이 매출총이익률과 잉여 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: 텍사스 인스트루먼트는 Analog의 전력·signal chain과 Embedded 처리의 micro컨트롤러s·processors를 중심으로 산업·자동차 고객에 노출됩니다. 300-mm wafer 생산능력 확장, 자체 fab·assembly/test, 재고 전략, factory loading, 감가상각이 매출총이익률과 현금흐름의 핵심 연결고리입니다.",
    researchFocus: [
      "Analog와 Embedded 처리의 사업부 믹스",
      "300-mm wafer 생산능력 확장과 LFAB ramp",
      "산업, 자동차, 데이터센터 수요와 출하량",
      "재고일수, factory loading, 감가상각과 매출총이익률",
    ],
    riskVariables: [
      "산업·자동차 반도체 사이클 둔화에 따른 출하량 감소",
      "생산능력 확장 선행과 factory loading 하락에 따른 매출총이익률 압박",
      "재고 일수 증가와 obsolete 재고 위험",
      "고객·유통업체 구매 조정과 금리 상승에 따른 이자비용 부담",
    ],
    suggestedPrompts: [
      "텍사스 인스트루먼트의 Analog와 Embedded 처리 매출 믹스가 산업·자동차 수요와 매출총이익률에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "300-mm wafer 생산능력 확장, LFAB ramp, factory loading이 TXN의 비용 구조와 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "재고일수, 유통업체 구매 조정, 감가상각 증가가 TXN의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  UBER: {
    ticker: "UBER",
    companyName: "Uber Technologies, Inc.",
    companyNameKo: "우버",
    sectorKo: "모빌리티·딜리버리 플랫폼",
    signature:
      "모빌리티, 배송, 화물가 이동 건수와 MAPCs를 총예약액로 확장하고, 수취율과 운전자 인센티브 균형이 수익성과 잉여 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: Uber는 모빌리티 승차, 배송 주문, 화물 물동량를 한 플랫폼에서 연결합니다. MAPCs, 이동 건수, 총예약액, 수취율, driver·배달 파트너 인센티브, 보험·결제 처리 비용, 화물 시장 사이클, 자율주행차와 독립 계약자 분류 규제가 매출총이익률과 adjusted EBITDA의 핵심 변수입니다.",
    researchFocus: [
      "모빌리티, 배송, 화물별 총예약액과 수취율",
      "이동 건수, MAPCs, 매출 Margin, adjusted EBITDA",
      "운전자 인센티브, 배달 파트너 인센티브, 보험·결제 처리 비용",
      "화물 cycle, 자율주행차, 독립 계약자 규제",
    ],
    riskVariables: [
      "독립 계약자 분류와 노동 규제 변화에 따른 비용 구조 변화",
      "운전자 인센티브 확대가 수취율과 수익성을 압박할 가능성",
      "보험료·결제 처리 비용 상승과 규제 준수 비용 증가",
      "화물 경기 둔화와 자율주행차 경쟁 확산",
    ],
    suggestedPrompts: [
      "우버의 모빌리티, 배송, 화물에서 이동 건수, MAPCs, 총예약액, 수취율가 매출로 연결되는 구조를 공시 기준으로 정리해줘.",
      "운전자 인센티브, 배달 파트너 인센티브, 보험·결제 처리 비용이 우버의 adjusted EBITDA와 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "독립 계약자 분류, 화물 사이클, 자율주행차가 우버의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  UNH: {
    ticker: "UNH",
    companyName: "UnitedHealth Group Incorporated",
    companyNameKo: "유나이티드헬스",
    sectorKo: "관리의료·헬스케어 서비스",
    signature:
      "United헬스케어의 보험료·회원 믹스와 Optum 헬스케어, Optum Insight, Optum Rx의 운영 효율이 의료관리비율과 마진을 좌우합니다.",
    description:
      "기업 리포트: UnitedHealth는 보험 사업 United헬스케어와 Optum 헬스케어, Optum Insight, Optum Rx를 함께 봐야 합니다. 상업용, 메디케어 Advantage, Medicaid 회원 믹스와 보험급여 가격정책, 의료관리비율, 약국 관리 서비스, 보험금 심사·데이터 분석, 약가·리베이트 구조가 매출과 영업이익의 핵심 연결고리입니다.",
    researchFocus: [
      "United헬스케어의 상업용, 메디케어 Advantage, Medicaid 회원 믹스",
      "의료관리비율과 보험급여 가격정책",
      "Optum 헬스케어, Optum Insight의 관리 배송·claim analytics",
      "Optum Rx와 약국 관리 서비스, 리베이트·약가 구조",
    ],
    riskVariables: [
      "의료비 이용률 상승이 의료관리비율을 악화할 가능성",
      "메디케어 Advantage 보상 규칙과 위험조정 변화",
      "Medicaid 자격·정책 변화와 회원 믹스 변동",
      "약국 관리 서비스의 리베이트·약가 규제와 데이터 운영 규제 강화",
    ],
    suggestedPrompts: [
      "유나이티드헬스의 United헬스케어에서 상업용, 메디케어 Advantage, Medicaid 회원 믹스와 보험급여 가격정책이 의료관리비율로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Optum 헬스케어, Optum Insight, Optum Rx가 의료관리비율과 영업이익률을 어떻게 보완하는지 설명해줘.",
      "메디케어 Advantage, Medicaid, 약국 관리 서비스 규제 변화가 유나이티드헬스의 성장 논지와 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  UNP: {
    ticker: "UNP",
    companyName: "Union Pacific Corporation",
    companyNameKo: "유니언 퍼시픽",
    sectorKo: "철도 운송",
    signature:
      "화차 적재량, 트래픽 믹스, 연료 할증료가 화물 매출을 만들고, 네트워크 속도와 영업 비율, 인건비 계약이 철도 운영 레버리지를 좌우합니다.",
    description:
      "기업 리포트: 유니언 퍼시픽은 복합운송, 석탄, 농산품, 산업 물동량과 화차 적재량, ARC, 가격·믹스, 연료 할증료를 함께 봐야 합니다. 화차 속도, 터미널 체류, 네트워크 속도, 영업 비율, 인건비 계약와 임금·연료비가 매출총이익률과 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "복합운송, 석탄, 농산품 화차 적재량와 트래픽 믹스",
      "화물 매출, ARC, 가격·믹스, 연료 할증료",
      "네트워크 속도, 화차 속도, 터미널 체류, 영업 비율",
      "인건비 계약, 임금·연료비, 운영비 구조",
    ],
    riskVariables: [
      "복합운송 물동량 둔화와 국제 컨테이너 수요 변동",
      "석탄 수요 감소와 천연가스 전환 압력",
      "연료 할증료 lag와 연료 가격 변동성",
      "인건비 계약 갱신과 임금 상승이 영업 비율에 미치는 영향",
    ],
    suggestedPrompts: [
      "유니언 퍼시픽의 화차 적재량, 복합운송, 석탄, 농산품 믹스가 화물 매출과 영업 비율에 연결되는 구조를 공시 기준으로 정리해줘.",
      "연료 할증료, ARC, 가격·믹스가 UNP의 매출과 잉여 현금흐름에 반영되는 순서를 설명해줘.",
      "네트워크 속도, 터미널 체류, 인건비 계약이 유니언 퍼시픽의 성장 논지와 운영비에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  V: {
    ticker: "V",
    companyName: "Visa Inc.",
    companyNameKo: "비자",
    sectorKo: "글로벌 결제 네트워크",
    signature:
      "결제 물량과 처리 거래가 서비스 매출을 만들고, 국경간 거래액, 비자 다이렉트, 데이터 처리 매출이 수익의 질을 가릅니다.",
    description:
      "기업 리포트: 비자는 결제 물량, 국경간 거래액, 처리 거래를 네트워크 수익으로 전환합니다. 서비스 매출, 데이터 처리 매출, 비자 다이렉트, 부가가치 서비스, 고객 인센티브, 발급사·가맹점 관계, 수수료 규제와 보안 리스크를 함께 봐야 매출총이익률과 현금흐름을 판단할 수 있습니다.",
    researchFocus: [
      "결제 물량, 국경간 거래액, 처리 거래",
      "서비스 매출과 데이터 처리 매출",
      "비자 다이렉트와 부가가치 서비스 성장",
      "고객 인센티브, 환율, 수수료 규제, 보안 리스크",
    ],
    riskVariables: [
      "수수료 규제와 지급결제 환경 변화에 따른 가격 전가력 제한",
      "사이버보안 사고·결제 처리 장애가 처리 거래에 미치는 영향",
      "AML/CFT, 개인정보, 국가별 결제 규제에 따른 준수 비용 증가",
      "여행·전자상거래 수요 변동에 따른 국경간 거래액 둔화",
    ],
    suggestedPrompts: [
      "비자의 결제 물량, 국경간 거래액, 처리 거래가 서비스 매출과 데이터 처리 매출로 연결되는 구조를 공시 기준으로 정리해줘.",
      "비자 다이렉트와 부가가치 서비스가 비자의 매출총이익률과 현금흐름에 어떤 의미를 갖는지 설명해줘.",
      "고객 인센티브, 수수료 규제, 보안 리스크가 비자의 성장 논지와 마진 안정성에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  VRTX: {
    ticker: "VRTX",
    companyName: "Vertex Pharmaceuticals Incorporated",
    companyNameKo: "버텍스",
    sectorKo: "바이오테크",
    signature:
      "Trikafta/Kaftrio와 ALYFTREK가 낭포성 섬유증 매출축을 유지하고, CASGEVY와 Journavx가 비낭포성 섬유증 다각화와 파이프라인 확장 속도를 보여줍니다.",
    description:
      "기업 리포트: 버텍스는 낭포성 섬유증 치료제 Trikafta/Kaftrio, ALYFTREK를 중심으로 수익을 만들며 CASGEVY, Journavx(VX-548/suzetrigine), povetacicept, inaxaplin 등 비낭포성 섬유증 파이프라인으로 확장을 시도합니다. 환급, 적응증 확대, 협업 매출, CRISPR·Zai 등 제휴 구조가 매출 인식과 연구개발 회수의 핵심 변수입니다.",
    researchFocus: [
      "Trikafta/Kaftrio, ALYFTREK의 낭포성 섬유증 매출과 환급",
      "CASGEVY 상업화와 SCD/TDT 접근성",
      "Journavx(VX-548/suzetrigine)와 비낭포성 섬유증 파이프라인",
      "협업 매출, CRISPR·Zai 제휴, in-라이선싱 비용",
    ],
    riskVariables: [
      "환급 지연으로 CF·비낭포성 섬유증 제품 매출 인식이 늦어질 가능성",
      "CASGEVY와 Journavx 초기 상용화·처방 채택 리스크",
      "파이프라인 임상 실패 또는 적응증 확대 지연",
      "세포·유전자치료 제조와 공급망 복잡성",
    ],
    suggestedPrompts: [
      "버텍스의 Trikafta/Kaftrio, ALYFTREK, CASGEVY, Journavx가 매출과 마진에 기여하는 구조를 공시 기준으로 정리해줘.",
      "환급과 적응증 확대가 버텍스의 낭포성 섬유증 프랜차이즈와 비낭포성 섬유증 다각화에 미치는 영향을 설명해줘.",
      "CASGEVY, Journavx, VX-548/suzetrigine, povetacicept, inaxaplin 파이프라인이 성장 논지와 연구개발 리스크에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },
  VZ: {
    ticker: "VZ",
    companyName: "Verizon Communications Inc.",
    companyNameKo: "버라이즌",
    sectorKo: "통신",
    signature:
      "소비자와 비즈니스의 무선 서비스 매출은 후불 휴대폰 순 순증, 이탈률, ARPA가 좌우하고, Fios·고정 무선 접속·주파수·부채가 잉여현금흐름을 결정합니다.",
    description:
      "기업 리포트: Verizon은 소비자와 비즈니스를 나눠 후불 휴대폰 순증, 후불 휴대폰 이탈률, 무선 리테일 후불 ARPA, 무선 서비스 매출을 봐야 합니다. Fios 광섬유 브로드밴드, 고정 무선 접속(FWA), 비즈니스 모빌리티·IoT·보안 서비스, 주파수 확보 비용과 부채 구조가 네트워크 투자와 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "소비자와 비즈니스 매출 믹스, 무선 서비스 매출",
      "후불 휴대폰 순증, 이탈률, ARPA",
      "Fios 광섬유 브로드밴드와 고정 무선 접속(FWA)",
      "주파수 확보 비용, 부채, 설비투자와 잉여 현금흐름",
    ],
    riskVariables: [
      "후불 휴대폰 순증 둔화와 이탈률 상승",
      "ARPA 하락이 무선 서비스 매출 방어에 미치는 압박",
      "Fios·FWA 확장 비용과 장비·유지비 증가",
      "주파수 경쟁, 부채 비용, 배당·네트워크 투자 여력 제약",
    ],
    suggestedPrompts: [
      "버라이즌의 소비자와 비즈니스에서 후불 휴대폰 순증, 이탈률, ARPA가 무선 서비스 매출에 연결되는 구조를 공시 기준으로 정리해줘.",
      "Fios 광섬유 브로드밴드와 고정 무선 접속(FWA)가 Verizon의 브로드밴드 믹스와 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "주파수 확보 비용과 부채 구조가 Verizon의 설비투자, 배당, 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  WDC: {
    ticker: "WDC",
    companyName: "Western Digital",
    companyNameKo: "웨스턴디지털",
    sectorKo: "HDD·데이터 스토리지",
    signature:
      "클라우드 하드디스크 수요와 엑사바이트 판매량, 엑사바이트당 평균 판매 가격가 수익성을 좌우하고, Sandisk/Flash 분리 이후 하드디스크 집중도가 더 선명해졌습니다.",
    description:
      "기업 리포트: 웨스턴디지털은 클라우드, 고객, 소비자 end 시장에서 하드디스크 기반 스토리지를 공급합니다. 클라우드 고객의 니어라인·대용량 하드디스크 수요, 엑사바이트 판매량, 평균 판매 가격, 재고, 상위 고객 집중도, Sandisk와 Flash 비즈니스 분리 이후의 비용 구조가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "클라우드 하드디스크 수요와 엑사바이트 판매량",
      "엑사바이트당 평균 판매 가격와 제품 믹스",
      "Sandisk/Flash 분리 이후 하드디스크 비용 구조",
      "재고, 상위 클라우드 고객 집중도, 공급망 비용",
    ],
    riskVariables: [
      "클라우드 고객 주문 변동과 상위 고객 집중도 리스크",
      "하드디스크 단일 사업 집중에 따른 대체기술·가격 압박",
      "재고 조정 실패와 공급망 비용 상승",
      "Sandisk 지분·분리 관련 손익과 차입 구조 변동성",
    ],
    suggestedPrompts: [
      "웨스턴디지털의 클라우드 하드디스크 수요가 엑사바이트 판매량과 엑사바이트당 평균 판매 가격를 통해 매출총이익률에 미치는 영향을 공시 기준으로 정리해줘.",
      "Sandisk/Flash 분리 이후 웨스턴디지털의 하드디스크 집중 구조와 비용 구조 변화가 성장 논지에 미치는 영향을 설명해줘.",
      "클라우드 고객 집중도, 재고, 공급망 비용이 웨스턴디지털의 잉여 현금흐름과 가격 협상력에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  WELL: {
    ticker: "WELL",
    companyName: "Welltower Inc.",
    companyNameKo: "웰타워",
    sectorKo: "헬스케어 리츠",
    signature:
      "Seniors Housing 영업, Triple-순, Outpatient 의료의 NOI 구조에서 점유율, 비율 성장, 임대료 escalators, operator concentration이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: 웰타워는 Seniors Housing 영업의 resident 수수료 및 서비스, Triple-순 리스의 고정·contingent 임대료 escalators, Outpatient 의료 포트폴리오 재배치를 함께 봐야 합니다. same-매장 NOI, 점유율, 비율 성장, operator concentration, 이자 비용과 자산 매각·재투자 타이밍이 AFFO와 성장 논지의 핵심 변수입니다.",
    researchFocus: [
      "Seniors Housing 영업의 점유율, 비율 성장, resident 수수료 및 서비스",
      "Triple-순 리스의 임대료 escalators와 임차인 믹스",
      "Outpatient 의료 매각·재투자와 same-매장 NOI",
      "operator concentration, 이자 비용, AFFO 민감도",
    ],
    riskVariables: [
      "점유율 둔화와 비율 성장 정체가 same-매장 NOI를 압박할 가능성",
      "operator concentration과 운영사 재무건전성 악화",
      "임대료 escalators 조건 미충족에 따른 rental 수익 둔화",
      "금리 상승과 이자 비용 증가, 자산 매각·재투자 지연",
    ],
    suggestedPrompts: [
      "웰타워의 Seniors Housing 영업, Triple-순, Outpatient 의료이 same-매장 NOI와 AFFO를 만드는 구조를 공시 기준으로 정리해줘.",
      "점유율, 비율 성장, resident 수수료 및 서비스, 임대료 escalators가 웰타워의 현금흐름에 전달되는 경로를 설명해줘.",
      "operator concentration, 이자 비용, Outpatient 의료 매각·재투자가 웰타워의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  ACN: {
    ticker: "ACN",
    companyName: "Accenture",
    companyNameKo: "액센추어",
    sectorKo: "IT 컨설팅·Managed Services",
    signature:
      "컨설팅과 관리형 서비스 신규 계약이 매출 전환 속도를 나누고, 생성형 AI·클라우드·보안 수요와 인력 투입률·이직률이 계약 수익성을 좌우합니다.",
    description:
      "기업 리포트: 액센추어는 전략·컨설팅, 테크놀로지, 운영, 송, 인더스트리 X를 재창조 서비스로 묶어 제공합니다. 컨설팅과 관리형 서비스의 신규 계약 전환 속도, 미주·유럽·중동·아프리카·아시아태평양 지역 수요, 통신·미디어·기술·금융 서비스·헬스케어 & 공공 서비스·제품·자원 산업군, 인력 투입률, 인력, 자발적 이직률, 급여 처리·하도급 비용이 영업이익률의 핵심 변수입니다.",
    researchFocus: [
      "컨설팅과 관리형 서비스 신규 계약·매출 전환 속도",
      "생성형 AI, 클라우드, 보안, 인더스트리 X 수요",
      "미주, 유럽·중동·아프리카, 아시아태평양과 산업군별 성장",
      "인력 투입률, 인력, 이직률, 계약 수익성",
    ],
    riskVariables: [
      "단기 컨설팅 수요 둔화와 관리형 서비스 대형계약 전환 지연",
      "인력 투입률·스킬 매칭 실패와 보상비 압박",
      "FX 변동과 지역별 고객 IT 예산 둔화",
      "보안 사고, 생태계 파트너 협업 약화, AI 제휴 실패",
    ],
    suggestedPrompts: [
      "액센추어의 컨설팅과 관리형 서비스 신규 계약이 매출과 영업이익률로 전환되는 속도의 차이를 공시 기준으로 정리해줘.",
      "생성형 AI, 클라우드, 보안, 인더스트리 X 수요가 액센추어의 지역·산업군별 성장에 미치는 영향을 설명해줘.",
      "인력 투입률, 인력, 자발적 이직률, 급여 처리·하도급 비용이 계약 수익성에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  ADP: {
    ticker: "ADP",
    companyName: "Automatic Data Processing",
    companyNameKo: "애드피",
    sectorKo: "인적자본 관리",
    signature:
      "고용주 서비스와 PEO 서비스가 급여 처리·인적자본관리 수익을 만들고, 신규 계약, 고객 유지율, 급여 처리 건수, 고객 예치금 운용 수익이 실적 민감도를 결정합니다.",
    description:
      "기업 리포트: ADP는 고용주 서비스와 PEO 서비스를 통해 급여 처리, 인적자본관리, HR 아웃소싱, 글로벌 솔루션를 제공합니다. 신규 영업 계약, 고객 유지율, 급여 처리 건수, 평균 사업장 직원 수, PEO 무마진 복리후생 통과 비용, 고객 예치금 이자수익와 고객 자금 유동성가 매출과 마진의 핵심 변수입니다.",
    researchFocus: [
      "고용주 서비스의 신규 계약, 고객 유지율, 급여 처리 건수",
      "PEO 서비스의 사업장 직원 수와 복리후생 통과 비용",
      "고객 예치금 잔액과 고객 예치금 이자수익",
      "ADP 배상 비용, 산재보상, 고객 자금 유동성",
    ],
    riskVariables: [
      "고용 둔화가 급여 처리 건수와 신규 영업 계약에 미치는 영향",
      "PEO 무마진 복리후생 통과 비용 확대에 따른 마진 희석",
      "금리 변동이 고객 예치금 이자수익에 미치는 영향",
      "고객 예치금 운용·단기 조달시장 변동에 따른 유동성 리스크",
    ],
    suggestedPrompts: [
      "ADP의 고용주 서비스와 PEO 서비스가 급여 처리, 인적자본관리, HR 아웃소싱 매출을 만드는 구조를 공시 기준으로 정리해줘.",
      "신규 영업 계약, 고객 유지율, 급여 처리 건수, 고객 예치금 이자수익이 ADP의 이익률에 연결되는 경로를 설명해줘.",
      "PEO 서비스의 사업장 직원 수, 복리후생 통과 비용, ADP 배상 비용이 ADP의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  APH: {
    ticker: "APH",
    companyName: "Amphenol",
    companyNameKo: "앰페놀",
    sectorKo: "커넥터·케이블·센서",
    signature:
      "Harsh Environment 솔루션, Communications 솔루션, Interconnect 및 Sensor 시스템이 통신, 항공우주, 방산, 자동차 수요와 인수 통합 성과를 매출로 전환합니다.",
    description:
      "기업 리포트: 앰페놀은 interconnect, 케이블, sensor, antenna 제품을 Harsh Environment 솔루션, Communications 솔루션, Interconnect 및 Sensor 시스템로 제공합니다. RF·광학·고속 인터커넥트, ruggedized connector, 케이블 assemblies, sensor 포트폴리오가 항공우주, 방산, 자동차, communications, IT/datacom 고객 수요에 연결되고 인수 통합이 제품군과 고객 기반을 넓힙니다.",
    researchFocus: [
      "Harsh Environment 솔루션의 ruggedized interconnect와 방산·항공우주 수요",
      "Communications 솔루션의 RF, optical, high-speed interconnect, 케이블, antenna",
      "Interconnect 및 Sensor 시스템의 sensor, backplane, 케이블 assemblies",
      "자동차, 항공우주, 방산, communications end 시장과 인수 통합",
    ],
    riskVariables: [
      "원재료·부품·물류비 상승에 따른 매출총이익률 압박",
      "제한 공급원 의존과 조달 지연",
      "FX 변동과 지역별 제조·고객 수요 변동",
      "인수 통합 과정의 생산·인력·시스템 정렬 리스크",
    ],
    suggestedPrompts: [
      "앰페놀의 Harsh Environment 솔루션, Communications 솔루션, Interconnect 및 Sensor 시스템가 항공우주, 방산, 자동차, communications 수요에 연결되는 구조를 공시 기준으로 정리해줘.",
      "RF·광학·고속 interconnect, 케이블 assemblies, sensor 제품군이 앰페놀의 매출총이익률과 현금흐름에 미치는 영향을 설명해줘.",
      "인수 통합, 제한 공급원 의존, 원재료·물류비가 앰페놀의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  BA: {
    ticker: "BA",
    companyName: "The Boeing Company",
    companyNameKo: "보잉",
    sectorKo: "항공우주·국방",
    signature:
      "상업용 Airplanes, 방산 우주 & 보안, 글로벌 서비스의 수주잔고를 생산 비율와 잉여 현금흐름으로 얼마나 빠르게 전환하는지가 핵심입니다.",
    description:
      "기업 리포트: Boeing은 상업용 Airplanes의 737 MAX·787 생산·인도, 방산 우주 & 보안의 방산·우주 계약 집행, 글로벌 서비스의 정비·부품·디지털 지원 수익을 함께 봐야 합니다. 수주잔고, 생산 비율, certification, 공급업체 품질, 납기 지연과 잉여 현금흐름 전환 속도가 실적의 핵심 변수입니다.",
    researchFocus: [
      "상업용 Airplanes의 737 MAX와 787 수주잔고·생산 비율",
      "방산 우주 & 보안 계약 집행과 비용 초과",
      "글로벌 서비스의 정비·부품·운항지원 수익",
      "certification, 공급업체 품질, 납기와 잉여 현금흐름",
    ],
    riskVariables: [
      "공급업체 품질 악화와 생산 차질",
      "certification 지연 및 안전·규제 대응 비용",
      "수주잔고 소진 지연과 인도 병목",
      "방산 고정가격 계약 비용 초과와 글로벌 서비스 회수 지연",
    ],
    suggestedPrompts: [
      "보잉의 상업용 Airplanes, 방산 우주 & 보안, 글로벌 서비스별 매출 구성과 수주잔고 전환 경로를 공시 기준으로 정리해줘.",
      "737 MAX와 787의 생산 비율, certification, 공급업체 품질가 보잉의 매출과 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "방산 계약 비용 초과, 납기 지연, 글로벌 서비스 회수 지연이 보잉의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  BK: {
    ticker: "BK",
    companyName: "The Bank of New York Mellon Corporation",
    companyNameKo: "뱅크 오브 뉴욕 멜론",
    sectorKo: "수탁은행·자산관리",
    signature:
      "Securities 서비스, 시장 및 자산관리 서비스, 투자 및 자산관리의 AUC/A·운용자산 기반 수수료 매출과 순이자수익이 수익의 핵심입니다.",
    description:
      "기업 리포트: BNY Mellon은 Securities 서비스의 custody·fund 서비스, 시장 및 자산관리 서비스의 결제·clearance·collateral, 투자 및 자산관리의 운용자산 수수료를 함께 봐야 합니다. 자산 under custody/administration(AUC/A), 자산 under 관리(운용자산), 예금 베타, 순이자수익, 시장 변동성과 결제·클리어링 운영 리스크가 실적을 좌우합니다.",
    researchFocus: [
      "Securities 서비스의 AUC/A 기반 수수료 매출",
      "시장 및 자산관리 서비스의 결제, clearance, collateral 관리",
      "투자 및 자산관리의 운용자산과 수수료율",
      "순이자수익, 예금 베타, 예금 믹스",
    ],
    riskVariables: [
      "금리·예금 베타 변화에 따른 순이자수익 민감도",
      "시장 하락이 AUC/A·운용자산 기반 수수료 매출에 미치는 영향",
      "자본·유동성·AML 규제 강화에 따른 비용 증가",
      "사이버·결제·클리어링 운영 인프라 리스크",
    ],
    suggestedPrompts: [
      "BNY Mellon의 Securities 서비스, 시장 및 자산관리 서비스, 투자 및 자산관리별 수수료 매출과 순이자수익 발생 구조를 공시 기준으로 정리해줘.",
      "AUC/A와 운용자산이 BNY Mellon의 수수료 수익과 현금흐름으로 전환되는 경로를 설명해줘.",
      "예금 베타, 금리 경로, 결제·클리어링 운영 리스크가 BNY Mellon의 성장 논지와 마진에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  BMY: {
    ticker: "BMY",
    companyName: "Bristol Myers Squibb",
    companyNameKo: "브리스틀마이어스 스크리브",
    sectorKo: "제약",
    signature:
      "Eliquis와 Revlimid의 LOE·가격 압력을 Opdivo, Breyanzi, Camzyos, Opdualag 성장과 파이프라인 실행으로 얼마나 상쇄하느냐가 핵심입니다.",
    description:
      "기업 리포트: 브리스틀마이어스 스크리브는 Eliquis, Revlimid 같은 Legacy Portfolio와 Opdivo, Breyanzi, Camzyos, Opdualag 중심 Growth Portfolio를 함께 봐야 합니다. LOE, 가격·환급 압력, acquired IPRD와 무형자산 상각, mezigdomide·iberdomide·obexelimab 등 파이프라인 이벤트가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Eliquis·Revlimid LOE와 가격·환급 압력",
      "Opdivo, Breyanzi, Camzyos, Opdualag 성장 포트폴리오",
      "acquired IPRD, 무형자산 상각, IPRD impairment",
      "mezigdomide, iberdomide, obexelimab, iza-bren 파이프라인",
    ],
    riskVariables: [
      "Eliquis 특허 분쟁과 제네릭 진입",
      "Revlimid 포함 Legacy Portfolio의 LOE 전환 가속",
      "미국 약가 정책과 list 가격 압박",
      "acquired IPRD 비용 변동성과 파이프라인 실패 가능성",
    ],
    suggestedPrompts: [
      "브리스틀마이어스 스크리브의 Eliquis와 Revlimid LOE 압력을 Opdivo, Breyanzi, Camzyos, Opdualag가 얼마나 상쇄하는지 공시 기준으로 정리해줘.",
      "acquired IPRD, 무형자산 상각, IPRD impairment가 BMY의 영업이익률과 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "mezigdomide, iberdomide, obexelimab, iza-bren 파이프라인 이벤트가 성장 논지와 연구개발 리스크에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },

  BX: {
    ticker: "BX",
    companyName: "Blackstone",
    companyNameKo: "블랙스톤",
    sectorKo: "대체 자산운용",
    signature:
      "부동산, 사모펀드, 신용 & 보험, 멀티자산 Investing의 운용자산·수수료 창출 운용자산·perpetual 자본이 FRE와 성과 매출을 만듭니다.",
    description:
      "기업 리포트: 블랙스톤은 부동산, 사모펀드, 신용 & 보험, 멀티자산 Investing을 통해 관리 및 자문 수수료, FRE, 성과 매출, realizations를 만듭니다. 운용자산, 수수료 창출 운용자산, perpetual 자본 운용자산, deployment, inflows, 실현·unrealized 성과와 순 Realizations가 배당 여력과 distributable 이익(DE)의 핵심 변수입니다.",
    researchFocus: [
      "부동산, 사모펀드, 신용 & 보험, 멀티자산 Investing별 운용자산",
      "수수료 창출 운용자산, perpetual 자본, 관리 수수료",
      "FRE, 성과 매출, realizations, 순 Realizations",
      "deployment, inflows, valuation, DE와 배당 여력",
    ],
    riskVariables: [
      "금리·신용 스프레드 변화와 부동산 가치 조정",
      "realizations 지연에 따른 성과 매출과 DE 변동",
      "신용 & 보험 유동성 스트레스와 손실 위험",
      "운용사·보험 플랫폼 규제 변화와 fund raising 둔화",
    ],
    suggestedPrompts: [
      "블랙스톤의 부동산, 사모펀드, 신용 & 보험, 멀티자산 Investing별 운용자산과 수수료 창출 운용자산이 FRE로 연결되는 구조를 공시 기준으로 정리해줘.",
      "성과 매출, realizations, 순 Realizations가 블랙스톤의 distributable 이익와 배당 여력에 미치는 영향을 설명해줘.",
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
      "북미 상업용 P&C와 Overseas General의 합산비율, 대형재해 손실, 준비금 development가 인수 수익과 순 투자 수익의 질을 좌우합니다.",
    description:
      "기업 리포트: Chubb는 북미 상업용 P&C, 북미 개인 P&C, Overseas General, 글로벌 Reinsurance, Life 보험를 함께 운영합니다. P&C 인수 수익, Life 사업부 수익, 순 투자 수익, 합산비율, 대형재해 손실와 준비금 development가 보험료 성장보다 더 중요한 수익성 판단 지표입니다.",
    researchFocus: [
      "북미 상업용 P&C와 개인 P&C 인수 수익",
      "Overseas General의 합산비율와 대형재해 손실",
      "준비금 development와 글로벌 Reinsurance 완충 효과",
      "Life 보험 사업부 수익과 순 투자 수익",
    ],
    riskVariables: [
      "대형재해 손실 증가에 따른 합산비율 악화",
      "favorable 준비금 development 둔화 또는 adverse 준비금 development",
      "금리·크레딧 환경 변화로 인한 순 투자 수익 변동",
      "요율 반영 지연과 리스크 선별 실패에 따른 손해율 악화",
    ],
    suggestedPrompts: [
      "처브의 북미 상업용 P&C와 Overseas General에서 합산비율, 대형재해 손실, 준비금 development가 인수 수익에 미치는 영향을 공시 기준으로 정리해줘.",
      "P&C 인수 수익, Life 사업부 수익, 순 투자 수익이 Chubb의 순이익을 어떻게 나눠 만드는지 설명해줘.",
      "글로벌 Reinsurance, 준비금 development, 대형재해 손실이 처브의 성장 논지와 자본 여력에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CDNS: {
    ticker: "CDNS",
    companyName: "Cadence Design Systems",
    companyNameKo: "카덴스",
    sectorKo: "EDA·반도체 설계 소프트웨어",
    signature:
      "핵심 EDA, Functional Verification, Digital IC, 반도체 IP, Cadence.AI가 반도체 설계 복잡도와 수주잔고를 반복매출로 전환합니다.",
    description:
      "기업 리포트: Cadence는 EDA 소프트웨어, 설계 IP, 하드웨어 emulation·prototyping, 시스템 design analysis를 제공합니다. 핵심 EDA, Functional Verification, Digital IC 설계 및 Signoff, 반도체 IP, Cadence.AI와 AgentStack, 수주잔고와 잔여수행의무, 하드웨어 납품 타이밍이 매출 인식과 매출총이익률의 핵심 변수입니다.",
    researchFocus: [
      "핵심 EDA와 Digital IC 설계 및 Signoff",
      "Functional Verification, 하드웨어 emulation, prototyping",
      "반도체 IP와 설계 IP 믹스",
      "Cadence.AI, AgentStack, 수주잔고, 반복매출",
    ],
    riskVariables: [
      "AI·반도체 설계 투자 사이클 둔화",
      "하드웨어 emulation 납품 지연과 부품 원가 상승",
      "수주잔고 회수 속도와 잔여수행의무 전환 지연",
      "수출통제·지정학 리스크와 환율 변동",
    ],
    suggestedPrompts: [
      "카덴스의 핵심 EDA, Functional Verification, Digital IC, 반도체 IP가 반복매출과 업프론트 수익으로 나뉘는 구조를 공시 기준으로 정리해줘.",
      "하드웨어 emulation과 prototyping 납품 타이밍이 Cadence의 매출 인식과 매출총이익률에 미치는 영향을 설명해줘.",
      "Cadence.AI, AgentStack, 수주잔고, 잔여수행의무가 카덴스의 성장 논지와 반도체 설계 수요에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },

  CEG: {
    ticker: "CEG",
    companyName: "Constellation Energy",
    companyNameKo: "컨스텔레이션 에너지",
    sectorKo: "원자력·전력",
    signature:
      "nuclear generation과 C&I 화물량, 전력 prices, 헤지, 생산 세금 크레딧이 수익성을 만들고 Crane 세정 에너지 Center가 장기 전력수요 논지를 보강합니다.",
    description:
      "기업 리포트: 컨스텔레이션 에너지는 nuclear generation, 천연가스·재생자원, 리테일·wholesale 전력 판매를 함께 봐야 합니다. 생산능력 factor, C&I 화물량, 전력 prices, 헤지 프로그램, 시장-기반 금리와 규제 금리, 생산 세금 크레딧, Crane 세정 에너지 Center와 장기 PPA가 현금흐름 안정성의 핵심 변수입니다.",
    researchFocus: [
      "nuclear generation 생산능력 factor와 fleet 믹스",
      "C&I 화물량, 리테일 화물량, wholesale 화물량와 전력 prices",
      "헤지 프로그램과 시장-기반 금리·규제 금리",
      "Crane 세정 에너지 Center, 장기 PPA, 생산 세금 크레딧",
    ],
    riskVariables: [
      "전력 prices 하락과 변동성 확대",
      "생산능력 시장·규제 금리 규제 변화",
      "생산 세금 크레딧 축소 또는 적용 조건 변화",
      "Crane 세정 에너지 Center 재가동·승인 지연과 C&I 가격 경쟁",
    ],
    suggestedPrompts: [
      "컨스텔레이션 에너지의 nuclear generation 생산능력 factor와 C&I 화물량가 전력 prices·헤지을 거쳐 수익성에 반영되는 구조를 공시 기준으로 정리해줘.",
      "Crane 세정 에너지 Center, 장기 PPA, 생산 세금 크레딧이 컨스텔레이션 에너지의 성장 논지와 현금흐름 안정성에 미치는 영향을 설명해줘.",
      "시장-기반 금리, 생산능력 시장, 규제 금리 변화가 CEG의 마진과 리스크 관리에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  CMCSA: {
    ticker: "CMCSA",
    companyName: "Comcast Corporation",
    companyNameKo: "컴캐스트",
    sectorKo: "미디어·통신",
    signature:
      "Connectivity & 플랫폼s의 브로드밴드·무선와 콘텐츠 & 체험의 Peacock·studios·테마파크가 서로 다른 수익 사이클을 만듭니다.",
    description:
      "기업 리포트: 컴캐스트는 Xfinity, 컴캐스트 비즈니스, Sky 기반 브로드밴드·무선·video·voice와 NBCUniversal의 Peacock, studios, 테마파크를 함께 봐야 합니다. 브로드밴드 가입자 경쟁, 무선 line 성장, cord-cutting, Peacock 유료 가입자와 광고, 스포츠 권리·콘텐츠 제작비, 테마파크 방문객과 신규 파크 투자 회수가 영업 레버리지의 핵심 변수입니다.",
    researchFocus: [
      "Connectivity & 플랫폼s의 브로드밴드, 무선, video, voice",
      "콘텐츠 & 체험의 Peacock, Media, Studios, Theme Parks",
      "브로드밴드 가입자, 무선 lines, cord-cutting",
      "광고, 스포츠 권리, 콘텐츠 제작비, 테마파크 투자 회수",
    ],
    riskVariables: [
      "5G·광섬유 경쟁 심화에 따른 브로드밴드 가입자 압박",
      "cord-cutting과 DTC/OTT 경쟁에 따른 video·광고 수익 둔화",
      "스포츠 권리·콘텐츠 제작비 상승과 Peacock 수익화 지연",
      "DOCSIS 4.0·FTTH 설비투자와 테마파크 투자 회수 지연",
    ],
    suggestedPrompts: [
      "컴캐스트의 Connectivity & 플랫폼s에서 브로드밴드, 무선, video가 매출과 EBITDA를 만드는 구조를 공시 기준으로 정리해줘.",
      "Peacock, Studios, Theme Parks가 콘텐츠 & 체험의 성장 논지와 비용 구조에 미치는 영향을 설명해줘.",
      "브로드밴드 경쟁, cord-cutting, 스포츠 권리 비용, 테마파크 설비투자가 컴캐스트의 잉여 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CME: {
    ticker: "CME",
    companyName: "CME Group",
    companyNameKo: "씨엠이 그룹",
    sectorKo: "파생상품 거래소",
    signature:
      "futures·옵션 거래, 청산, 시장 데이터가 결합된 모델에서 평균 daily 물량, 거래 수수료, collateral 효율이 실적 레버리지를 만듭니다.",
    description:
      "기업 리포트: 씨엠이 그룹은 CME Globex 기반 futures·옵션 거래, central counterparty 청산, 시장 데이터, BrokerTec·EBS 현금 시장를 함께 운영합니다. 이자 비율 제품, 평균 daily 물량, 평균 비율 per 계약, 거래 수수료, 시장 데이터 구독, collateral·마진 관리가 매출과 운영 리스크의 핵심 변수입니다.",
    researchFocus: [
      "futures·옵션 물량과 평균 비율 per 계약",
      "이자 비율 제품, SOFR·Treasury 거래량",
      "청산, collateral, 마진, default risk 관리",
      "시장 데이터 구독, BrokerTec, EBS 현금 시장",
    ],
    riskVariables: [
      "시장 변동성·금리 사이클 변화에 따른 ADV 변동",
      "거래 수수료 경쟁과 제품 믹스 변화",
      "청산 member 집중도와 마진 call·default 리스크",
      "규제·사이버보안·거래 시스템 장애 리스크",
    ],
    suggestedPrompts: [
      "씨엠이 그룹의 futures·옵션 평균 daily 물량과 평균 비율 per 계약이 청산 및 거래 수수료로 연결되는 구조를 공시 기준으로 정리해줘.",
      "이자 비율 제품, SOFR·Treasury 거래량이 CME의 수익성과 마진에 미치는 영향을 설명해줘.",
      "BrokerTec, EBS, 시장 데이터 구독, collateral·마진 운영이 CME의 성장 논지와 리스크에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },

  CMI: {
    ticker: "CMI",
    companyName: "Cummins",
    companyNameKo: "커민스",
    sectorKo: "상용차 엔진·전력 솔루션",
    signature:
      "Engine, Components, Distribution, 전력 시스템, Accelera 다섯 축에서 대형 트럭, off-highway, emissions regulations, 보증 비용이 수익성을 좌우합니다.",
    description:
      "기업 리포트: 커민스는 Engine, Components, Distribution, 전력 시스템, Accelera를 통해 상용차 엔진, 배출가스 처리, 발전 시스템, 서비스·부품, electrified 전력와 electrolyzers를 제공합니다. 대형 트럭, medium-duty bus, off-highway, 전력 generation 수요, emissions regulations, 보증 프로그램와 보증 비용이 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Engine, Components, Distribution, 전력 시스템, Accelera별 매출·마진",
      "대형 트럭, off-highway, 전력 generation 수요",
      "emissions regulations와 Emission 솔루션 가격 전가력",
      "Accelera의 electrolyzers·electrified 전력와 보증 비용",
    ],
    riskVariables: [
      "대형 트럭와 off-highway 수요 둔화",
      "emissions regulations 인증 지연과 개발비 증가",
      "보증 비용 확대와 품질·수리 정책 부담",
      "Accelera 초기 상업화 비용과 electrolyzers 수요 변동",
    ],
    suggestedPrompts: [
      "커민스의 Engine, Components, Distribution, 전력 시스템, Accelera가 매출과 EBITDA를 만드는 구조를 공시 기준으로 정리해줘.",
      "emissions regulations와 Emission 솔루션이 대형 트럭·off-highway 가격 전가력과 매출총이익률에 미치는 영향을 설명해줘.",
      "보증 비용, Accelera electrolyzers, 전력 시스템 수요가 커민스의 성장 논지와 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  COF: {
    ticker: "COF",
    companyName: "Capital One Financial Corporation",
    companyNameKo: "캐피털 원",
    sectorKo: "카드·소비자금융",
    signature:
      "신용 카드가 수익의 중심이고 소비자금융·상업용 은행, Discover 인수, allowance for 신용손실와 charge-offs가 실적 변동성을 만듭니다.",
    description:
      "기업 리포트: 자본 One은 신용 카드, 소비자금융, 상업용 은행을 나눠 봐야 합니다. Domestic·해외 카드 대출, 예금, 자동차 lending, 상업용 대출 믹스, 순이자수익, 순 이자 마진, allowance for 신용손실, charge-offs, Discover 인수와 Brex 인수 통합비용이 수익성과 자본 여력의 핵심 변수입니다.",
    researchFocus: [
      "신용 카드의 순이자수익, charge-offs, allowance for 신용손실",
      "소비자금융의 예금, 자동차 lending, 순 이자 마진",
      "상업용 은행의 상업용 대출와 unfunded 약정",
      "Discover 인수, Brex 인수, 통합비용·무형자산 상각",
    ],
    riskVariables: [
      "카드 charge-offs와 allowance for 신용손실 확대",
      "예금 비용 상승과 대출 수율 둔화에 따른 순이자마진 압박",
      "Discover 통합 비용, 결제 네트워크 전환, 신용 포트폴리오 재표준화",
      "소비자·상업용 대출 modifications 증가와 신용 사이클 둔화",
    ],
    suggestedPrompts: [
      "캐피털 원의 신용 카드, 소비자금융, 상업용 은행이 순이자수익과 순 이자 마진을 만드는 구조를 공시 기준으로 정리해줘.",
      "allowance for 신용손실, charge-offs, 순 charge-off 비율이 자본 One의 카드 포트폴리오 리스크를 어떻게 보여주는지 설명해줘.",
      "Discover 인수과 Brex 인수이 캐피털 원의 비용 구조, 무형자산, 결제 네트워크 성장 논지에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  COP: {
    ticker: "COP",
    companyName: "ConocoPhillips",
    companyNameKo: "코노코필립스",
    sectorKo: "에너지·E&P",
    signature:
      "Lower 48 단기 개발 효율과 Alaska Willow, Canada Surmont·Montney, LNG off-take가 생산 volumes와 실현 prices를 통해 현금흐름을 만듭니다.",
    description:
      "기업 리포트: 코노코필립스는 Lower 48, Alaska, Canada, 유럽·중동·아프리카, 아시아태평양 생산 포트폴리오를 운영합니다. Lower 48 short-cycle drilling, Alaska Willow, Canada Surmont·Montney, LNG 프로젝트와 off-take, proved 매장량, 준비금 replacement, 자본 지출, 생산 비용, WTI·Brent·Henry Hub 실현 prices가 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Lower 48 short-cycle drilling과 생산 volumes",
      "Alaska Willow와 Western North Slope 개발 일정",
      "Canada Surmont·Montney, 유럽·중동·아프리카, 아시아태평양 생산 믹스",
      "LNG off-take, proved 매장량, 자본 지출, 실현 prices",
    ],
    riskVariables: [
      "WTI·Brent·Henry Hub 가격 하락에 따른 실현 prices 압박",
      "field decline과 drilling 효율 저하로 인한 생산 감소",
      "Willow 설비투자·schedule 지연과 인허가·환경 소송 리스크",
      "로열티·세금·환경 규제와 영업 비용 상승",
    ],
    suggestedPrompts: [
      "코노코필립스의 Lower 48, Alaska, Canada, 유럽·중동·아프리카, 아시아태평양 생산 포트폴리오가 생산 volumes와 실현 prices로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Alaska Willow, Canada Surmont·Montney, LNG off-take가 코노코필립스의 장기 성장 논지와 자본 지출에 미치는 영향을 설명해줘.",
      "proved 매장량, 준비금 replacement, 생산 비용, WTI·Brent·Henry Hub 가격 변동이 코노코필립스의 잉여 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CRWD: {
    ticker: "CRWD",
    companyName: "CrowdStrike",
    companyNameKo: "크라우드스트라이크",
    sectorKo: "사이버보안",
    signature:
      "Falcon 플랫폼의 엔드포인트 보안, 클라우드 보안, identity protection 모듈 확장이 구독 매출, 연간 반복매출, 순 고객 유지율의 핵심 동력입니다.",
    description:
      "기업 리포트: 크라우드스트라이크는 Falcon 플랫폼과 보안 클라우드를 기반으로 엔드포인트 보안, 클라우드 보안, identity protection, incident response를 제공합니다. 구독 매출, 연간 반복매출, 순 고객 유지율, 모듈 adoption, per-엔드포인트·per-모듈 가격 구조, outage/remediation 신뢰 회복 비용이 성장성과 마진의 핵심 변수입니다.",
    researchFocus: [
      "Falcon 플랫폼 구독 매출과 연간 반복매출",
      "엔드포인트 보안, 클라우드 보안, identity protection 모듈 adoption",
      "순 고객 유지율, 갱신, per-엔드포인트·per-모듈 가격 구조",
      "incident response, outage/remediation, 고객 신뢰 회복 비용",
    ],
    riskVariables: [
      "고객 갱신 둔화와 순 고객 유지율 약화",
      "모듈 adoption 둔화에 따른 확장 성장 둔화",
      "보안 사고·outage/remediation 이슈가 신뢰와 비용에 미치는 영향",
      "AI·클라우드 보안 인력 확보와 경쟁 심화",
    ],
    suggestedPrompts: [
      "크라우드스트라이크의 Falcon 플랫폼에서 엔드포인트 보안, 클라우드 보안, identity protection 모듈이 구독 매출과 연간 반복매출로 연결되는 구조를 공시 기준으로 정리해줘.",
      "연간 반복매출, 순 고객 유지율, 모듈 adoption이 크라우드스트라이크의 구독 확장성을 어떻게 보여주는지 설명해줘.",
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
      "헬스케어 관리 Benefits의 Aetna 보험손익과 헬스케어 서비스·Pharmacy & 소비자 Wellness의 Caremark 약국 보험금 청구가 의료 급여 비율와 마진을 좌우합니다.",
    description:
      "기업 리포트: CVS 헬스는 헬스케어 관리 Benefits(Aetna), 헬스케어 서비스(Caremark), Pharmacy & 소비자 Wellness를 함께 봐야 합니다. 메디케어 Advantage, 의료 급여 비율, 약국 보험금 청구, 리베이트·약가 구조, 매장 optimization, Aetna 멤버십과 약국 채널 교차효과가 매출총이익률과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Aetna 헬스케어 관리 Benefits와 의료 급여 비율",
      "Caremark 헬스케어 서비스의 약국 보험금 청구와 리베이트 구조",
      "Pharmacy & 소비자 Wellness와 매장 optimization",
      "메디케어 Advantage, 멤버십 유지, 약국·보험 교차효과",
    ],
    riskVariables: [
      "의료 이용률 상승에 따른 의료 급여 비율 악화",
      "메디케어 Advantage 보상·위험조정 변화",
      "약국 보험금 청구 정산·리베이트 규제와 약가 압박",
      "매장 optimization이 접근성·오프라인 처방 트래픽에 미치는 영향",
    ],
    suggestedPrompts: [
      "CVS 헬스의 헬스케어 관리 Benefits(Aetna), 헬스케어 서비스(Caremark), Pharmacy & 소비자 Wellness가 매출과 마진을 만드는 구조를 공시 기준으로 정리해줘.",
      "메디케어 Advantage와 의료 급여 비율이 CVS의 보험손익과 현금흐름에 미치는 영향을 설명해줘.",
      "약국 보험금 청구, 리베이트, 매장 optimization이 CVS의 성장 논지와 비용 구조에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  CVX: {
    ticker: "CVX",
    companyName: "Chevron Corporation",
    companyNameKo: "셰브론",
    sectorKo: "에너지·석유·가스",
    signature:
      "Upstream의 Permian·Tengizchevroil 생산과 LNG, Downstream 정제 마진s, proved 매장량와 자본 지출 배분이 실적 민감도를 결정합니다.",
    description:
      "기업 리포트: 셰브론은 Upstream 탐사·생산, LNG, Downstream 정유·마케팅을 함께 봐야 합니다. Permian 생산, Tengizchevroil 가동률, LNG 가격·offtake, 원자재 prices, 정제 마진s, proved 매장량, 자본 지출와 자본환원 정책이 영업 현금흐름과 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Upstream의 Permian과 Tengizchevroil 생산",
      "LNG 가격 연동, offtake, 글로벌 가스 수요",
      "Downstream 정제 마진s와 정제 수요",
      "proved 매장량, 자본 지출, 자본환원",
    ],
    riskVariables: [
      "원유·천연가스 원자재 prices 변동성",
      "정제 마진s 축소와 정제 수요 둔화",
      "Tengizchevroil 운영·증설 지연과 LNG offtake 변동",
      "proved 매장량 하향 조정과 설비투자 부담 확대",
    ],
    suggestedPrompts: [
      "셰브론의 Upstream, LNG, Downstream 수익 경로가 원자재 prices와 정제 마진s로 연결되는 구조를 공시 기준으로 정리해줘.",
      "Permian과 Tengizchevroil이 셰브론의 생산량, 영업 현금흐름, 자본 지출에 미치는 영향을 설명해줘.",
      "proved 매장량, LNG offtake, 정제 마진s, 설비투자 배분이 셰브론의 성장 논지와 자본환원에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  DUK: {
    ticker: "DUK",
    companyName: "Duke Energy Corporation",
    companyNameKo: "듀크 에너지",
    sectorKo: "전력·천연가스 유틸리티",
    signature:
      "Electric Utilities 및 인프라와 가스 Utilities 및 인프라의 요금기반자산 성장, 규제 금리, 연료비 회수가 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: 듀크 에너지는 전력 EU&I와 가스 GU&I를 운영하는 규제형 유틸리티입니다. 요금기반자산, 비율 케이스, 규제 금리, 연료비 회수, purchased 전력, storm 비용, 석탄 ash, 자본 plan과 금리·이자비용이 매출 인식과 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "EU&I와 GU&I의 요금기반자산 확대와 규제 금리",
      "연료비 회수, purchased 전력, 연료 가격 변동",
      "storm 비용 회수와 석탄 ash 규제 비용",
      "자본 plan, 금리, 투자비 회수 속도",
    ],
    riskVariables: [
      "비율 케이스 승인 지연과 ROE 조정",
      "연료비 회수 비용 인정 지연 또는 부인",
      "storm 비용과 석탄 ash 회수 불확실성",
      "자본 plan 확대와 금리 상승에 따른 잉여현금흐름 압박",
    ],
    suggestedPrompts: [
      "듀크 에너지의 EU&I와 GU&I에서 요금기반자산, 규제 금리, ROE가 매출과 현금흐름에 연결되는 구조를 공시 기준으로 정리해줘.",
      "연료비 회수, storm 비용, 석탄 ash 비용 회수가 듀크 에너지의 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "자본 plan, 비율 케이스, 금리 상승이 듀크 에너지의 성장 논지와 배당 여력에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  EQIX: {
    ticker: "EQIX",
    companyName: "Equinix",
    companyNameKo: "이퀴닉스",
    sectorKo: "데이터센터·클라우드 인프라",
    signature:
      "IBX 데이터센터의 코로케이션·interconnection과 xScale 확장이 recurring 매출, 월간반복매출, 점유율, AFFO를 만드는 핵심 축입니다.",
    description:
      "기업 리포트: 이퀴닉스는 IBX 데이터센터와 xScale을 통해 코로케이션, interconnection, 관리형 인프라를 제공합니다. recurring 매출, 월간반복매출, cabinet 점유율, interconnection density, 이탈률, 전력 availability와 전력 비용, high-density AI·클라우드 수요, 설비투자와 AFFO 전환 속도가 성장성과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "IBX 코로케이션, interconnection, 관리형 인프라 recurring 매출",
      "월간반복매출, cabinet 점유율, 이탈률, 월간반복매출 per Cabinet",
      "xScale, AI·클라우드 high-전력 density 수요",
      "전력 availability, 전력 비용, 설비투자, AFFO",
    ],
    riskVariables: [
      "전력 availability 제약과 전력비 상승",
      "high-density AI 수요에 따른 설비투자 부담 확대",
      "IBX 장애·SLA 위반·사이버 사고 리스크",
      "고객 이탈률과 월간반복매출 성장률 둔화",
    ],
    suggestedPrompts: [
      "이퀴닉스의 IBX 코로케이션, interconnection, 관리형 인프라가 recurring 매출과 월간반복매출을 만드는 구조를 공시 기준으로 정리해줘.",
      "xScale, AI·클라우드 high-density 수요, 전력 availability가 이퀴닉스의 점유율과 AFFO에 미치는 영향을 설명해줘.",
      "전력 비용, 이탈률, 설비투자, IBX 운영 리스크가 이퀴닉스의 성장 논지와 현금흐름에 주는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  FCX: {
    ticker: "FCX",
    companyName: "Freeport-McMoRan Inc.",
    companyNameKo: "프리포트맥모란",
    sectorKo: "구리·비철금속 채굴",
    signature:
      "Grasberg, 북미 구리 광산, 남미 광산의 구리·금·몰리브덴 생산과 광석 품위, 단위 순 현금 비용, 자본 지출이 현금흐름을 좌우합니다.",
    description:
      "기업 리포트: 프리포트맥모란은 Grasberg, 북미, 남미 광산에서 구리, 금, 몰리브덴을 생산하고 제련을 거쳐 판매합니다. 부산물 믹스, 광석 품위, 회수율, 제련 효율, 단위 순 현금 비용, 자본 지출, 인도네시아·남미 규제와 로열티 체계가 매출총이익률과 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "Grasberg, 북미 구리 광산, 남미 산출량",
      "구리, 금, 몰리브덴 부산물 믹스",
      "광석 품위, 회수율, 제련 효율과 단위 순 현금 비용",
      "자본 지출, 가동률, 인허가·로열티 구조",
    ],
    riskVariables: [
      "구리·금·몰리보든 가격 변동",
      "Grasberg·북미·남미 광산의 광석 품위 저하",
      "인도네시아·남미 정치·규제·세금·로열티 리스크",
      "에너지·물류·부품·정비 비용 상승에 따른 단위 순 현금 비용 압박",
    ],
    suggestedPrompts: [
      "프리포트맥모란의 Grasberg, 북미 구리 광산, 남미 광산에서 구리, 금, 몰리브덴 생산이 매출로 연결되는 구조를 공시 기준으로 정리해줘.",
      "광석 품위, 회수율, 제련 효율이 FCX의 단위 순 현금 비용과 매출총이익률에 미치는 영향을 설명해줘.",
      "자본 지출, 인허가·로열티, 광산별 가동률이 FCX의 성장 논지와 잉여 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  FDX: {
    ticker: "FDX",
    companyName: "FedEx Corporation",
    companyNameKo: "페덱스",
    sectorKo: "물류·운송",
    signature:
      "페덱스 Express, 페덱스 Ground, 페덱스 화물의 package 물량, 수율, 연료 할증료를 DRIVE와 네트워크 2.0 비용 savings로 얼마나 흡수하느냐가 핵심입니다.",
    description:
      "기업 리포트: 페덱스는 Express, Ground, 화물의 패키지·화물 물동량과 수율를 함께 봐야 합니다. package 물량, 연료 할증료, purchased 운송, 네트워크 2.0, DRIVE 비용 savings, aircraft fleet 운용, 페덱스 화물 분리 계획과 global trade policy가 영업이익과 잉여 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "페덱스 Express와 Ground의 package 물량, 수율",
      "페덱스 화물의 화물 pounds, 수율, 분리 계획",
      "네트워크 2.0와 DRIVE 비용 savings",
      "연료 할증료, aircraft fleet, purchased 운송 비용",
    ],
    riskVariables: [
      "네트워크 2.0와 DRIVE 실행 지연",
      "페덱스 화물 분사 비용과 조건 변화",
      "연료 할증료와 purchased 운송 비율 변동",
      "global trade policy, 계절성, aircraft fleet 운용 제약",
    ],
    suggestedPrompts: [
      "페덱스의 페덱스 Express, 페덱스 Ground, 페덱스 화물에서 package 물량, 수율, 연료 할증료가 매출과 영업이익에 연결되는 구조를 공시 기준으로 정리해줘.",
      "네트워크 2.0와 DRIVE 비용 savings가 페덱스의 비용 구조와 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "페덱스 화물 분사, aircraft fleet 운용, global trade policy가 페덱스의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  GD: {
    ticker: "GD",
    companyName: "General Dynamics Corporation",
    companyNameKo: "제너럴 다이내믹스",
    sectorKo: "항공우주·국방",
    signature:
      "항공우주, Marine 시스템, Combat 시스템, 기술의 수주잔고와 계약 믹스가 매출과 마진을 좌우하고, Gulfstream과 Columbia-class가 핵심 동력입니다.",
    description:
      "기업 리포트: General 다이내믹스는 Gulfstream 중심 항공우주, Columbia-class·Virginia-class 잠수함의 Marine 시스템, 군용차량·무기체계의 Combat 시스템, C5ISR·IT 서비스의 기술를 함께 봐야 합니다. funded·unfunded 수주잔고, Gulfstream deliveries, shipbuilding 산업 기본, 고정-가격·비용-reimbursable 계약 믹스가 영업 마진과 현금 conversion의 핵심 변수입니다.",
    researchFocus: [
      "항공우주의 Gulfstream deliveries, book-to-bill, 수주잔고",
      "Marine 시스템의 Columbia-class, Virginia-class, John Lewis-class",
      "Combat 시스템의 군용차량·무기체계 수요",
      "기술의 C5ISR, IT 서비스, 계약 믹스",
    ],
    riskVariables: [
      "국방 예산 승인 지연과 funded 수주잔고 전환 리스크",
      "shipbuilding 산업 기반 압박과 공급망 지연",
      "Gulfstream 공급망·인도 일정 변동",
      "고정-가격 계약 원가 상승과 장기 프로그램 일정 지연",
    ],
    suggestedPrompts: [
      "제너럴 다이내믹스의 항공우주, Marine 시스템, Combat 시스템, 기술별 수주잔고와 영업 마진 차이를 공시 기준으로 정리해줘.",
      "Gulfstream deliveries와 항공우주 수주잔고가 GD의 현금흐름과 마진에 미치는 영향을 설명해줘.",
      "Columbia-class·Virginia-class 잠수함, shipbuilding 공급망, 고정-가격 계약 믹스가 GD의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  GE: {
    ticker: "GE",
    companyName: "General Electric",
    companyNameKo: "제너럴 일렉트릭",
    sectorKo: "항공우주·엔진",
    signature:
      "GE 항공우주의 상업용 Engines & 서비스와 방산 & Propulsion 기술에서 LEAP, 정비 방문s, spare 부품, 서비스 수주잔고가 실적을 좌우합니다.",
    description:
      "기업 리포트: GE는 GE 항공우주 중심으로 상업용 엔진, 방산 추진체계, 장기 서비스 계약을 운영합니다. LEAP 엔진 납기, 상업용 Engines & 서비스의 정비 방문s와 spare 부품, 방산 & Propulsion 기술 주문, 서비스 수주잔고, long-term 서비스 계약와 공급 chain 병목이 사업부 마진과 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "상업용 Engines & 서비스의 LEAP, 정비 방문s, spare 부품",
      "방산 & Propulsion 기술 주문과 방산 예산 집행",
      "서비스 수주잔고, 잔여수행의무, long-term 서비스 계약",
      "공급업체 배송 성과, 재료·부품 공급망, MRO 네트워크",
    ],
    riskVariables: [
      "LEAP·CFM 엔진 부품 공급 제약과 납기 지연",
      "정비 방문s 일정 지연과 spare 부품 가용성 부족",
      "방산 예산·수출 승인·계약 일정 변동",
      "장기 서비스 계약 손익 조정과 관세·공급망 비용 압박",
    ],
    suggestedPrompts: [
      "GE 항공우주의 상업용 Engines & 서비스에서 LEAP 납기, 정비 방문s, spare 부품가 매출과 사업부 이익에 연결되는 구조를 공시 기준으로 정리해줘.",
      "서비스 수주잔고와 long-term 서비스 계약가 GE의 현금흐름과 마진 안정성에 미치는 영향을 설명해줘.",
      "공급 chain 병목과 방산 & Propulsion 기술 예산·계약 일정이 GE의 성장 논지에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  HCA: {
    ticker: "HCA",
    companyName: "HCA Healthcare",
    companyNameKo: "HCA 헬스케어",
    sectorKo: "병원 운영·헬스케어 서비스",
    signature:
      "same facility equivalent admissions, 매출 per equivalent admission, payer 믹스가 병원 수요와 수익성의 방향을 보여주고 인건비·charity 관리가 마진을 좌우합니다.",
    description:
      "HCA 헬스케어는 병원, ambulatory surgery centers, emergency room visits, inpatient·outpatient surgeries를 함께 운영합니다. admissions, same facility equivalent admissions, acuity, payer 믹스, 메디케어·Medicaid·관리형 관리, 인건비, supplies, charity 관리와 uncompensated 관리가 매출과 영업 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "same facility admissions와 equivalent admissions",
      "매출 per equivalent admission, acuity, payer 믹스",
      "emergency room visits, inpatient surgeries, outpatient surgeries",
      "인건비, supplies, charity 관리, 메디케어·Medicaid 보상",
    ],
    riskVariables: [
      "관리형 관리 재협상과 payer 믹스 악화",
      "인건비와 supplies 비용 상승",
      "charity 관리와 uncompensated 관리 확대",
      "메디케어·Medicaid 보상 정책 변화와 지역별 수요 충격",
    ],
    suggestedPrompts: [
      "HCA의 same facility admissions, equivalent admissions, 매출 per equivalent admission이 매출 성장으로 연결되는 구조를 공시 기준으로 정리해줘.",
      "payer 믹스, 메디케어, Medicaid, 관리형 관리가 HCA의 마진과 현금흐름에 미치는 영향을 설명해줘.",
      "인건비, supplies, charity 관리, emergency room visits 변화가 HCA의 비용 구조와 현금흐름 리스크에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  ICE: {
    ticker: "ICE",
    companyName: "Intercontinental Exchange",
    companyNameKo: "인터컨티넨탈 익스체인지",
    sectorKo: "금융시장 인프라",
    signature:
      "거래소, 채권·데이터 서비스, 모기지 기술가 거래 매출과 반복매출을 나눠 만들며 청산과 데이터 서비스가 안정성을 보강합니다.",
    description:
      "기업 리포트: ICE는 futures·옵션와 에너지 제품 중심 Exchanges, 고정 수익 데이터·CDS 청산, Mortgage 테크놀로지의 Encompass·MERS·Simplifile을 함께 운영합니다. 거래 매출, 반복매출, 청산, 데이터 및 connectivity, Ellie Mae·Encompass 기반 모기지 workflow, 규제 approvals와 시장 데이터 수수료 심사가 매출과 마진의 핵심 변수입니다.",
    researchFocus: [
      "Exchanges의 futures, 옵션, 에너지 제품, 청산",
      "고정 수익 및 데이터 서비스의 CDS 청산과 데이터 서비스",
      "Mortgage 테크놀로지의 Encompass, MERS, Simplifile",
      "반복매출과 거래 매출 믹스",
    ],
    riskVariables: [
      "청산 member default와 collateral haircut 리스크",
      "파생상품·에너지·금리 변동성 둔화에 따른 거래량 감소",
      "시장 데이터 수수료 심사와 SEC·CFPB·FFIEC 규제",
      "모기지 origination 둔화와 데이터 보안 비용 증가",
    ],
    suggestedPrompts: [
      "ICE의 거래소, 채권·데이터 서비스, 모기지 기술가 반복매출과 거래 매출을 만드는 구조를 공시 기준으로 정리해줘.",
      "에너지 futures, CDS 청산, Encompass 모기지 workflow가 ICE의 매출 안정성과 마진에 미치는 영향을 설명해줘.",
      "청산 규제, 시장 데이터 수수료 심사, 모기지 cycle이 ICE의 성장 논지와 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  LMT: {
    ticker: "LMT",
    companyName: "Lockheed Martin Corporation",
    companyNameKo: "록히드 마틴",
    sectorKo: "항공우주·국방",
    signature:
      "Aeronautics, Missiles 및 Fire 제어, Rotary 및 Mission 시스템, 우주의 수주잔고와 고정-가격 계약 실행력이 이익률을 좌우합니다.",
    description:
      "기업 리포트: 록히드 마틴은 F-35 중심 Aeronautics, PAC-3·THAAD의 Missiles 및 Fire 제어, Rotary 및 Mission 시스템, 위성·방위 추적의 우주를 운영합니다. 수주잔고, 고정-가격 계약, 비용-plus 계약, classified 프로그램, reach-forward 손실, 공급 chain과 수출통제가 매출 recognition과 현금 conversion의 핵심 변수입니다.",
    researchFocus: [
      "F-35와 Aeronautics 수주잔고",
      "PAC-3, THAAD, tactical missile과 Missiles 및 Fire 제어",
      "Rotary 및 Mission 시스템 장기 운영·유지 계약",
      "우주, classified 프로그램, 고정-가격 계약 믹스",
    ],
    riskVariables: [
      "F-35 및 대형 국방 프로그램 조달 지연",
      "고정-가격 계약 비용 초과와 reach-forward 손실",
      "공급 chain, 부품 인증, 사이버·수출통제 부담",
      "classified 프로그램 범위 변경과 회수 속도 지연",
    ],
    suggestedPrompts: [
      "록히드 마틴의 Aeronautics, Missiles 및 Fire 제어, Rotary 및 Mission 시스템, 우주별 수주잔고와 수익 경로를 공시 기준으로 정리해줘.",
      "F-35와 고정-가격 계약이 매출 recognition, 이익 booking, 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "classified 프로그램, reach-forward 손실, 공급 chain 이슈가 록히드 마틴의 성장 논지와 마진에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },

  LOW: {
    ticker: "LOW",
    companyName: "Lowe's Companies, Inc.",
    companyNameKo: "로우즈",
    sectorKo: "소매·주거개선",
    signature: "자가정비와 프로 고객 수요를 매장·온라인·설치 서비스로 흡수하며, 비교매장매출의 티켓·거래 분해와 merchandising·공급 chain 실행이 마진을 좌우하는 주거개선 소매업체.",
    description: "로우즈는 주거 개선 제품, 건축 자재, 하드웨어, 가전, 정원, 설치 서비스와 장비 렌탈을 매장과 온라인 채널로 판매합니다. 공시 해석에서는 비교매장매출을 평균 티켓과 거래로 나눠 가격·믹스와 방문 수요를 분리해 보고, 프로 고객와 자가정비 고객의 수요 차이가 merchandising, 주문처리, 매출총이익률에 어떻게 반영되는지 확인해야 합니다. 주택 거래 둔화, 금리, 주택 가격, 노후 주택 개보수 수요, 공급망과 last-mile 배송 비용이 매출총이익률과 영업 레버리지의 핵심 변수입니다.",
    researchFocus: [
      "비교매장매출을 티켓, 거래, 제품 믹스로 분해한 수요 해석",
      "프로 고객, 자가정비 고객, 온라인 판매, 설치 서비스가 매출총이익률에 미치는 차이",
      "merchandising, 가격정책, 재고손실, 공급 chain 비용이 매출총이익률에 반영되는 방식",
      "housing turnover, home 가격, repair/remodel 수요가 프로젝트성 매출로 이어지는 경로"
    ],
    riskVariables: [
      "고금리와 주택 거래 둔화로 인한 대형 주거개선 프로젝트 지연",
      "원자재·운송·last-mile 배송 비용 상승과 재고손실 증가에 따른 매출총이익률 압박",
      "프로 고객 수요 둔화 또는 자가정비 트래픽 감소에 따른 비교매장매출 약화",
      "인건비, 매장 운영비, 주문처리 투자 부담이 영업 마진을 낮출 가능성"
    ],
    suggestedPrompts: [
      "로우즈의 비교매장매출을 티켓과 거래로 나눠 최근 수요가 가격·믹스인지 방문 회복인지 설명해줘.",
      "프로 고객와 자가정비 고객이 로우즈의 merchandising, 온라인 판매, 설치 서비스 수익성에 미치는 차이를 공시 기준으로 정리해줘.",
      "주택 거래, 금리, 공급망, 재고손실이 로우즈의 매출총이익률과 영업현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  MAR: {
    ticker: "MAR",
    companyName: "Marriott International",
    companyNameKo: "메리어트 인터내셔널",
    sectorKo: "호텔·여행",
    signature: "asset-light 호텔 네트워크에서 프랜차이즈 수수료, Base 관리 수수료, Incentive 관리 수수료가 RevPAR·객실 순증·Bonvoy 충성도와 맞물리는 글로벌 호텔 운영사.",
    description: "메리어트는 호텔을 직접 보유하기보다 franchising, 관리, 라이선싱 계약으로 브랜드와 운영 시스템을 확장하는 asset-light 구조입니다. 공시 해석에서는 프랜차이즈 수수료와 Base 관리 수수료가 객실 수 증가와 RevPAR 회복에 얼마나 민감한지, Incentive 관리 수수료가 호텔 오너의 수익성 개선을 얼마나 반영하는지, Marriott Bonvoy와 공동브랜드 신용 카드 수수료가 브랜드 락인과 반복 수요를 어떻게 강화하는지를 봐야 합니다. Owned, leased, 및 other 비중은 작지만 경기 변동과 비용 부담이 직접 반영되므로 수수료 business와 분리해 확인하는 편이 좋습니다.",
    researchFocus: [
      "프랜차이즈 수수료, Base 관리 수수료, Incentive 관리 수수료의 성장률과 RevPAR 연결",
      "Marriott Bonvoy, 공동브랜드 신용 카드, 로열티 프로그램 수수료가 총 수수료 매출에 기여하는 방식",
      "rooms 파이프라인, conversion, 순 rooms 성장이 장기 수수료 기본로 전환되는 속도",
      "Owned, leased, 및 other 호텔의 비용 부담과 수수료 중심 사업 대비 수익성 차이"
    ],
    riskVariables: [
      "RevPAR, 점유율, ADR 둔화로 수수료 성장이 약해질 가능성",
      "호텔 오너의 자금조달 환경 악화와 개발 지연에 따른 파이프라인 전환 리스크",
      "Bonvoy 가치 약화, 대체 숙박 플랫폼, 호텔 체인 경쟁으로 인한 브랜드 수수료 압박",
      "직접 운영·임차 호텔의 인건비, 임대료, 자본비용 부담"
    ],
    suggestedPrompts: [
      "메리어트의 프랜차이즈 수수료, Base 관리 수수료, Incentive 관리 수수료가 RevPAR과 객실 순증에 어떻게 연결되는지 최근 공시 기준으로 정리해줘.",
      "Marriott Bonvoy와 공동브랜드 신용 카드 수수료가 메리어트의 수수료 business를 어떻게 보강하는지 공시 근거로 설명해줘.",
      "메리어트의 rooms 파이프라인과 호텔 오너 자금조달 리스크가 장기 수수료 기본에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  MCK: {
    ticker: "MCK",
    companyName: "McKesson Corporation",
    companyNameKo: "맥케슨",
    sectorKo: "의료 유통·헬스케어 솔루션",
    signature: "북미n Pharmaceutical 유통을 축으로 전문·종양학 practice, RxTS, 의료-수술까지 묶어 의약품 접근성·재고·상환 데이터를 관리하는 헬스케어 유통사.",
    description: "맥케슨은 북미n Pharmaceutical에서 branded, 제네릭, 전문, 바이오시밀러, OTC 의약품 유통을 담당하고 ClarusONE과 SynerGx를 통해 제네릭 조달과 재고 효율을 관리합니다. 종양학 & Multispecialty는 종양 전문 진료 네트워크와 전문 의약품을 연결하고, Prescription 테크놀로지 솔루션는 처방 접근성, 가격 투명성, 환자 지원 흐름을 PBM·약국·제약사와 연결합니다. 의료-수술 솔루션는 비급성 의료기관에 소모품과 물류 서비스를 제공하는 축입니다. 공시 해석에서는 단순 매출 규모보다 낮은 마진의 유통 사업 안에서 전문 믹스, 340B·리베이트 model 분쟁, opioid 합의·소송 비용, 의료-수술 분리 추진이 이익률과 현금흐름에 미치는 영향을 함께 봐야 합니다.",
    researchFocus: [
      "북미n Pharmaceutical의 branded·제네릭·전문·바이오시밀러 물량 구성과 총 이익 비율",
      "ClarusONE·SynerGx를 통한 제네릭 조달 효율과 재고 회전",
      "종양학 & Multispecialty의 practice 네트워크, 전문 의약품, infusion 서비스 확장",
      "RxTS의 prescription 접속, affordability, life sciences 서비스 수익 기여"
    ],
    riskVariables: [
      "opioid litigation 및 관련 세금·충당부채 변동",
      "340B, 리베이트 model, PBM·제약사 계약 관련 규제·소송",
      "제네릭 가격 deflation이나 고객 계약 갱신에 따른 유통 마진 압박",
      "의료-수술 솔루션 분리 및 구조조정 비용"
    ],
    suggestedPrompts: [
      "맥케슨의 북미n Pharmaceutical에서 전문·제네릭 믹스가 매출보다 이익률에 어떤 영향을 주는지 최근 공시 기준으로 정리해줘.",
      "ClarusONE, SynerGx, RxTS가 맥케슨의 조달·처방 접근성·환자 지원 흐름을 어떻게 나누어 담당하는지 공시 근거로 설명해줘.",
      "맥케슨의 opioid, 340B, 리베이트 model, 의료-수술 분리 리스크가 현금흐름과 비용 항목에 미치는 영향을 정리해줘.",
    ],
    questionChains: {},
  },

  MO: {
    ticker: "MO",
    companyName: "Altria Group, Inc.",
    companyNameKo: "알트리아",
    sectorKo: "담배",
    signature: "Marlboro 중심 Smokeable 제품 현금창출력과 on!·NJOY 중심 구강담배 제품 전환이 동시에 평가되는 미국 담배 기업.",
    description: "알트리아는 미국 내 Marlboro 중심 연소담배 제품이 현금흐름의 핵심이고, on!와 NJOY를 통해 구강담배 제품 편입을 늘리며 포트폴리오 전환 속도를 조절하는 구조입니다. 공시 해석에서는 판매량 감소 국면에서 가격 인상이 어디까지 마진을 방어하는지, 소비세와 주별 과세 체계가 가격 결정권을 얼마나 제한하는지, FDA 규제가 NJOY·on! 확장 경로에 어떤 제약을 만드는지를 함께 확인해야 합니다.",
    researchFocus: [
      "Marlboro 중심 Smokeable 제품의 출하량, 리테일 share, 가격 인상 효과",
      "on! 니코틴 파우치es의 판매량 증가와 구강담배 제품 마진 기여",
      "NJOY 전자담배 포트폴리오가 reduced-risk 전환에서 맡는 역할",
      "소비세와 주별 규제가 가격 결정권·프로모션·유통 채널에 미치는 영향"
    ],
    riskVariables: [
      "미국 흡연 수요 둔화에 따른 Smokeable 제품 판매량 감소",
      "연방·주 소비세 인상 및 과세 체계 변경",
      "FDA 승인, 라벨, 마케팅·유통 규칙 강화에 따른 NJOY·on! 확장 제약",
      "Smokeable 제품 현금창출 감소 속도가 구강담배 제품 성장보다 빨라지는 전환 리스크"
    ],
    suggestedPrompts: [
      "알트리아의 최근 공시 기준으로 Marlboro 판매량 감소를 가격 인상이 얼마나 상쇄하고 있는지 정리해줘.",
      "on!와 NJOY가 알트리아의 구강담배 제품 전환에서 각각 어떤 지표로 확인되는지 공시 근거로 보여줘.",
      "알트리아의 소비세와 FDA 규제가 가격정책, 프로모션, 영업현금흐름에 미치는 영향을 정리해줘.",
    ],
    questionChains: {},
  },

  NEM: {
    ticker: "NEM",
    companyName: "Newmont Corporation",
    companyNameKo: "뉴몬트",
    sectorKo: "금속·채굴",
    signature: "금 생산을 중심으로 구리·은·납·아연 부산물까지 함께 팔며, 광산별 grade·처리량·CAS/AISC와 대형 프로젝트 집행이 현금흐름을 좌우하는 글로벌 금광 기업.",
    description: "뉴몬트는 Boddington, Tanami, Lihir, Cadia, Cerro Negro, Ahafo 같은 주요 광산과 Nevada Gold Mines 지분, Pueblo Viejo·Fruta del Norte 지분 노출을 통해 금과 동반 금속을 생산합니다. 공시 해석에서는 평균 실현 금값만 보는 것보다 광산별 광석 품위, 분쇄 처리량, 회복, 박토, 유지 자본이 CAS와 AISC에 어떻게 반영되는지 확인해야 합니다. Ahafo North, Tanami, Cadia, Lihir 관련 개발·확장·광산 개발 순서는 장기 생산량과 자본집행 리스크를 동시에 보여주는 지점입니다.",
    researchFocus: [
      "금, 구리, 은, 납, 아연 가격 변화가 실현 가격와 매출 믹스에 미치는 영향",
      "Boddington, Tanami, Lihir, Cadia, Cerro Negro, Ahafo의 생산량·grade·처리량·회복 차이",
      "CAS, AISC, 유지 자본, 박토 비용이 광산별 현금마진에 반영되는 방식",
      "Ahafo North, Tanami, Cadia, Lihir 프로젝트와 Nevada Gold Mines·Pueblo Viejo 지분 노출"
    ],
    riskVariables: [
      "금 가격 하락 또는 구리·은 등 부산물 가격 변동에 따른 현금흐름 민감도",
      "에너지, 시약, 운송, 노동, 장비 비용 상승에 따른 CAS/AISC 압박",
      "광산별 grade 저하, mill downtime, weather, geotechnical 이슈로 인한 생산 차질",
      "가나 로열티·stability agreement, 호주·캐나다 달러 등 세금·환율·국가 리스크"
    ],
    suggestedPrompts: [
      "뉴몬트의 주요 광산별 생산량, grade, 처리량 변화가 CAS와 AISC에 어떻게 반영되는지 최근 공시 기준으로 정리해줘.",
      "Ahafo North, Tanami, Cadia, Lihir 관련 프로젝트가 뉴몬트의 장기 생산량과 자본지출에 미치는 영향을 설명해줘.",
      "뉴몬트의 금 가격, 부산물 가격, 가나 로열티, 환율 리스크가 영업현금흐름에 미치는 경로를 비교해줘.",
    ],
    questionChains: {},
  },

  PH: {
    ticker: "PH",
    companyName: "Parker-Hannifin Corporation",
    companyNameKo: "파커 하니핀",
    sectorKo: "산업 설비",
    signature: "Motion & 제어 기술을 Diversified 산업과 항공우주 시스템에 공급하며, 주문잔고·가격 전가·제품 믹스가 마진을 좌우하는 산업·항공 부품 기업.",
    description: "파커 하니핀은 hydraulic, pneumatic, filtration, sealing, fluid connector, motion control 같은 Motion & 제어 제품을 산업 장비와 항공우주 고객에게 공급합니다. Diversified 산업은 공장 자동화, 공조/냉동, 에너지, 운송, 일반 산업 장비 수요에 노출되고, 항공우주 시스템는 상업용 OEM, 방산, 애프터마켓 주문과 장기 프로그램 비중이 큽니다. 공시 해석에서는 수주잔고가 다음 매출로 전환되는 속도, 가격 인상이 재료비·물류비를 얼마나 상쇄하는지, Meggitt 인수 이후 항공 포트폴리오와 시너지 비용이 사업부 영업 마진에 어떻게 반영되는지 봐야 합니다.",
    researchFocus: [
      "Diversified 산업의 북미·국제 수요와 in-plant 장비, 공조/냉동, 에너지 고객 노출",
      "항공우주 시스템의 상업용 OEM, 방산, 애프터마켓 주문 구성과 수주잔고 전환",
      "가격 전가, 제품 믹스, 재료비 상승이 사업부 영업이익에 미치는 영향",
      "Meggitt 통합 이후 항공 포트폴리오, 시너지, 구조조정 비용 흐름"
    ],
    riskVariables: [
      "원자재·부품·물류 비용 상승을 가격 인상으로 충분히 상쇄하지 못할 위험",
      "공급망 차질, 항공 OEM 생산 지연, 방산 프로그램 일정 변경",
      "산업 설비 수요 둔화와 유통업체 재고 조정에 따른 주문 감소",
      "Meggitt 통합, 구조조정, 환율·금리 노출이 마진 개선 속도를 늦출 가능성"
    ],
    suggestedPrompts: [
      "파커 하니핀의 Diversified 산업과 항공우주 시스템 매출·마진을 최근 공시 기준으로 나눠 설명해줘.",
      "항공우주 시스템의 OEM, 방산, 애프터마켓 주문과 수주잔고가 향후 매출 가시성에 어떤 의미를 갖는지 정리해줘.",
      "파커 하니핀의 가격 전가, 재료비, Meggitt 통합 비용이 사업부 영업 마진에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  PLD: {
    ticker: "PLD",
    companyName: "Prologis, Inc.",
    companyNameKo: "프로로그리스",
    sectorKo: "부동산",
    signature: "글로벌 물류 부동산 포트폴리오의 점유율·same-매장 NOI와 전략 자본, 데이터센터 전력 파이프라인을 함께 보는 산업용 REIT.",
    description: "프로로그리스는 전자상거래, 리테일, 제조, 3PL 고객에게 물류 부동산을 임대하는 글로벌 물류 부동산 REIT입니다. 공시 해석에서는 점유율과 임대료 change가 same-매장 NOI와 핵심 FFO에 어떻게 연결되는지, development starts와 stabilizations가 향후 임대수익으로 전환되는 속도, 전략 자본의 수수료·promote 수익이 부동산 임대수익과 다른 변동성을 갖는지를 분리해서 봐야 합니다. 최근에는 데이터센터 전력 파이프라인과 에너지 관련 사업도 물류 네트워크의 전력·입지 가치와 연결되는 확장 축입니다.",
    researchFocus: [
      "점유율, 임대료 change, same-매장 NOI가 핵심 FFO에 반영되는 경로",
      "development starts, stabilizations, build-to-suit 프로젝트가 장기 임대수익으로 전환되는 속도",
      "전략 자본의 운용자산, 수수료, promote 수익과 부동산 임대수익의 차이",
      "데이터센터 전력 파이프라인, 태양광, 에너지 스토리지가 물류 부동산 입지 가치에 더하는 효과"
    ],
    riskVariables: [
      "금리 상승과 신용 스프레드 확대로 인한 부채비용·재자금조달 부담",
      "점유율 하락 또는 same-매장 NOI 둔화에 따른 핵심 FFO 압박",
      "개발 프로젝트 지연, 임차인 확보 지연, build-to-suit 비용 초과",
      "전략 자본 성과보수와 자산매각 수익의 경기·거래시장 민감도"
    ],
    suggestedPrompts: [
      "프로로그리스의 점유율, 임대료 change, same-매장 NOI가 핵심 FFO에 어떻게 연결되는지 최근 공시 기준으로 정리해줘.",
      "development starts와 stabilizations가 프로로그리스의 향후 임대수익과 자본배분에 미치는 영향을 설명해줘.",
      "전략 자본과 데이터센터 전력 파이프라인이 프로로그리스의 전통적인 물류 부동산 수익과 어떻게 다른지 비교해줘.",
    ],
    questionChains: {},
  },

  PNC: {
    ticker: "PNC",
    companyName: "PNC Financial Services Group, Inc.",
    companyNameKo: "PNC 파이낸셜 서비스",
    sectorKo: "은행·자산운용",
    signature: "소매은행, Corporate & 기관 은행, 자산 관리를 묶어 NII/순이자마진, 예금 비용, 상업용 부동산 신용 리스크, FirstBank 통합 효과를 함께 봐야 하는 대형 지역은행.",
    description: "PNC는 소매은행, Corporate & 기관 은행, 자산 관리 수익을 기반으로 대출·예금·수수료 사업을 운영합니다. 공시 해석에서는 NII와 순이자마진이 금리 경로, 예금 베타, 대출 믹스, 비이자예금 비중에 어떻게 반응하는지 확인해야 합니다. FirstBank 통합은 대출·예금 기반을 키우는 요인이지만 통합 비용, IT·통제 체계, 신용 포트폴리오 변화도 같이 따라옵니다. 상업용 부동산, 특히 오피스 노출과 소비자 신용 품질는 충당금, ACL, 순 charge-off 경로로 은행 이익 변동성을 만드는 핵심 지점입니다.",
    researchFocus: [
      "NII, 순이자마진, 예금 베타, 비이자예금 비중이 이자수익성에 미치는 영향",
      "Retail 은행, Corporate & 기관 은행, 자산 관리의 수익 믹스와 비용 구조",
      "FirstBank 통합 이후 대출, 예금, branch footprint, 비용 synergy 변화",
      "상업용 부동산·오피스와 소비자 포트폴리오의 ACL, 충당금, 순 charge-off 흐름"
    ],
    riskVariables: [
      "금리 인하·상승 국면에서 예금 비용과 순이자마진이 기대와 다르게 움직일 위험",
      "상업용 부동산·오피스 신용 악화와 소비자 delinquency 증가에 따른 신용 손실 확대",
      "FirstBank 통합 과정의 비용 초과, 시스템 전환, 통제 리스크",
      "uninsured 예금, wholesale 자금조달, liquidity coverage 관련 자금조달 압박"
    ],
    suggestedPrompts: [
      "PNC의 NII와 순이자마진을 예금 베타, 대출 믹스, 비이자예금 비중으로 나눠 최근 공시 기준으로 설명해줘.",
      "FirstBank 통합이 PNC의 대출, 예금, 비용 구조, 신용 리스크에 어떤 변화를 만들었는지 정리해줘.",
      "PNC의 상업용 부동산·오피스와 소비자 신용 risk가 ACL, 충당금, 순 charge-off에 어떻게 반영되는지 분석해줘.",
    ],
    questionChains: {},
  },

  PWR: {
    ticker: "PWR",
    companyName: "Quanta Services, Inc.",
    companyNameKo: "퀀타 서비스",
    sectorKo: "전력·유틸리티 인프라",
    signature: "Electric 인프라 솔루션과 Underground Utility 및 인프라 솔루션에서 전력망·재생에너지·가스 유틸리티 공사를 수행하며, 수주잔고와 계약 믹스가 매출 가시성과 마진 변동성을 좌우하는 인프라 시공사.",
    description: "퀀타 서비스는 전력 송전·배전, 변전소, grid hardening, storm restoration, 재생에너지 연계 인프라, 가스 유틸리티와 파이프라인 무결성 공사를 수행합니다. Electric 인프라 솔루션는 전력망 현대화, 송전망 증설, 재생에너지 에너지 인프라 연계 수요에 민감하고, Underground Utility 및 인프라 솔루션는 가스 유틸리티 교체·보수와 산업 인프라 프로젝트가 중심입니다. 공시 해석에서는 수주잔고와 잔여수행의무가 매출로 전환되는 속도, 고정-가격·단위-가격·비용-plus 계약 믹스, 자재·장비·숙련 인력 가용성이 프로젝트 마진과 운전자본에 미치는 영향을 함께 봐야 합니다.",
    researchFocus: [
      "Electric 인프라 솔루션의 전력망 현대화, 송전·변전, grid hardening 수요",
      "재생에너지 에너지 인프라와 태양광·풍력·배터리 저장 프로젝트의 전력망 연결 공사",
      "Underground Utility 및 인프라 솔루션의 가스 유틸리티, 파이프라인 integrity, 산업 인프라 노출",
      "수주잔고, 잔여수행의무, 고정-가격·단위-가격·비용-plus 계약 믹스가 매출과 마진에 반영되는 방식"
    ],
    riskVariables: [
      "고정-가격 대형 프로젝트의 견적 오류, 일정 지연, change order 회수 실패",
      "전력 유틸리티·재생에너지 고객의 자본지출, 금리, 인센티브 변화",
      "철강·전선·장비·하도급 비용 상승과 숙련 인력 부족",
      "기상 악화, 자연재해, 허가·규제 지연에 따른 생산성 저하와 운전자본 부담"
    ],
    suggestedPrompts: [
      "퀀타 서비스의 Electric 인프라 솔루션과 Underground Utility 및 인프라 솔루션이 매출·마진에서 어떻게 다른지 최근 공시 기준으로 정리해줘.",
      "수주잔고와 잔여수행의무가 퀀타 서비스의 향후 매출 가시성을 보여주는 방식과 한계를 설명해줘.",
      "고정-가격 계약, 자재 조달, 숙련 인력 부족이 퀀타 서비스의 프로젝트 마진과 현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  SBUX: {
    ticker: "SBUX",
    companyName: "Starbucks Corporation",
    companyNameKo: "스타벅스",
    sectorKo: "커피·외식",
    signature: "직영 점포와 licensed 점포, 비교가능 매장 판매의 거래·티켓 분해, 스타벅스 Rewards·모바일 Order 및 Pay가 매장 수익성과 브랜드 반복 구매를 좌우하는 글로벌 커피 체인.",
    description: "스타벅스는 직영 점포에서 음료·푸드 매출을 직접 인식하고, licensed 점포에서는 로열티와 제품 공급 수익을 얻는 구조입니다. 공시 해석에서는 비교가능 매장 판매를 거래와 티켓으로 나눠 트래픽 둔화와 가격·믹스 효과를 구분하고, Back to 스타벅스 운영 재편이 매장 노동, 속도, 고객 경험, 영업이익률에 어떤 변화를 만드는지 확인해야 합니다. 스타벅스 Rewards, 스타벅스 카드, 모바일 Order 및 Pay는 반복 구매와 디지털 주문 믹스를 보여주는 핵심 지표이고, 원두·유제품·관세·인건비 부담은 매장 마진에 직접 반영됩니다.",
    researchFocus: [
      "직영 점포와 licensed 점포의 매출 인식·마진 구조 차이",
      "비교가능 매장 판매의 거래, 티켓, 지역별 믹스 변화",
      "Back to 스타벅스 운영 재편, 매장 폐점·전환, Siren System 투자 효과",
      "스타벅스 Rewards, 스타벅스 카드, 모바일 Order 및 Pay가 주문 빈도와 디지털 믹스에 미치는 영향"
    ],
    riskVariables: [
      "거래건수 감소를 가격·믹스 개선만으로 상쇄하지 못할 위험",
      "원두, 유제품, 물류, 관세, 매장 인건비 상승에 따른 매장 마진 압박",
      "중국·국제 시장 경쟁 심화와 licensed partner 성과 부진",
      "점포 재편, 노조 이슈, 운영 속도 개선 실패로 인한 브랜드 경험 약화"
    ],
    suggestedPrompts: [
      "스타벅스의 직영 점포와 licensed 점포가 매출과 마진에서 어떻게 다른지 최근 공시 기준으로 정리해줘.",
      "비교가능 매장 판매를 거래와 티켓으로 나눠 스타벅스의 트래픽과 가격·믹스 흐름을 설명해줘.",
      "스타벅스 Rewards, 모바일 Order 및 Pay, Back to 스타벅스 운영 재편이 매장 수익성에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  SNPS: {
    ticker: "SNPS",
    companyName: "Synopsys, Inc.",
    companyNameKo: "시놉시스",
    sectorKo: "반도체 설계 자동화·EDA",
    signature: "EDA와 설계 IP를 기반으로 칩 설계·검증 흐름을 장악하고, Ansys 통합으로 시뮬레이션 & analysis와 AI-driven design 포트폴리오를 확장한 반도체 설계 소프트웨어 기업.",
    description: "시놉시스는 설계 자동화, 설계 IP, 시뮬레이션 & analysis 제품을 통해 반도체와 전자 시스템 설계 고객의 개발 흐름에 깊게 들어가 있습니다. 공시 해석에서는 시간기반 라이선스, upfront, 유지보수 및 서비스 매출 믹스가 수주잔고와 현금흐름으로 어떻게 이어지는지 봐야 합니다. Ansys 통합은 multiphysics 시뮬레이션, EDA, AI-driven design 결합을 강화하는 축이지만 통합 비용, 부채·이자비용, 상각 부담도 같이 따라옵니다. 소프트웨어 Integrity 처분 이후에는 EDA·IP·시뮬레이션 중심의 핵심 설계 플랫폼 수익성에 더 집중해 보는 구조입니다.",
    researchFocus: [
      "설계 자동화의 EDA 라이선스, verification, AI-driven design 수요",
      "설계 IP의 processor, 인터페이스, 보안 IP 수요와 고객 tape-out 일정",
      "Ansys 통합 이후 시뮬레이션 & analysis, multiphysics, semiconductor workflow 결합 효과",
      "time-기반, upfront, 유지보수 및 서비스 매출 믹스와 수주잔고 전환 속도"
    ],
    riskVariables: [
      "반도체 고객의 설계 착수 지연과 대형 고객 구매 타이밍 변동",
      "미국 수출 통제와 중국·지역별 규제로 인한 EDA·IP 판매 제약",
      "Ansys 통합 지연, 부채·이자비용, 상각 부담에 따른 현금흐름 압박",
      "설계 IP 경쟁 심화, IP 분쟁, 사이버 보안 사고로 인한 신뢰도 훼손"
    ],
    suggestedPrompts: [
      "시놉시스의 설계 자동화과 설계 IP가 매출 인식과 마진에서 어떻게 다른지 최근 공시 기준으로 설명해줘.",
      "Ansys 통합이 EDA, 시뮬레이션 & analysis, AI-driven design 포트폴리오에 어떤 변화를 주는지 공시 근거로 정리해줘.",
      "시놉시스의 수주잔고, time-기반 라이선스, upfront 매출, 수출 통제 리스크가 현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  SO: {
    ticker: "SO",
    companyName: "Southern Company",
    companyNameKo: "서던 컴퍼니",
    sectorKo: "규제형 전력·가스 유틸리티",
    signature: "Alabama 전력, Georgia 전력, Mississippi 전력, 서던 컴퍼니 전력, 서던 컴퍼니 Company 가스의 규제 utility 구조에서 요금기반자산, 연료비 회수, Vogtle 비용 회수가 현금흐름을 좌우하는 남동부 유틸리티.",
    description: "서던 컴퍼니는 규제형 전력 유틸리티와 천연가스 유통, 도매 전력 사업을 함께 운영합니다. 공시 해석에서는 전력 판매량보다 비율 케이스, allowed ROE, 연료비 회수, storm 비용 회복, AFUDC와 같은 규제 회수 메커니즘이 이익와 현금흐름에 어떤 시차로 반영되는지 보는 것이 중요합니다. Georgia 전력의 Vogtle Units 3·4는 상업운전 이후 요금기반자산와 세액공제·비용 회수 논리로 이어지는 핵심 자산이고, Alabama 전력와 Georgia 전력의 연료비·폭풍복구비 회수 체계는 단기 현금흐름 변동을 설명하는 지점입니다.",
    researchFocus: [
      "Alabama 전력와 Georgia 전력의 비율 케이스, allowed ROE, 요금기반자산 확대 경로",
      "연료비 회수, storm 비용 회복, 비율 ECR 등 규제 회수 메커니즘",
      "Vogtle Units 3·4의 요금기반자산 반영, PTC, 공동 소유 비용 정산",
      "서던 컴퍼니 전력의 PPA와 서던 컴퍼니 Company 가스의 천연가스 유통 수익 안정성"
    ],
    riskVariables: [
      "PSC 요율 승인 지연, allowed ROE 하향, 비용 회수 조건 변경",
      "연료 가격 변동과 연료비 회수 시차에 따른 운전자본 부담",
      "허리케인·폭풍 피해 복구 비용과 회수 일정 불확실성",
      "Vogtle 관련 비용 조정, 장기금리 상승, 대규모 자본지출 부담"
    ],
    suggestedPrompts: [
      "서던 컴퍼니의 Alabama 전력와 Georgia 전력 비율 케이스가 요금기반자산와 allowed ROE에 어떻게 연결되는지 공시 기준으로 정리해줘.",
      "Vogtle Units 3·4의 요금기반자산 반영, PTC, 비용 회수 구조가 현금흐름에 미치는 영향을 설명해줘.",
      "연료비 회수와 storm 비용 회복가 서던 컴퍼니의 단기 이익과 운전자본에 어떤 시차를 만드는지 분석해줘.",
    ],
    questionChains: {},
  },

  TJX: {
    ticker: "TJX",
    companyName: "The TJX Companies, Inc.",
    companyNameKo: "TJX",
    sectorKo: "오프프라이스 소매",
    signature: "Marmaxx, HomeGoods, TJX Canada, TJX 해외을 통해 off-가격 재고 조달력과 빠른 회전율을 수익화하며, comp 판매와 상품 마진이 핵심인 할인 소매업체.",
    description: "TJX는 TJ Maxx, Marshalls, Sierra, HomeGoods, Winners, Homesense, TK Maxx 같은 off-가격 브랜드를 운영합니다. 공시 해석에서는 comp 판매를 고객 거래와 평균 장바구니로 나눠 방문 빈도와 구매 믹스를 구분하고, 상품 마진, markdown, 화물, 재고손실, 판관비 레버리지가 사업부 이익 마진에 어떻게 반영되는지 확인해야 합니다. 온라인 비중보다 매장 방문 경험과 opportunistic buying이 핵심이라, 재고 조달 환경과 소비자의 가치-seeking 성향이 실적의 중요한 선행 신호입니다.",
    researchFocus: [
      "Marmaxx, HomeGoods, TJX Canada, TJX 해외의 comp 판매와 사업부 이익 마진 차이",
      "상품 마진, markon, markdown, 화물, 재고손실이 매출총이익률에 미치는 영향",
      "off-가격 buying 조직이 브랜드 재고, 마감재고, opportunistic 재고를 확보하는 방식",
      "점포 수, 판매 square footage, 이커머스 보조 역할, 환율이 지역별 실적에 주는 영향"
    ],
    riskVariables: [
      "브랜드 재고 조달 환경 악화 또는 상품 믹스 실패에 따른 트래픽 둔화",
      "화물, 임금, 재고손실, markdown 증가로 인한 상품 마진 압박",
      "캐나다·유럽·호주 환율 변동과 해외 소비 둔화",
      "관세, 무역정책, 공급망 병목이 구매 원가와 재고 회전율에 미치는 영향"
    ],
    suggestedPrompts: [
      "TJX의 Marmaxx, HomeGoods, TJX Canada, TJX 해외을 comp 판매와 사업부 마진 기준으로 비교해줘.",
      "TJX의 상품 마진, markdown, 화물, 재고손실이 off-가격 수익성에 어떻게 반영되는지 공시 기준으로 정리해줘.",
      "off-가격 재고 조달력과 소비자 가치-seeking 성향이 TJX의 트래픽과 평균 장바구니에 미치는 영향을 설명해줘.",
    ],
    questionChains: {},
  },

  TT: {
    ticker: "TT",
    companyName: "Trane Technologies plc",
    companyNameKo: "트레인 테크놀로지스",
    sectorKo: "HVAC·운송 냉동",
    signature: "Trane의 상업용·Residential 공조와 Thermo King 운송 냉동을 묶어, 신규 계약·수주잔고·서비스 매출·refrigerant 전환이 마진을 좌우하는 기후 솔루션 기업.",
    description: "트레인 테크놀로지스는 Trane 브랜드의 상업용 공조와 Residential 공조, Thermo King의 Transport Refrigeration, 그리고 서비스·부품·임대 솔루션으로 매출을 만듭니다. 공시 해석에서는 상업용 공조의 신규 계약와 수주잔고가 장비·서비스 매출로 전환되는 속도, Residential 공조가 금리와 주택 수요에 받는 압력, Transport Refrigeration이 트럭·트레일러·콜드체인 투자 사이클에 반응하는 방식을 나눠 봐야 합니다. refrigerant 규제 전환, 원자재·부품 비용, 가격 전가, 설치 인력과 공급망은 매출총이익률의 핵심 변수입니다.",
    researchFocus: [
      "상업용 공조의 신규 계약, 수주잔고, 서비스 attachment, 에너지 효율화 수요",
      "Residential 공조의 금리·주택경기·refrigerant 전환 민감도",
      "Thermo King Transport Refrigeration의 트럭·트레일러·콜드체인 장비 수요",
      "가격 전가, 원자재·물류 비용, 지역별 미주·유럽·중동·아프리카·아시아태평양 마진 차이"
    ],
    riskVariables: [
      "상업용 공조 수주잔고 전환 지연 또는 고객 프로젝트 취소",
      "Residential 공조 수요 둔화와 refrigerant 규제 전환 비용",
      "Transport Refrigeration의 운송 장비 교체 사이클 약화",
      "관세, 원자재, 물류, 환율 변동이 가격 전가보다 빠르게 마진을 압박할 위험"
    ],
    suggestedPrompts: [
      "트레인의 상업용 공조, Residential 공조, Thermo King Transport Refrigeration을 신규 계약와 수주잔고 기준으로 비교해줘.",
      "refrigerant 규제 전환과 금리 환경이 트레인의 Residential 공조 수요와 마진에 미치는 영향을 설명해줘.",
      "트레인의 서비스 매출, 가격 전가, 원자재·물류 비용이 매출총이익률에 어떻게 반영되는지 공시 기준으로 정리해줘.",
    ],
    questionChains: {},
  },

  USB: {
    ticker: "USB",
    companyName: "U.S. Bancorp",
    companyNameKo: "유에스뱅코프",
    sectorKo: "은행·결제",
    signature: "NII/순이자마진과 예금 비용, Payments 수수료, 상업용 부동산·소비자 신용, CET1 자본완충력을 같이 봐야 하는 결제 비중 높은 미국 대형 은행.",
    description: "유에스뱅코프는 자산관리, Corporate, 상업용 및 기관 은행, 소비자 및 비즈니스 은행, 결제 서비스를 함께 운영하는 다각화 은행입니다. 공시 해석에서는 대출 성장보다 NII와 순이자마진이 예금 베타, 예금 믹스, securities reinvestment, 자금조달 비용에 어떻게 반응하는지가 중요합니다. Payments는 카드·상거래 결제 수수료로 은행 수익을 보완하지만 소비 지출, 가맹점 물량, charge-off와도 연결됩니다. 상업용 부동산, 신용카드, 소비자 대출의 ACL과 순 charge-off, 그리고 CET1·liquidity position은 배당·자사주·성장 여력을 판단하는 핵심 변수입니다.",
    researchFocus: [
      "NII, 순이자마진, 예금 베타, 자금조달 비용이 순이자수익에 반영되는 방식",
      "결제 서비스의 가맹점 acquiring, 카드, corporate 결제 수수료 흐름",
      "상업대출, 상업용 부동산, 주택담보, 신용카드 포트폴리오의 신용 품질와 ACL",
      "CET1, 자본 return, liquidity, securities 포트폴리오가 대차대조표 여력에 주는 의미"
    ],
    riskVariables: [
      "예금 비용 상승 또는 비이자예금 감소로 인한 순이자마진 압박",
      "상업용 부동산와 신용카드 연체·charge-off 증가에 따른 충당금 확대",
      "Payments 거래량 둔화, 가맹점 믹스 변화, 규제 비용 증가",
      "BTIG 같은 인수·통합 실행, 자본규제, 유동성 규제 변화"
    ],
    suggestedPrompts: [
      "유에스뱅코프의 NII와 순이자마진을 예금 베타, 자금조달 비용, securities reinvestment 관점에서 최근 공시 기준으로 정리해줘.",
      "결제 서비스가 유에스뱅코프의 은행 수익성을 어떻게 보완하고 어떤 경기 민감도를 갖는지 설명해줘.",
      "유에스뱅코프의 상업용 부동산, 신용카드, ACL, CET1 지표를 연결해 신용 리스크와 자본 여력을 분석해줘.",
    ],
    questionChains: {},
  },

  WM: {
    ticker: "WM",
    companyName: "Waste Management, Inc.",
    companyNameKo: "웨이스트 매니지먼트",
    sectorKo: "폐기물·환경 서비스",
    signature: "수거, transfer, landfill, recycling, 재생에너지 천연가스를 묶어 가격-over-물량과 처리 수율, 원자재 가격, RNG 프로젝트가 마진을 좌우하는 북미 폐기물 처리 기업.",
    description: "웨이스트 매니지먼트는 주거·상업·산업 폐기물 수거, transfer station, landfill 처리, recycling 처리, 재생에너지 에너지 사업을 운영합니다. 공시 해석에서는 수거 및 처리의 평균 수율와 물량을 분리해 가격-over-물량이 실제로 유지되는지 확인해야 합니다. Recycling 처리 및 판매는 재활용 원재료 가격과 처리량에 민감하고, 재생에너지 에너지는 landfill 가스를 RNG·전력으로 전환하는 프로젝트의 가동률과 RINs·RECs 가격이 중요합니다. 헬스케어 솔루션과 인수 통합은 수익원 확대 요인이지만 운송·인력·정비·환경 규제 비용도 함께 따라옵니다.",
    researchFocus: [
      "수거 및 처리의 평균 수율, 물량, 이탈률, 노선 밀도 변화",
      "landfill, transfer station, 처리 수수료, special waste 믹스가 마진에 미치는 영향",
      "Recycling 처리 및 판매의 원자재 가격, 처리 스프레드, 물량 흐름",
      "재생에너지 에너지의 landfill 가스, RNG, RINs, RECs 프로젝트 가동과 수익 기여"
    ],
    riskVariables: [
      "경기 둔화와 건설·산업 활동 약화에 따른 수거 물량 감소",
      "임금, 연료, 차량 정비, 보험 비용 상승으로 인한 영업 비용 압박",
      "재활용 원재료 가격과 RNG·RINs·RECs 가격 변동",
      "landfill permit, PFAS, leachate, environmental remediation 관련 규제 비용"
    ],
    suggestedPrompts: [
      "웨이스트 매니지먼트의 수거 및 처리에서 평균 수율와 물량이 매출과 마진에 어떻게 다르게 반영되는지 정리해줘.",
      "Recycling 처리 및 판매와 재생에너지 에너지가 원자재 가격, RNG, RINs, RECs 가격에 얼마나 민감한지 공시 기준으로 설명해줘.",
      "landfill permit, PFAS, 연료·인건비 상승이 웨이스트 매니지먼트의 현금흐름과 비용 구조에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },

  WMB: {
    ticker: "WMB",
    companyName: "Williams Companies, Inc.",
    companyNameKo: "윌리엄스",
    sectorKo: "천연가스 인프라·미드스트림",
    signature: "Transco 중심 Transmission & Gulf of Mexico의 firm reservation 수익과 Northeast G&P·West 집하·처리, 가스 & 천연가스액 마케팅 스프레드가 현금흐름을 나누는 천연가스 미드스트림 기업.",
    description: "윌리엄스는 Transco와 Northwest 파이프라인 같은 장거리 천연가스 운송·저장 자산, Northeast G&P와 West의 집하·처리, 가스 & 천연가스액 마케팅을 운영합니다. 공시 해석에서는 Transmission & Gulf of Mexico의 firm 생산능력 reservation과 FERC 요율 구조가 수수료 기반 현금흐름을 얼마나 안정화하는지, 집하·처리 물량과 MVC가 생산지역의 가스 흐름을 어떻게 반영하는지 봐야 합니다. 가스 & 천연가스액 마케팅은 basis 스프레드, 계절성, derivative mark-to-시장에 따라 변동성이 커서 안정적인 운송·저장 수익과 분리해 판단해야 합니다.",
    researchFocus: [
      "Transco, Northwest 파이프라인, MountainWest 운송·저장 수익과 FERC 비율 구조",
      "Northeast G&P의 Marcellus·Utica 집하, 처리, MVC 물량",
      "West 사업부의 집하·처리, Deepwater Gulf, Louisiana 에너지 Gateway 노출",
      "가스 & 천연가스액 마케팅의 basis 스프레드, 천연가스액 가격, derivative 손익 변동"
    ],
    riskVariables: [
      "FERC 승인, 비율 케이스, 프로젝트 허가 지연에 따른 확장 일정 리스크",
      "집하·처리 물량 감소와 생산자 drilling activity 둔화",
      "건설비 상승, 연결 프로젝트 지연, 환경·토지 사용 규제",
      "천연가스액 가격, basis 스프레드, 파생상품 평가손익, 계절성 수요 변동"
    ],
    suggestedPrompts: [
      "윌리엄스의 Transco 중심 Transmission 수익이 firm reservation과 FERC 요율 구조로 어떻게 안정화되는지 설명해줘.",
      "Northeast G&P와 West의 집하·처리 물량, MVC, 생산지역 노출이 실적에 미치는 영향을 비교해줘.",
      "가스 & 천연가스액 마케팅의 basis 스프레드와 derivative 손익이 윌리엄스의 안정적인 파이프라인 현금흐름과 어떻게 다른지 정리해줘.",
    ],
    questionChains: {},
  },

  XOM: {
    ticker: "XOM",
    companyName: "Exxon Mobil Corporation",
    companyNameKo: "엑손모빌",
    sectorKo: "통합 에너지",
    signature: "Upstream의 Permian·Guyana·LNG 물량, 에너지 제품 정제 스프레드, Chemical·전문 제품 마진, 저탄소 솔루션 투자 속도를 함께 봐야 하는 통합 에너지 기업.",
    description: "엑손모빌은 Upstream, 에너지 제품, Chemical 제품, 전문 제품, 저탄소 솔루션를 통해 원유·가스 생산부터 정제·화학·특수제품까지 통합 운영합니다. 공시 해석에서는 유가만 보는 것보다 Permian과 Guyana 생산량, LNG 프로젝트, refinery 인력 투입률, 정제마진 스프레드, chemical 마진, 전문 제품 믹스가 영업현금흐름을 어떻게 나누는지 확인해야 합니다. Pioneer 통합과 advantaged 자산 확대는 업스트림 물량과 비용 구조를 바꾸는 축이고, 저탄소 솔루션는 carbon capture, 수소, low-emission fuels 상업화 속도와 정책 지원이 수익성의 관건입니다.",
    researchFocus: [
      "Upstream의 Permian, Guyana, LNG 생산량·realization·단위 비용 변화",
      "에너지 제품의 정제 처리량, refinery 인력 투입률, 정제마진 스프레드, 거래 결과",
      "Chemical 제품와 전문 제품의 제품 믹스, 원료 비용, 마진 cycle",
      "저탄소 솔루션의 carbon capture, 수소, low-emission fuels 투자와 상업화 조건"
    ],
    riskVariables: [
      "원유·천연가스 가격 급락과 지역별 실현 가격 약화",
      "정제·화학 스프레드 축소와 원료 비용 변동",
      "Permian, Guyana, LNG 프로젝트 지연 또는 비용 초과",
      "저탄소 솔루션 정책 지원 약화, 탄소 규제, litigation·환경 리스크"
    ],
    suggestedPrompts: [
      "엑손모빌의 Upstream에서 Permian, Guyana, LNG가 생산량과 현금흐름에 미치는 영향을 최근 공시 기준으로 정리해줘.",
      "에너지 제품, Chemical 제품, 전문 제품의 스프레드와 제품 믹스가 엑손모빌 마진에 어떻게 반영되는지 설명해줘.",
      "저탄소 솔루션과 기존 oil & 가스 사업의 자본지출, 정책 의존도, 현금흐름 성격을 비교해줘.",
    ],
    questionChains: {},
  },

  WFC: {
    ticker: "WFC",
    companyName: "Wells Fargo & Company",
    companyNameKo: "웰스파고",
    sectorKo: "은행",
    signature: "NII/순이자마진, 예금, 소비자 banking, 상업용 부동산·C&I 신용, asset cap·consent order 해소 이후 비용 구조와 자본배분을 함께 봐야 하는 미국 대형 은행.",
    description: "웰스파고는 소비자금융, 상업용 은행, Corporate & 투자 은행, 자산관리 & 투자 관리를 운영하는 대형 은행입니다. 공시 해석에서는 NII와 순이자마진이 예금, 대출 믹스, securities 수율, 자금조달 비용에 어떻게 반응하는지 보고, 소비자 banking의 신용카드·모기지·자동차 대출과 상업용 부동산·C&I 포트폴리오의 allowance와 순 charge-off를 함께 확인해야 합니다. 과거 asset cap과 consent orders는 성장 제약과 준수 비용를 만든 핵심 변수였고, 관련 해소 이후에도 통제·리스크 관리 비용과 자본배분 정상화 속도를 따로 점검해야 합니다.",
    researchFocus: [
      "NII, 순이자마진, 예금, 대출 믹스, 자금조달 비용이 순이자수익에 미치는 영향",
      "소비자 banking의 신용카드, 모기지, 자동차 대출, 리테일 수수료 흐름",
      "상업용 부동산, C&I, 신용 카드, 자동차 포트폴리오의 ACL, 충당금, 순 charge-off 변화",
      "asset cap, FRB·OCC·CFPB consent orders 해소 이후 준수 비용과 자본 return"
    ],
    riskVariables: [
      "예금 비용 상승과 대출 성장 둔화에 따른 순이자마진 압박",
      "상업용 부동산·C&I·신용카드 charge-off 증가와 충당금 확대",
      "consent order 이후에도 남는 운영·통제·준수 비용",
      "금리·환율·파생상품·자본 rule 변화가 자본배분과 수익성에 미치는 영향"
    ],
    suggestedPrompts: [
      "웰스파고의 NII와 순이자마진을 예금, 대출 믹스, 자금조달 비용 관점에서 최근 공시 기준으로 정리해줘.",
      "상업용 부동산, C&I, 신용 카드, 자동차, 모기지 포트폴리오별 신용 손실와 allowance 흐름을 비교해줘.",
      "asset cap과 consent order 해소 이후 웰스파고의 준수 비용, 자본배분, 자사주 정책에 남은 체크포인트를 설명해줘.",
    ],
    questionChains: {},
  },
  AMT: {
    ticker: "AMT",
    companyName: "American Tower Corporation",
    companyNameKo: "아메리칸 타워",
    sectorKo: "통신 인프라 REIT",
    signature: "communications 부동산에서 tower leasing, 코로케이션, tenant 청구액를 만들고 CoreSite 데이터센터와 AFFO 전환을 함께 봐야 하는 글로벌 통신 인프라 REIT.",
    description: "아메리칸 타워는 미국·캐나다, 유럽, 라틴아메리카, Africa & 아시아태평양의 통신 타워와 CoreSite 데이터센터를 운영합니다. 공시 해석에서는 tower leasing의 tenant 청구액, 코로케이션, amendment, straight-line 매출 조정이 유기적 tenant 청구액 성장로 이어지는지 확인해야 합니다. DISH 같은 tenant 이탈률과 특정 고객 분쟁은 임대수익 안정성을 흔들 수 있고, 데이터센터는 전력·냉각·interconnection 수요와 자본 expenditure가 AFFO 전환 속도를 좌우합니다. REIT 특성상 금리, 부채 만기, 환율, 배당 여력도 사업 성장만큼 중요합니다.",
    researchFocus: [
      "tower leasing의 tenant 청구액, 코로케이션, amendment, tenant 이탈률 변화",
      "CoreSite 데이터센터의 rental, 전력, interconnection 수익과 전력·냉각 제약",
      "지역별 U.S. & Canada, Europe, Latin 미국, Africa & 아시아태평양 site 수익성 차이",
      "AFFO, 자본 expenditure, 부채비용, 배당 여력의 연결 구조"
    ],
    riskVariables: [
      "DISH 등 대형 tenant 이탈률과 임대료 분쟁에 따른 유기적 성장 둔화",
      "데이터센터 전력 확보, 냉각, 허가, utility 계약 지연",
      "금리 상승, refinancing, 환율 변동이 AFFO와 배당 여력에 미치는 압박",
      "통신사 네트워크 지출 둔화와 tower 코로케이션 수요 약화"
    ],
    suggestedPrompts: [
      "아메리칸 타워의 tower leasing에서 tenant 청구액, 코로케이션, tenant 이탈률이 AFFO에 어떻게 연결되는지 정리해줘.",
      "CoreSite 데이터센터가 아메리칸 타워의 기존 통신 타워 사업과 다른 수익·비용 구조를 갖는지 설명해줘.",
      "DISH 같은 대형 tenant 이탈, 금리, 환율이 아메리칸 타워의 배당 여력과 현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  CSX: {
    ticker: "CSX",
    companyName: "CSX Corporation",
    companyNameKo: "CSX",
    sectorKo: "철도 운송",
    signature: "미국 동부 철도망에서 상품, 복합운송, 석탄, trucking 물동량을 운송하며, 연료 할증료와 영업 비율, 열차 속도·체류이 수익성과 서비스 품질을 함께 보여주는 화물철도 기업.",
    description: "CSX는 동부 미국 철도 네트워크와 복합운송 터미널을 기반으로 산업재, 농산물, 자동차, 화학, 석탄, 컨테이너 화물을 운송합니다. 공시 해석에서는 상품, 복합운송, 석탄의 물동량과 운임 믹스를 나눠 보고, 연료 할증료가 연료비 변동을 얼마나 상쇄하는지 확인해야 합니다. 영업 비율, 열차 속도, 터미널 체류, on-time 성과는 네트워크 효율과 고객 서비스 수준을 동시에 보여주는 핵심 지표입니다. 노무 계약, 안전 규제, hazardous materials, 석탄 수요와 다른 운송모드 경쟁은 마진과 물동량을 흔드는 주요 변수입니다.",
    researchFocus: [
      "상품, 복합운송, 석탄, trucking의 물동량·운임 믹스와 매출 기여",
      "연료 할증료와 locomotive 연료 비용이 영업이익에 반영되는 방식",
      "영업 비율, 열차 속도, 터미널 체류, trip plan compliance의 서비스 품질 신호",
      "동부 네트워크, 복합운송 터미널, 석탄 export·domestic 수요가 자산 활용도에 미치는 영향"
    ],
    riskVariables: [
      "연료 가격 변동과 연료 할증료 회수 시차",
      "석탄 수요 약화, 천연가스 가격, export 석탄 시장 변동",
      "노무 계약, 안전 규제, hazardous materials 관련 비용 증가",
      "트럭 경쟁, 경기 둔화, 기상 재해로 인한 물동량·네트워크 생산성 저하"
    ],
    suggestedPrompts: [
      "CSX의 상품, 복합운송, 석탄 물동량과 운임 믹스가 매출과 영업 비율에 어떻게 연결되는지 정리해줘.",
      "연료 할증료와 연료비 변동이 CSX의 영업이익과 현금흐름에 미치는 영향을 공시 기준으로 설명해줘.",
      "열차 속도, 터미널 체류, on-time 성과가 CSX의 서비스 품질과 마진에 어떤 신호를 주는지 분석해줘.",
    ],
    questionChains: {},
  },
  CI: {
    ticker: "CI",
    companyName: "The Cigna Group",
    companyNameKo: "시그나 그룹",
    sectorKo: "헬스케어·보험",
    signature: "Evernorth 헬스케어 서비스의 약국 급여 서비스와 Cigna 헬스케어의 보험 사업을 나눠 보며, 보험금 청구 믹스, 리베이트 구조, 의료관리비율이 수익성을 좌우하는 헬스케어 기업.",
    description: "시그나 그룹은 Evernorth 헬스케어 서비스와 Cigna 헬스케어를 통해 약제 급여 관리, 전문 관리, 의료보험, 국제 건강보험 사업을 운영합니다. 공시 해석에서는 Evernorth의 약국 claim 물량, 전문 drug 믹스, 리베이트와 제조사 협상 구조가 조정 매출과 마진에 어떻게 반영되는지 봐야 합니다. Cigna 헬스케어는 프리미엄 비율, 회원 수, 의료 비용 trend, 인력 투입률, 의료관리비율이 핵심이고, 메디케어 Advantage 등 일부 사업 매각 이후에는 과거 비교보다 남은 사업의 마진 흐름을 더 중요하게 봐야 합니다.",
    researchFocus: [
      "Evernorth Pharmacy Benefit 서비스의 claim 물량, 전문 drug 믹스, 리베이트 구조",
      "전문 및 관리 서비스의 고객 확장, 약제 유통, 관리 관리 수익",
      "Cigna 헬스케어의 프리미엄 비율, 회원 수, 의료관리비율, 인력 투입률 변화",
      "메디케어 Advantage·PDP 매각 이후 남은 사업 믹스와 현금흐름 비교 가능성"
    ],
    riskVariables: [
      "고가 전문 drug 비중 증가와 제조사 약가 상승에 따른 약국 마진 압박",
      "리베이트-잉여 모델 전환과 PBM 규제 강화로 인한 계약 구조 변화",
      "의료 비용 trend, 인력 투입률, 단위 비용 상승에 따른 의료관리비율 악화",
      "사업 매각 이후 비교 기준 왜곡, 보험부채·제조사 미수금 타이밍에 따른 현금흐름 변동"
    ],
    suggestedPrompts: [
      "시그나의 Evernorth에서 약국 claim 물량, 전문 drug 믹스, 리베이트 구조가 마진에 어떻게 연결되는지 정리해줘.",
      "Cigna 헬스케어의 프리미엄 비율, 인력 투입률, 의료관리비율이 보험 사업 수익성에 미치는 영향을 설명해줘.",
      "메디케어 Advantage 등 매각 이후 시그나의 남은 성장 축과 비교 기준 변화가 어떤 의미를 갖는지 분석해줘.",
    ],
    questionChains: {},
  },
  DELL: {
    ticker: "DELL",
    companyName: "Dell Technologies Inc.",
    companyNameKo: "델 테크놀로지스",
    sectorKo: "서버·PC·스토리지",
    signature: "인프라 솔루션 Group의 AI servers와 스토리지, 고객 솔루션 Group의 상업용 PC 수요를 함께 보며, AI 믹스가 매출총이익률·재고·운전자본을 흔드는 하드웨어 플랫폼 기업.",
    description: "델 테크놀로지스는 인프라 솔루션 Group(ISG)과 고객 솔루션 Group(CSG)을 통해 서버, 스토리지, 네트워킹, 상업용 PC, 소비자 PC, 서비스 매출을 만듭니다. 공시 해석에서는 AI-optimized servers와 traditional servers의 성장 속도, 스토리지 수요, CSG 상업용 refresh가 매출을 얼마나 지탱하는지 나눠 봐야 합니다. AI server 믹스 확대는 매출 성장을 키우지만 부품 조달, 메모리 비용, 재고와 매출채권 증가, 매출총이익률 희석을 동반할 수 있습니다. 이연매출, 잔여수행의무, channel 재고는 향후 매출 인식과 현금흐름 가시성을 판단하는 핵심 지표입니다.",
    researchFocus: [
      "ISG의 AI-optimized servers, traditional servers 및 네트워킹, 스토리지 매출·마진 구조",
      "CSG의 상업용 PC, 소비자 PC, 서비스 수요와 PC refresh 사이클",
      "AI server 믹스가 매출총이익률, 부품 조달, 재고, accounts receivable에 미치는 영향",
      "이연매출, 잔여수행의무, channel 재고의 매출 인식 신호"
    ],
    riskVariables: [
      "AI server 수요의 고객별 주문 타이밍 변동과 수주잔고 전환 불확실성",
      "메모리·GPU·부품 비용 상승과 공급 constraint에 따른 매출총이익률 압박",
      "재고와 매출채권 증가로 인한 운전자본 부담",
      "PC refresh 둔화, 가격 경쟁, 서비스 재판매 축소에 따른 CSG 수익성 약화"
    ],
    suggestedPrompts: [
      "델의 ISG에서 AI-optimized servers, traditional servers, 스토리지가 매출과 마진에 어떻게 다르게 기여하는지 정리해줘.",
      "AI server 믹스 확대가 델의 매출총이익률, 재고, 매출채권, 현금흐름에 미치는 영향을 공시 기준으로 설명해줘.",
      "CSG 상업용 PC 수요와 이연매출, 잔여수행의무가 델의 향후 매출 가시성에 주는 신호를 분석해줘.",
    ],
    questionChains: {},
  },
  EMR: {
    ticker: "EMR",
    companyName: "Emerson Electric Co.",
    companyNameKo: "에머슨 일렉트릭",
    sectorKo: "산업 자동화",
    signature: "소프트웨어 & 시스템, Intelligent Devices, 안전 & 생산성를 통해 공정·하이브리드·이산 제조 자동화를 제공하며, AspenTech와 수주잔고 전환이 마진과 현금흐름을 좌우하는 자동화 기업.",
    description: "에머슨 일렉트릭은 DeltaV, Ovation, AspenTech, Test & Measurement, Final 제어, Measurement & Analytical, 안전 & 생산성 제품군을 통해 공정, hybrid, discrete automation 고객을 지원합니다. 공시 해석에서는 소프트웨어 & 시스템의 소프트웨어 갱신과 Test & Measurement 수요, Intelligent Devices의 밸브·계측·분석 장비 수요, 안전 & 생산성의 산업 현장 생산성 솔루션을 나눠 봐야 합니다. AspenTech 통합은 소프트웨어와 자산 최적화 비중을 높이는 축이지만 무형자산 상각, 인수 비용, 갱신 타이밍 변동도 함께 만듭니다. 수주잔고 전환 속도와 지역별 주문 흐름은 단기 매출 가시성의 핵심 신호입니다.",
    researchFocus: [
      "소프트웨어 & 시스템의 DeltaV, Ovation, AspenTech, Test & Measurement 수요",
      "Intelligent Devices의 Final 제어, Measurement & Analytical, discrete automation 장비 흐름",
      "AspenTech 통합 이후 소프트웨어 믹스, 반복매출, 무형자산 상각 영향",
      "수주잔고 전환, 가격 조정, 관세·환율·원재료 비용이 마진에 반영되는 방식"
    ],
    riskVariables: [
      "소프트웨어 갱신 타이밍 지연과 대형 자동화 프로젝트 발주 둔화",
      "관세, 원자재, 전자부품 비용 상승을 가격 조정으로 상쇄하지 못할 위험",
      "AspenTech 통합 비용, 무형자산 상각, 포트폴리오 재편에 따른 이익 변동",
      "에너지·화학·산업 고객의 설비투자 사이클 둔화와 지역별 수요 편차"
    ],
    suggestedPrompts: [
      "에머슨의 소프트웨어 & 시스템와 Intelligent Devices가 매출·마진에서 어떻게 다른지 공시 기준으로 정리해줘.",
      "AspenTech 통합이 에머슨의 소프트웨어 믹스, 반복매출, 무형자산 상각 부담에 어떤 변화를 주는지 설명해줘.",
      "수주잔고 전환, 관세, 원자재 비용, 자동화 프로젝트 발주가 에머슨의 현금흐름에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  APO: {
    ticker: "APO",
    companyName: "Apollo Global Management, Inc.",
    companyNameKo: "아폴로 글로벌 매니지먼트",
    sectorKo: "대체자산 운용",
    signature: "자산 관리와 Athene 중심 Retirement 서비스를 결합해 운용자산, FRE, 스프레드-관련 이익, origination이 함께 움직이는 대체자산 운용사.",
    description: "아폴로는 private 신용, equity, 실물자산, insurance-linked retirement 자산를 운용하고 Athene·Athora 등 Retirement 서비스와 연결된 자산 조달·투자 구조를 갖고 있습니다. 공시 해석에서는 운용자산과 수수료-Generating 운용자산 증가가 관리 수수료와 FRE로 얼마나 전환되는지, Athene의 스프레드-관련 이익이 순 스프레드와 투자 포트폴리오 수익률에 얼마나 민감한지 확인해야 합니다. origination, deployment, realizations, 성과보수 이자는 시장 환경과 거래 회전 속도에 따라 이익의 질을 크게 바꿉니다.",
    researchFocus: [
      "운용자산, 수수료-Generating 운용자산, 관리 수수료, FRE의 성장 연결",
      "Athene·Athora 기반 Retirement 서비스의 순 스프레드와 스프레드-관련 이익",
      "origination, asset-backed finance, private 신용 deployment가 수수료와 보험자산에 미치는 영향",
      "realizations, 성과보수 이자, 투자 성과가 변동 이익과 배당 여력에 주는 신호"
    ],
    riskVariables: [
      "금리와 신용 스프레드 변화로 순 스프레드와 스프레드-관련 이익이 압박될 위험",
      "시장 침체로 deployment, realizations, 성과보수 이자 인식이 지연될 가능성",
      "보험 계리 가정, 대체투자 평가, 유동성 수요가 Retirement 서비스 이익을 흔들 위험",
      "대형 M&A·보험 플랫폼 통합과 규제 자본 요구가 수수료 믹스와 자본배분에 주는 부담"
    ],
    suggestedPrompts: [
      "아폴로의 운용자산과 수수료-Generating 운용자산이 관리 수수료와 FRE로 어떻게 전환되는지 공시 기준으로 정리해줘.",
      "Athene 중심 Retirement 서비스에서 순 스프레드와 스프레드-관련 이익이 어떤 변수에 민감한지 설명해줘.",
      "origination, deployment, realizations, 성과보수 이자가 아폴로의 이익 변동성과 배당 여력에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  HWM: {
    ticker: "HWM",
    companyName: "Howmet Aerospace Inc.",
    companyNameKo: "하우메트 에어로스페이스",
    sectorKo: "항공우주 부품",
    signature: "Engine 제품, Fastening 시스템, Engineered Structures, Forged Wheels를 통해 항공 엔진·방산·가스터빈·상용차 휠 수요를 받는 경량 금속 부품 기업.",
    description: "하우메트 에어로스페이스는 항공 엔진용 투자 castings, airfoils, fasteners, titanium structures, forged wheels 같은 고부가 금속 부품을 생산합니다. 공시 해석에서는 Engine 제품와 Fastening 시스템가 상업 항공·방산 항공·가스터빈 수요에 얼마나 민감한지, Engineered Structures가 titanium·aluminum 가공과 airframe·landing gear 수요에서 어떤 마진을 내는지 봐야 합니다. titanium, aluminum, nickel, cobalt, 에너지 비용을 가격 인상과 inflationary 비용 전가로 얼마나 반영하는지, GE 항공우주·RTX 같은 대형 고객 의존도가 핵심 리스크입니다.",
    researchFocus: [
      "Engine 제품의 engine 예비부품, airfoils, 투자 casting, 가스터빈 수요",
      "Fastening 시스템와 Engineered Structures의 항공기·엔진·landing gear 부품 노출",
      "Forged Wheels의 상용 운송·대형 트럭 사이클 민감도",
      "titanium, aluminum, nickel, cobalt, 에너지 비용과 가격 전가 구조"
    ],
    riskVariables: [
      "GE 항공우주, RTX 등 대형 고객 생산 일정과 항공 엔진 수요 변동",
      "원자재·에너지·관세 비용을 가격 인상으로 충분히 전가하지 못할 위험",
      "상업 항공 생산 지연, 방산 프로그램 일정 변경, 공급망 병목",
      "인수 통합, 제품 라인 재편, 품질·납기 문제로 인한 마진 압박"
    ],
    suggestedPrompts: [
      "하우메트의 Engine 제품, Fastening 시스템, Engineered Structures, Forged Wheels가 매출·마진에서 어떻게 다른지 정리해줘.",
      "상업 항공, 방산 항공, 가스터빈 수요가 하우메트의 engine 예비부품와 fasteners에 미치는 영향을 설명해줘.",
      "titanium, aluminum, nickel, cobalt 비용과 대형 고객 의존도가 하우메트의 마진 방어력에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  KKR: {
    ticker: "KKR",
    companyName: "KKR & Co. Inc.",
    companyNameKo: "KKR",
    sectorKo: "대체자산 운용",
    signature: "사모펀드, Real 자산, 신용 & Liquid Strategies와 글로벌 대서양 보험 플랫폼을 결합해 FPAUM, FRE, 성과보수 이자, realizations가 함께 움직이는 대체자산 운용사.",
    description: "KKR은 자산운용, 자본 시장, 보험 플랫폼 글로벌 대서양을 함께 운영합니다. 공시 해석에서는 운용자산보다 수수료 Paying 운용자산(FPAUM)이 관리 수수료와 FRE로 얼마나 전환되는지, 사모펀드·Real 자산·신용 전략별 자본 raised와 deployment가 수수료 기반을 얼마나 키우는지 봐야 합니다. 성과보수 이자와 실현 성과 수익은 realizations 타이밍에 민감하고, 글로벌 대서양은 순 투자 수익과 비용 of insurance, 신용 포트폴리오 성과가 KKR 전체 이익 변동성을 키우거나 완충하는 축입니다.",
    researchFocus: [
      "사모펀드, Real 자산, 신용 & Liquid Strategies의 운용자산·FPAUM·자본 raised 흐름",
      "관리 수수료, 거래 수수료, FRE, 수수료-관련 성과 매출의 연결 구조",
      "성과보수 이자, carry-eligible 운용자산, realizations, deployment 속도",
      "글로벌 대서양의 순 투자 수익, 비용 of insurance, 신용 포트폴리오 성과"
    ],
    riskVariables: [
      "시장 침체로 realizations와 성과보수 이자 인식이 지연될 위험",
      "금리·신용 스프레드 변화로 글로벌 대서양 투자수익과 보험 비용이 흔들릴 가능성",
      "비상장 자산 가치평가, leverage, 유동성 악화가 운용자산·FPAUM 성장에 주는 압박",
      "규제·보험 자본 요구, 핵심 인력 이탈, 제3자 운영 리스크"
    ],
    suggestedPrompts: [
      "KKR의 사모펀드, Real 자산, 신용 & Liquid Strategies별 운용자산과 FPAUM이 FRE로 어떻게 연결되는지 정리해줘.",
      "성과보수 이자와 realizations 타이밍이 KKR의 실현 이익과 배당 여력에 미치는 영향을 설명해줘.",
      "글로벌 대서양의 순 투자 수익과 비용 of insurance가 KKR 전체 수익성에 어떤 변동성을 만드는지 분석해줘.",
    ],
    questionChains: {},
  },
  JCI: {
    ticker: "JCI",
    companyName: "Johnson Controls International plc",
    companyNameKo: "존슨컨트롤스",
    sectorKo: "빌딩 솔루션",
    signature: "미주, 유럽·중동·아프리카, 아시아태평양에서 공조, fire & 보안, OpenBlue, 서비스 매출을 묶어 건물 자동화·효율화 수요를 수익화하는 빌딩 솔루션 기업.",
    description: "존슨컨트롤스는 상업용 건물의 공조, 제어, fire & 보안, 디지털 운영 솔루션과 유지보수 서비스를 제공합니다. 공시 해석에서는 제품 & 시스템 매출과 서비스 매출이 각각 설치형 프로젝트와 반복 유지보수로 어떻게 나뉘는지, 미주·유럽·중동·아프리카·아시아태평양의 orders와 수주잔고가 매출로 전환되는 속도를 봐야 합니다. OpenBlue와 connected 제품는 건물 운영 효율과 데이터 기반 서비스를 강화하지만 사이버 보안, 데이터 프라이버시, 장기 서비스 계약 이행 리스크도 함께 키웁니다. R&LC 공조 매각 이후 포트폴리오 단순화가 마진과 현금흐름에 반영되는지도 중요합니다.",
    researchFocus: [
      "미주, 유럽·중동·아프리카, 아시아태평양별 제품 & 시스템와 서비스 매출의 성장·마진 차이",
      "orders, 수주잔고, 잔여수행의무가 설치 프로젝트와 서비스 매출로 전환되는 속도",
      "공조, controls, fire & 보안, OpenBlue connected 제품의 수익 기여",
      "R&LC 공조 매각 이후 포트폴리오 단순화와 구조조정 비용 흐름"
    ],
    riskVariables: [
      "대형 프로젝트 지연·취소와 수주잔고 전환 속도 둔화",
      "관세, 부품 조달, 설치 인력 부족으로 인한 프로젝트 마진 압박",
      "OpenBlue와 connected 제품 관련 cyber breach·데이터 프라이버시 리스크",
      "포트폴리오 매각 정산, 과거 fire·Tyco 법적 이슈, 구조조정 실행 비용"
    ],
    suggestedPrompts: [
      "존슨컨트롤스의 제품 & 시스템와 서비스 매출이 미주, 유럽·중동·아프리카, 아시아태평양별로 어떻게 다른지 정리해줘.",
      "orders, 수주잔고, 잔여수행의무가 존슨컨트롤스의 향후 매출과 현금흐름 가시성에 주는 의미를 설명해줘.",
      "OpenBlue, 공조, fire & 보안 사업과 R&LC 공조 매각 이후 포트폴리오 변화가 마진에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  MCO: {
    ticker: "MCO",
    companyName: "Moody's Corporation",
    companyNameKo: "무디스",
    sectorKo: "신용평가·금융 데이터",
    signature: "무디스 Investors 서비스의 ratings 발행와 무디스 Analytics의 반복매출·연간 반복매출·KYC·데이터 분석가 함께 실적을 만드는 금융 정보 기업.",
    description: "무디스는 무디스 Investors 서비스(MIS)와 무디스 Analytics(MA)를 통해 신용평가, 리서치, 데이터, 리스크 분석, KYC 솔루션을 제공합니다. 공시 해석에서는 MIS의 Corporate Finance, Structured Finance, 금융 Institutions, Public Project & 인프라 발행 수요가 거래 매출과 마진을 얼마나 흔드는지 봐야 합니다. MA는 Decision 솔루션, 리서치·인사이트, 데이터 & Information의 반복매출과 연간 반복매출이 핵심이고, 클라우드 구독과 데이터 솔루션 확장이 수익 방어력을 높입니다. 신용평가 규제, 소송, 모델·데이터 품질, AI 제품 신뢰성은 평판과 비용 구조를 동시에 건드리는 리스크입니다.",
    researchFocus: [
      "MIS의 ratings 발행, 거래 매출, CFG·SFG·FIG·PPIF 발행시장 민감도",
      "MA의 반복매출, 연간 반복매출, 이연매출, Decision 솔루션·KYC 수요",
      "리서치·인사이트, 데이터 & Information, 클라우드 구독 전환이 마진에 미치는 영향",
      "신용평가 규제, litigation, 생성형 AI·데이터 품질, cyber risk가 비용 구조에 주는 부담"
    ],
    riskVariables: [
      "금리·신용 스프레드·발행시장 위축으로 MIS 거래 매출이 급감할 위험",
      "신용평가 규제, 조사, 소송으로 인한 법률비용과 평판 훼손",
      "MA 구독 갱신 둔화, KYC·데이터 분석 경쟁 심화, 고객 예산 축소",
      "생성형 AI 제품 오류, 데이터 품질 문제, cyber breach로 인한 신뢰도 저하"
    ],
    suggestedPrompts: [
      "무디스의 MIS ratings 발행와 MA 반복매출이 매출 안정성에서 어떻게 다른지 공시 기준으로 비교해줘.",
      "MA의 연간 반복매출, Decision 솔루션, KYC, 데이터 분석가 무디스의 반복매출과 마진에 어떤 의미를 갖는지 설명해줘.",
      "신용평가 규제, 소송, 생성형 AI·데이터 품질 리스크가 무디스의 비용 구조와 평판에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  MDT: {
    ticker: "MDT",
    companyName: "Medtronic plc",
    companyNameKo: "메드트로닉",
    sectorKo: "의료기기",
    signature: "심혈관 치료, Neuroscience, 의료 수술, Diabetes 포트폴리오에서 CoreValve·PulseSelect·Hugo·MiniMed 채택과 규제·보상 환경을 함께 봐야 하는 글로벌 의료기기 기업.",
    description: "메드트로닉은 심혈관, 신경과학, 수술·의료기기, 당뇨 관리 제품을 전 세계 병원과 환자에게 공급합니다. 공시 해석에서는 심혈관 치료의 CoreValve, Micra, PulseSelect와 Neuroscience의 spine·신경혈관 치료 제품, 의료 수술의 Hugo RAS와 surgical technologies, Diabetes의 MiniMed 780G·Simplera·Guardian 채택 속도를 나눠 봐야 합니다. 관세, 환율, 공급망, 연구개발·판관비 상용화 비용은 제품 성장과 별도로 마진을 흔들 수 있고, Diabetes 분리 추진은 비용 구조와 사업 포커스를 바꾸는 이벤트입니다.",
    researchFocus: [
      "심혈관 치료의 CoreValve, Micra, PulseSelect, cardiac rhythm 제품 채택",
      "Neuroscience의 spine, 신경조절, ENT, 신경혈관 치료 수요",
      "의료 수술의 Hugo RAS, stapling, surgical technologies 수익성",
      "Diabetes의 MiniMed, Simplera, Guardian과 분리 추진에 따른 비용·전략 변화"
    ],
    riskVariables: [
      "규제 승인 지연, 보험 보상 변화, 병원 구매 예산 압박",
      "관세, 환율, 공급망 비용이 매출총이익률을 낮출 위험",
      "Diabetes 분리 과정의 구조조정 비용과 운영 집중도 저하",
      "신제품 상용화 연구개발·판관비 부담과 제품 리콜·품질 리스크"
    ],
    suggestedPrompts: [
      "메드트로닉의 심혈관 치료, Neuroscience, 의료 수술, Diabetes가 매출과 마진에서 어떻게 다른지 정리해줘.",
      "CoreValve, PulseSelect, Hugo RAS, MiniMed 제품군이 메드트로닉의 성장 동력으로 어떻게 작동하는지 설명해줘.",
      "관세, 환율, 보험 보상, Diabetes 분리 추진이 메드트로닉의 현금흐름과 비용 구조에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  MMM: {
    ticker: "MMM",
    companyName: "3M Company",
    companyNameKo: "3M",
    sectorKo: "산업·소비재 제조",
    signature: "안전 및 산업, 운송 및 Electronics, 소비자 사업의 기초 수익성과 Solventum 분사 이후 PFAS·Combat Arms Earplugs 소송성 항목을 함께 봐야 하는 산업재 기업.",
    description: "3M은 안전 및 산업, 운송 및 Electronics, 소비자 제품군을 통해 산업용 접착제·연마재, 전기·전자 소재, 자동차·항공·반도체 소재, 가정·소비재 제품을 공급합니다. 공시 해석에서는 electrical 시장, 산업 adhesives, abrasives, 데이터센터, semiconductor, 항공우주 수요가 세그먼트 마진을 어떻게 움직이는지 봐야 합니다. Solventum 분사 이후 헬스케어가 빠진 구조에서 PFAS, Combat Arms Earplugs, Aearo respirator mask/asbestos, transformation 비용 같은 특수 항목이 GAAP 이익과 현금흐름을 계속 흔드는지가 핵심입니다.",
    researchFocus: [
      "안전 및 산업의 electrical 시장, adhesives, abrasives, 산업 specialties 수요",
      "운송 및 Electronics의 semiconductor, 데이터센터, 항공우주, 자동차 노출",
      "소비자의 home improvement, 패키징, home 및 자동차 관리 수요 변화",
      "Solventum 분사 이후 PFAS, Combat Arms Earplugs, Aearo 관련 충당금과 현금지출"
    ],
    riskVariables: [
      "PFAS 소송·규제와 환경 정화 비용의 장기 현금흐름 부담",
      "Combat Arms Earplugs와 Aearo respirator/asbestos 관련 합의·청구 변동",
      "소비자 수요 둔화와 home improvement·패키징 약세",
      "관세, 구조조정, transformation 비용이 세그먼트 마진을 압박할 위험"
    ],
    suggestedPrompts: [
      "3M의 안전 및 산업, 운송 및 Electronics, 소비자 세그먼트가 매출·마진에서 어떻게 다른지 정리해줘.",
      "PFAS, Combat Arms Earplugs, Aearo 관련 항목이 3M의 현금흐름과 이익 품질에 미치는 영향을 설명해줘.",
      "Solventum 분사 이후 3M의 남은 사업 포트폴리오와 transformation 비용이 투자 판단에 주는 의미를 분석해줘.",
    ],
    questionChains: {},
  },
  MPWR: {
    ticker: "MPWR",
    companyName: "Monolithic Power Systems, Inc.",
    companyNameKo: "모놀리식 파워 시스템즈",
    sectorKo: "전력관리 반도체",
    signature: "전력관리 IC, DC-DC converters, 전력 modules를 기업 데이터, 자동차, 산업 고객에 공급하며, AI 서버 수요와 재고·파운드리·OSAT 운영이 마진을 좌우하는 fabless 반도체 기업.",
    description: "모놀리식 파워 시스템즈는 전력관리 IC, DC-DC·AC-DC converter, 전력 모듈, wafer die를 설계하고 외부 파운드리와 OSAT 파트너를 통해 생산합니다. 공시 해석에서는 기업 데이터의 AI 서버 전력 수요, 스토리지 및 computing, 자동차, 산업, communications, 소비자 최종시장별 매출 흐름을 나눠 봐야 합니다. 유통업체와 가치-added reseller 채널 비중이 높아 주문 재조정과 stock rotation이 매출 가시성을 흔들 수 있고, 재고와 구매 약정는 현금흐름의 핵심 변수입니다.",
    researchFocus: [
      "기업 데이터와 AI 서버용 전력관리 IC·모듈 수요",
      "스토리지 및 computing, 자동차, 산업, communications, 소비자 최종시장 믹스",
      "파운드리, OSAT, wafer, assembly/test 비용이 매출총이익률에 미치는 영향",
      "유통업체, VAS, stock rotation, 재고, 구매 약정가 운전자본에 주는 신호"
    ],
    riskVariables: [
      "AI 서버 주문 타이밍 변동과 고객·채널 재고 조정",
      "wafer 생산능력, 파운드리, OSAT 병목과 원재료·관세 비용 상승",
      "유통업체 의존도와 아시아 매출 편중에 따른 지역·채널 리스크",
      "재고 증가, stock rotation, 구매 의무 확대에 따른 현금흐름 압박"
    ],
    suggestedPrompts: [
      "모놀리식 파워의 기업 데이터와 AI 서버용 전력관리 수요가 매출·마진에 어떻게 연결되는지 정리해줘.",
      "파운드리, OSAT, wafer, assembly/test 비용이 MPWR의 매출총이익률과 공급 안정성에 미치는 영향을 설명해줘.",
      "유통업체 채널, stock rotation, 재고, 구매 약정가 MPWR의 현금흐름에 주는 리스크를 분석해줘.",
    ],
    questionChains: {},
  },
  MNST: {
    ticker: "MNST",
    companyName: "Monster Beverage Corporation",
    companyNameKo: "몬스터 베버리지",
    sectorKo: "에너지 음료",
    signature: "Monster 에너지 Drinks와 전략 브랜드 원액, Alcohol 브랜드를 Coca-Cola 병입 시스템과 병행 유통하며, 케이스 판매·promotional allowances·알루미늄 캔 비용이 마진을 좌우하는 에너지 음료 기업.",
    description: "몬스터 베버리지는 Monster 에너지 Drinks, 전략 브랜드, Alcohol 브랜드를 운영합니다. Monster 에너지는 완제품 에너지음료 출하와 케이스 판매가 핵심이고, 전략 브랜드는 원액과 beverage 기본 판매 구조라 매출 인식과 마진이 다르게 움직입니다. Coca-Cola 병입/유통 시스템은 글로벌 확장에 중요한 채널이지만 특정 bottler·유통업체 의존도와 판촉비 부담도 키웁니다. 공시 해석에서는 promotional allowances, slotting 수수료, rebates, 광고 support가 순 판매와 매출총이익률을 얼마나 깎는지, 알루미늄 캔·원재료·운송비가 가격 인상으로 상쇄되는지 봐야 합니다.",
    researchFocus: [
      "Monster 에너지 Drinks의 케이스 판매, 가격정책, flavor·brand 확장 효과",
      "전략 브랜드의 원액, beverage 기본, Coca-Cola 유통망 매출 구조",
      "Alcohol 브랜드의 craft beer, FMB, hard seltzer 수요와 에너지음료 대비 수익성 차이",
      "promotional allowances, rebates, slotting 수수료, 알루미늄 캔·운송비가 매출총이익률에 미치는 영향"
    ],
    riskVariables: [
      "Coca-Cola 병입 시스템과 대형 유통업체 의존도",
      "알루미늄 캔, 원재료, 연료, 해상·육상 운송비 상승",
      "promotional allowances 증가와 판촉 경쟁 심화에 따른 순 판매 압박",
      "caffeine·성분 규제, alcohol 제품 규제, 소비자 취향 변화"
    ],
    suggestedPrompts: [
      "몬스터 베버리지의 Monster 에너지 Drinks와 전략 브랜드가 매출 인식과 마진에서 어떻게 다른지 정리해줘.",
      "Coca-Cola 병입 시스템과 대형 유통업체 의존도가 몬스터의 성장성과 리스크에 어떤 의미를 갖는지 설명해줘.",
      "promotional allowances, 알루미늄 캔 비용, 운송비가 몬스터 베버리지의 매출총이익률에 미치는 영향을 분석해줘.",
    ],
    questionChains: {},
  },
  NOC: {
    ticker: "NOC",
    companyName: "Northrop Grumman Corporation",
    companyNameKo: "노스롭 그라만",
    sectorKo: "항공우주·방산",
    signature: "Aeronautics 시스템, 방산 시스템, Mission 시스템, 우주 시스템에서 B-21, Sentinel, IBCS, SDA, Next-Gen OPIR 같은 장기 방산 프로그램과 고정-가격 계약 리스크를 함께 봐야 하는 방산 기업.",
    description: "노스롭 그라만은 stealth aircraft, missile 방산, C4ISR, radar, cyber, space 시스템s를 미국 정부와 동맹국에 공급합니다. 공시 해석에서는 Aeronautics 시스템의 B-21 Raider와 F-35, 방산 시스템의 Sentinel·IBCS, Mission 시스템의 radar·전자전·C4ISR, 우주 시스템의 SDA·Next-Gen OPIR·GEM 63XL 프로그램을 나눠 봐야 합니다. 수주잔고와 순 awards는 장기 매출 가시성을 보여주지만, 고정-가격 계약와 EAC 조정은 비용 초과가 발생할 때 사업부 마진을 즉시 흔드는 핵심 리스크입니다.",
    researchFocus: [
      "Aeronautics 시스템의 B-21 Raider, F-35, 무인·유인 항공 프로그램",
      "방산 시스템의 Sentinel, IBCS, missile 방산, ammunition 프로그램",
      "Mission 시스템의 radar, sensors, C4ISR, electronic warfare 수요",
      "우주 시스템의 SDA, Next-Gen OPIR, launch vehicle components와 고정-가격 EAC 조정"
    ],
    riskVariables: [
      "B-21과 Sentinel 같은 대형 개발 프로그램의 비용 추정·일정 변경",
      "고정-가격 계약 비용 초과와 unfavorable EAC 조정에 따른 마진 압박",
      "미국 정부 예산, continuing resolution, 조달 일정 지연",
      "classified 프로그램, 공급망, 엔지니어링 인력, 품질 이슈로 인한 현금흐름 변동"
    ],
    suggestedPrompts: [
      "노스롭 그라만의 Aeronautics, 방산, Mission, 우주 시스템를 주요 프로그램과 마진 리스크 기준으로 비교해줘.",
      "B-21 Raider와 Sentinel 프로그램에서 고정-가격 계약과 EAC 조정이 이익에 미치는 영향을 설명해줘.",
      "수주잔고와 순 awards가 노스롭 그라만의 장기 매출 가시성을 보여주는 방식과 한계를 분석해줘.",
    ],
    questionChains: {},
  },
  NSC: {
    ticker: "NSC",
    companyName: "Norfolk Southern Corporation",
    companyNameKo: "노퍽 서던",
    sectorKo: "철도 운송",
    signature: "동부 미국 철도망에서 상품, 복합운송, 석탄 물동량을 운송하며, railway 영업 비율, 열차 speed, 터미널 체류, 연료 할증료가 수익성과 서비스 품질을 보여주는 화물철도 기업.",
    description: "노퍽 서던은 동부 U.S. 네트워크를 통해 산업재, 농산물, 자동차, 화학, 복합운송 컨테이너, 석탄을 운송합니다. 공시 해석에서는 상품, 복합운송, 석탄의 물량과 매출 per 단위을 나눠 보고, 연료 할증료가 연료비 변동을 얼마나 흡수하는지 확인해야 합니다. railway 영업 비율, 열차 speed, 터미널 체류은 비용 통제와 서비스 품질을 동시에 보여주는 핵심 지표입니다. 동부 Ohio Incident 관련 비용·보험 회수, STB 규제, 노무 계약, hazardous materials 사고 리스크는 영업비용과 잉여 현금흐름을 흔드는 변수입니다.",
    researchFocus: [
      "상품, 복합운송, 석탄의 물량, 매출 per 단위, 연료 할증료 기여",
      "railway 영업 비율, 열차 speed, 터미널 체류, 서비스 re책임 변화",
      "동부 U.S. 네트워크의 트래픽 믹스와 트럭·barge 등 다른 운송모드 경쟁",
      "동부 Ohio Incident 비용·보험 회수, STB 규제, 노무 계약이 현금흐름에 미치는 영향"
    ],
    riskVariables: [
      "연료비 상승과 연료 할증료 회수 시차에 따른 영업 비율 압박",
      "동부 Ohio Incident 후속 비용, 보험 회수, litigation 관련 변동성",
      "STB 규제, 노무 계약 재협상, hazardous materials 안전 비용 증가",
      "기상 재해, mainline 사고, 트럭 경쟁으로 인한 열차 speed·체류 악화"
    ],
    suggestedPrompts: [
      "노퍽 서던의 상품, 복합운송, 석탄 물동량과 매출 per 단위이 영업 비율에 어떻게 연결되는지 정리해줘.",
      "연료 할증료와 연료비 변동이 노퍽 서던의 영업이익과 잉여 현금흐름에 미치는 영향을 설명해줘.",
      "동부 Ohio Incident, STB 규제, 열차 speed·터미널 체류 변화가 노퍽 서던의 운영 안정성에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  NXPI: {
    ticker: "NXPI",
    companyName: "NXP Semiconductors N.V.",
    companyNameKo: "엔엑스피",
    sectorKo: "반도체",
    signature: "엔엑스피는 자동차, 산업 & IoT, 모바일, 통신 인프라 & 기타 네 가지 최종시장 축을 중심으로 포트폴리오를 만들고, communication 보안과 연결성(5G, secure edge) 수요가 성장의 핵심이다.",
    description: "NXP는 micro컨트롤러s(S32x, MCX), application processors(i.MX), 통신 프로세서, 연결성 칩셋, 아날로그 및 인터페이스, RF 전력 증폭기, 보안 컨트롤러, 센서를 묶어 차량·산업·모바일·통신 인프라 수요를 동시에 잡는 반도체 기업입니다. 공시에서 자동차, 산업 & IoT, 모바일, 통신 인프라 & 기타로 나눈 매출과 제품군을 함께 보면, 어느 시장에서 어떤 제품이 마진을 견인했는지가 드러납니다. 마진은 공급원가 효율과 제품 믹스 변화로 개선되는 반면, 연구개발과 인력 보상 성격의 비용 증가가 순이익 변동성 요인으로 작동합니다. 제조는 자체 시설, 협력 JV, 제3자 파운드리와 조립 파트너의 다층 조달 구조라 납기·원가·품질 영향도가 분기별로 달라집니다.",
    researchFocus: [
      "최종시장별 성장 동인을 매출 구성(프로세서·혼합신호·RF 등)과 연결해 분해",
      "Secure connected edge identification, 5G radio 전력, 무선 connectivity(NFC/UWB/BLE/5G) 수요와 제품군 매칭",
      "S32x/MCX/i.MX 라인업이 차량·산업·엣지 환경에서 수익성에 미치는 영향",
      "파운드리/JV/assembly 협력망이 제조 원가·납기 유연성·조달 안정성에 미치는 영향",
      "인수 통합(예: TTTech 자동차, Aviva Links, Kinara) 이후 비용구조 변화와 무형자산·연구개발 비용 반영 방식"
    ],
    riskVariables: [
      "반도체 경기 변동: 수요 변동성과 가격 압박이 판매량·마진을 동시에 흔듦",
      "무역 정책과 수출통제: 관세, 규제 강화가 공급망 분절·조달 차질로 전이",
      "제3자 생산망 리스크: 파운드리·조립 협력사 병목, 수율·납기 이슈",
      "인력·통합 리스크: 핵심 엔지니어 확보와 인수조직 통합이 개발 일정·원가에 영향",
      "보안·지재권 리스크: 사이버 보안, IP 분쟁, 고객 인증·규제 이슈"
    ],
    suggestedPrompts: [
      "NXP의 최종시장별 실적을 제품군 관점으로 나눠 보면 어떤 축의 성장이 더 강한지 분석해줘.",
      "공급망(자체·JV·제3자 조달) 구조에서 원가 효율과 납기 지연 리스크의 거래 패턴을 정리해줘.",
      "인수 후 통합 비용과 신규 포트폴리오가 연구개발, 마진, 영업비용 구조에 어떤 방식으로 반영되는지 보여줘."
    ],
    questionChains: {},
  },
  SHW: {
    ticker: "SHW",
    companyName: "The Sherwin-Williams Company",
    companyNameKo: "쉐윈-윌리엄스",
    sectorKo: "도료 및 코팅",
    signature: "Paint Stores Group, 소비자 브랜드 Group, 성과 코팅 Group 3개 축으로 매출이 나뉘며, 각 축의 수요 특성이 가격 인상 전략, 원재료 비용 전가, 산업 수요 회복 속도와 다르게 맞물린다.",
    description: "쉐윈-윌리엄스는 북미를 중심으로 유럽·라틴아메리카·아시아로 뻗은 글로벌 도료·코팅 기업으로, Paint Stores Group, 소비자 브랜드 Group, 성과 코팅 Group 구조를 갖추고 있습니다. 실적 해석은 3개 축의 순 판매와 마진 변화를 함께 봐야 하는데, 상권 기반 매장, 라틴아메리카 가정·전문 채널, 산업용 코팅 축이 서로 다른 동학으로 움직이기 때문입니다. 기본적으로 같은 분기에도 화학 원료 가격, 환율, 채널별 판촉 방식이 마진에 다르게 반영되므로 채널별 세그먼트 분해가 필수입니다. 최근 분기 자료는 Paint Stores의 동일매장매출 개선, 소비자 브랜드의 Suvinil 편입효과, 성과 코팅의 건설·코팅 수요 분화로 가시화되는 흐름을 보여줍니다.",
    researchFocus: [
      "Paint Stores Group, 소비자 브랜드 Group, 성과 코팅 Group의 순 판매·총 이익·IBT를 축별로 비교",
      "Paint Stores의 점포 개점 후 12개월 초과 매장와 동일매장매출이 수익성에 반영되는 경로",
      "소비자 브랜드의 Suvinil 편입 및 라틴아메리카 채널 믹스 변화가 마진에 미치는 영향",
      "성과 코팅 내 자동차 Refinish, 산업, 패키징, coil 수요 분리와 화학원재료·환율 민감도",
      "resins 및 latex, 안료, 용제, 용기 조달 구조가 COGS와 가격 인상 여력에 미치는 영향"
    ],
    riskVariables: [
      "소비 둔화와 자가정비/주거 보수 수요 변동으로 소매 채널 회복이 지연될 가능성",
      "원재료와 에너지 비용 상승, 관세·무역·기상 충격이 COGS에 즉시 반영되는 구조",
      "숙련 인력 부족이 생산성과 납기 안정성을 제약할 수 있는 운영 리스크",
      "원자재 수급 집중 구간과 공급망 불안정이 납기와 가격 경쟁력 동시 악화"
    ],
    suggestedPrompts: [
      "Paint Stores Group의 동일매장매출이 마진과 어떻게 연결되는지 채널별로 설명해줘.",
      "Suvinil 인수 이후 소비자 브랜드의 매출·매출총이익률 개선이 어디에서 발생했는지 공시 근거로 보여줘.",
      "성과 코팅의 자동차·산업·코일 수요 성장에 원재료 조정이 어떻게 반영됐는지 정리해줘."
    ],
    questionChains: {},
  },
  SLB: {
    ticker: "SLB",
    companyName: "Schlumberger Limited",
    companyNameKo: "슐럼버저",
    sectorKo: "석유·가스 서비스",
    signature: "지질해석, 시추, 완료, 생산최적화 기술을 묶어 상업화하고, 고객의 신규 투자 설비투자와 운영 효율 회복 속도에 따라 실적이 크게 반응하는 업스트림 핵심 서비스 기업이다.",
    description: "슐럼버저는 석유·천연가스 E&P 생산성을 높이기 위해 reservoir characterization, 지구물리, 시추·완성 서비스, 압력/재료 관리, 디지털 분석 플랫폼을 결합합니다. 공시 해석에서는 프로젝트 단위로 인식되는 계약 매출, 서비스 매출, 수주잔고, 유정당 단가, 장비 가용성 지표를 같이 봐야 합니다. 단기적으로는 유가 자체보다 상류사 설비투자 집행 속도, 탐사·개발 계획, 장기 계약(EPC/long-term 서비스) 비중이 성장성 핵심입니다. 동시에 대형 프로젝트의 현장 준수 비용, 안전 규제, 환경·인력 이슈가 마진 변동을 결정합니다.",
    researchFocus: [
      "유정별 서비스 포트폴리오(지질해석·시추·완성·생산 솔루션)의 매출 기여와 단가 추적",
      "상류사 설비투자 사이클과 계약 믹스가 서비스 수요와 수주잔고 전개에 미치는 관계",
      "디지털 분석과 자동화 도구가 현장 운영 효율·비용 구조·예측 정확도에 주는 영향",
      "지역별 프로젝트 배분(미국 셰일, 브라질, 중동, 북해 등)과 규제·안전 이슈의 수익성 반영",
      "장비 운용, 수리, 인력 라인업이 서비스 마진과 프로젝트 일정 준수에 미치는 영향"
    ],
    riskVariables: [
      "상류사 설비투자 삭감이나 탐사 지연이 실적을 즉시 둔화시킬 수 있음",
      "안전 규제 강화와 허가 절차 지연이 프로젝트 승인·가동률을 제한할 수 있음",
      "복잡한 지질 조건 및 장비 고장으로 completion/downtime이 늘어날 수 있음",
      "원자재 가격, 환율, 연료비 변동이 프로젝트 원가와 계약 단가에 전달되는 타이밍 리스크"
    ],
    suggestedPrompts: [
      "슐럼버저의 수주잔고와 신계약 수주가 지역별 실적 가시성에 어떤 방식으로 연결되는지 설명해줘.",
      "시추·완성·생산서비스의 매출 믹스가 설비투자 환경 변화에 따라 어떻게 재배치되는지 추적해줘.",
      "디지털/소프트웨어 기반 서비스가 마진 개선에 기여하는 부분과 오히려 비용이 늘어나는 포인트를 구분해줘."
    ],
    questionChains: {},
  },
  AEP: {
    ticker: "AEP",
    companyName: "American Electric Power Company, Inc.",
    companyNameKo: "아메리칸 일렉트릭 파워",
    sectorKo: "전력 유틸리티",
    signature: "Vertically Integrated Utilities, Transmission 및 Distribution Utilities, AEP Transmission Holdco, Generation & 마케팅을 나눠 보며, 요금기반자산 투자와 규제 회수가 현금흐름을 좌우하는 미국 전력 유틸리티.",
    description: "기업 리포트: AEP는 발전·송전·배전을 묶은 Vertically Integrated Utilities, AEP Texas·OPCo 중심 Transmission 및 Distribution Utilities, FERC 규제 송전 자산을 보유한 AEP Transmission Holdco, 경쟁 전력 노출이 있는 Generation & 마케팅을 함께 봐야 합니다. 공시 해석에서는 비율 케이스, 연료 회복, transmission 투자, 화물량 성장, generation 믹스, environmental 준수 비용이 매출과 영업현금흐름을 어떻게 나누는지 확인해야 합니다. 전력망 투자는 장기 성장 기반이지만, 규제 승인 지연과 고금리 환경에서는 잉여 현금흐름과 차입 부담을 동시에 키웁니다.",
    researchFocus: [
      "Vertically Integrated Utilities의 generation 믹스, 연료 회복, 고객 화물량",
      "Transmission 및 Distribution Utilities의 비율 케이스, weather-normalized 수요, grid 투자",
      "AEP Transmission Holdco의 FERC 비율, transmission 프로젝트 지출, allowed return",
      "Generation & 마케팅의 wholesale 전력 가격, counterparty exposure, collateral needs"
    ],
    riskVariables: [
      "요금 인가 지연과 비용 회수 불확실성이 요금기반자산 성장의 현금 전환을 늦출 위험",
      "석탄재, 배출규제, 발전소 폐쇄·개선 비용이 설비투자와 충당부담을 키울 가능성",
      "기상·계절성 수요와 산업용 화물량 변동이 분기별 매출을 흔들 가능성",
      "고금리, 차입 증가, 담보 요구가 배당·투자 여력을 제약할 위험"
    ],
    suggestedPrompts: [
      "AEP의 Vertically Integrated Utilities, T&D Utilities, Transmission Holdco가 요금기반자산와 현금흐름에 어떻게 다르게 기여하는지 정리해줘.",
      "연료 회복, 비율 케이스, transmission 투자가 AEP의 영업이익과 잉여 현금흐름에 연결되는 경로를 설명해줘.",
      "환경규제, 석탄재 비용, 고금리, 담보 요구가 AEP의 배당과 전력망 투자에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  AON: {
    ticker: "AON",
    companyName: "Aon plc",
    companyNameKo: "에이온",
    sectorKo: "보험중개·인적자본 컨설팅",
    signature: "리스크 자본과 Human 자본로 재편된 구조에서 상업용 리스크, Reinsurance, 헬스케어, 자산관리 수수료와 NFP 통합 효과를 함께 봐야 하는 전문 서비스 기업.",
    description: "기업 리포트: Aon은 리스크 자본과 Human 자본을 통해 보험중개, 재보험, 리스크 컨설팅, 헬스·복지, 퇴직연금·투자 컨설팅을 제공합니다. 리스크 자본에서는 상업용 리스크와 Reinsurance의 프리미엄 cycle, 고객 유지율, 시장 생산능력, 자본 시장 솔루션이 수수료 성장을 좌우하고, Human 자본에서는 헬스케어, 자산관리, talent 자문, pension administration 수요가 마진을 움직입니다. NFP 인수 이후에는 중소형 고객 채널, producer compensation, 시스템 통합, 구조조정 비용이 성장률과 영업이익률을 동시에 흔드는 변수입니다.",
    researchFocus: [
      "리스크 자본의 상업용 리스크, Reinsurance, 시장 생산능력, 고객 유지율",
      "Human 자본의 헬스케어, 자산관리, pension administration, talent 자문 수요",
      "NFP 인수 이후 producer 네트워크, cross-sell, integration 비용",
      "compensation 및 급여s, technology 지출, 구조조정 비용이 영업 마진에 미치는 영향"
    ],
    riskVariables: [
      "보험 가격 사이클 둔화와 재보험 생산능력 변화에 따른 brokerage 수수료 둔화",
      "NFP 통합 지연, 시스템 전환, producer 고객 유지율 실패에 따른 비용 초과",
      "개인정보·사이버 사고와 E&O claim이 평판·규제 비용을 키울 위험",
      "인재 확보 경쟁과 보상비 상승이 유기적 마진 확장을 제한할 가능성"
    ],
    suggestedPrompts: [
      "Aon의 리스크 자본과 Human 자본이 매출 성장과 마진에서 어떻게 다르게 작동하는지 정리해줘.",
      "상업용 리스크, Reinsurance, 헬스케어, 자산관리 수요가 보험 사이클과 고용시장 변화에 어떻게 연결되는지 설명해줘.",
      "NFP 통합, compensation, technology 지출가 Aon의 영업이익률과 현금흐름에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  CL: {
    ticker: "CL",
    companyName: "Colgate-Palmolive Company",
    companyNameKo: "콜게이트-팜올리브",
    sectorKo: "생활소비재·펫 뉴트리션",
    signature: "Oral, 개인 및 홈 관리와 Hill's Pet Nutrition을 나눠 보며, 가격·물량·원재료·유통채널 믹스가 마진을 좌우하는 글로벌 필수소비재 기업.",
    description: "기업 리포트: 콜게이트-팜올리브는 Oral 관리, 개인 관리, 홈 관리와 Hill's Pet Nutrition을 통해 글로벌 소비재 매출을 만듭니다. 공시 해석에서는 지역별 유기적 판매를 가격, 물량, 환율로 나누고, Hill's의 prescription diet와 science diet 같은 프리미엄 pet 영양이 회사 전체 매출총이익률을 얼마나 보강하는지 봐야 합니다. resins, oils, pulp, tallow, corn, soybean 같은 원재료와 광고비, 유통 채널 재고 조정, retailer 가격정책 pressure는 가격 전가력과 영업 마진의 핵심 변수입니다.",
    researchFocus: [
      "Oral 관리, 개인 관리, 홈 관리의 가격, 물량, 지역별 유기적 판매",
      "Hill's Pet Nutrition의 prescription diet, science diet, 프리미엄 믹스",
      "Latin 미국, 북미, Europe, 아시아태평양, Africa/Eurasia 매출 민감도",
      "원재료, 광고 지출, retailer 재고, promotion이 매출총이익률에 미치는 영향"
    ],
    riskVariables: [
      "resins, oils, pulp, tallow, corn, soybean 등 원재료 가격 상승",
      "대형 유통채널의 재고 조정과 판촉 요구가 출하와 가격 전가력을 낮출 위험",
      "환율 약세와 신흥국 소비 둔화가 reported 판매와 마진을 압박할 가능성",
      "pet 영양 경쟁 심화와 프리미엄 제품 수요 둔화"
    ],
    suggestedPrompts: [
      "콜게이트의 Oral, 개인 및 홈 관리와 Hill's Pet Nutrition이 성장률과 마진에서 어떻게 다른지 정리해줘.",
      "가격, 물량, FX, 원재료 비용이 Colgate의 유기적 판매와 매출총이익률에 전달되는 경로를 설명해줘.",
      "유통채널 재고 조정, 판촉비, pet 영양 경쟁이 Colgate의 성장 논지에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  CTAS: {
    ticker: "CTAS",
    companyName: "Cintas Corporation",
    companyNameKo: "신타스",
    sectorKo: "유니폼 렌탈·시설 서비스",
    signature: "유니폼 렌탈·시설 서비스와 응급처치·안전 서비스가 노선 밀도, 고객 유지율, 인건비, 재고 상각을 통해 마진을 만드는 현장형 B2B 서비스 기업.",
    description: "기업 리포트: 신타스는 유니폼 렌탈·시설 서비스에서 유니폼, flame resistant clothing, mats, mops, restroom supplies를 route 기반으로 렌탈·판매하고, 응급처치·안전 서비스에서 응급·안전 용품과 training 서비스를 제공합니다. Fire Protection 서비스와 유니폼 Direct 판매는 All 기타 성격으로 보조 수익을 만듭니다. 공시 해석에서는 노선 밀도, 고객 유지율, new business wins, in-서비스 재고 상각, 생산 인건비, 배송 연료, textile 비용이 매출총이익률과 영업 마진에 어떻게 반영되는지 봐야 합니다.",
    researchFocus: [
      "유니폼 렌탈·시설 서비스의 노선 밀도, 고객 유지율, rental 물량",
      "응급처치·안전 서비스의 안전 규제, workplace 수요, 제품 replenishment",
      "Fire Protection 서비스와 유니폼 Direct 판매의 보조 성장·마진 기여",
      "in-서비스 재고, textile 비용, 생산 인건비, 배송 비용이 마진에 미치는 영향"
    ],
    riskVariables: [
      "임금·운송비·섬유 원가 상승이 route profitability를 낮출 위험",
      "employee-partner 확보와 이탈률 악화가 서비스 품질·납기 비용을 키울 가능성",
      "중소기업 고객 경기 둔화와 신규 계약 감소",
      "시스템 장애, 사이버보안, 규제·안전 기준 변화에 따른 운영비 증가"
    ],
    suggestedPrompts: [
      "신타스의 유니폼 렌탈·시설 서비스와 응급처치·안전 서비스가 매출과 마진에서 어떻게 다른지 정리해줘.",
      "노선 밀도, 고객 유지율, in-서비스 재고 상각이 신타스의 영업 레버리지에 어떻게 연결되는지 설명해줘.",
      "노동비, textile 비용, 배송 비용, 고객 경기 둔화가 신타스의 현금흐름에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  DASH: {
    ticker: "DASH",
    companyName: "DoorDash, Inc.",
    companyNameKo: "도어대시",
    sectorKo: "온디맨드 커머스 플랫폼",
    signature: "도어대시 Marketplace, Wolt, Deliveroo, Drive와 광고·멤버십을 묶어 GOV, 전체 Orders, contribution 이익으로 수익성을 봐야 하는 온디맨드 커머스 플랫폼.",
    description: "기업 리포트: 도어대시는 음식배달을 출발점으로 식료품, 리테일, convenience, alcohol 같은 local commerce로 확장하고, Wolt와 Deliveroo를 통해 해외 마켓플레이스도 키웁니다. 공시 해석에서는 GOV, 전체 Orders, Marketplace GOV, 순 매출 Margin, contribution 이익, 소비자 인수, 가맹점 selection, Dasher 공급를 함께 봐야 합니다. Drive와 white-label 주문처리, ads, DashPass·Wolt+·Deliveroo Plus 멤버십은 주문 빈도와 수취율를 보강하지만, 노동자 분류 규제와 지역별 경쟁은 단위 economics를 흔드는 핵심 리스크입니다.",
    researchFocus: [
      "Marketplace GOV, 전체 Orders, 순 매출 Margin, contribution 이익",
      "restaurant, 식료품, 리테일, convenience 카테고리 확장과 가맹점 selection",
      "Wolt, Deliveroo 해외 마켓플레이스와 통합 비용",
      "Drive, ads, DashPass, Wolt+, Deliveroo Plus가 주문 빈도와 수취율에 미치는 영향"
    ],
    riskVariables: [
      "food 배송, 식료품, 리테일 last-mile 경쟁 심화에 따른 promotion·incentive 증가",
      "Dasher 분류 규제, 최저보상 규칙, 보험·안전 비용 상승",
      "Wolt·Deliveroo 통합 지연과 지역별 규제·환율 리스크",
      "가맹점 이탈률, 소비자 고객 유지율 약화, 개인정보·위치정보 보안 사고"
    ],
    suggestedPrompts: [
      "도어대시의 GOV, 전체 Orders, 순 매출 Margin, contribution 이익이 수익성으로 연결되는 구조를 정리해줘.",
      "restaurant, 식료품, 리테일, Drive, ads, 멤버십이 도어대시의 성장 경로에서 각각 어떤 역할을 하는지 설명해줘.",
      "Dasher 규제, 경쟁 프로모션, Wolt·Deliveroo 통합이 도어대시의 단위 economics에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  ECL: {
    ticker: "ECL",
    companyName: "Ecolab Inc.",
    companyNameKo: "이콜랩",
    sectorKo: "물·위생·감염예방 서비스",
    signature: "글로벌 Water, 글로벌 기관 & 전문, 글로벌 생명과학, 글로벌 해충 방제을 통해 물 처리, 식품안전, 위생, 제약공정, 방제 서비스를 묶어 가격·물량·서비스 생산성이 마진을 좌우합니다.",
    description: "기업 리포트: 이콜랩은 글로벌 Water, 글로벌 기관 & 전문, 글로벌 생명과학, 글로벌 해충 방제으로 재편된 구조에서 물 처리, 세정·위생, 식품·음료 공정, 제약·바이오 제조 환경, 상업용 pest elimination 서비스를 제공합니다. 공시 해석에서는 식품 & Beverage, 글로벌 High-Tech, Paper, 기관, 전문, 생명과학, 해충 방제의 유기적 판매와 가치 가격정책이 원자재 비용, field 서비스 인건비, 디지털 솔루션 투자와 어떻게 맞물리는지 봐야 합니다. 고객의 물·에너지 절감, 식품안전, 감염예방, 규제 준수 니즈는 가격 전가력의 근거이지만, 원재료와 서비스 인건비가 마진 확장 속도를 제약할 수 있습니다.",
    researchFocus: [
      "글로벌 Water의 식품 & Beverage, Light & Heavy Water, Paper, 글로벌 High-Tech 수요",
      "글로벌 기관 & 전문의 restaurant, hospitality, lodging, healthcare hygiene 채널",
      "글로벌 생명과학의 제약, biologics, cleaning validation, contamination control",
      "글로벌 해충 방제의 서비스 노선 밀도, 상업용 accounts, 디지털 monitoring"
    ],
    riskVariables: [
      "원자재 비용과 서비스 인건비 inflation이 가치 가격정책 효과를 상쇄할 가능성",
      "restaurant, hospitality, foodservice 트래픽 둔화가 기관 수요를 낮출 위험",
      "생명과학 고객의 바이오테크 자금조달, 제약 설비투자, validation cycle 지연",
      "규제·환경 기준 변화, 제품 품질 이슈, 현장 서비스 인력 부족에 따른 비용 증가"
    ],
    suggestedPrompts: [
      "이콜랩의 글로벌 Water, 기관 & 전문, 생명과학, 해충 방제이 매출과 마진에서 어떻게 다른지 정리해줘.",
      "가치 가격정책, 원자재 비용, field 서비스 인건비가 이콜랩의 영업 마진에 전달되는 경로를 설명해줘.",
      "식품 & Beverage, 글로벌 High-Tech, 생명과학, 해충 방제 수요 변화가 이콜랩의 성장 논지에 주는 의미를 분석해줘."
    ],
    questionChains: {},
  },
  EOG: {
    ticker: "EOG",
    companyName: "EOG Resources, Inc.",
    companyNameKo: "이오지 리소스",
    sectorKo: "에너지·E&P",
    signature: "Delaware Basin, Eagle Ford, Dorado, Rocky Mountain, Trinidad에서 crude oil, 천연가스액, 천연가스를 생산하며 well 생산성와 현금 return framework가 투자 판단의 핵심인 독립 E&P 기업.",
    description: "기업 리포트: 이오지 리소스는 미국 중심의 crude oil, condensate, 천연가스액, 천연가스 탐사·개발·생산 기업입니다. 공시 해석에서는 Delaware Basin의 Wolfcamp·Bone Spring, South Texas Eagle Ford와 Dorado 가스, Rocky Mountain 자산, Trinidad 가스 노출을 나눠 생산량, 실현 가격, 리스 및 well 비용, 집하·처리·운송 비용, finding 및 development 비용를 봐야 합니다. drilling 재고와 well 생산성는 장기 매장량 가치의 핵심이고, 배당·special dividend·share repurchase를 포함한 현금 return framework는 원자재 가격 cycle에서 자본배분 품질을 보여줍니다.",
    researchFocus: [
      "Delaware Basin, Eagle Ford, Dorado, Rocky Mountain, Trinidad 생산량·well 생산성",
      "crude oil, 천연가스액, 천연가스 믹스와 실현 가격",
      "리스 및 well, 집하, 처리, 운송 비용",
      "설비투자 discipline, 준비금 replacement, dividend, special dividend, share repurchase"
    ],
    riskVariables: [
      "원유·천연가스액·천연가스 가격 하락과 basis differential 악화",
      "well 생산성 저하, decline 비율, 준비금 replacement 실패",
      "서비스·장비·인력 비용 상승과 drilling/completion 지연",
      "methane, flaring, water handling, permitting 규제가 비용 구조를 높일 위험"
    ],
    suggestedPrompts: [
      "EOG의 Delaware Basin, Eagle Ford, Dorado, Rocky Mountain, Trinidad 자산이 생산량과 현금흐름에 어떻게 기여하는지 정리해줘.",
      "crude oil, 천연가스액, 천연가스 믹스와 실현 가격가 EOG의 마진과 설비투자 회수에 미치는 영향을 설명해줘.",
      "well 생산성, decline 비율, 서비스 비용, methane 규제가 EOG의 현금 return framework에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  GM: {
    ticker: "GM",
    companyName: "General Motors Company",
    companyNameKo: "제너럴 모터스",
    sectorKo: "자동차",
    signature: "GMNA, GMI, GM 금융을 나눠 보고 Chevrolet, GMC, Cadillac, Buick의 ICE·전기차 믹스와 OnStar·Super Cruise, 보증, 재고가 마진을 좌우하는 완성차 기업.",
    description: "기업 리포트: 제너럴 모터스는 GM 북미, GM 해외, GM 금융을 통해 차량 판매, 부품·서비스, 리스·대출 금융 수익을 만듭니다. 공시 해석에서는 Chevrolet, GMC, Cadillac, Buick의 트럭·SUV 믹스, 전기차 전환 속도, 딜러 재고, 가격정책, 인센티브, 보증 및 리콜 비용, 원재료, 인건비 agreement, GM 금융의 신용 손실와 리스 residual을 함께 봐야 합니다. Cruise 로보택시 전략 축소 이후에는 Super Cruise, OnStar, 소프트웨어-enabled 서비스와 개인 차량 ADAS 투자 효율이 더 중요해졌습니다.",
    researchFocus: [
      "GMNA와 GMI의 트럭, SUV, 전기차, 가격정책, incentive 믹스",
      "GM 금융의 대출, 리스, residual 가치, 신용 손실",
      "OnStar, Super Cruise, 소프트웨어-enabled 서비스와 ADAS 투자",
      "보증, 리콜, 원재료, 인건비 agreement, 딜러 재고"
    ],
    riskVariables: [
      "전기차 수요 둔화와 보조금·배출규제 변화가 설비투자와 재고를 압박할 위험",
      "원자재, 관세, 부품 공급, 물류비 상승에 따른 제조 마진 악화",
      "보증, 리콜, 품질 이슈와 보증충당 추정 변동",
      "GM 금융의 신용손실, 중고차 가격, 리스 residual 악화"
    ],
    suggestedPrompts: [
      "GM의 GMNA, GMI, GM 금융이 매출과 adjusted EBIT에 어떻게 다르게 기여하는지 정리해줘.",
      "Chevrolet, GMC, Cadillac, Buick의 트럭·SUV·전기차 믹스와 OnStar, Super Cruise가 GM의 성장 논지에 주는 의미를 설명해줘.",
      "전기차 수요 둔화, 보증, 원재료, GM 금융 신용 손실이 GM의 현금흐름에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  HLT: {
    ticker: "HLT",
    companyName: "Hilton Worldwide Holdings Inc.",
    companyNameKo: "힐튼",
    sectorKo: "호텔·여행",
    signature: "관리 & 프랜차이즈 수수료 중심의 asset-light 구조에서 RevPAR, 순 단위 성장, Hilton Honors, owner economics가 수수료 기본와 현금흐름을 좌우하는 글로벌 호텔 운영사.",
    description: "기업 리포트: Hilton은 관리 및 프랜차이즈와 Ownership을 나눠 봐야 합니다. 관리 및 프랜차이즈는 프랜차이즈 호텔, 관리형 hotels, 라이선싱, Hilton Honors, 공동브랜드 카드, strategic partnerships에서 수수료 매출을 만들고, Ownership은 보유·임차 호텔의 객실 매출과 운영비가 직접 반영됩니다. 공시 해석에서는 RevPAR, 점유율, ADR, 순 단위 성장, development 파이프라인, conversion, owner 금융 condition, 로열티 프로그램 program economics가 총 수수료 매출과 adjusted EBITDA로 얼마나 전환되는지 확인해야 합니다.",
    researchFocus: [
      "관리 및 프랜차이즈의 기본 수수료, 프랜차이즈 수수료, 라이선싱 수수료, RevPAR 민감도",
      "Ownership 호텔의 점유율, ADR, 인건비, property-level 마진",
      "Hilton Honors, 공동브랜드 카드, direct booking, strategic partnerships",
      "development 파이프라인, conversion, 순 단위 성장, owner 금융"
    ],
    riskVariables: [
      "RevPAR 둔화와 점유율·ADR 약화가 수수료 성장를 낮출 가능성",
      "호텔 오너 자금조달 악화와 개발 지연으로 파이프라인 전환이 늦어질 위험",
      "OTA 수수료, 로열티 프로그램 비용, 사이버보안 사고가 직접 채널 수익성을 해칠 가능성",
      "노동비, 임대료, 재산세, 보험료 상승이 Ownership 마진을 압박할 위험"
    ],
    suggestedPrompts: [
      "힐튼의 관리 & 프랜차이즈와 Ownership이 RevPAR, ADR, 점유율 변화에 어떻게 다르게 반응하는지 정리해줘.",
      "Hilton Honors, 공동브랜드 카드, direct booking이 Hilton의 수수료 business를 어떻게 보강하는지 설명해줘.",
      "개발 파이프라인, 호텔 오너 자금조달, OTA 수수료, 노동비가 Hilton의 성장 논지에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  ITW: {
    ticker: "ITW",
    companyName: "Illinois Tool Works Inc.",
    companyNameKo: "일리노이 툴웍스",
    sectorKo: "산업재·특수 제조",
    signature: "자동차 OEM, 식품 Equipment, Test & Measurement 및 Electronics, Welding, Polymers & Fluids, Construction 제품, 전문 제품의 7개 세그먼트에서 80/20 영업 시스템과 가격·원가·수요 믹스가 마진을 좌우합니다.",
    description: "기업 리포트: 일리노이 툴웍스는 7개 세그먼트를 통해 자동차 부품, 식품 장비, 전자·측정 장비, 용접 장비, 폴리머·윤활·접착 제품, 건설용 fastening, 전문 제품을 공급합니다. 공시 해석에서는 자동차 OEM의 vehicle 생산, 식품 Equipment의 상업용 kitchen 수요, Test & Measurement 및 Electronics의 전자·semiconductor 수요, Welding의 산업 설비투자, Polymers & Fluids와 Construction 제품의 원재료·건설 수요를 분리해 봐야 합니다. ITW 비즈니스 Model과 80/20 공정는 마진 방어의 핵심이지만, 유기적 성장 둔화와 원가·환율 압박은 사업부 영업이익을 흔듭니다.",
    researchFocus: [
      "자동차 OEM, 식품 Equipment, Welding의 end-시장 수요와 마진",
      "Test & Measurement 및 Electronics의 전자, semiconductor, 산업 testing 수요",
      "Polymers & Fluids, Construction 제품, 전문 제품의 원재료·제품 믹스",
      "80/20 공정, 기업 initiatives, 가격-비용, 구조조정"
    ],
    riskVariables: [
      "자동차 생산 둔화와 산업 설비투자 약화에 따른 유기적 매출 둔화",
      "원재료·부품·물류비 상승을 가격으로 상쇄하지 못할 위험",
      "고객별 짧은 주문주기와 유통업체 재고 조정",
      "환율, 무역규제, 제품 품질·IP 분쟁에 따른 비용 증가"
    ],
    suggestedPrompts: [
      "ITW의 7개 세그먼트를 end-시장 수요와 영업 마진 기준으로 비교해줘.",
      "80/20 공정와 기업 initiatives가 ITW의 가격 전가와 비용 효율에 어떻게 연결되는지 설명해줘.",
      "자동차 생산, 산업 설비투자, 원재료 비용, 환율이 ITW의 현금흐름에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  KMI: {
    ticker: "KMI",
    companyName: "Kinder Morgan, Inc.",
    companyNameKo: "킨더 모건",
    sectorKo: "천연가스 인프라·미드스트림",
    signature: "Natural 가스 Pipelines, 제품 Pipelines, Terminals, CO2를 통해 수수료 기반 현금흐름을 만들고, 계약 갱신, 물량, FERC 비율, 프로젝트 수주잔고가 배당 여력을 좌우합니다.",
    description: "기업 리포트: 킨더 모건은 Natural 가스 Pipelines, 제품 Pipelines, Terminals, CO2를 운영하는 북미 미드스트림 기업입니다. Natural 가스 Pipelines는 운송, 스토리지, 집하, 처리 수익과 firm 계약이 핵심이고, 제품 Pipelines는 refined 제품, crude, condensate 운송·터미널 수익을 만듭니다. Terminals는 bulk, liquids, Jones Act tanker, 스토리지 서비스를 제공하고, CO2는 enhanced oil 회복와 원자재 가격 노출이 있습니다. 공시 해석에서는 의무구매, MVC, 계약 갱신, FERC 비율, 확장 수주잔고, 유지보수 설비투자, leverage, dividend coverage를 함께 봐야 합니다.",
    researchFocus: [
      "Natural 가스 Pipelines의 firm transport, 스토리지, 집하, 처리 계약",
      "제품 Pipelines와 Terminals의 refined 제품, crude, liquids, bulk handling",
      "CO2 사업부의 EOR, oil 가격 exposure, decline profile",
      "프로젝트 수주잔고, 유지보수 설비투자, leverage, dividend coverage"
    ],
    riskVariables: [
      "FERC 비율 케이스, 파이프라인 permitting, environmental review 지연",
      "producer drilling activity 둔화와 집하·처리 물량 감소",
      "계약 갱신 시 관세·물량 조건 악화",
      "허리케인, 사이버보안, 파이프라인 integrity, 유지보수 비용 증가"
    ],
    suggestedPrompts: [
      "킨더 모건의 Natural 가스 Pipelines, 제품 Pipelines, Terminals, CO2가 현금흐름 안정성에서 어떻게 다른지 정리해줘.",
      "firm 계약, MVC, FERC 비율, 프로젝트 수주잔고가 KMI의 배당 여력에 연결되는 경로를 설명해줘.",
      "drilling activity 둔화, permitting, 계약 갱신, 파이프라인 integrity가 KMI의 현금흐름에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  MPC: {
    ticker: "MPC",
    companyName: "Marathon Petroleum Corporation",
    companyNameKo: "마라톤 페트롤리엄",
    sectorKo: "정유·미드스트림",
    signature: "정제 & 마케팅, Midstream, 재생에너지 디젤을 나눠 보며, 정제마진 스프레드, 처리량, MPLX 현금흐름, RIN·LCFS·원료 비용이 실적 변동을 좌우하는 다운스트림 에너지 기업.",
    description: "기업 리포트: 마라톤 페트롤리엄은 정제 & 마케팅에서 원유 정제와 도매·소매 제품 판매를 담당하고, Midstream에서는 MPLX를 통해 crude, refined 제품, 천연가스, 천연가스액 운송·저장·처리 수익을 만듭니다. 재생에너지 디젤은 Martinez Renewables와 원료·규제 크레딧 구조를 통해 별도 수익성을 형성합니다. 공시 해석에서는 refinery 처리량, 인력 투입률, 정제마진 스프레드, sour/sweet crude differential, turnaround 비용, RIN 비용, LCFS 신용, MPLX distributions, 운전자본을 함께 봐야 합니다.",
    researchFocus: [
      "정제 & 마케팅의 처리량, 인력 투입률, 정제마진 스프레드, 제품 수율",
      "Midstream과 MPLX의 파이프라인, 터미널, 집하, 처리 현금흐름",
      "재생에너지 디젤의 원료 비용, RIN, LCFS, 인력 투입률",
      "turnaround 비용, 운전자본, shareholder return, 부채 축소"
    ],
    riskVariables: [
      "정제 마진 축소와 원유 differential 악화",
      "turnaround, refinery outage, safety incident에 따른 인력 투입률 저하",
      "RIN, LCFS, 재생에너지 diesel 신용 가격 변동",
      "MPLX 물량, counterparty, 규제, permitting 리스크"
    ],
    suggestedPrompts: [
      "마라톤 페트롤리엄의 정제 & 마케팅, Midstream, 재생에너지 디젤이 실적 변동성에서 어떻게 다른지 정리해줘.",
      "처리량, 정제마진 스프레드, RIN, LCFS, MPLX 유통이 MPC의 현금흐름에 연결되는 경로를 설명해줘.",
      "turnaround, refinery outage, 원료 비용, 규제 크레딧 변동이 MPC의 자본배분에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  ORLY: {
    ticker: "ORLY",
    companyName: "O'Reilly Automotive, Inc.",
    companyNameKo: "오라일리 오토모티브",
    sectorKo: "자동차 애프터마켓 부품 유통",
    signature: "자가정비와 professional 서비스 provider 고객을 동시에 겨냥한 자동차 부품 매장·유통 네트워크에서 비교가능 매장 판매, 재고 availability, 매출총이익률이 핵심인 애프터마켓 소매업체.",
    description: "기업 리포트: 오라일리 오토모티브는 자동차 부품, 공구, 액세서리, 유지보수 제품을 자가정비 고객과 professional 서비스 provider에게 판매합니다. 공시 해석에서는 비교가능 매장 판매를 티켓, 거래, 가격, 믹스로 나누고, 매장 count 확장, 유통 center, 재고 availability, 자체브랜드 믹스, 재고손실, 화물 비용이 매출총이익률과 영업 마진에 어떻게 반영되는지 봐야 합니다. 노후 차량 증가와 주행거리 회복은 수요 기반이지만, 신차 판매, 전기차 보급, 기술 복잡도, 금리와 소비 여력은 장기 수요를 흔드는 변수입니다.",
    researchFocus: [
      "자가정비와 professional 고객 믹스, 비교가능 매장 판매, 티켓·거래",
      "매장 openings, 유통 center, 재고 availability, same-day 주문처리",
      "자체브랜드, 제품 믹스, 가격정책, 재고손실, 화물 비용이 매출총이익률에 미치는 영향",
      "vehicle age, miles driven, repair complexity, 상업용 account 고객 유지율"
    ],
    riskVariables: [
      "주행거리, 차량 연식, 소비 여력 변화에 따른 애프터마켓 수요 둔화",
      "재고 shortage, 공급업체 disruption, 화물 비용, 재고손실 증가",
      "전기차 보급과 차량 기술 변화가 일부 부품 수요를 바꿀 가능성",
      "고금리와 부채비용 상승이 자사주 매입·점포 확장 여력을 제약할 위험"
    ],
    suggestedPrompts: [
      "O'Reilly의 자가정비와 professional 고객 믹스가 비교가능 매장 판매와 매출총이익률에 어떻게 다르게 반영되는지 정리해줘.",
      "매장 openings, 유통 center, 재고 availability가 ORLY의 성장성과 현금흐름에 연결되는 경로를 설명해줘.",
      "vehicle age, miles driven, 전기차 전환, 화물 비용이 ORLY의 장기 수요와 마진에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  PSX: {
    ticker: "PSX",
    companyName: "Phillips 66",
    companyNameKo: "필립스 66",
    sectorKo: "정유·화학·미드스트림",
    signature: "정제, 마케팅 및 Specialties, Midstream, Chemicals, 재생에너지 Fuels를 통해 실현 마진, 천연가스액 처리량, CPChem 지분 성과, 규제 크레딧을 함께 봐야 하는 다운스트림 에너지 기업.",
    description: "기업 리포트: 필립스 66은 정유소, refined 제품 marketing, 기본 oils·lubricants, midstream 파이프라인·천연가스액 자산, Chevron Phillips Chemical 지분, 재생에너지 fuels를 묶어 운영합니다. 공시 해석에서는 refinery 인력 투입률, 실현 마진, turnaround 비용, 마케팅 및 Specialties 마진, Midstream 천연가스액 집하·처리·fractionation·export, CPChem equity 이익, Rodeo 재생에너지 fuels, LCFS·RIN 신용을 나눠 봐야 합니다. 정제 마진과 화학 사이클은 분기 변동성이 크고, 재생에너지 fuels는 정책·원료·가동률에 민감합니다.",
    researchFocus: [
      "정제의 인력 투입률, 실현 마진, turnaround 비용, crude slate",
      "마케팅 및 Specialties의 refined 제품, 기본 oils, lubricants 마진",
      "Midstream의 천연가스액 처리량, 파이프라인, fractionation, export, Y-grade integration",
      "Chemicals CPChem 지분과 재생에너지 Fuels의 원료, LCFS, RIN, Rodeo 가동률"
    ],
    riskVariables: [
      "정제 마진 축소와 crude differential 악화",
      "CPChem의 petrochemical 스프레드와 global plastics 수요 둔화",
      "천연가스액 처리량, 파이프라인 integration, 프로젝트 집행 지연",
      "재생에너지 fuels 신용 가격, 원료 비용, 정책 변화"
    ],
    suggestedPrompts: [
      "필립스 66의 정제, 마케팅 및 Specialties, Midstream, Chemicals, 재생에너지 Fuels 성과를 세그먼트별로 정리해줘.",
      "실현 마진, 천연가스액 처리량, CPChem equity 이익, LCFS·RIN이 PSX의 현금흐름에 연결되는 경로를 설명해줘.",
      "정제 마진, 화학 사이클, 재생에너지 fuels 정책 변화가 PSX의 배당·자사주 여력에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  RCL: {
    ticker: "RCL",
    companyName: "Royal Caribbean Cruises Ltd.",
    companyNameKo: "로열 캐리비안",
    sectorKo: "크루즈·여행",
    signature: "Royal Caribbean 해외, Celebrity Cruises, Silversea에서 passenger 티켓 매출과 onboard 매출을 나눠 보며, 화물량 factor, 순 수율, 연료, newbuild 설비투자가 현금흐름을 좌우하는 크루즈 기업.",
    description: "기업 리포트: Royal Caribbean은 Royal Caribbean 해외, Celebrity Cruises, Silversea 브랜드를 통해 크루즈 여객권과 onboard 및 other 매출을 만듭니다. 공시 해석에서는 passenger 티켓 매출, onboard 지출, 화물량 factor, 생산능력 days, 순 yields, 점유율, 연료 비용, ship 영업 비용, newbuild 배송, drydock schedule, 고객 예금를 함께 봐야 합니다. 수요 회복과 프리미엄화는 수율를 높이지만, 선박 건조 설비투자와 부채, 연료비, 항만·안전 규제는 잉여 현금흐름과 재무 레버리지를 흔듭니다.",
    researchFocus: [
      "passenger 티켓 매출, onboard 및 other 매출, 순 수율",
      "생산능력 days, 점유율, 화물량 factor, itinerary 믹스",
      "newbuild 배송, drydock, ship 영업 expenses, 연료 비용",
      "고객 예금, 부채 maturity, 이자 비용, 잉여 현금흐름"
    ],
    riskVariables: [
      "여행 수요 둔화와 가격 민감도 상승에 따른 순 수율 약화",
      "연료비, 항만비, 선원비, 보험료 상승",
      "신조선 인도 지연, drydock 일정, 안전·환경 규제 비용",
      "고금리와 높은 부채가 설비투자·주주환원 여력을 제약할 위험"
    ],
    suggestedPrompts: [
      "Royal Caribbean의 passenger 티켓 매출과 onboard 매출이 순 수율와 현금흐름에 어떻게 기여하는지 정리해줘.",
      "생산능력 days, 점유율, 화물량 factor, itinerary 믹스가 RCL의 성장성과 마진에 주는 의미를 설명해줘.",
      "연료 비용, newbuild 설비투자, 고객 예금, 부채 maturity가 RCL의 잉여 현금흐름에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  ROST: {
    ticker: "ROST",
    companyName: "Ross Stores, Inc.",
    companyNameKo: "로스 스토어즈",
    sectorKo: "오프프라이스 소매",
    signature: "Ross Dress for Less와 dd's DISCOUNTS에서 마감재고 buying, 비교가능 매장 판매, 상품 마진, 점유율 비용이 수익성을 좌우하는 오프프라이스 소매업체.",
    description: "기업 리포트: 로스 스토어즈는 Ross Dress for Less와 dd's DISCOUNTS를 통해 apparel, 접속ories, footwear, home fashion을 할인 판매합니다. 공시 해석에서는 비교가능 매장 판매, 매장 openings, 평균 티켓, 거래, 상품 마진, buying 및 유통 비용, 점유율 비용, packaway 재고를 함께 봐야 합니다. 오프프라이스 모델은 vendor 마감재고과 opportunistic buying이 강점이지만, 소비자 트래픽 약화, wage·화물·임대료 상승, 재고 markdown은 영업 마진을 빠르게 압박합니다.",
    researchFocus: [
      "Ross Dress for Less와 dd's DISCOUNTS의 비교가능 매장 판매, 티켓, 거래",
      "마감재고 buying, packaway 재고, 상품 마진",
      "매장 openings, 점유율 비용, 유통 비용, 재고손실",
      "apparel, home, footwear 믹스와 저소득·중산층 소비 민감도"
    ],
    riskVariables: [
      "소비 둔화와 트래픽 약화에 따른 비교가능 매장 판매 둔화",
      "markdown, 재고손실, 화물, wage, 점유율 비용 상승",
      "좋은 마감재고 재고 확보 실패와 vendor 공급 불균형",
      "점포 확장 지연, 임대료·건설비 상승, 물류센터 병목"
    ],
    suggestedPrompts: [
      "Ross와 dd's DISCOUNTS의 비교가능 매장 판매를 티켓, 거래, 상품 마진 관점에서 정리해줘.",
      "마감재고 buying, packaway 재고, markdown이 로스 스토어즈의 매출총이익률에 어떻게 작동하는지 설명해줘.",
      "wage, 화물, 점유율 비용, 재고손실이 ROST의 영업 마진에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  VLO: {
    ticker: "VLO",
    companyName: "Valero Energy Corporation",
    companyNameKo: "발레로 에너지",
    sectorKo: "정유·재생연료",
    signature: "정제, 재생에너지 디젤, Ethanol을 나눠 보며, 정제 마진, 처리량, DGD 재생에너지 diesel, ethanol crush 스프레드가 실적을 좌우하는 다운스트림 에너지 기업.",
    description: "기업 리포트: Valero는 정제에서 원유를 가솔린, 디젤, jet 연료, petrochemical 원료으로 전환하고, 재생에너지 디젤에서는 Diamond Green 디젤을 통해 재생에너지 diesel, 재생에너지 naphtha, sustainable aviation 연료을 생산하며, Ethanol에서는 ethanol과 distillers grains를 판매합니다. 공시 해석에서는 refinery 처리량, 인력 투입률, 제품 수율, regional 마진, turnaround 비용, RIN·LCFS·blender 크레딧, 원료 비용, ethanol crush 스프레드를 함께 봐야 합니다. 정유 마진은 원자재 cycle에 민감하고, 재생에너지 diesel은 정책·원료·가동률에 따라 수익성이 크게 달라집니다.",
    researchFocus: [
      "정제의 처리량, 인력 투입률, regional 마진, 제품 수율",
      "Diamond Green 디젤의 재생에너지 diesel, 재생에너지 naphtha, SAF, 원료 비용",
      "Ethanol의 corn 비용, ethanol 가격, distillers grains, crush 스프레드",
      "RIN, LCFS, blender 크레딧, turnaround 비용, 운전자본"
    ],
    riskVariables: [
      "정제 마진 축소와 원유·제품 스프레드 악화",
      "refinery outage, turnaround, 안전·환경 사고에 따른 가동률 하락",
      "재생에너지 diesel 신용, RIN, LCFS 정책 변화",
      "corn, soybean oil, waste 원료 가격 상승과 물류 병목"
    ],
    suggestedPrompts: [
      "Valero의 정제, 재생에너지 디젤, Ethanol 세그먼트를 수익원과 마진 driver 기준으로 정리해줘.",
      "처리량, regional 마진, DGD 재생에너지 diesel, ethanol crush 스프레드가 VLO의 현금흐름에 연결되는 경로를 설명해줘.",
      "RIN, LCFS, 원료 비용, turnaround가 Valero의 잉여 현금흐름과 자본배분에 주는 리스크를 분석해줘."
    ],
    questionChains: {},
  },
  WBD: {
    ticker: "WBD",
    companyName: "Warner Bros. Discovery, Inc.",
    companyNameKo: "워너 브라더스 디스커버리",
    sectorKo: "미디어·스트리밍",
    signature: "Studios, Networks, DTC에서 theatrical, 콘텐츠 라이선싱, 광고, 유통, streaming subscribers를 나눠 보며 부채 축소과 콘텐츠 지출가 핵심인 미디어 기업.",
    description: "기업 리포트: 워너 브라더스 디스커버리는 Studios, Networks, Direct-to-소비자를 통해 영화·TV 제작, DC·Warner Bros. IP, 케이블 networks, 광고, 유통, streaming을 운영합니다. Studios에서는 theatrical releases, 게임, TV 생산, 콘텐츠 라이선싱, home entertainment를 보고, Networks에서는 affiliate 수수료와 광고이 핵심입니다. DTC에서는 Max와 Discovery+ 기반 subscribers, ARPU, 이탈률, 콘텐츠 지출, marketing 비용이 수익성 전환을 좌우합니다. 공시 해석에서는 linear TV decline, ad 시장, sports rights, 콘텐츠 impairment, 구조조정, 부채 repayment를 함께 봐야 합니다.",
    researchFocus: [
      "Studios의 theatrical slate, DC IP, TV 생산, 게임, 콘텐츠 라이선싱",
      "Networks의 affiliate 매출, 광고, 유통 갱신, linear decline",
      "DTC의 Max subscribers, ARPU, 이탈률, 콘텐츠 지출, marketing efficiency",
      "잉여 현금흐름, 부채 축소, 구조조정, 콘텐츠 impairment"
    ],
    riskVariables: [
      "linear TV cord-cutting과 광고시장 둔화",
      "DTC 이탈률, 가격 인상 저항, 콘텐츠 지출 증가",
      "영화 slate 부진, 게임 실패, IP 가치 손상",
      "높은 부채, 구조조정 비용, sports rights·유통 협상 리스크"
    ],
    suggestedPrompts: [
      "WBD의 Studios, Networks, DTC가 매출원과 현금흐름에서 어떻게 다른지 정리해줘.",
      "Max subscribers, ARPU, 이탈률, 콘텐츠 지출가 WBD의 DTC 수익성에 연결되는 경로를 설명해줘.",
      "linear TV decline, 광고시장, 콘텐츠 impairment, 부채 축소가 WBD의 투자 논지에 주는 리스크를 분석해줘."
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
