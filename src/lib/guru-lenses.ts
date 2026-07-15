import { DEFAULT_LOCALE } from "@/i18n/config";

export type GuruLensKey =
  | "auto"
  | "buffett"
  | "marks"
  | "ackman"
  | "flatt"
  | "terry_smith";

export type GuruLensOption = {
  key: GuruLensKey;
  label: string;
  labelKo: string;
  labelEn: string;
  shortLabel: string;
  affiliationKo: string;
  affiliationEn: string;
  introKo: string;
  introEn: string;
  perspectiveKo: string;
  perspectiveEn: string;
  descriptionKo: string;
  descriptionEn: string;
  detailKo: string;
  detailEn: string;
};

export const GURU_LENSES: readonly GuruLensOption[] = [
  {
    key: "auto",
    label: "Auto",
    labelKo: "자동 선택",
    labelEn: "Auto",
    shortLabel: "전체",
    affiliationKo: "KRW Ontology",
    affiliationEn: "KRW Ontology",
    introKo: "질문에 맞는 구루 렌즈를 자동으로 고릅니다.",
    introEn: "Automatically selects the relevant guru lens for the question.",
    perspectiveKo: "특정 인물 하나로 좁히기 전, 여러 투자 원칙을 함께 훑습니다.",
    perspectiveEn:
      "Scans multiple investing principles before narrowing to one investor.",
    descriptionKo: "질문에 맞는 구루 렌즈를 자동으로 고릅니다.",
    descriptionEn: "Select the relevant guru lenses for the question.",
    detailKo: "특정 구루를 고르기 전 넓게 원칙과 질문 프레임을 찾습니다.",
    detailEn: "Use a broad lens before selecting a specific investor.",
  },
  {
    key: "buffett",
    label: "Warren Buffett",
    labelKo: "워런 버핏",
    labelEn: "Warren Buffett",
    shortLabel: "Buffett",
    affiliationKo: "Berkshire Hathaway",
    affiliationEn: "Berkshire Hathaway",
    introKo: "장기 가치투자와 자본 배분을 대표하는 투자자입니다.",
    introEn:
      "An investor associated with long-term value investing and capital allocation.",
    perspectiveKo:
      "이해 가능한 사업인지, 해자가 지속되는지, 현금창출력이 오래 갈지를 먼저 봅니다.",
    perspectiveEn:
      "Starts with understandable businesses, durable moats, and long-lived cash generation.",
    descriptionKo: "사업 품질, 해자, 장기 현금창출력을 봅니다.",
    descriptionEn: "Business quality, moat, and long-term cash generation.",
    detailKo:
      "이해 가능한 사업, 지속 가능한 경쟁우위, 장기 현금창출력을 먼저 묻는 렌즈입니다.",
    detailEn:
      "Start with understandable businesses, durable advantage, and long-term cash generation.",
  },
  {
    key: "marks",
    label: "Howard Marks",
    labelKo: "하워드 막스",
    labelEn: "Howard Marks",
    shortLabel: "Marks",
    affiliationKo: "Oaktree Capital Management",
    affiliationEn: "Oaktree Capital Management",
    introKo: "시장 사이클, 리스크, 2차적 사고를 강조하는 투자자입니다.",
    introEn:
      "An investor known for market cycles, risk control, and second-level thinking.",
    perspectiveKo:
      "좋은 스토리보다 손실 가능성, 사이클 위치, 군중심리의 과열을 먼저 의심합니다.",
    perspectiveEn:
      "Questions downside risk, cycle position, and crowd excess before accepting the story.",
    descriptionKo: "사이클, 손실 가능성, 과열 리스크를 봅니다.",
    descriptionEn: "Cycles, downside risk, and market excess.",
    detailKo:
      "좋은 이야기보다 손실 가능성, 사이클 위치, 군중심리를 먼저 의심하는 렌즈입니다.",
    detailEn:
      "Probe downside, cycle position, and crowd behavior before accepting a good story.",
  },
  {
    key: "ackman",
    label: "Bill Ackman",
    labelKo: "빌 애크먼",
    labelEn: "Bill Ackman",
    shortLabel: "Ackman",
    affiliationKo: "Pershing Square",
    affiliationEn: "Pershing Square",
    introKo: "소수의 단순하고 예측 가능한 기업에 집중하는 액티브 투자자입니다.",
    introEn:
      "An active investor focused on a concentrated set of simple, predictable businesses.",
    perspectiveKo:
      "큰 포지션을 견딜 만큼 사업이 단순한지, 가정이 검증 가능한지 확인합니다.",
    perspectiveEn:
      "Tests whether the business is simple enough and assumptions are strong enough for concentration.",
    descriptionKo: "집중 투자 전 필요한 조건과 가정을 봅니다.",
    descriptionEn: "Concentrated-investment conditions and assumptions.",
    detailKo:
      "단순하고 예측 가능한 사업인지, 큰 포지션을 견딜 만큼 가정이 강한지 점검합니다.",
    detailEn:
      "Test simplicity, predictability, and whether assumptions can support concentration.",
  },
  {
    key: "flatt",
    label: "Bruce Flatt",
    labelKo: "브루스 플랫",
    labelEn: "Bruce Flatt",
    shortLabel: "Flatt",
    affiliationKo: "Brookfield",
    affiliationEn: "Brookfield",
    introKo: "실물자산과 운영 역량을 기반으로 장기 복리를 추구하는 투자자입니다.",
    introEn:
      "An investor associated with long-duration real assets and operating compounding.",
    perspectiveKo:
      "자산의 질, 운영자의 실행력, 재투자 기회와 자본 배분의 지속성을 봅니다.",
    perspectiveEn:
      "Looks at asset quality, operator execution, reinvestment runway, and capital allocation.",
    descriptionKo: "장기 자산, 운영 품질, 자본 배분을 봅니다.",
    descriptionEn: "Long-duration assets, operations, and capital allocation.",
    detailKo:
      "장기 자산의 질, 운영자 역량, 재투자와 자본 배분의 지속성을 봅니다.",
    detailEn:
      "Focus on long-duration assets, operator quality, reinvestment, and capital allocation.",
  },
  {
    key: "terry_smith",
    label: "Terry Smith",
    labelKo: "테리 스미스",
    labelEn: "Terry Smith",
    shortLabel: "Terry Smith",
    affiliationKo: "Fundsmith",
    affiliationEn: "Fundsmith",
    introKo: "좋은 기업을 비싸지 않게 사고 오래 보유하는 품질 투자자입니다.",
    introEn:
      "A quality investor focused on buying good companies, avoiding overpayment, and holding.",
    perspectiveKo:
      "먼저 나쁜 기업을 걸러내고, 가격 discipline과 장기 보유 가능성을 확인합니다.",
    perspectiveEn:
      "Filters out weak businesses first, then tests price discipline and long holding quality.",
    descriptionKo: "좋은 기업을 비싸지 않게 오래 보유할 수 있는지 봅니다.",
    descriptionEn: "Quality, price discipline, and long holding periods.",
    detailKo:
      "좋은 기업을 골라 과도한 가격을 피하고 오래 보유할 수 있는지부터 거릅니다.",
    detailEn:
      "Filter for quality, price discipline, and whether the business can be held for years.",
  },
];

