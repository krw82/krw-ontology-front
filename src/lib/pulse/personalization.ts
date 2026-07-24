import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { UserCompanyCoverageLevel } from "@/types/api-contracts";
import type {
  AgentRunRow,
  ChatSessionRow,
  Database,
  UserCompanyMarkRow,
} from "@/types/database";

type CompanyMark = Pick<UserCompanyMarkRow, "ticker" | "coverage_level">;
type RecentCompanySession = Pick<
  ChatSessionRow,
  "id" | "default_tickers" | "updated_at"
>;
type CompletedCompanyRun = Pick<AgentRunRow, "session_id" | "finished_at">;

const RECENT_RESEARCH_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;
const RESEARCH_AFFINITY_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_PREFERRED_TICKERS = 100;
const MAX_RESEARCH_SESSIONS = 120;
const MAX_COMPLETED_RUNS = 240;
const RESEARCH_RECENCY_HALF_LIFE_DAYS = 14;

export interface PulseResearchAffinity {
  completed_run_count: number;
  /** Completed company conversations, deduplicated by chat session. */
  research_session_count: number;
  distinct_research_days: number;
  latest_completed_at: string;
  tier: PulseResearchContextTier;
  score: number;
}

export type PulseResearchContextTier = "strong" | "active" | "recent" | "history";

export interface PulseUserTickerSignals {
  coverageByTicker: Map<string, UserCompanyCoverageLevel>;
  recentResearchTickers: Set<string>;
  researchAffinityByTicker: Map<string, PulseResearchAffinity>;
  preferredTickers: string[];
}

export async function getPulseUserTickerSignals(
  supabase: SupabaseClient<Database>,
  userId: string,
  now = new Date(),
): Promise<PulseUserTickerSignals> {
  const affinityCutoff = new Date(
    now.getTime() - RESEARCH_AFFINITY_WINDOW_MS,
  ).toISOString();
  const [marksResult, sessionsResult] = await Promise.all([
    supabase
      .from("user_company_marks")
      .select("ticker,coverage_level")
      .eq("user_id", userId)
      .limit(MAX_PREFERRED_TICKERS)
      .returns<CompanyMark[]>(),
    supabase
      .from("chat_sessions")
      .select("id, default_tickers, updated_at")
      .eq("user_id", userId)
      .eq("scope_type", "company")
      .is("deleted_at", null)
      .gte("updated_at", affinityCutoff)
      .order("updated_at", { ascending: false })
      .limit(MAX_RESEARCH_SESSIONS)
      .returns<RecentCompanySession[]>(),
  ]);
  if (marksResult.error) throw marksResult.error;
  if (sessionsResult.error) throw sessionsResult.error;

  const coverageByTicker = new Map<string, UserCompanyCoverageLevel>();
  const sessions = sessionsResult.data ?? [];
  const sessionIds = sessions.map((session) => session.id);
  const runsResult = sessionIds.length === 0
    ? { data: [] as CompletedCompanyRun[], error: null }
    : await supabase
      .from("agent_runs")
      .select("session_id,finished_at")
      .in("session_id", sessionIds)
      .eq("status", "completed")
      .gte("finished_at", affinityCutoff)
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(MAX_COMPLETED_RUNS)
      .returns<CompletedCompanyRun[]>();
  if (runsResult.error) throw runsResult.error;

  const researchAffinityByTicker = buildPulseResearchAffinities(
    sessions,
    runsResult.data ?? [],
    now,
  );
  const recentResearchTickers = new Set(
    [...researchAffinityByTicker.entries()]
      .filter(([, affinity]) => affinity.tier !== "history")
      .map(([ticker]) => ticker),
  );

  for (const mark of marksResult.data ?? []) {
    const ticker = normalizeTicker(mark.ticker);
    if (!ticker) continue;
    if (mark.coverage_level) coverageByTicker.set(ticker, mark.coverage_level);
  }

  const affinityTickers = [...researchAffinityByTicker.entries()]
    .filter(([, affinity]) => affinity.tier !== "history")
    .sort(([, left], [, right]) => right.score - left.score)
    .map(([ticker]) => ticker);

  return {
    coverageByTicker,
    recentResearchTickers,
    researchAffinityByTicker,
    preferredTickers: [...new Set([
      ...[...coverageByTicker.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ticker]) => ticker),
      ...affinityTickers,
    ])].slice(0, MAX_PREFERRED_TICKERS),
  };
}

/**
 * Keeps research affinity explainable and request-local. The score is based on
 * completed company conversations first. Extra completed runs are a bounded
 * depth signal, not a way for one long chat to outweigh repeated research.
 */
