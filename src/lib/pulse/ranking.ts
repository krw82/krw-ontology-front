import type { PulseAnalysisPhase, PulseFeedSlot } from "@/types/api-contracts";
import {
  PULSE_PRIORITY_RANK,
  type PulseCandidate,
  type PulseRankedCandidate,
  type PulseSortKey,
} from "@/lib/pulse/contract";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const URGENT_FRESH_MS = 72 * HOUR_MS;
const TERMINAL_ANALYSIS_FRESH_MS = 7 * DAY_MS;
const FLAT_MIX_TOP_WINDOW = 6;
const MAX_TOP_TICKER_COUNT = 2;
const MAX_COMPLETED_ANALYSIS_COUNT = 2;
// News evidence decays exponentially: a story half-lives every 24 hours so a
// 5-day-old high-score issue cannot out-rank today's fresh news. Combined with
// the step freshnessScore this produces a deliberate double time penalty.
const NEWS_EVIDENCE_HALF_LIFE_HOURS = 24;

/**
 * The server ships an authorized reservoir, not a final rendered list. The
 * device later turns repeated Form 4 rows into one display entry and chooses
 * a single company story for its own browser.
 */
export const PULSE_CANDIDATE_POOL_MAX = 48;
// A Form 4 stack ultimately becomes one display card and one company story
// is selected on-device. Keep their reservoirs deliberately small so the
// server can still authorize a full screen of distinct ordinary cards.
const MAX_REGULAR_FORM4_CANDIDATES = 10;
const MAX_EARLY_EDITORIAL_CANDIDATES = 8;
// News has its own device-side three-to-four-card mixing rule. Preserve a
// larger source reservoir here so manual refresh can genuinely rotate news
// instead of repeatedly showing the same top three market issues.
const MAX_NEWS_CANDIDATES = 18;

/**
 * Produces a single utility order. `feed_slot` remains a reason/category for
 * analytics and safety constraints, but no longer determines visible sections
 * or a fixed slot quota.
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
  const reviewedAt = candidate.reviewed_at ?? candidate.judgment?.updated_at ?? null;
  const actionable = candidate.actionable ?? isActionableCandidate(candidate, phase, reviewedAt);
  const state = candidate.state ?? (reviewedAt ? "reviewed" : "new");

  return {
    ...candidate,
    phase,
    reviewed_at: reviewedAt,
    state,
    actionable,
    lane: getPulseLane(candidate, phase, now),
    rank_score: getRankScore(candidate, phase, actionable, reviewedAt, state, now),
    priority_rank: PULSE_PRIORITY_RANK[candidate.priority],
    coverage_rank: coverageRank(candidate.coverage_level),
    saved_rank: candidate.is_pinned || candidate.saved_at ? 0 : 1,
    feed_slot: classifyPulseFeedSlot(candidate, phase),
    server_rank: 0,
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
  reviewedAt = candidate.reviewed_at ?? candidate.judgment?.updated_at ?? null,
): boolean {
  if (reviewedAt) return false;
  if (
    candidate.kind === "filing"
    || candidate.kind === "question"
    || candidate.kind === "resurface"
    || candidate.kind === "news"
  ) return true;
  return candidate.kind === "analysis" && phase !== "active";
}

/**
 * A small tie-break/safety band, not a visible lane. The utility score remains
 * the primary order so a highly relevant completed analysis can sit naturally
 * between filings rather than after a whole feed section.
 */
export function getPulseLane(
  candidate: PulseCandidate,
  phase: PulseAnalysisPhase | null,
  now: Date,
): number {
  const ageMs = Math.max(0, now.getTime() - Date.parse(candidate.occurred_at));
  if (candidate.kind === "filing" && candidate.priority === "urgent" && ageMs <= URGENT_FRESH_MS) return 0;
  if (candidate.kind === "analysis" && phase === "active") return 5;
  if (candidate.kind === "learning") return 40;
  return 10;
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
  if (left.rank_score !== right.rank_score) return right.rank_score - left.rank_score;
  if (left.priority_rank !== right.priority_rank) return left.priority_rank - right.priority_rank;
  if (left.lane !== right.lane) return left.lane - right.lane;
  if (left.coverage_rank !== right.coverage_rank) return left.coverage_rank - right.coverage_rank;
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
    coverage_rank,
    saved_rank,
    occurred_at,
    item_key,
  } = candidate;
  return { lane, rank_score, priority_rank, coverage_rank, saved_rank, occurred_at, item_key };
}

