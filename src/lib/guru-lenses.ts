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
  icon: string;
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
    icon: "auto_awesome",
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
    icon: "verified",
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
    icon: "warning",
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
    icon: "center_focus_strong",
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
    icon: "domain",
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
    icon: "filter_alt",
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

export function getGuruLensPromptPrefix(
  lens: GuruLensOption,
  locale: string = DEFAULT_LOCALE,
): string {
  return lens.key === "auto"
    ? "[구루 렌즈: 전체]"
    : `[구루 렌즈: ${getGuruLensDisplayName(lens, locale)}]`;
}

export function getGuruSuggestedPrompts(
  lens: GuruLensOption,
  locale: string,
): string[] {
  const isKo = locale === "ko";
  const byLens: Record<GuruLensKey, { ko: string[]; en: string[] }> = {
    auto: {
      ko: [
        "좋은 기업을 판단할 때 먼저 던질 질문을 정리해줘.",
        "리스크를 볼 때 어떤 함정을 피해야 해?",
        "밸류에이션을 보기 전에 확인할 원칙을 알려줘.",
      ],
      en: [
        "What questions should come first when judging a good company?",
        "What traps should I avoid when thinking about risk?",
        "What principles should I check before valuation?",
      ],
    },
    buffett: {
      ko: [
        "워런 버핏 렌즈로 좋은 기업인지 판단할 체크리스트를 만들어줘.",
        "해자와 장기 현금창출력을 볼 때 어떤 질문을 해야 해?",
        "잘 아는 사업인지 판단하는 기준을 정리해줘.",
      ],
      en: [
        "Build a Buffett-lens checklist for judging whether a business is high quality.",
        "What should I ask about moat and long-term cash generation?",
        "How do I test whether a business is understandable enough?",
      ],
    },
    marks: {
      ko: [
        "하워드 막스 렌즈로 손실 가능성과 사이클 리스크를 점검해줘.",
        "좋은 스토리처럼 보이지만 위험한 상황을 구분해줘.",
        "지금 질문에서 2차적 사고로 봐야 할 지점을 정리해줘.",
      ],
      en: [
        "Use a Marks lens to check downside and cycle risk.",
        "Separate attractive stories from dangerous situations.",
        "What second-level thinking should I apply to this question?",
      ],
    },
    ackman: {
      ko: [
        "빌 애크먼 렌즈로 집중 투자 전에 확인할 조건을 정리해줘.",
        "단순하고 예측 가능한 사업인지 확인할 질문을 만들어줘.",
        "큰 포지션을 잡기 전에 깨져야 할 가정을 정리해줘.",
      ],
      en: [
        "Use an Ackman lens to list conditions before a concentrated investment.",
        "What questions test whether a business is simple and predictable?",
        "What assumptions must be breakable before sizing a large position?",
      ],
    },
    flatt: {
      ko: [
        "브루스 플랫 렌즈로 장기 자산과 운영 품질을 볼 때 무엇을 확인해야 해?",
        "자본 배분과 재투자 기회를 점검할 질문을 정리해줘.",
        "운영자가 장기 가치를 키우는지 보는 기준을 알려줘.",
      ],
      en: [
        "Use a Flatt lens to check long-duration assets and operating quality.",
        "What questions test capital allocation and reinvestment opportunity?",
        "How do I judge whether operators compound long-term value?",
      ],
    },
    terry_smith: {
      ko: [
        "Terry Smith 렌즈로 왜 거절할지부터 점검해줘.",
        "좋은 기업을 비싸게 사는 실수를 피하려면 무엇을 봐야 해?",
        "오래 보유할 수 없는 기업을 걸러내는 질문을 정리해줘.",
      ],
      en: [
        "Use a Terry Smith lens to start with reasons to reject.",
        "What should I check to avoid overpaying for a quality business?",
        "What questions filter out companies I cannot hold for a long time?",
      ],
    },
  };

  return isKo ? byLens[lens.key].ko : byLens[lens.key].en;
}

export function buildGuruSessionHref(
  sessionId: string,
  locale: string,
  lensKey: GuruLensKey = "auto",
): string {
  const params = new URLSearchParams({ sessionId });
  if (lensKey !== "auto") {
    params.set("guru", lensKey);
  }
  if (locale !== DEFAULT_LOCALE) {
    params.set("locale", locale);
  }
  return `/guru?${params.toString()}`;
}

export function buildGuruLensHref(lensKey: GuruLensKey, locale: string): string {
  const params = new URLSearchParams({ guru: lensKey });
  if (locale !== DEFAULT_LOCALE) {
    params.set("locale", locale);
  }
  return `/guru?${params.toString()}`;
}
