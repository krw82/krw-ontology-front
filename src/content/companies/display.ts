import type { Locale } from "@/i18n/config";
import {
  getCompanyLandingCopyForTicker,
  listCompanyLandingCopyTickers,
  getSuggestedPromptsForTickers,
} from "@/lib/companies/landing-copy";

interface CompanyDisplayCopy {
  name?: string;
  companyNameKo?: string;
  sector?: string | null;
  description?: string;
  core_strength?: string;
  critical_risk?: string;
}

type CanonicalLandingCopy = CompanyDisplayCopy & {
  name?: string;
};

const EN_FALLBACK_SECTOR_MAP: Record<string, string> = {
  기술: "Technology",
  반도체: "Semiconductors",
  "반도체·데이터센터": "Semiconductors and data centers",
  "반도체·AI 인프라": "Semiconductors and AI infrastructure",
  "반도체 장비": "Semiconductor equipment",
  "클라우드 네트워킹": "Cloud networking",
  "바이오의약품": "Biopharma",
  바이오: "Biotechnology",
  제약: "Pharmaceuticals",
  "반도체·인프라 소프트웨어": "Semiconductors and infrastructure software",
  "소프트웨어·디지털 미디어": "Software and digital media",
  "소프트웨어·클라우드": "Software and cloud",
  "클라우드 기반 소프트웨어": "Cloud software",
  금융: "Financials",
  "투자은행 및 자산관리": "Investment banking and asset management",
  은행: "Banking",
  보험: "Insurance",
  결제: "Payment services",
  "결제·카드 네트워크": "Payment and card networks",
  헬스케어: "Healthcare",
  소매: "Retail",
  유통: "Retail",
  "창고형 리테일": "Retail and warehouse clubs",
  "온라인 여행": "Online travel",
  자동차: "Automotive",
  인프라: "Infrastructure",
  에너지: "Energy",
  산업재: "Industrials",
  항공우주: "Aerospace and defense",
  통신: "Telecommunications",
  소프트웨어: "Software",
  미디어: "Media",
  건설: "Construction and industrial machinery",
  스트리밍: "Streaming media",
  건물: "Building solutions",
  농업: "Agricultural and construction machinery",
  소재: "Materials",
  유틸리티: "Utilities",
  에너지전환: "Energy transition",
  "소프트웨어·AI": "Software and AI",
  "대체자산 운용": "Alternative asset management",
  의료기기: "Medical devices",
  식품: "Food and beverage",
  음료: "Beverages",
  엔터테인먼트: "Entertainment",
  방산: "Aerospace and defense",
  교육: "Education",
  화학: "Chemicals",
  유통망: "Logistics",
  금융서비스: "Financial services",
  부동산: "Real estate",
  "산업 자동화": "Industrial automation",
  IT: "Information technology",
  "커넥터·케이블·센서": "Connectors, cables, and sensors",
  자산운용: "Asset management",
  "대체 자산운용": "Alternative asset management",
  "산업기계": "Industrial machinery",
  "원자력·전력": "Nuclear and power",
  "파생상품 거래소": "Derivative exchange",
  "상용차 엔진·전력 솔루션": "Commercial vehicle engines and power solutions",
  사이버보안: "Cybersecurity",
  "네트워킹 장비": "Networking equipment",
  "철도 운송": "Rail transport",
  "서버, PC, 스토리지": "Servers, PC, and storage",
  "HDD, 데이터 스토리지": "HDD and data storage",
  "HDD·데이터 스토리지": "HDD and data storage",
  "생명과학·진단": "Life sciences and diagnostics",
  "전력관리·산업장비": "Power management and industrial equipment",
  "구리·비철금속 채굴": "Copper and base metals mining",
  "물류·운송": "Logistics and transportation",
  "전력, 그리드 장비": "Power and grid equipment",
  "검색, 광고, 클라우드": "Search, advertising, and cloud",
  "하이브리드 클라우드·AI": "Hybrid cloud and AI",
  "로봇 수술 플랫폼": "Robotic surgery platform",
  "빌딩 솔루션": "Building solutions",
  산업가스: "Industrial gases",
  "글로벌 외식 프랜차이즈": "Global restaurant franchises",
  담배: "Tobacco",
  "담배·Smoke-Free 소비재": "Tobacco and smoke-free products",
  "금속·채굴": "Metals and mining",
  "기업용 워크플로 SaaS": "Enterprise workflow SaaS",
  "담배, Smoke-Free 소비재": "Tobacco and smoke-free products",
  "커피, 외식": "Coffee and restaurants",
  "브로커리지·자산관리": "Brokerage and asset management",
  "도료 및 코팅": "Coatings and painting",
  "석유·가스 서비스": "Oil and gas services",
  "생명과학 장비·진단": "Life sciences equipment and diagnostics",
  "HVAC·운송 냉동": "HVAC and transport refrigeration",
  "모빌리티·딜리버리 플랫폼": "Mobility and delivery platform",
  "폐기물·환경 서비스": "Waste and environmental services",
  "AI·데이터 소프트웨어 플랫폼": "AI and data software platform",
  "EDA·반도체 설계 소프트웨어": "EDA and semiconductor design software",
  "IT 컨설팅·Managed Services": "IT consulting and managed services",
  "검색·광고·클라우드": "Search, advertising, and cloud",
  "관리의료·헬스케어 서비스": "Managed care and healthcare services",
  "규제형 전력·가스 유틸리티": "Regulated power and gas utility",
  "글로벌 결제 네트워크": "Global payment network",
  "금융시장 인프라": "Financial markets infrastructure",
  "금융정보·지수·벤치마크": "Financial information, index, and benchmark",
  "기업용 소프트웨어·클라우드": "Enterprise software and cloud",
  "농업·건설 장비": "Agricultural and construction equipment",
  "데이터 저장장치": "Data storage",
  "데이터센터·클라우드 인프라": "Data center and cloud infrastructure",
  "메모리 반도체·스토리지": "Memory semiconductors and storage",
  "모바일 반도체·라이선싱": "Mobile semiconductors and licensing",
  무선통신: "Wireless communication",
  "미디어·통신": "Media and communication",
  바이오테크: "Biotechnology",
  "반도체 공정 제어·검사 장비": "Semiconductor process control and test equipment",
  "반도체 설계 자동화·EDA": "Semiconductor design automation and EDA",
  "반도체·파운드리": "Semiconductors and foundry",
  "병원 운영·헬스케어 서비스": "Hospital operations and healthcare services",
  산업설비: "Industrial equipment",
  "산업·소비재 제조": "Industrial and consumer goods manufacturing",
  "산업 설비": "Industrial equipment",
  생활소비재: "Consumer staples",
  "세무·회계·개인금융 소프트웨어": "Tax, accounting, and personal finance software",
  "소매·주거개선": "Retail and home improvement",
  "소셜 광고·AI": "Social advertising and AI",
  손해보험: "Property and casualty insurance",
  "수탁은행·자산관리": "Custody bank and asset management",
  "식품·음료": "Food and beverage",
  "신용평가·금융 데이터": "Credit rating and financial data",
  "아날로그·임베디드 반도체": "Analog and embedded semiconductors",
  "에너지 음료": "Energy drinks",
  "에너지·E&P": "Energy E&P",
  "에너지·석유·가스": "Oil and gas energy",
  "오프프라이스 소매": "Off-price retail",
  "은행·결제": "Banking and payments",
  "은행·자본시장": "Banking and capital markets",
  "은행·자산운용": "Banking and asset management",
  "의료 유통·헬스케어 솔루션": "Healthcare distribution and solutions",
  "이커머스·클라우드": "E-commerce and cloud",
  "인적자본 관리": "Human capital management",
  "전기차·에너지": "Electric vehicles and energy",
  "전력·유틸리티 인프라": "Power and utility infrastructure",
  "전력·천연가스 유틸리티": "Power and natural gas utility",
  "전력·그리드 장비": "Power and grid equipment",
  "전력관리 반도체": "Power management semiconductors",
  "제약·백신·동물건강": "Pharmaceuticals, vaccines, and animal health",
  "제약·의료기기": "Pharmaceuticals and medical devices",
  "천연가스 인프라·미드스트림": "Natural gas infrastructure and midstream",
  "카드·소비자금융": "Cards and consumer finance",
  "커피·외식": "Coffee and restaurants",
  "콘텐츠·체험형 엔터테인먼트": "Content and experiential entertainment",
  "통신 인프라 REIT": "Communication infrastructure REIT",
  "특수소재·광통신": "Specialty materials and optical communication",
  "투자은행·자산관리": "Investment banking and asset management",
  "항공우주·국방": "Aerospace and defense",
  "항공우주·방산": "Aerospace and defense",
  "항공우주·산업 자동화·에너지 전환 솔루션": "Aerospace, industrial automation, and energy transition solutions",
  "항공우주·엔진": "Aerospace engines",
  "항공우주 부품": "Aerospace parts",
  "헬스케어 리츠": "Healthcare REITs",
  "헬스케어·약국·보험": "Healthcare, pharmacy, and insurance",
  "헬스케어·보험": "Healthcare and insurance",
  "서버·PC·스토리지": "Servers, PC, and storage",
  "통합 에너지": "Integrated energy",
  호텔: "Hotels",
  "호텔·여행": "Hotels and travel",
  "전력·재생에너지": "Power and renewable energy",
};