/**
 * Converts the scored server candidates into one ordered list. The rules make
 * the first scroll varied without exposing category controls to the user.
 */
export function buildPulseCandidatePool(
  ranked: PulseRankedCandidate[],
  now = new Date(),
): PulseRankedCandidate[] {
  // Sources (including the optional development showcase) may be composed in
  // parallel. Re-establish the utility order here rather than relying on the
  // caller's concatenation order.
  const available = ranked
    .filter((candidate) => !candidate.reviewed_at && !isStaleTerminalAnalysis(candidate, now))
    .sort(compareRankedCandidates);
  // Form 4 rows collapse to a single display card later. Retain a bounded
  // expansion set for that card, but reserve the rest of the reservoir for
  // distinct filings/questions so the feed can still fill one useful screen.
  // Early company stories are also kept as alternatives; the browser picks a
  // single stable one and rotates only after an intentional refresh.
  const earlyEditorial = available
    .filter(isEarlyEditorialCandidate)
    .slice(0, MAX_EARLY_EDITORIAL_CANDIDATES);
  const regularForm4 = available
    .filter(isRegularForm4Candidate)
    .slice(0, MAX_REGULAR_FORM4_CANDIDATES);
  const news = available
    .filter((candidate) => candidate.kind === "news")
    .slice(0, MAX_NEWS_CANDIDATES);
  const reservedKeys = new Set([
    ...earlyEditorial.map((candidate) => candidate.item_key),
    ...regularForm4.map((candidate) => candidate.item_key),
    ...news.map((candidate) => candidate.item_key),
  ]);
  const mainCapacity = Math.max(
    0,
    PULSE_CANDIDATE_POOL_MAX - earlyEditorial.length - regularForm4.length - news.length,
  );
  const mainCandidates = mixFlatCandidates(
    available.filter((candidate) =>
      !reservedKeys.has(candidate.item_key)
      && !isRegularForm4Candidate(candidate)
      && !isEarlyEditorialCandidate(candidate)
      && candidate.kind !== "news"),
    mainCapacity,
  );
  // Keep the mixer order for ordinary candidates. Re-sorting here would undo
  // its top-six diversity guarantees before the device receives the reservoir.
  const selected = [...mainCandidates, ...regularForm4, ...earlyEditorial, ...news]
    .slice(0, PULSE_CANDIDATE_POOL_MAX);

  return selected.map((candidate, serverRank) => ({
    ...candidate,
    feed_slot: classifyPulseFeedSlot(candidate, candidate.phase),
    server_rank: serverRank,
  }));
}

export function classifyPulseFeedSlot(
  candidate: Pick<PulseCandidate, "kind" | "coverage_level" | "has_recent_research" | "linked_thesis" | "metadata">,
  phase: PulseAnalysisPhase | null = null,
): PulseFeedSlot {
  if (candidate.kind === "news") {
    const personal = isActiveCoverage(candidate.coverage_level)
      || Boolean(candidate.has_recent_research)
      || candidate.metadata.market_issue_followed_match === true
      || candidate.metadata.market_issue_personal_match === true;
    return personal ? "signal" : "news";
  }
  if (candidate.kind === "learning") return "learning";
  if (candidate.kind === "resurface") {
    return candidate.metadata.monitoring_rule_type === "scheduled_review"
      ? "continue"
      : "resurface";
  }
  if (candidate.kind === "analysis" || candidate.kind === "question" || candidate.kind === "checkup") {
    return "continue";
  }
  if (candidate.kind === "filing") {
    const personal = isActiveCoverage(candidate.coverage_level)
      || Boolean(candidate.has_recent_research)
      || Boolean(candidate.linked_thesis)
      || hasMonitoringRuleMatch(candidate);
    return personal ? "signal" : "discovery";
  }
  void phase;
  return "continue";
}

function mixFlatCandidates(
  candidates: PulseRankedCandidate[],
  limit: number,
): PulseRankedCandidate[] {
  const selected: PulseRankedCandidate[] = [];
  const deferred: PulseRankedCandidate[] = [];

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (canPlace(candidate, selected, true)) {
      selected.push(candidate);
    } else {
      deferred.push(candidate);
    }
  }

  // When a user has only one kind of useful work, never leave blank space just
  // to preserve a diversity ideal. Relax only soft top-of-feed constraints.
  for (const candidate of deferred) {
    if (selected.length >= limit) break;
    if (canPlace(candidate, selected, false)) selected.push(candidate);
  }

  return selected;
}

