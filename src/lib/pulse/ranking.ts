import {
  PULSE_BASE_SCORES,
  PULSE_PRIORITY_SCORES,
  type PulseCandidate,
  type PulseRankedCandidate,
} from "@/lib/pulse/contract";

const UNREAD_BOOST = 40;
const PINNED_BOOST = 60;
const HOLDING_BOOST = 20;
const URGENT_DIVERSITY_EXEMPTION = "urgent";

export function scorePulseCandidate(candidate: PulseCandidate): number {
  return (
    PULSE_BASE_SCORES[candidate.kind] +
    PULSE_PRIORITY_SCORES[candidate.priority] +
    (candidate.read_at ? 0 : UNREAD_BOOST) +
    (candidate.is_pinned ? PINNED_BOOST : 0) +
    (candidate.is_holding ? HOLDING_BOOST : 0)
  );
}

export function rankPulseCandidates(
  candidates: PulseCandidate[],
  now = new Date(),
): PulseRankedCandidate[] {
  const scored = candidates
    .filter((candidate) => {
      const available = Date.parse(candidate.available_at);
      const expires = candidate.expires_at ? Date.parse(candidate.expires_at) : null;
      const current = now.getTime();
      return available <= current && (expires === null || expires > current);
    })
    .map((candidate) => ({
      ...candidate,
      score: scorePulseCandidate(candidate),
    }))
    .sort(compareRankedCandidates);

  return enforceFirstPageDiversity(scored);
}

export function compareRankedCandidates(
  left: PulseRankedCandidate,
  right: PulseRankedCandidate,
): number {
  if (left.score !== right.score) return right.score - left.score;
  const occurredDiff = Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
  if (occurredDiff !== 0) return occurredDiff;
  return left.item_key.localeCompare(right.item_key);
}

/**
 * Keeps the first screen useful without hiding candidates: deferred items retain
 * their relative order and rejoin immediately after the protected window.
 */
export function enforceFirstPageDiversity(
  ranked: PulseRankedCandidate[],
): PulseRankedCandidate[] {
  const protectedWindow: PulseRankedCandidate[] = [];
  const deferred: PulseRankedCandidate[] = [];
  const tickerCounts = new Map<string, number>();
  let learningCount = 0;

  for (const candidate of ranked) {
    if (protectedWindow.length >= 10) {
      deferred.push(candidate);
      continue;
    }

    const ticker = candidate.ticker;
    const tickerCount = ticker ? tickerCounts.get(ticker) ?? 0 : 0;
    const tickerAllowed =
      protectedWindow.length >= 8 ||
      !ticker ||
      tickerCount < 2 ||
      candidate.priority === URGENT_DIVERSITY_EXEMPTION;
    const learningAllowed = candidate.kind !== "learning" || learningCount < 1;

    if (!tickerAllowed || !learningAllowed) {
      deferred.push(candidate);
      continue;
    }

    protectedWindow.push(candidate);
    if (ticker && protectedWindow.length <= 8) {
      tickerCounts.set(ticker, tickerCount + 1);
    }
    if (candidate.kind === "learning") learningCount += 1;
  }

  return [...protectedWindow, ...deferred];
}