export const GURU_DIRECTORY_LENSES = GURU_LENSES.filter(
  (lens) => lens.key !== "auto",
);

export function normalizeGuruLensKey(value: unknown): GuruLensKey | null {
  return GURU_LENSES.some((lens) => lens.key === value)
    ? (value as GuruLensKey)
    : null;
}

export function getGuruLens(key: GuruLensKey): GuruLensOption {
  return GURU_LENSES.find((lens) => lens.key === key) ?? GURU_LENSES[0];
}

export function getGuruLensDisplayName(
  lens: GuruLensOption,
  locale: string,
): string {
  return locale === "ko" ? lens.labelKo : lens.labelEn;
}

export function getGuruSuggestedPrompts(
  lens: GuruLensOption,
  locale: string,
  options: { hasCompanyContext?: boolean } = {},
): string[] {
  const isKo = locale === "ko";
  const philosophyByLens: Record<GuruLensKey, { ko: string[]; en: string[] }> = {
    auto: {
      ko: [
        "이 투자 아이디어에서 가장 먼저 의심해야 할 가정은 무엇인가요?",
        "리스크를 관리하려면 어떤 질문부터 해야 할까요?",
        "집중 투자와 분산 투자 중 어떤 관점으로 봐야 할까요?",
      ],
      en: [
        "What assumption should I question first in this investment idea?",
        "Which questions should I ask first to manage the risk?",
        "Should I think about this through concentration or diversification?",
      ],
    },
    buffett: {
      ko: [
        "좋은 기업을 고를 때 무엇을 가장 먼저 봐야 하나요?",
        "오래 보유할 수 있는 사업은 어떻게 구분하나요?",
        "해자와 현금창출력을 볼 때 초보자가 놓치기 쉬운 점은 무엇인가요?",
      ],
      en: [
        "What should I look at first when judging a good business?",
        "How do I tell whether a business can be held for years?",
        "What do beginners often miss about moats and cash generation?",
      ],
    },
    marks: {
      ko: [
        "리스크를 관리하려면 어떤 질문부터 해야 하나요?",
        "좋은 이야기처럼 보여도 손실로 이어지는 경우는 언제인가요?",
        "사이클과 군중심리를 볼 때 공격과 방어를 어떻게 나누나요?",
      ],
      en: [
        "Which questions should I ask first to manage risk?",
        "When can a good-looking story still lead to loss?",
        "How should I separate offense and defense through cycles and crowd psychology?",
      ],
    },
    ackman: {
      ko: [
        "집중 투자와 분산 투자는 어떤 기준으로 나눠야 하나요?",
        "큰 비중을 싣기 전에 반드시 깨봐야 할 가정은 무엇인가요?",
        "단순하고 강한 투자 아이디어는 어떻게 구분하나요?",
      ],
      en: [
        "How should I decide between concentration and diversification?",
        "What assumptions must I break before taking a large position?",
        "How do I identify a simple and strong investment idea?",
      ],
    },
    flatt: {
      ko: [
        "장기 자산 가치를 볼 때 무엇을 먼저 확인해야 하나요?",
        "좋은 운영자가 가치를 키우고 있는지는 어떻게 판단하나요?",
        "재투자와 자본 배분에서 가장 먼저 의심할 점은 무엇인가요?",
      ],
      en: [
        "What should I check first when judging long-term asset value?",
        "How can I tell whether a good operator is compounding value?",
        "What should I question first in reinvestment and capital allocation?",
      ],
    },
    terry_smith: {
      ko: [
        "오래 보유할 좋은 기업은 어떤 순서로 판단하나요?",
        "좋은 기업처럼 보여도 거절해야 하는 경우는 언제인가요?",
        "가격을 너무 낙관적으로 보는 위험은 어떻게 피하나요?",
      ],
      en: [
        "In what order should I judge a quality company for long-term holding?",
        "When should I reject a company even if it looks good?",
        "How do I avoid becoming too optimistic on price?",
      ],
    },
  };
  const companyByLens: Record<GuruLensKey, { ko: string[]; en: string[] }> = {
    auto: {
      ko: [
        "이 투자 아이디어에서 가장 먼저 의심해야 할 가정은 무엇인가요?",
        "리스크를 관리하려면 어떤 질문부터 해야 할까요?",
        "집중 투자와 분산 투자 중 어떤 관점으로 봐야 할까요?",
      ],
      en: [
        "What assumption should I question first in this investment idea?",
        "Which questions should I ask first to manage the risk?",
        "Should I think about this through concentration or diversification?",
      ],
    },
    buffett: {
      ko: [
        "버핏 관점에서 이 기업을 볼 때 무엇을 가장 먼저 봐야 할까요?",
        "이 사업을 오래 보유해도 되는지 어떻게 판단하면 좋을까요?",
        "해자와 현금창출력에서 제가 놓치기 쉬운 리스크는 무엇인가요?",
      ],
      en: [
        "From a Buffett lens, what should I look at first in this company?",
        "How should I judge whether this business can be held for years?",
        "What risk might I miss in its moat and cash generation?",
      ],
    },
    marks: {
      ko: [
        "하워드 막스 관점에서 지금 가장 조심해야 할 리스크는 무엇인가요?",
        "좋은 이야기처럼 보이지만 손실로 이어질 수 있는 부분은 어디인가요?",
        "사이클과 군중심리 기준으로 지금은 공격할 때인가요, 방어할 때인가요?",
      ],
      en: [
        "From a Howard Marks lens, what risk should I be most careful about now?",
        "What part of this attractive story could still lead to loss?",
        "From cycles and crowd psychology, is this a time to be aggressive or defensive?",
      ],
    },
    ackman: {
      ko: [
        "애크먼 관점에서 이 아이디어는 큰 비중을 실어도 될 만큼 단순한가요?",
        "집중 투자와 분산 투자 중 이 기업은 어느 쪽에 더 가까운가요?",
        "큰 포지션을 잡기 전에 반드시 깨봐야 할 가정은 무엇인가요?",
      ],
      en: [
        "From an Ackman lens, is this idea simple enough for a large position?",
        "Is this company closer to a concentration case or a diversification case?",
        "What assumptions must I break before taking a large position?",
      ],
    },
    flatt: {
      ko: [
        "브루스 플랫 관점에서 이 기업의 장기 자산 가치는 어떻게 봐야 할까요?",
        "운영자가 장기 가치를 키우고 있는지 무엇으로 판단하면 좋을까요?",
        "재투자 기회와 자본 배분에서 가장 먼저 확인할 리스크는 무엇인가요?",
      ],
      en: [
        "From a Bruce Flatt lens, how should I think about this company's long-term asset value?",
        "How can I judge whether the operator is compounding long-term value?",
        "What risk should I check first in reinvestment and capital allocation?",
      ],
    },
    terry_smith: {
      ko: [
        "테리 스미스 관점에서 이 기업은 오래 보유할 만큼 좋은 기업인가요?",
        "좋은 기업처럼 보여도 제가 거절해야 할 이유는 무엇인가요?",
        "가격을 너무 낙관적으로 보는 위험은 어디에서 생길까요?",
      ],
      en: [
        "From a Terry Smith lens, is this good enough to hold for years?",
        "Even if it looks like a good company, why might I still reject it?",
        "Where could I become too optimistic on price?",
      ],
    },
  };

  const prompts = options.hasCompanyContext
    ? companyByLens[lens.key]
    : philosophyByLens[lens.key];
  return isKo ? prompts.ko : prompts.en;
}

export function buildGuruSessionHref(
  sessionId: string,
  locale: string,
  lensKey: GuruLensKey = "auto",
  ticker?: string | null,
): string {
  const params = new URLSearchParams({ sessionId });
  if (lensKey !== "auto") {
    params.set("guru", lensKey);
  }
  const normalizedTicker = ticker?.trim().toUpperCase();
  if (normalizedTicker) {
    params.set("ticker", normalizedTicker);
  }
  if (locale !== DEFAULT_LOCALE) {
    params.set("locale", locale);
  }
  return `/guru?${params.toString()}`;
}

export function buildGuruLensHref(
  lensKey: GuruLensKey,
  locale: string,
  ticker?: string | null,
): string {
  const params = new URLSearchParams({ guru: lensKey });
  const normalizedTicker = ticker?.trim().toUpperCase();
  if (normalizedTicker) {
    params.set("ticker", normalizedTicker);
  }
  if (locale !== DEFAULT_LOCALE) {
    params.set("locale", locale);
  }
  return `/guru?${params.toString()}`;
}