function canPlace(
  candidate: PulseRankedCandidate,
  selected: PulseRankedCandidate[],
  strict: boolean,
): boolean {
  const completedAnalyses = selected.filter((item) =>
    item.kind === "analysis" && item.phase === "completed").length;
  if (
    candidate.kind === "analysis"
    && candidate.phase === "completed"
    && completedAnalyses >= MAX_COMPLETED_ANALYSIS_COUNT
  ) {
    return false;
  }

  if (!strict || candidate.priority === "urgent" || selected.length >= FLAT_MIX_TOP_WINDOW) {
    return true;
  }

  if (candidate.feed_slot === "learning") return false;

  if (candidate.ticker) {
    const sameTicker = selected.filter((item) => item.ticker === candidate.ticker).length;
    if (sameTicker >= MAX_TOP_TICKER_COUNT) return false;
  }

  if (candidate.feed_slot === "discovery") {
    const discoveryCount = selected.filter((item) => item.feed_slot === "discovery").length;
    if (discoveryCount >= 1) return false;
  }

  if (isForm4(candidate)) {
    const existingForm4 = selected.filter(isForm4);
    if (existingForm4.length > 0 && !existingForm4.every((item) => sameCalendarDay(item, candidate))) {
      return false;
    }
  }

  const previous = selected.at(-1);
  if (!previous || previous.kind !== candidate.kind) return true;
  // Several same-day Form 4 filings intentionally become one compact stack in
  // the client, so they are not treated as repetitive adjacent cards.
  return isForm4(previous) && isForm4(candidate) && sameCalendarDay(previous, candidate);
}

