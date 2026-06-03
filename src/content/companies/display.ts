import type { Locale } from "@/i18n/config";
import {
  getCompanyLandingCopyForTicker,
  getSuggestedPromptsForTickers,
} from "@/lib/companies/landing-copy";

interface CompanyDisplayCopy {
  companyNameKo?: string;
  sector?: string | null;
  description?: string;
  core_strength?: string;
  critical_risk?: string;
}

const englishCompanyCopy: Record<string, CompanyDisplayCopy> = {
  AAPL: {
    sector: "Consumer technology",
    description:
      "Apple combines iPhone, Services, Mac, iPad, and Wearables into a high-retention consumer ecosystem with strong cash generation.",
    core_strength:
      "Core activity: iPhone installed base, Services monetization, premium hardware cycles, and ecosystem retention.",
    critical_risk:
      "Key watch item: iPhone demand cycles, App Store regulation, China exposure, supply chain concentration, and FX pressure.",
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

const englishSuggestedPrompts: Record<string, readonly string[]> = {
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

export function getCompanyDisplayCopyForTicker(
  locale: Locale,
  ticker: string,
): CompanyDisplayCopy {
  const canonicalCopy = getCompanyLandingCopyForTicker(ticker);
  if (locale === "ko") return canonicalCopy;

  const normalizedTicker = ticker.trim().toUpperCase();
  return {
    companyNameKo: undefined,
    ...englishCompanyCopy[normalizedTicker],
  };
}

export function getSuggestedPromptDisplaysForTickers(
  locale: Locale,
  tickers: readonly string[],
): readonly string[] {
  if (locale === "ko") return getSuggestedPromptsForTickers(tickers);

  const normalizedTickers = tickers.map((ticker) => ticker.trim().toUpperCase());
  const prompts = normalizedTickers.flatMap(
    (ticker) => englishSuggestedPrompts[ticker] ?? [],
  );

  return prompts;
}