function toEnglishSector(sector: string | null | undefined): string | null {
  const normalized = sector?.trim();
  if (!normalized) return null;
  if (EN_FALLBACK_SECTOR_MAP[normalized]) return EN_FALLBACK_SECTOR_MAP[normalized];

  const splitSegments = normalized
    .split(/[·,]/g)
    .map((segment) => segment.trim())
    .map((segment) => EN_FALLBACK_SECTOR_MAP[segment] ?? segment)
    .filter(Boolean);

  if (splitSegments.length > 1) {
    return splitSegments.join(", ");
  }

  const genericSectorMatch = Object.entries(EN_FALLBACK_SECTOR_MAP).find(([ko]) =>
    normalized.includes(ko),
  );
  if (genericSectorMatch) {
    return genericSectorMatch[1];
  }

  return normalized
    .split(/[·/()]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment)
    .join(", ");
}

function buildEnglishFallbackCopy(ticker: string, canonicalCopy: CompanyDisplayCopy): CompanyDisplayCopy {
  const companyRecord = canonicalCopy as CanonicalLandingCopy;
  const companyName =
    companyRecord.name?.trim() || companyRecord.companyNameKo?.trim() || ticker;
  const sector = toEnglishSector(canonicalCopy.sector);
  const fallbackSector = sector || "Corporate";

  return {
    name: companyName,
    companyNameKo: undefined,
    sector: fallbackSector,
    description: `${companyName} is a filing-grounded company in ${fallbackSector} with operations linked to segment and geography mix changes.`,
    core_strength: `Core activity: ${companyName} financial disclosures by segment and geography.`,
    critical_risk: `Key watch item: demand volatility, pricing power, and operating cost pressure under the most current filing cycle.`,
  };
}

