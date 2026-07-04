import "server-only";

import {
  extractMentionedPercentMove,
  inferMarketMoveDirection,
  type MarketMoveDirection,
} from "@/lib/market-move/intent";
import type {
  MarketMoveContext,
  MarketMoveEventCandidate,
  MarketMoveObservation,
  TechnicalMarketSignal,
  YahooFinanceSnapshot,
} from "@/lib/market-move/types";
import { fetchYahooFinanceSnapshot } from "@/lib/market-move/yahoo-finance-mcp-client";
import { normalizeTicker } from "@/lib/ontology/ticker";

interface BuildMarketMoveContextParams {
  ticker: string;
  companyName?: string | null;
  userQuestion: string;
  now?: Date;
  fetchSnapshot?: (ticker: string) => Promise<YahooFinanceSnapshot>;
}

export async function buildMarketMoveContext(
  params: BuildMarketMoveContextParams,
): Promise<MarketMoveContext> {
  const ticker = normalizeTicker(params.ticker);
  if (!ticker) {
    throw new Error(`Invalid ticker for market move context: ${params.ticker}`);
  }

  const now = params.now ?? new Date();
  const direction = inferMarketMoveDirection(params.userQuestion);
  const requestedPercentMove = extractMentionedPercentMove(params.userQuestion);
  const fetchSnapshot = params.fetchSnapshot ?? fetchYahooFinanceSnapshot;

  try {
    const snapshot = await fetchSnapshot(ticker);
    const observation = buildObservation({
      ticker,
      direction,
      requestedPercentMove,
      companyName: params.companyName,
      snapshot,
    });
    return buildContext({
      ticker,
      companyName: observation.company_name,
      userQuestion: params.userQuestion,
      now,
      status: "ok",
      providerStatus: "ok",
      providerError: null,
      observation,
      eventCandidates: snapshot.news,
    });
  } catch (error) {
    const observation = buildFallbackObservation({
      ticker,
      companyName: params.companyName,
      direction,
      requestedPercentMove,
    });
    return buildContext({
      ticker,
      companyName: observation.company_name,
      userQuestion: params.userQuestion,
      now,
      status: "partial",
      providerStatus: "unavailable",
      providerError: error instanceof Error ? error.message : "Yahoo Finance MCP unavailable",
      observation,
      eventCandidates: [],
    });
  }
}

function buildObservation(params: {
  ticker: string;
  direction: MarketMoveDirection;
  requestedPercentMove: number | null;
  companyName?: string | null;
  snapshot: YahooFinanceSnapshot;
}): MarketMoveObservation {
  const { stockInfo, historicalPrices } = params.snapshot;
  const historicalMove = deriveMoveFromHistoricalPrices(historicalPrices);
  const currentPrice =
    numberValue(
      stockInfo.currentPrice,
      stockInfo.regularMarketPrice,
      historicalMove.currentPrice,
    );
  const previousClose =
    numberValue(
      stockInfo.regularMarketPreviousClose,
      stockInfo.previousClose,
      historicalMove.previousClose,
    );
  const absoluteChange =
    numberValue(stockInfo.regularMarketChange) ??
    (currentPrice !== null && previousClose !== null
      ? currentPrice - previousClose
      : null);
  const percentChange =
    numberValue(stockInfo.regularMarketChangePercent) ??
    historicalMove.percentChange;
  const volume = integerValue(stockInfo.regularMarketVolume, stockInfo.volume);
  const averageVolume = integerValue(
    stockInfo.averageVolume,
    stockInfo.averageDailyVolume10Day,
    stockInfo.averageVolume10days,
  );
  const technicalSignal = buildTechnicalSignal({
    currentPrice,
    previousClose,
    percentChange,
    volume,
    averageVolume,
    stockInfo,
  });

  return {
    ticker: params.ticker,
    company_name:
      stringValue(stockInfo.longName, stockInfo.shortName) ??
      params.companyName ??
      null,
    direction: params.direction,
    requested_percent_move: params.requestedPercentMove,
    current_price: currentPrice,
    previous_close: previousClose,
    absolute_change: absoluteChange,
    percent_change: percentChange,
    volume,
    average_volume: averageVolume,
    volume_signal: volumeSignal(volume, averageVolume),
    technical_signal: technicalSignal,
    market_time: stringValue(stockInfo.marketState) ?? null,
    currency: stringValue(stockInfo.currency, stockInfo.financialCurrency) ?? null,
  };
}

