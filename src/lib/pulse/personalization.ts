import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { ChatSessionRow, Database, UserCompanyMarkRow } from "@/types/database";

type CompanyMark = Pick<UserCompanyMarkRow, "ticker" | "is_holding" | "is_watchlisted">;
type RecentCompanySession = Pick<ChatSessionRow, "default_tickers">;

const RECENT_RESEARCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PREFERRED_TICKERS = 100;

export interface PulseUserTickerSignals {
  holdingTickers: Set<string>;
  watchlistedTickers: Set<string>;
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
      .select("ticker,is_holding,is_watchlisted")
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

  const holdingTickers = new Set<string>();
  const watchlistedTickers = new Set<string>();
  const recentResearchTickers = new Set<string>();
  for (const mark of marksResult.data ?? []) {
    const ticker = normalizeTicker(mark.ticker);
    if (!ticker) continue;
    if (mark.is_holding) holdingTickers.add(ticker);
    if (mark.is_watchlisted) watchlistedTickers.add(ticker);
  }
  for (const session of sessionsResult.data ?? []) {
    for (const rawTicker of session.default_tickers ?? []) {
      const ticker = normalizeTicker(rawTicker);
      if (ticker) recentResearchTickers.add(ticker);
    }
  }

  return {
    holdingTickers,
    watchlistedTickers,
    recentResearchTickers,
    preferredTickers: [...new Set([
      ...holdingTickers,
      ...watchlistedTickers,
      ...recentResearchTickers,
    ])].slice(0, MAX_PREFERRED_TICKERS),
  };
}

export function applyPulseUserTickerSignals(
  candidates: PulseCandidate[],
  signals: PulseUserTickerSignals,
): PulseCandidate[] {
  return candidates.map((candidate) => {
    const ticker = normalizeTicker(candidate.ticker);
    const isHolding = Boolean(ticker && signals.holdingTickers.has(ticker));
    const isWatchlisted = Boolean(ticker && signals.watchlistedTickers.has(ticker));
    const hasRecentResearch = Boolean(ticker && signals.recentResearchTickers.has(ticker));
    const personalizedReason = filingReason(candidate, ticker, isHolding, isWatchlisted, hasRecentResearch);

    return {
      ...candidate,
      is_holding: isHolding,
      is_watchlisted: isWatchlisted,
      has_recent_research: hasRecentResearch,
      ...(personalizedReason ?? {}),
    };
  });
}

export function emptyPulseUserTickerSignals(): PulseUserTickerSignals {
  return {
    holdingTickers: new Set(),
    watchlistedTickers: new Set(),
    recentResearchTickers: new Set(),
    preferredTickers: [],
  };
}

function filingReason(
  candidate: PulseCandidate,
  ticker: string | null,
  isHolding: boolean,
  isWatchlisted: boolean,
  hasRecentResearch: boolean,
): Pick<PulseCandidate, "reason_code" | "reason_label"> | null {
  if (candidate.kind !== "filing" || !ticker) return null;
  if (isHolding && hasRecentResearch) {
    return {
      reason_code: "holding_research_followup",
      reason_label: `${ticker}은 보유 기업이며 최근 이 기업을 리서치했습니다.`,
    };
  }
  if (isHolding) {
    return {
      reason_code: "holding_new_filing",
      reason_label: `${ticker}은 보유 기업입니다.`,
    };
  }
  if (isWatchlisted) {
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

function normalizeTicker(value: string | null | undefined): string | null {
  const ticker = value?.trim().toUpperCase();
  return ticker || null;
}