function buildEnglishFallbackPrompts(ticker: string): readonly string[] {
  const canonicalCopy = getCompanyLandingCopyForTicker(ticker);
  const companyName = canonicalCopy.name || ticker;
  return [
    `How have ${companyName}'s segment drivers and geography mix changed in the latest filings?`,
    `Which factors most directly move ${companyName}'s margin, cash flow, and growth visibility in the latest filing period?`,
    `What filing-based risks are most likely to pressure ${companyName}'s investment thesis next period?`,
  ];
}

const EN_HARDCODED_COMPANY_COPY: Record<string, CompanyDisplayCopy> = {
  AAPL: {
    sector: "Consumer technology",
    description:
      "Apple combines iPhone, Services, Mac, iPad, and Wearables into a high-retention consumer ecosystem with strong cash generation.",
    core_strength:
      "Core activity: iPhone installed base, Services monetization, premium hardware cycles, and ecosystem retention.",
    critical_risk:
      "Key watch item: iPhone demand cycles, App Store regulation, China exposure, supply chain concentration, and FX pressure.",
  },
  ADP: {
    sector: "Human capital management",
    description:
      "ADP serves Employer Services and PEO Services across payroll, HCM, HR outsourcing, and global payroll solutions.",
    core_strength:
      "Core activity: new business bookings, client retention, pays per control, and client funds management as key drivers of service margin.",
    critical_risk:
      "Key watch item: payroll demand sensitivity, PEO pass-through margin compression, interest rate impact on funds held for clients, and client funds liquidity risk.",
  },
  AMZN: {
    sector: "E-commerce and cloud infrastructure",
    description:
      "Amazon connects online retail, third-party marketplace services, advertising, subscriptions, and AWS cloud infrastructure.",
    core_strength:
      "Core activity: marketplace scale, logistics density, advertising growth, Prime engagement, and AWS operating leverage.",
    critical_risk:
      "Key watch item: retail margin pressure, cloud demand normalization, fulfillment costs, regulation, and capital intensity.",
  },
  NVDA: {
    sector: "Semiconductors and AI infrastructure",
    description:
      "NVIDIA sells accelerated computing platforms for data centers, gaming, professional visualization, automotive, and edge AI.",
    core_strength:
      "Core activity: AI accelerator demand, CUDA software ecosystem, data center platform expansion, and networking attach.",
    critical_risk:
      "Key watch item: hyperscaler capex cycles, export controls, supply constraints, customer concentration, and competition.",
  },
  MSFT: {
    sector: "Cloud software",
    description:
      "Microsoft combines Azure, Office, Windows, Dynamics, LinkedIn, security, gaming, and AI infrastructure into an enterprise platform.",
    core_strength:
      "Core activity: Azure growth, Microsoft 365 expansion, enterprise AI adoption, security attach, and durable software renewal.",
    critical_risk:
      "Key watch item: cloud growth deceleration, AI infrastructure cost, enterprise spending cycles, regulation, and competition.",
  },
  META: {
    sector: "Digital advertising and social platforms",
    description:
      "Meta monetizes Facebook, Instagram, WhatsApp, Messenger, and AI-driven discovery through digital advertising at global scale.",
    core_strength:
      "Core activity: ad impression growth, recommendation systems, Reels engagement, advertiser tools, and operating efficiency.",
    critical_risk:
      "Key watch item: regulatory pressure, privacy constraints, AI and Reality Labs spending, ad market cycles, and platform competition.",
  },
  GOOG: {
    sector: "Search, advertising, and cloud",
    description:
      "Alphabet monetizes Search, YouTube, Google Network, subscriptions, devices, Google Cloud, and AI infrastructure.",
    core_strength:
      "Core activity: Search intent monetization, YouTube engagement, cloud growth, AI integration, and global distribution.",
    critical_risk:
      "Key watch item: antitrust remedies, AI search disruption, cloud profitability, ad market cycles, and traffic acquisition costs.",
  },
  TSLA: {
    sector: "Electric vehicles and energy",
    description:
      "Tesla sells electric vehicles, energy storage, solar products, software features, and services around a vertically integrated platform.",
    core_strength:
      "Core activity: EV production scale, vehicle software, battery and energy storage expansion, charging network, and manufacturing efficiency.",
    critical_risk:
      "Key watch item: demand elasticity, price cuts, margin pressure, production execution, regulation, and EV competition.",
  },
  AVGO: {
    sector: "Semiconductors and infrastructure software",
    description:
      "Broadcom supplies semiconductor solutions and infrastructure software across networking, broadband, wireless, storage, and enterprise workloads.",
    core_strength:
      "Core activity: custom silicon demand, networking content, infrastructure software renewals, operating discipline, and customer depth.",
    critical_risk:
      "Key watch item: customer concentration, semiconductor cycles, integration execution, AI networking demand, and regulatory scrutiny.",
  },
  WMT: {
    sector: "Retail and omnichannel commerce",
    description:
      "Walmart operates large-scale stores, clubs, e-commerce, marketplace, advertising, and fulfillment networks across everyday essentials.",
    core_strength:
      "Core activity: price leadership, grocery scale, membership, marketplace growth, advertising, and supply chain execution.",
    critical_risk:
      "Key watch item: wage and logistics costs, consumer pressure, inventory management, e-commerce profitability, and competition.",
  },
  XOM: {
    sector: "Integrated energy",
    description:
      "Exxon Mobil operates upstream, downstream, chemicals, low-carbon solutions, and integrated energy assets across commodity cycles.",
    core_strength:
      "Core activity: advantaged upstream resources, refining and chemicals integration, capital discipline, and project execution.",
    critical_risk:
      "Key watch item: oil and gas prices, refining margins, reserve replacement, regulatory pressure, and energy transition exposure.",
  },
};