function isStaleTerminalAnalysis(candidate: PulseRankedCandidate, now: Date): boolean {
  if (candidate.kind !== "analysis" || candidate.phase === "active") return false;
  const age = Math.max(0, now.getTime() - Date.parse(candidate.occurred_at));
  if (candidate.phase === "failed") return age > 3 * DAY_MS;
  return age > TERMINAL_ANALYSIS_FRESH_MS;
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

function isForm4(candidate: Pick<PulseCandidate, "kind" | "metadata">): boolean {
  if (candidate.kind !== "filing") return false;
  const formType = String(candidate.metadata.form_type ?? "");
  return formType === "4" || formType === "4/A";
}

function isRegularForm4Candidate(candidate: PulseRankedCandidate): boolean {
  return isForm4(candidate) && candidate.priority !== "urgent";
}

function isEarlyEditorialCandidate(candidate: PulseRankedCandidate): boolean {
  return candidate.kind === "learning"
    && candidate.metadata.editorial_placement === "early";
}

function sameCalendarDay(left: PulseRankedCandidate, right: PulseRankedCandidate): boolean {
  return left.occurred_at.slice(0, 10) === right.occurred_at.slice(0, 10);
}

function getRankScore(
  candidate: PulseCandidate,
  phase: PulseAnalysisPhase | null,
  actionable: boolean,
  reviewedAt: string | null,
  state: PulseRankedCandidate["state"],
  now: Date,
): number {
  if (reviewedAt) return 0;

  const materiality = candidate.priority === "urgent"
    ? 25
    : candidate.priority === "high" ? 18 : candidate.priority === "normal" ? 11 : 4;
  const researchAffinity = researchAffinityRankScore(
    candidate.research_affinity ?? (candidate.has_recent_research ? 6 : 0),
  );
  const userRelevance = Math.min(
    25,
    coverageScore(candidate.coverage_level)
      + researchAffinity
      + (candidate.linked_thesis ? 7 : 0)
      + (hasMonitoringRuleMatch(candidate) ? 6 : 0)
      + (candidate.saved_at || candidate.is_pinned ? 4 : 0)
      + newsPersonalizationScore(candidate),
  );
  const continuity = candidate.kind === "analysis"
    ? phase === "completed" ? 18 : phase === "active" ? 12 : 2
    : candidate.kind === "question" ? (hasQuestionEvidence(candidate) ? 10 : 5)
      : candidate.kind === "resurface" ? 6 : actionable ? 3 : 0;
  const evidence = candidate.kind === "filing"
    ? candidate.metadata.filing_brief_ready === true ? 6 : isDigestFiling(candidate) ? 1 : 3
    : candidate.kind === "question" && hasQuestionEvidence(candidate) ? 4
      : candidate.kind === "news" ? newsTimeDecayedScore(candidate, now) : 0;
  const seenPenalty = state === "seen" ? 6 : 0;

  return Math.max(
    0,
    materiality + userRelevance + continuity + evidence
      + freshnessScore(candidate.occurred_at, now) - seenPenalty,
  );
}

function isActiveCoverage(level: PulseCandidate["coverage_level"]): boolean {
  return level !== null;
}

function coverageRank(level: PulseCandidate["coverage_level"]): number {
  return level === "interest" ? 0 : 1;
}

function coverageScore(level: PulseCandidate["coverage_level"]): number {
  return level === "interest" ? 15 : 0;
}

/**
 * Affinity is generated on a 0–20 session-based scale. Compress it only at
 * ranking time so repeated conversations remain distinguishable while a
 * manually selected interest company still has the strongest single signal.
 */
function researchAffinityRankScore(value: number): number {
  return Math.min(14, Math.log1p(Math.max(0, value)) * 4.6);
}

function hasMonitoringRuleMatch(candidate: Pick<PulseCandidate, "metadata">): boolean {
  const value = candidate.metadata.monitoring_rule_match_count ?? candidate.metadata.rule_match_count;
  return typeof value === "number" ? value > 0 : value === true || value === "true";
}

function hasQuestionEvidence(candidate: PulseCandidate): boolean {
  const value = candidate.metadata.evidence_count ?? candidate.metadata.has_new_evidence;
  return typeof value === "number" ? value > 0 : value === true || value === "true";
}

function newsPersonalizationScore(candidate: PulseCandidate): number {
  if (candidate.kind !== "news") return 0;
  return candidate.metadata.market_issue_followed_match === true ? 5
    : candidate.metadata.market_issue_personal_match === true ? 3 : 0;
}

/**
 * @deprecated Superseded by {@link newsTimeDecayedScore} which applies an
 * exponential time decay so stale high-score issues yield to fresh news.
 * Retained for reference and potential non-news reuse.
 */
function newsEvidenceScore(candidate: PulseCandidate): number {
  const sources = numericMetadata(candidate, "market_issue_source_count");
  const official = numericMetadata(candidate, "market_issue_official_source_count");
  const score = numericMetadata(candidate, "market_issue_market_score");
  return Math.min(8, Math.min(3, sources) + Math.min(2, official) + Math.min(3, Math.floor(score / 35)));
}

/**
 * Time-decayed news evidence score. Same static evidence base as
 * {@link newsEvidenceScore}, multiplied by an exponential decay weight
 * (half-life = {@link NEWS_EVIDENCE_HALF_LIFE_HOURS}) so the score halves
 * every 24 hours. This prevents a days-old high-market-score story from
 * burying today's fresh news in the ranked feed.
 *
 * Decay weights: 0h=1.0, 12h≈0.71, 24h=0.5, 48h=0.25, 72h≈0.125, 5d≈0.03.
 */
function newsTimeDecayedScore(candidate: PulseCandidate, now: Date): number {
  const marketScore = numericMetadata(candidate, "market_issue_market_score");
  const sources = numericMetadata(candidate, "market_issue_source_count");
  const official = numericMetadata(candidate, "market_issue_official_source_count");
  const evidenceBase = Math.min(3, sources) + Math.min(2, official) + Math.min(3, Math.floor(marketScore / 35));
  const occurredMs = Date.parse(candidate.occurred_at);
  if (!Number.isFinite(occurredMs)) return 0;
  const ageHours = Math.max(0, now.getTime() - occurredMs) / HOUR_MS;
  const decayWeight = Math.pow(0.5, ageHours / NEWS_EVIDENCE_HALF_LIFE_HOURS);
  return Math.min(8, evidenceBase * decayWeight);
}

function numericMetadata(candidate: PulseCandidate, key: string): number {
  const value = candidate.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function freshnessScore(occurredAt: string, now: Date): number {
  const parsed = Date.parse(occurredAt);
  if (Number.isNaN(parsed)) return 0;
  const ageHours = Math.max(0, now.getTime() - parsed) / HOUR_MS;
  if (ageHours <= 6) return 18;
  if (ageHours <= 24) return 14;
  if (ageHours <= 72) return 9;
  if (ageHours <= 7 * 24) return 4;
  return 0;
}
