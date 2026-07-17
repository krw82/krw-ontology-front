import type { PulseAnalysisPhase } from "@/types/api-contracts";
import {
  PULSE_PRIORITY_RANK,
  type PulseCandidate,
  type PulseRankedCandidate,
  type PulseSortKey,
} from "@/lib/pulse/contract";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const URGENT_FRESH_MS = 72 * HOUR_MS;
const FILING_FRESH_MS = 7 * DAY_MS;
const DIGEST_FRESH_MS = 3 * DAY_MS;
const TERMINAL_ANALYSIS_FRESH_MS = 7 * DAY_MS;
const DISCOVERY_WINDOW_SIZE = 10;

/**
 * Lane order is intentionally categorical rather than a weighted score. A
 * lower number always wins; preference boosts only break ties inside a lane.
 */
export function rankPulseCandidates(
  candidates: PulseCandidate[],
  now = new Date(),
): PulseRankedCandidate[] {
  return candidates
    .filter((candidate) => isAvailable(candidate, now))
    .map((candidate) => toRankedCandidate(candidate, now))
    .sort(compareRankedCandidates);
}

export function toRankedCandidate(
  candidate: PulseCandidate,
  now = new Date(),
): PulseRankedCandidate {
  const phase = getAnalysisPhase(candidate);
  const reviewedAt = candidate.reviewed_at ?? candidate.read_at;
  const actionable = candidate.actionable ?? isActionableCandidate(candidate, phase, reviewedAt);
  const state = candidate.state ?? (reviewedAt ? "reviewed" : "new");
  const lane = reviewedAt ? 90 : getPulseLane(candidate, phase, now);

  return {
    ...candidate,
    phase,
    reviewed_at: reviewedAt,
    read_at: candidate.read_at ?? reviewedAt,
    state,
    actionable,
    lane,
    rank_score: getRankScore(candidate, phase, actionable, reviewedAt, now),
    priority_rank: PULSE_PRIORITY_RANK[candidate.priority],
    holding_rank: candidate.is_holding ? 0 : 1,
    saved_rank: candidate.is_pinned || candidate.saved_at ? 0 : 1,
  };
}

export function getAnalysisPhase(candidate: PulseCandidate): PulseAnalysisPhase | null {
  if (candidate.kind !== "analysis") return null;
  if (candidate.phase) return candidate.phase;
  const status = String(candidate.metadata.run_status ?? "");
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "active";
}

export function isActionableCandidate(
  candidate: PulseCandidate,
  phase = getAnalysisPhase(candidate),
  reviewedAt = candidate.reviewed_at ?? candidate.read_at,
): boolean {
  if (reviewedAt) return false;
  if (candidate.kind === "filing" || candidate.kind === "question" || candidate.kind === "resurface") return true;
  return candidate.kind === "analysis" && phase !== "active";
}

export function getPulseLane(
  candidate: PulseCandidate,
  phase: PulseAnalysisPhase | null,
  now: Date,
): number {
  const ageMs = Math.max(0, now.getTime() - Date.parse(candidate.occurred_at));
  if (candidate.kind === "filing") {
    if (candidate.priority === "urgent" && ageMs <= URGENT_FRESH_MS) return 0;
    if (isDigestFiling(candidate) && ageMs <= DIGEST_FRESH_MS) return 12;
    if (!isDigestFiling(candidate) && ageMs <= FILING_FRESH_MS) return 10;
    return 15;
  }
  if (candidate.kind === "analysis") {
    if (phase === "active") return 30;
    return ageMs <= TERMINAL_ANALYSIS_FRESH_MS ? 20 : 25;
  }
  if (candidate.kind === "question") return 25;
  if (candidate.kind === "resurface") return 40;
  if (candidate.kind === "learning") return 50;
  return 90;
}

export function compareRankedCandidates(
  left: PulseRankedCandidate,
  right: PulseRankedCandidate,
): number {
  return comparePulseSortKeys(left, right);
}

export function comparePulseSortKeys(
  left: PulseSortKey,
  right: PulseSortKey,
): number {
  if (left.lane !== right.lane) return left.lane - right.lane;
  if (left.rank_score !== right.rank_score) return right.rank_score - left.rank_score;
  if (left.priority_rank !== right.priority_rank) return left.priority_rank - right.priority_rank;
  if (left.holding_rank !== right.holding_rank) return left.holding_rank - right.holding_rank;
  if (left.saved_rank !== right.saved_rank) return left.saved_rank - right.saved_rank;
  const occurredDiff = Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
  if (occurredDiff !== 0) return occurredDiff;
  return left.item_key.localeCompare(right.item_key);
}