const EN_HARDCODED_SUGGESTED_PROMPTS: Record<string, readonly string[]> = {
  ADP: [
    "How do ADP's Employer Services and PEO Services generate payroll, HCM, and HR outsourcing revenue by filing section?",
    "How do new business bookings, retention, pays per control, and interest on funds held for clients affect ADP's profitability?",
    "What is the growth impact of worksite employee trends and how can PEO zero-margin benefits pass-through and ADP Indemnity costs affect risks?",
  ],
  AAPL: [
    "What drove Apple's recent revenue growth across iPhone and Services?",
    "How did Apple's Services mix affect margins?",
    "Which Apple risk factors matter most for the investment thesis?",
  ],
  AMZN: [
    "How did AWS growth and margin affect Amazon's profitability?",
    "What is driving Amazon's retail operating leverage?",
    "Which fulfillment and cloud risks should be watched?",
  ],
  NVDA: [
    "What drove NVIDIA data center revenue growth?",
    "How sustainable are NVIDIA's gross margins?",
    "Which export control or customer concentration risks matter most?",
  ],
  MSFT: [
    "How did Azure and Microsoft 365 drive recent growth?",
    "What does AI infrastructure spending mean for Microsoft margins?",
    "Which risks could challenge Microsoft's cloud thesis?",
  ],
  META: [
    "What drove Meta advertising revenue growth?",
    "How did operating efficiency affect Meta margins?",
    "Which regulatory and Reality Labs risks matter most?",
  ],
  GOOG: [
    "What drove Alphabet Search and YouTube revenue growth?",
    "How is Google Cloud affecting Alphabet profitability?",
    "Which antitrust or AI search risks matter most?",
  ],
  TSLA: [
    "What drove Tesla automotive revenue and margin changes?",
    "How are price cuts affecting Tesla profitability?",
    "Which demand and production risks matter most for Tesla?",
  ],
  AVGO: [
    "What drove Broadcom semiconductor and software revenue?",
    "How does AI networking demand affect Broadcom's thesis?",
    "Which customer concentration risks matter most?",
  ],
  WMT: [
    "What drove Walmart comparable sales and e-commerce growth?",
    "How are wages and logistics affecting Walmart margins?",
    "Which consumer pressure risks matter most?",
  ],
  XOM: [
    "What drove Exxon Mobil earnings across upstream and downstream?",
    "How do commodity prices and refining margins affect cash flow?",
    "Which energy transition and regulatory risks matter most?",
  ],
};

