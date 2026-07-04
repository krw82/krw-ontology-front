import type { MarketMoveDirection } from "@/lib/market-move/intent";

export interface MarketMoveObservation {
  ticker: string;
  company_name: string | null;
  direction: MarketMoveDirection;
  requested_percent_move: number | null;
  current_price: number | null;
  previous_close: number | null;
  absolute_change: number | null;
  percent_change: number | null;
  volume: number | null;
  average_volume: number | null;
  volume_signal: "above_average" | "near_average" | "below_average" | "unknown";
  technical_signal: TechnicalMarketSignal;
  market_time: string | null;
  currency: string | null;
}

export interface TechnicalMarketSignal {
  price: {
    direction: "up" | "down" | "flat" | "unknown";
    magnitude: "small" | "moderate" | "large" | "unknown";
  };
  volume: {
    ratio: number | null;
    signal: "high_activity" | "normal_activity" | "thin_activity" | "unknown";
  };
  trend: {
    vs_50d: "above" | "below" | "near" | "unknown";
    vs_200d: "above" | "below" | "near" | "unknown";
    signal:
      | "strong_uptrend"
      | "short_term_pullback_midterm_intact"
      | "trend_break_risk"
      | "neutral_or_mixed"
      | "unknown";
  };
  range_52w: {
    position: number | null;
    signal: "upper_range" | "middle_range" | "lower_range" | "unknown";
  };
  size: {
    market_cap: number | null;
    bucket: "mega_cap" | "large_cap" | "mid_cap" | "small_cap" | "unknown";
  };
  overall:
    | "technically_strong"
    | "short_term_pressure_but_midterm_trend_intact"
    | "trend_break_risk"
    | "neutral_or_mixed"
    | "insufficient_data";
}

export interface MarketMoveEventCandidate {
  title: string;
  summary: string | null;
  description: string | null;
  url: string | null;
  source_domain: string | null;
  published_at: string | null;
  relevance_note: string;
}

export interface MarketMoveContext extends Record<string, unknown> {
  version: "market-move-context/v1";
  ticker: string;
  company_name: string | null;
  user_question: string;
  as_of: string;
  status: "ok" | "partial";
  provider: {
    name: "yahoo-finance-mcp";
    status: "ok" | "unavailable";
    error: string | null;
  };
  market_observation: MarketMoveObservation;
  event_candidates: MarketMoveEventCandidate[];
  source_pack: {
    version: "market-move-source-pack/v1";
    ontology_search_brief_en: string;
    original_text_for_ontology: string;
    source_urls: string[];
    source_previews: Array<{
      title: string;
      url: string | null;
      domain: string | null;
      summary: string | null;
    }>;
  };
}

export interface YahooFinanceSnapshot {
  stockInfo: Record<string, unknown>;
  historicalPrices: Array<Record<string, unknown>>;
  news: MarketMoveEventCandidate[];
}
