import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { UserCompanyCoverageLevel } from "@/types/api-contracts";
import type { ChatSessionRow, Database, UserCompanyMarkRow } from "@/types/database";

type CompanyMark = Pick<UserCompanyMarkRow, "ticker" | "coverage_level">;
type RecentCompanySession = Pick<ChatSessionRow, "default_tickers">;

const RECENT_RESEARCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PREFERRED_TICKERS = 100;

export interface PulseUserTickerSignals {
  coverageByTicker: Map<string, UserCompanyCoverageLevel>;
  recentResearchTickers: Set<string>;
  preferredTickers: string[];
}

export async function getPulseUserTickerSignals(
  supabase: SupabaseClient<Database>,
  userId: string,
  now = new Date(),
): Promise<PulseUserTickerSignals> {
  const cutoff = new Date(now.getTime() - RECENT_RESEARCH_WINDOW_MS).toISOString();
  const [marksResult, sessionsResult] = await Promise.all([
    supabase
      .from("user_company_marks")
      .select("ticker,coverage_level")
      .eq("user_id", userId)
      .limit(MAX_PREFERRED_TICKERS)
      .returns<CompanyMark[]>(),
    supabase
      .from("chat_sessions")
      .select("default_tickers")
      .eq("user_id", userId)
      .eq("scope_type", "company")
      .is("deleted_at", null)
      .gte("updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(20)
      .returns<RecentCompanySession[]>(),
  ]);
  if (marksResult.error) throw marksResult.error;
  if (sessionsResult.error) throw sessionsResult.error;

  const coverageByTicker = new Map<string, UserCompanyCoverageLevel>();
  const recentResearchTickers = new Set<string>();
  for (const mark of marksResult.data ?? []) {
    const ticker = normalizeTicker(mark.ticker);
    if (!ticker) continue;
    if (mark.coverage_level) coverageByTicker.set(ticker, mark.coverage_level);
  }
  for (const session of sessionsResult.data ?? []) {
    for (const rawTicker of session.default_tickers ?? []) {
      const ticker = normalizeTicker(rawTicker);
      if (ticker) recentResearchTickers.add(ticker);
    }
  }

  return {
    coverageByTicker,
    recentResearchTickers,
    preferredTickers: [...new Set([
      ...[...coverageByTicker.entries()]
        .sort((left, right) => coveragePriority(left[1]) - coveragePriority(right[1]))
        .map(([ticker]) => ticker),
      ...recentResearchTickers,
    ])].slice(0, MAX_PREFERRED_TICKERS),
  };
}

export function applyPulseUserTickerSignals(
  candidates: PulseCandidate[],
  signals: PulseUserTickerSignals,
): PulseCandidate[] {
  return candidates.map((candidate) => personalizeCandidate(candidate, signals));
}

/**
 * A saved filing judgment owns the user's share-class context. Re-composition
 * must never silently move that immutable decision from GOOGL to GOOG (or the
 * reverse) just because the SEC event has another canonical ticker.
 */
export function applyPulseFilingDecisionTicker(
  candidate: PulseCandidate,
  rawTicker: string,
  signals: PulseUserTickerSignals,
): PulseCandidate {
  return personalizeCandidate(candidate, signals, normalizeTicker(rawTicker));
}

export function pulseCandidateTickerIdentities(
  candidate: Pick<PulseCandidate, "ticker" | "metadata">,
): string[] {
  const coveredTickers = typeof candidate.metadata.covered_tickers_csv === "string"
    ? candidate.metadata.covered_tickers_csv.split(",")
    : [];
  return [...new Set([candidate.ticker, ...coveredTickers]
    .map(normalizeTicker)
    .filter((ticker): ticker is string => Boolean(ticker)))];
}

export function emptyPulseUserTickerSignals(): PulseUserTickerSignals {
  return {
    coverageByTicker: new Map(),
    recentResearchTickers: new Set(),
    preferredTickers: [],
  };
}

function filingReason(
  candidate: PulseCandidate,
  ticker: string | null,
  coverageLevel: UserCompanyCoverageLevel | null,
  hasRecentResearch: boolean,
): Pick<PulseCandidate, "reason_code" | "reason_label"> | null {
  if (candidate.kind !== "filing" || !ticker) return null;
  if (coverageLevel === "holding" && hasRecentResearch) {
    return {
      reason_code: "holding_research_followup",
      reason_label: `${ticker}은 보유 기업이며 최근 이 기업을 리서치했습니다.`,
    };
  }
  if (coverageLevel === "holding") {
    return {
      reason_code: "holding_new_filing",
      reason_label: `${ticker}은 보유 기업입니다.`,
    };
  }
  if (coverageLevel === "interest") {
    return {
      reason_code: "watchlisted_new_filing",
      reason_label: `${ticker}을 관심 기업으로 저장했습니다.`,
    };
  }
  if (hasRecentResearch) {
    return {
      reason_code: "recent_research_followup",
      reason_label: `최근 ${ticker} 관련 리서치를 이어서 확인할 수 있습니다.`,
    };
  }
  return null;
}

function personalizeCandidate(
  candidate: PulseCandidate,
  signals: PulseUserTickerSignals,
  forcedTicker?: string | null,
): PulseCandidate {
  const identities = pulseCandidateTickerIdentities(candidate);
  const canonicalTicker = normalizeTicker(candidate.ticker);
  const ticker = forcedTicker
    ?? selectCoverageTicker(identities, signals.coverageByTicker)
    ?? identities.find((identity) => signals.recentResearchTickers.has(identity))
    ?? canonicalTicker;
  const coverageLevel = ticker ? signals.coverageByTicker.get(ticker) ?? null : null;
  const hasRecentResearch = identities.some((identity) =>
    signals.recentResearchTickers.has(identity));
  const contextualized = candidate.kind === "filing" && ticker
    ? applyFilingTickerContext(candidate, ticker, canonicalTicker)
    : candidate;
  const personalizedReason = filingReason(
    contextualized,
    ticker,
    coverageLevel,
    hasRecentResearch,
  );

  return {
    ...contextualized,
    coverage_level: coverageLevel,
    has_recent_research: hasRecentResearch,
    ...(personalizedReason ?? {}),
  };
}

function selectCoverageTicker(
  identities: string[],
  coverageByTicker: Map<string, UserCompanyCoverageLevel>,
): string | null {
  let selected: { ticker: string; rank: number } | null = null;
  for (const ticker of identities) {
    const status = coverageByTicker.get(ticker);
    if (!status) continue;
    const rank = coveragePriority(status);
    if (!selected || rank < selected.rank) selected = { ticker, rank };
  }
  return selected?.ticker ?? null;
}

function applyFilingTickerContext(
  candidate: PulseCandidate,
  ticker: string,
  canonicalTicker: string | null,
): PulseCandidate {
  return {
    ...candidate,
    ticker,
    primary_action: rewriteTickerAction(candidate.primary_action, ticker),
    secondary_actions: candidate.secondary_actions.map((action) =>
      rewriteTickerAction(action, ticker)),
    metadata: {
      ...candidate.metadata,
      canonical_ticker: canonicalTicker,
    },
  };
}

function rewriteTickerAction(
  action: PulseCandidate["primary_action"],
  ticker: string,
): PulseCandidate["primary_action"] {
  if (action.type !== "link") return action;
  let target: URL;
  try {
    target = new URL(action.href, "https://krwontology.com");
  } catch {
    return action;
  }
  if (target.origin !== "https://krwontology.com") return action;
  if (!target.pathname.startsWith("/filings/") && target.pathname !== "/chat/new") {
    return action;
  }
  target.searchParams.set("ticker", ticker);
  return {
    ...action,
    href: `${target.pathname}${target.search}${target.hash}`,
  };
}

function coveragePriority(status: UserCompanyCoverageLevel): number {
  if (status === "holding") return 0;
  return 1;
}

function normalizeTicker(value: string | null | undefined): string | null {
  const ticker = value?.trim().toUpperCase();
  return ticker || null;
}