export function buildPulseResearchAffinities(
  sessions: RecentCompanySession[],
  runs: CompletedCompanyRun[],
  now = new Date(),
): Map<string, PulseResearchAffinity> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const byTicker = new Map<string, {
    completedRunCount: number;
    researchSessionIds: Set<string>;
    researchDays: Set<string>;
    latestCompletedAt: number;
  }>();

  for (const run of runs) {
    const session = sessionsById.get(run.session_id);
    const completedAt = run.finished_at ? Date.parse(run.finished_at) : Number.NaN;
    if (!session || Number.isNaN(completedAt)) continue;

    for (const rawTicker of session.default_tickers ?? []) {
      const ticker = normalizeTicker(rawTicker);
      if (!ticker) continue;
      const current = byTicker.get(ticker) ?? {
        completedRunCount: 0,
        researchSessionIds: new Set<string>(),
        researchDays: new Set<string>(),
        latestCompletedAt: completedAt,
      };
      current.completedRunCount += 1;
      current.researchSessionIds.add(session.id);
      current.researchDays.add(new Date(completedAt).toISOString().slice(0, 10));
      current.latestCompletedAt = Math.max(current.latestCompletedAt, completedAt);
      byTicker.set(ticker, current);
    }
  }

  return new Map([...byTicker.entries()].map(([ticker, value]) => {
    const ageDays = Math.max(0, now.getTime() - value.latestCompletedAt) / (24 * 60 * 60 * 1_000);
    const researchSessionCount = value.researchSessionIds.size;
    const depthRuns = Math.max(0, value.completedRunCount - researchSessionCount);
    const score = Math.min(
      20,
      Math.log1p(researchSessionCount) * 3.1
        + Math.min(value.researchDays.size, 6) * 1.15
        + Math.min(1.5, Math.log1p(depthRuns) * 0.45)
        + 6 * 0.5 ** (ageDays / RESEARCH_RECENCY_HALF_LIFE_DAYS),
    );
    return [ticker, {
      completed_run_count: value.completedRunCount,
      research_session_count: researchSessionCount,
      distinct_research_days: value.researchDays.size,
      latest_completed_at: new Date(value.latestCompletedAt).toISOString(),
      tier: researchContextTier({
        researchSessionCount,
        researchDayCount: value.researchDays.size,
        ageMs: Math.max(0, now.getTime() - value.latestCompletedAt),
      }),
      score: Number(score.toFixed(3)),
    }];
  }));
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
    researchAffinityByTicker: new Map(),
    preferredTickers: [],
  };
}

function filingReason(
  candidate: PulseCandidate,
  ticker: string | null,
  coverageLevel: UserCompanyCoverageLevel | null,
  hasRecentResearch: boolean,
  researchTier: PulseResearchContextTier,
): Pick<PulseCandidate, "reason_code" | "reason_label"> | null {
  if (candidate.kind !== "filing" || !ticker) return null;
  if (coverageLevel === "interest" && hasRecentResearch) {
    return {
      reason_code: "covered_research_followup",
      reason_label: researchTier === "strong"
        ? `관심 기업 ${ticker}의 리서치 흐름과 관련`
        : `최근 ${ticker} 리서치와 관련`,
    };
  }
  if (coverageLevel === "interest") {
    return {
      reason_code: "covered_new_filing",
      reason_label: `관심 기업 ${ticker}의 새 공시`,
    };
  }
  if (hasRecentResearch) {
    return {
      reason_code: "recent_research_followup",
      reason_label: researchTier === "strong"
        ? `${ticker} 리서치 흐름과 관련`
        : `최근 ${ticker} 리서치와 관련`,
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
    ?? selectResearchTicker(identities, signals.researchAffinityByTicker)
    ?? canonicalTicker;
  const coverageLevel = ticker ? signals.coverageByTicker.get(ticker) ?? null : null;
  const hasRecentResearch = identities.some((identity) =>
    signals.recentResearchTickers.has(identity));
  const researchAffinity = Math.max(
    0,
    ...identities.map((identity) => signals.researchAffinityByTicker.get(identity)?.score ?? 0),
  );
  const researchTier = selectResearchContextTier(identities, signals.researchAffinityByTicker, hasRecentResearch);
  const contextualized = candidate.kind === "filing" && ticker
    ? applyFilingTickerContext(candidate, ticker, canonicalTicker)
    : candidate;
  const personalizedReason = filingReason(
    contextualized,
    ticker,
    coverageLevel,
    hasRecentResearch,
    researchTier,
  );

  return {
    ...contextualized,
    coverage_level: coverageLevel,
    has_recent_research: hasRecentResearch,
    research_affinity: researchAffinity,
    metadata: {
      ...contextualized.metadata,
      has_recent_research: hasRecentResearch,
      research_context_tier: researchTier === "history" ? null : researchTier,
    },
    ...(personalizedReason ?? {}),
  };
}

function selectCoverageTicker(
  identities: string[],
  coverageByTicker: Map<string, UserCompanyCoverageLevel>,
): string | null {
  return identities.find((ticker) => coverageByTicker.has(ticker)) ?? null;
}

function selectResearchTicker(
  identities: string[],
  researchAffinityByTicker: Map<string, PulseResearchAffinity>,
): string | null {
  let selected: string | null = null;
  let selectedScore = 0;
  for (const ticker of identities) {
    const score = researchAffinityByTicker.get(ticker)?.score ?? 0;
    if (score > selectedScore) {
      selected = ticker;
      selectedScore = score;
    }
  }
  return selected;
}

function selectResearchContextTier(
  identities: string[],
  affinities: Map<string, PulseResearchAffinity>,
  fallbackRecent: boolean,
): PulseResearchContextTier {
  let selected: PulseResearchAffinity | null = null;
  for (const ticker of identities) {
    const affinity = affinities.get(ticker);
    if (!affinity || (selected && affinity.score <= selected.score)) continue;
    selected = affinity;
  }
  return selected?.tier ?? (fallbackRecent ? "recent" : "history");
}

function researchContextTier(params: {
  researchSessionCount: number;
  researchDayCount: number;
  ageMs: number;
}): PulseResearchContextTier {
  if (params.researchSessionCount >= 4 && params.researchDayCount >= 2) return "strong";
  if (params.researchSessionCount >= 2 || params.researchDayCount >= 2) return "active";
  if (params.ageMs <= RECENT_RESEARCH_WINDOW_MS) return "recent";
  return "history";
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

function normalizeTicker(value: string | null | undefined): string | null {
  const ticker = value?.trim().toUpperCase();
  return ticker || null;
}