export function sortKeyOf(candidate: PulseRankedCandidate): PulseSortKey {
  const {
    lane,
    rank_score,
    priority_rank,
    holding_rank,
    saved_rank,
    occurred_at,
    item_key,
  } = candidate;
  return { lane, rank_score, priority_rank, holding_rank, saved_rank, occurred_at, item_key };
}

/**
 * Diversity is a display-only pass. Call this only with the already bounded
 * first raw page window so it cannot alter keyset pagination boundaries.
 */
export function reorderFirstPageWindow(
  rawWindow: PulseRankedCandidate[],
): PulseRankedCandidate[] {
  const protectedWindow: PulseRankedCandidate[] = [];
  const deferred: PulseRankedCandidate[] = [];
  const tickerCounts = new Map<string, number>();
  let learningCount = 0;

  for (const candidate of rawWindow) {
    if (protectedWindow.length >= 10) {
      deferred.push(candidate);
      continue;
    }

    const ticker = candidate.ticker;
    const tickerCount = ticker ? tickerCounts.get(ticker) ?? 0 : 0;
    const tickerAllowed =
      protectedWindow.length >= 8
      || !ticker
      || tickerCount < 2
      || candidate.priority === "urgent";
    const learningAllowed = candidate.kind !== "learning" || learningCount < 1;

    if (!tickerAllowed || !learningAllowed) {
      deferred.push(candidate);
      continue;
    }

    protectedWindow.push(candidate);
    if (ticker && protectedWindow.length <= 8) tickerCounts.set(ticker, tickerCount + 1);
    if (candidate.kind === "learning") learningCount += 1;
  }

  return reserveDiscoverySlot([...protectedWindow, ...deferred]);
}

// Compatibility export retained for tests and any temporary callers. New code
// must only call it with a bounded first-page window.
export const enforceFirstPageDiversity = reorderFirstPageWindow;

/**
 * One catalog-discovery item earns a late first-screen slot when the bounded
 * candidate RPC supplied one. It never moves ahead of an urgent filing, so the
 * feed remains an inbox before it becomes a discovery surface.
 */
function reserveDiscoverySlot(
  candidates: PulseRankedCandidate[],
): PulseRankedCandidate[] {
  if (candidates.slice(0, DISCOVERY_WINDOW_SIZE).some(isDiscoveryCandidate)) return candidates;
  const discoveryIndex = candidates.findIndex(isDiscoveryCandidate);
  if (discoveryIndex < DISCOVERY_WINDOW_SIZE) return candidates;

  const destination = candidates
    .slice(0, DISCOVERY_WINDOW_SIZE)
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.priority !== "urgent")
    .at(-1)?.index;
  if (destination === undefined) return candidates;

  const next = [...candidates];
  const [discovery] = next.splice(discoveryIndex, 1);
  if (!discovery) return candidates;
  next.splice(destination, 0, discovery);
  return next;
}

function isDiscoveryCandidate(candidate: PulseRankedCandidate): boolean {
  return candidate.kind === "filing" && candidate.metadata.candidate_bucket === "discovery";
}

function isAvailable(candidate: PulseCandidate, now: Date): boolean {
  const available = Date.parse(candidate.available_at);
  const expires = candidate.expires_at ? Date.parse(candidate.expires_at) : null;
  const current = now.getTime();
  return available <= current && (expires === null || expires > current);
}

function isDigestFiling(candidate: PulseCandidate): boolean {
  return candidate.kind === "filing" && String(candidate.metadata.alert_priority ?? "") === "digest";
}

function getRankScore(
  candidate: PulseCandidate,
  phase: PulseAnalysisPhase | null,
  actionable: boolean,
  reviewedAt: string | null,
  now: Date,
): number {
  if (reviewedAt) return 0;

  const materiality = candidate.priority === "urgent"
    ? 35
    : candidate.priority === "high" ? 25 : candidate.priority === "normal" ? 15 : 8;
  const userRelevance = Math.min(
    30,
    (candidate.is_holding ? 18 : 0)
      + (candidate.is_watchlisted ? 10 : 0)
      + (candidate.has_recent_research ? 8 : 0)
      + (candidate.saved_at || candidate.is_pinned ? 5 : 0),
  );
  const actionValue = actionable ? 10 : phase === "active" ? 6 : 0;

  return materiality + userRelevance + actionValue + freshnessScore(candidate.occurred_at, now);
}

function freshnessScore(occurredAt: string, now: Date): number {
  const parsed = Date.parse(occurredAt);
  if (Number.isNaN(parsed)) return 0;
  const ageHours = Math.max(0, now.getTime() - parsed) / HOUR_MS;
  if (ageHours <= 6) return 20;
  if (ageHours <= 24) return 16;
  if (ageHours <= 72) return 10;
  if (ageHours <= 7 * 24) return 4;
  return 0;
}