const EN_DEFAULT_SUGGESTED_PROMPTS: readonly string[] = [
  "Which companies benefit most from AI data center investment?",
  "Which semiconductor companies benefit from rising memory prices?",
  "Which companies can defend margins if consumer demand slows?",
];

const EN_MULTI_COMPANY_SUGGESTED_PROMPTS: readonly string[] = [
  "Compare the growth drivers.",
  "Compare the margin trends.",
  "Compare the key risks.",
];

function buildEnglishCompanyCopyMap(): Record<string, CompanyDisplayCopy> {
  const fallbackEntries = listCompanyLandingCopyTickers().map((ticker) => {
    const canonicalCopy = getCompanyLandingCopyForTicker(ticker);
    const fallbackCopy = buildEnglishFallbackCopy(ticker, canonicalCopy);
    const hardcoded = EN_HARDCODED_COMPANY_COPY[ticker];
    return [ticker, hardcoded ? { ...fallbackCopy, ...hardcoded } : fallbackCopy];
  });

  return Object.fromEntries(fallbackEntries) as Record<string, CompanyDisplayCopy>;
}

function buildEnglishSuggestedPromptsMap(): Record<string, readonly string[]> {
  const fallbackEntries = listCompanyLandingCopyTickers().map((ticker) => {
    const hardcodedPrompts = EN_HARDCODED_SUGGESTED_PROMPTS[ticker];
    const fallbackPrompts = hardcodedPrompts ?? buildEnglishFallbackPrompts(ticker);
    return [ticker, fallbackPrompts];
  });

  return Object.fromEntries(fallbackEntries) as Record<string, readonly string[]>;
}

const englishCompanyCopy = buildEnglishCompanyCopyMap();
const englishSuggestedPrompts = buildEnglishSuggestedPromptsMap();

export function getCompanyDisplayCopyForTicker(
  locale: Locale,
  ticker: string,
): CompanyDisplayCopy {
  if (locale === "ko") return getCompanyLandingCopyForTicker(ticker);

  const normalizedTicker = ticker.trim().toUpperCase();
  const enFallbackCopy = englishCompanyCopy[normalizedTicker];
  if (enFallbackCopy) {
    return { companyNameKo: undefined, ...enFallbackCopy };
  }

  return {};
}

export function getSuggestedPromptDisplaysForTickers(
  locale: Locale,
  tickers: readonly string[],
): readonly string[] {
  if (locale === "ko") return getSuggestedPromptsForTickers(tickers);

  const normalizedTickers = tickers
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
  if (normalizedTickers.length === 0) return EN_DEFAULT_SUGGESTED_PROMPTS;
  if (normalizedTickers.length > 1) return EN_MULTI_COMPANY_SUGGESTED_PROMPTS;

  const prompts = normalizedTickers.flatMap(
    (ticker) => englishSuggestedPrompts[ticker] ?? buildEnglishFallbackPrompts(ticker),
  );
  return prompts;
}