function buildFallbackObservation(params: {
  ticker: string;
  companyName?: string | null;
  direction: MarketMoveDirection;
  requestedPercentMove: number | null;
}): MarketMoveObservation {
  return {
    ticker: params.ticker,
    company_name: params.companyName ?? null,
    direction: params.direction,
    requested_percent_move: params.requestedPercentMove,
    current_price: null,
    previous_close: null,
    absolute_change: null,
    percent_change: null,
    volume: null,
    average_volume: null,
    volume_signal: "unknown",
    technical_signal: emptyTechnicalSignal(),
    market_time: null,
    currency: null,
  };
}

function buildContext(params: {
  ticker: string;
  companyName: string | null;
  userQuestion: string;
  now: Date;
  status: "ok" | "partial";
  providerStatus: "ok" | "unavailable";
  providerError: string | null;
  observation: MarketMoveObservation;
  eventCandidates: MarketMoveEventCandidate[];
}): MarketMoveContext {
  const sourcePreviews = params.eventCandidates.slice(0, 6).map((candidate) => ({
    title: candidate.title,
    url: candidate.url,
    domain: candidate.source_domain,
    summary: candidate.summary ?? candidate.description,
  }));
  const sourceUrls = sourcePreviews
    .map((source) => source.url)
    .filter((url): url is string => Boolean(url));
  const observationSummary = buildObservationSummary(params.observation);
  const newsSummary = buildNewsSummary(params.eventCandidates);
  const ontologyBrief = buildOntologySearchBrief({
    ticker: params.ticker,
    companyName: params.companyName,
    userQuestion: params.userQuestion,
    observationSummary,
    newsSummary,
    status: params.status,
  });

  return {
    version: "market-move-context/v1",
    ticker: params.ticker,
    company_name: params.companyName,
    user_question: params.userQuestion,
    as_of: params.now.toISOString(),
    status: params.status,
    provider: {
      name: "yahoo-finance-mcp",
      status: params.providerStatus,
      error: params.providerError,
    },
    market_observation: params.observation,
    event_candidates: params.eventCandidates,
    source_pack: {
      version: "market-move-source-pack/v1",
      ontology_search_brief_en: ontologyBrief,
      original_text_for_ontology: [
        `User question: ${params.userQuestion}`,
        `Market observation: ${observationSummary}`,
        newsSummary ? `Recent Yahoo Finance news candidates: ${newsSummary}` : "",
        params.providerError
          ? `Provider limitation: ${params.providerError}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      source_urls: sourceUrls,
      source_previews: sourcePreviews,
    },
  };
}

function buildOntologySearchBrief(params: {
  ticker: string;
  companyName: string | null;
  userQuestion: string;
  observationSummary: string;
  newsSummary: string;
  status: "ok" | "partial";
}): string {
  const company = params.companyName
    ? `${params.companyName} (${params.ticker})`
    : params.ticker;
  return [
    `Investigate why ${company} shares moved, using the app-provided market observation only as the current market prompt.`,
    `User question: ${params.userQuestion}`,
    `Market observation: ${params.observationSummary}`,
    params.newsSummary
      ? `Recent market/news candidates to bridge into filing evidence: ${params.newsSummary}`
      : "No usable recent Yahoo Finance news candidate was available; focus on filing baseline, company comments, risk factors, cash-flow and operating exposure that could explain investor sensitivity.",
    params.status === "partial"
      ? "Provider data was partial/unavailable, so do not pretend live news was verified."
      : "Do not treat Yahoo news candidates as confirmed company disclosure; use filings to explain whether the market narrative matters.",
  ].join(" ");
}

function buildObservationSummary(observation: MarketMoveObservation): string {
  const parts = [
    `direction=${observation.direction}`,
    observation.requested_percent_move !== null
      ? `user_reported_move=${formatPercent(observation.requested_percent_move)}`
      : "",
    observation.percent_change !== null
      ? `yahoo_regular_move=${formatPercent(observation.percent_change)}`
      : "",
    observation.current_price !== null
      ? `current_price=${formatNumber(observation.current_price)}`
      : "",
    observation.previous_close !== null
      ? `previous_close=${formatNumber(observation.previous_close)}`
      : "",
    observation.volume_signal !== "unknown"
      ? `volume_signal=${observation.volume_signal}`
      : "",
    observation.technical_signal.overall !== "insufficient_data"
      ? `technical_overall=${observation.technical_signal.overall}`
      : "",
    observation.technical_signal.trend.signal !== "unknown"
      ? `technical_trend=${observation.technical_signal.trend.signal}`
      : "",
    observation.technical_signal.range_52w.signal !== "unknown"
      ? `range_52w=${observation.technical_signal.range_52w.signal}`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "market move requested, live price details unavailable";
}

function buildNewsSummary(candidates: MarketMoveEventCandidate[]): string {
  return candidates
    .slice(0, 5)
    .map((candidate) => {
      const source = candidate.source_domain ? ` (${candidate.source_domain})` : "";
      return `${candidate.title}${source}`;
    })
    .join("; ");
}

function deriveMoveFromHistoricalPrices(
  prices: Array<Record<string, unknown>>,
): {
  currentPrice: number | null;
  previousClose: number | null;
  percentChange: number | null;
} {
  const closes = prices
    .map((row) => ({
      date: stringValue(row.Date) ?? "",
      close: numberValue(row.Close, row.close, row.AdjClose, row["Adj Close"]),
    }))
    .filter((row): row is { date: string; close: number } =>
      Boolean(row.date && row.close !== null),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = closes.at(-1)?.close ?? null;
  const previous = closes.at(-2)?.close ?? null;
  const percent =
    latest !== null && previous !== null && previous !== 0
      ? ((latest - previous) / previous) * 100
      : null;
  return {
    currentPrice: latest,
    previousClose: previous,
    percentChange: percent,
  };
}

function volumeSignal(
  volume: number | null,
  averageVolume: number | null,
): MarketMoveObservation["volume_signal"] {
  if (!volume || !averageVolume || averageVolume <= 0) return "unknown";
  const ratio = volume / averageVolume;
  if (ratio >= 1.5) return "above_average";
  if (ratio <= 0.7) return "below_average";
  return "near_average";
}

function buildTechnicalSignal(params: {
  currentPrice: number | null;
  previousClose: number | null;
  percentChange: number | null;
  volume: number | null;
  averageVolume: number | null;
  stockInfo: Record<string, unknown>;
}): TechnicalMarketSignal {
  const fiftyDayAverage = numberValue(params.stockInfo.fiftyDayAverage);
  const twoHundredDayAverage = numberValue(params.stockInfo.twoHundredDayAverage);
  const fiftyTwoWeekLow = numberValue(params.stockInfo.fiftyTwoWeekLow);
  const fiftyTwoWeekHigh = numberValue(params.stockInfo.fiftyTwoWeekHigh);
  const marketCap = numberValue(params.stockInfo.marketCap);

  const price = {
    direction: priceDirection(params.percentChange),
    magnitude: priceMagnitude(params.percentChange, marketCap),
  } satisfies TechnicalMarketSignal["price"];

  const volume = technicalVolumeSignal(params.volume, params.averageVolume);
  const trend = trendSignal({
    currentPrice: params.currentPrice,
    fiftyDayAverage,
    twoHundredDayAverage,
  });
  const range52w = range52wSignal({
    currentPrice: params.currentPrice,
    fiftyTwoWeekLow,
    fiftyTwoWeekHigh,
  });
  const size = {
    market_cap: marketCap,
    bucket: marketCapBucket(marketCap),
  } satisfies TechnicalMarketSignal["size"];

  return {
    price,
    volume,
    trend,
    range_52w: range52w,
    size,
    overall: overallTechnicalRead({
      price,
      volume,
      trend,
      range52w,
    }),
  };
}

function emptyTechnicalSignal(): TechnicalMarketSignal {
  return {
    price: {
      direction: "unknown",
      magnitude: "unknown",
    },
    volume: {
      ratio: null,
      signal: "unknown",
    },
    trend: {
      vs_50d: "unknown",
      vs_200d: "unknown",
      signal: "unknown",
    },
    range_52w: {
      position: null,
      signal: "unknown",
    },
    size: {
      market_cap: null,
      bucket: "unknown",
    },
    overall: "insufficient_data",
  };
}

function priceDirection(
  percentChange: number | null,
): TechnicalMarketSignal["price"]["direction"] {
  if (percentChange === null) return "unknown";
  if (percentChange > 0.2) return "up";
  if (percentChange < -0.2) return "down";
  return "flat";
}

function priceMagnitude(
  percentChange: number | null,
  marketCap: number | null,
): TechnicalMarketSignal["price"]["magnitude"] {
  if (percentChange === null) return "unknown";
  const abs = Math.abs(percentChange);
  const megaCap = marketCap !== null && marketCap >= 200_000_000_000;
  if (abs >= 3 || (megaCap && abs >= 2)) return "large";
  if (abs >= 1) return "moderate";
  return "small";
}

function technicalVolumeSignal(
  volume: number | null,
  averageVolume: number | null,
): TechnicalMarketSignal["volume"] {
  if (!volume || !averageVolume || averageVolume <= 0) {
    return {
      ratio: null,
      signal: "unknown",
    };
  }
  const ratio = volume / averageVolume;
  return {
    ratio: Number(ratio.toFixed(2)),
    signal:
      ratio >= 1.5
        ? "high_activity"
        : ratio <= 0.7
          ? "thin_activity"
          : "normal_activity",
  };
}

function trendSignal(params: {
  currentPrice: number | null;
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
}): TechnicalMarketSignal["trend"] {
  const vs50d = compareToReference(params.currentPrice, params.fiftyDayAverage);
  const vs200d = compareToReference(params.currentPrice, params.twoHundredDayAverage);
  const unknown = vs50d === "unknown" && vs200d === "unknown";

  if (unknown) {
    return {
      vs_50d: vs50d,
      vs_200d: vs200d,
      signal: "unknown",
    };
  }

  let signal: TechnicalMarketSignal["trend"]["signal"] = "neutral_or_mixed";
  if (vs200d === "below") {
    signal = "trend_break_risk";
  } else if (
    vs50d === "above" &&
    vs200d === "above" &&
    params.fiftyDayAverage !== null &&
    params.twoHundredDayAverage !== null &&
    params.fiftyDayAverage > params.twoHundredDayAverage
  ) {
    signal = "strong_uptrend";
  } else if (
    vs50d === "below" &&
    (vs200d === "above" || vs200d === "near")
  ) {
    signal = "short_term_pullback_midterm_intact";
  }

  return {
    vs_50d: vs50d,
    vs_200d: vs200d,
    signal,
  };
}

function compareToReference(
  current: number | null,
  reference: number | null,
): "above" | "below" | "near" | "unknown" {
  if (current === null || reference === null || reference <= 0) return "unknown";
  const diff = (current - reference) / reference;
  if (Math.abs(diff) <= 0.02) return "near";
  return diff > 0 ? "above" : "below";
}

function range52wSignal(params: {
  currentPrice: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
}): TechnicalMarketSignal["range_52w"] {
  const { currentPrice, fiftyTwoWeekLow, fiftyTwoWeekHigh } = params;
  if (
    currentPrice === null ||
    fiftyTwoWeekLow === null ||
    fiftyTwoWeekHigh === null ||
    fiftyTwoWeekHigh <= fiftyTwoWeekLow
  ) {
    return {
      position: null,
      signal: "unknown",
    };
  }
  const rawPosition =
    (currentPrice - fiftyTwoWeekLow) / (fiftyTwoWeekHigh - fiftyTwoWeekLow);
  const position = Math.max(0, Math.min(1, rawPosition));
  return {
    position: Number(position.toFixed(2)),
    signal:
      position >= 0.8
        ? "upper_range"
        : position >= 0.4
          ? "middle_range"
          : "lower_range",
  };
}

function marketCapBucket(
  marketCap: number | null,
): TechnicalMarketSignal["size"]["bucket"] {
  if (marketCap === null || marketCap <= 0) return "unknown";
  if (marketCap >= 200_000_000_000) return "mega_cap";
  if (marketCap >= 10_000_000_000) return "large_cap";
  if (marketCap >= 2_000_000_000) return "mid_cap";
  return "small_cap";
}

function overallTechnicalRead(params: {
  price: TechnicalMarketSignal["price"];
  volume: TechnicalMarketSignal["volume"];
  trend: TechnicalMarketSignal["trend"];
  range52w: TechnicalMarketSignal["range_52w"];
}): TechnicalMarketSignal["overall"] {
  if (
    params.trend.signal === "unknown" &&
    params.price.direction === "unknown" &&
    params.volume.signal === "unknown" &&
    params.range52w.signal === "unknown"
  ) {
    return "insufficient_data";
  }
  if (params.trend.signal === "trend_break_risk") return "trend_break_risk";
  if (params.trend.signal === "strong_uptrend") {
    if (
      params.price.direction === "down" &&
      params.price.magnitude !== "small" &&
      params.volume.signal === "high_activity"
    ) {
      return "neutral_or_mixed";
    }
    return "technically_strong";
  }
  if (params.trend.signal === "short_term_pullback_midterm_intact") {
    return "short_term_pressure_but_midterm_trend_intact";
  }
  if (
    params.price.direction === "down" &&
    params.price.magnitude !== "small" &&
    params.volume.signal === "high_activity"
  ) {
    return "short_term_pressure_but_midterm_trend_intact";
  }
  return "neutral_or_mixed";
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.replace(/,/g, ""))
          : NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function integerValue(...values: unknown[]): number | null {
  const value = numberValue(...values);
  return value === null ? null : Math.round(value);
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%`;
}
