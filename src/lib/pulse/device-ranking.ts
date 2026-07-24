import type {
  PulseFeedResponse,
  PulseFeedSummary,
  PulseItem,
  PulseItemKind,
  PulseLinkAction,
} from "@/types/api-contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const SCORE_HALF_LIFE_DAYS = 30;
const MAX_TICKER_SCORES = 100;
const MAX_ITEM_EXPOSURES = 300;
const ITEM_EXPOSURE_RETENTION_MS = 60 * DAY_MS;
const ITEM_IGNORE_SUPPRESSION_MS = 7 * DAY_MS;
const RESURFACE_COOLDOWN_MS = 28 * DAY_MS;
const LEARNING_COOLDOWN_MS = 7 * DAY_MS;
const SCORE_LIMIT = 30;
const LOCAL_ADJUSTMENT_LIMIT = 12;
const LOCAL_RANK_SHIFT = 1.25;
const FLAT_MIX_TOP_WINDOW = 6;
const MAX_TOP_TICKER_COUNT = 2;
const MAX_COMPLETED_ANALYSIS_COUNT = 2;

export const PULSE_DEVICE_PROFILE_VERSION = 3;

export interface PulseDeviceScoreEntry {
  score: number;
  updated_at: string;
}

export interface PulseDeviceExposure {
  impression_count: number;
  last_seen_at: string;
  last_opened_at: string | null;
  source_opened_at: string | null;
  last_interacted_at: string | null;
}

/**
 * Private, account-scoped browser data. It holds no card copy or research
 * content and deliberately never synchronizes back to the server.
 */
export interface PulseDeviceProfile {
  version: typeof PULSE_DEVICE_PROFILE_VERSION;
  ranking_version: "rule_v5_flat";
  updated_at: string;
  sequence: number;
  ticker_scores: Record<string, PulseDeviceScoreEntry>;
  kind_scores: Partial<Record<PulseItemKind, PulseDeviceScoreEntry>>;
  item_exposures: Record<string, PulseDeviceExposure>;
}

export type PulseDeviceSignal =
  | "impression"
  | "open"
  | "source_open"
  | "save"
  | "unsave"
  | "review"
  | "unreview"
  | "snooze"
  | "dismiss";

export interface DevicePulseSlate {
  items: PulseItem[];
  summary: PulseFeedSummary;
}

export function createPulseDeviceProfile(now = new Date()): PulseDeviceProfile {
  return {
    version: PULSE_DEVICE_PROFILE_VERSION,
    ranking_version: "rule_v5_flat",
    updated_at: now.toISOString(),
    sequence: 0,
    ticker_scores: {},
    kind_scores: {},
    item_exposures: {},
  };
}

export function isPulseDeviceProfile(value: unknown): value is PulseDeviceProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Partial<PulseDeviceProfile>;
  return profile.version === PULSE_DEVICE_PROFILE_VERSION
    && profile.ranking_version === "rule_v5_flat"
    && typeof profile.updated_at === "string"
    && typeof profile.sequence === "number"
    && isRecord(profile.ticker_scores)
    && isRecord(profile.kind_scores)
    && isRecord(profile.item_exposures);
}

/** Lazily decays and bounds local state without any server request. */
export function normalizePulseDeviceProfile(
  input: PulseDeviceProfile,
  now = new Date(),
): PulseDeviceProfile {
  const profile = structuredClone(input);
  profile.ticker_scores = pruneScores(profile.ticker_scores, now, MAX_TICKER_SCORES);
  profile.kind_scores = pruneScores(profile.kind_scores, now, PULSE_ITEM_KINDS.length);
  profile.item_exposures = Object.fromEntries(
    Object.entries(profile.item_exposures)
      .filter(([, exposure]) => isExposure(exposure))
      .filter(([, exposure]) => Date.parse(exposure.last_seen_at) > now.getTime() - ITEM_EXPOSURE_RETENTION_MS)
      .sort(([, left], [, right]) => Date.parse(right.last_seen_at) - Date.parse(left.last_seen_at))
      .slice(0, MAX_ITEM_EXPOSURES),
  );
  profile.updated_at = now.toISOString();
  return profile;
}

export function applyPulseDeviceSignal(
  input: PulseDeviceProfile,
  item: Pick<PulseItem, "id" | "ticker" | "kind">,
  signal: PulseDeviceSignal,
  now = new Date(),
): PulseDeviceProfile {
  const profile = normalizePulseDeviceProfile(input, now);
  const nowIso = now.toISOString();
  const exposure = profile.item_exposures[item.id] ?? {
    impression_count: 0,
    last_seen_at: nowIso,
    last_opened_at: null,
    source_opened_at: null,
    last_interacted_at: null,
  };

  if (signal === "impression") {
    exposure.impression_count = Math.min(99, exposure.impression_count + 1);
    exposure.last_seen_at = nowIso;
  }
  if (signal === "open") {
    exposure.last_opened_at = nowIso;
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 3, 1, nowIso);
  }
  if (signal === "source_open") {
    exposure.source_opened_at = nowIso;
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 6, 2, nowIso);
  }
  if (signal === "save") {
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 8, 2, nowIso);
  }
  if (signal === "unsave") {
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, -8, -2, nowIso);
  }
  if (signal === "review") {
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 2, 0, nowIso);
  }
  if (signal === "unreview") {
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, -2, 0, nowIso);
  }
  if (signal === "snooze") {
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 1, 0, nowIso);
  }
  if (signal === "dismiss") applyScores(profile, item, 0, -2, nowIso);

  profile.item_exposures[item.id] = exposure;
  profile.sequence += 1;
  profile.updated_at = nowIso;
  return normalizePulseDeviceProfile(profile, now);
}

/**
 * Selects one continuous device slate from server-authorized candidates. Local
 * signals can move a card by about one position or suppress repeated work,
 * but they cannot replace the server's materiality order.
 */
export function selectDevicePulseSlate(
  feed: Pick<PulseFeedResponse, "candidate_items" | "active_analysis_items" | "visible_limit">,
  inputProfile: PulseDeviceProfile,
  now = new Date(),
): DevicePulseSlate {
  const profile = normalizePulseDeviceProfile(inputProfile, now);
  const candidatesById = new Map<string, PulseItem>();
  // Candidate items preserve the server's integrated score. Active analysis
  // items are present here in V5 and are retained as a fallback for an older
  // cached or partially synchronized response.
  for (const item of feed.candidate_items) candidatesById.set(item.id, item);
  for (const item of feed.active_analysis_items) {
    if (!candidatesById.has(item.id)) candidatesById.set(item.id, item);
  }

  const ordered = [...candidatesById.values()]
    .filter((item) => !isLocallySuppressed(item, profile, now))
    .map((item) => applyDeviceSeenState(item, profile))
    .sort((left, right) => compareItems(left, right, profile));
  // `visible_limit` counts visual entries after Form 4 composition. Keep the
  // authorized candidate buffer here so a same-day trade stack cannot consume
  // the entire device slate before the display layer has a chance to diversify
  // it. The UI applies the visual-entry limit after grouping.
  const items = mixFlatDeviceItems(ordered, ordered.length);

  return {
    items,
    summary: buildDevicePulseSummary(items, feed.active_analysis_items),
  };
}

export function buildDevicePulseSummary(
  items: PulseItem[],
  activeAnalysisItems: PulseItem[],
): PulseFeedSummary {
  const actionable = items.filter((item) => item.actionable && !item.reviewed_at);
  return {
    actionable_count: actionable.length,
    active_analysis_count: activeAnalysisItems.length,
    counts: {
      filing: countKind(actionable, "filing"),
      analysis: actionable.filter((item) => item.kind === "analysis" && item.phase !== "active").length,
      question: countKind(actionable, "question"),
      resurface: countKind(actionable, "resurface"),
    },
    primary_action: toLinkAction(actionable[0]?.primary_action),
  };
}

function mixFlatDeviceItems(items: PulseItem[], limit: number): PulseItem[] {
  const selected: PulseItem[] = [];
  const deferred: PulseItem[] = [];

  for (const item of items) {
    if (selected.length >= limit) break;
    if (canPlaceDeviceItem(item, selected, true)) selected.push(item);
    else deferred.push(item);
  }
  for (const item of deferred) {
    if (selected.length >= limit) break;
    if (canPlaceDeviceItem(item, selected, false)) selected.push(item);
  }
  return selected;
}

function canPlaceDeviceItem(item: PulseItem, selected: PulseItem[], strict: boolean): boolean {
  const completedAnalyses = selected.filter((candidate) =>
    candidate.kind === "analysis" && candidate.phase === "completed").length;
  if (item.kind === "analysis" && item.phase === "completed" && completedAnalyses >= MAX_COMPLETED_ANALYSIS_COUNT) {
    return false;
  }

  if (!strict || item.priority === "urgent" || selected.length >= FLAT_MIX_TOP_WINDOW) return true;
  if (item.feed_slot === "learning") return false;

  if (item.ticker) {
    const sameTicker = selected.filter((candidate) => candidate.ticker === item.ticker).length;
    if (sameTicker >= MAX_TOP_TICKER_COUNT) return false;
  }
  if (item.feed_slot === "discovery") {
    const discoveryCount = selected.filter((candidate) => candidate.feed_slot === "discovery").length;
    if (discoveryCount >= 1) return false;
  }
  if (isForm4(item)) {
    const existingForm4 = selected.filter(isForm4);
    if (existingForm4.length > 0 && !existingForm4.every((candidate) => sameCalendarDay(candidate, item))) {
      return false;
    }
  }

  const previous = selected.at(-1);
  if (!previous || previous.kind !== item.kind) return true;
  return isForm4(previous) && isForm4(item) && sameCalendarDay(previous, item);
}

function compareItems(left: PulseItem, right: PulseItem, profile: PulseDeviceProfile): number {
  const urgent = Number(right.priority === "urgent") - Number(left.priority === "urgent");
  if (urgent !== 0) return urgent;

  const leftAdjustedRank = left.server_rank - localRankShift(left, profile);
  const rightAdjustedRank = right.server_rank - localRankShift(right, profile);
  if (leftAdjustedRank !== rightAdjustedRank) return leftAdjustedRank - rightAdjustedRank;

  const local = localAdjustment(right, profile) - localAdjustment(left, profile);
  if (local !== 0) return local;
  const occurred = Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
  if (occurred !== 0) return occurred;
  return left.id.localeCompare(right.id);
}

function localRankShift(item: PulseItem, profile: PulseDeviceProfile): number {
  return localAdjustment(item, profile) / LOCAL_ADJUSTMENT_LIMIT * LOCAL_RANK_SHIFT;
}

function localAdjustment(item: PulseItem, profile: PulseDeviceProfile): number {
  const ticker = item.ticker ? profile.ticker_scores[item.ticker] : undefined;
  const kind = profile.kind_scores[item.kind];
  const exposure = profile.item_exposures[item.id];
  const engagement = exposure?.source_opened_at ? 2
    : exposure?.last_opened_at ? 1
      : exposure?.last_interacted_at ? 0.5 : 0;
  const fatigue = exposure && !exposure.last_opened_at && !exposure.source_opened_at && !exposure.last_interacted_at
    ? exposure.impression_count >= 3 ? 8 : exposure.impression_count === 2 ? 3 : 0
    : 0;
  return clamp(
    (ticker?.score ?? 0) * 0.45 + (kind?.score ?? 0) * 0.25 + engagement - fatigue,
    -LOCAL_ADJUSTMENT_LIMIT,
    LOCAL_ADJUSTMENT_LIMIT,
  );
}

function isLocallySuppressed(item: PulseItem, profile: PulseDeviceProfile, now: Date): boolean {
  const exposure = profile.item_exposures[item.id];
  if (!exposure) return false;
  const lastSeen = Date.parse(exposure.last_seen_at);
  if (item.kind === "analysis" && item.phase === "completed" && exposure.last_opened_at) return true;
  if (
    !exposure.last_opened_at
    && !exposure.source_opened_at
    && !exposure.last_interacted_at
    && exposure.impression_count >= 3
    && lastSeen > now.getTime() - ITEM_IGNORE_SUPPRESSION_MS
  ) {
    return true;
  }
  if (item.feed_slot === "resurface") return lastSeen > now.getTime() - RESURFACE_COOLDOWN_MS;
  if (item.feed_slot === "learning") return lastSeen > now.getTime() - LEARNING_COOLDOWN_MS;
  return false;
}

function applyDeviceSeenState(item: PulseItem, profile: PulseDeviceProfile): PulseItem {
  if (item.state !== "new" || !profile.item_exposures[item.id]) return item;
  return { ...item, state: "seen" };
}

function applyScores(
  profile: PulseDeviceProfile,
  item: Pick<PulseItem, "ticker" | "kind">,
  tickerDelta: number,
  kindDelta: number,
  updatedAt: string,
): void {
  if (item.ticker && tickerDelta !== 0) {
    profile.ticker_scores[item.ticker] = updateScore(
      profile.ticker_scores[item.ticker],
      tickerDelta,
      updatedAt,
    );
  }
  if (kindDelta !== 0) {
    profile.kind_scores[item.kind] = updateScore(
      profile.kind_scores[item.kind],
      kindDelta,
      updatedAt,
    );
  }
}

function updateScore(
  current: PulseDeviceScoreEntry | undefined,
  delta: number,
  updatedAt: string,
): PulseDeviceScoreEntry {
  return {
    score: clamp((current?.score ?? 0) + delta, -SCORE_LIMIT, SCORE_LIMIT),
    updated_at: updatedAt,
  };
}

function pruneScores<T extends Record<string, PulseDeviceScoreEntry | undefined>>(
  values: T,
  now: Date,
  limit: number,
): T {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, entry]) => isScoreEntry(entry))
      .map(([key, entry]) => {
        const scoreEntry = entry as PulseDeviceScoreEntry;
        return [key, {
          score: decayScore(scoreEntry.score, scoreEntry.updated_at, now),
          updated_at: scoreEntry.updated_at,
        }];
      })
      .filter(([, entry]) => Math.abs((entry as PulseDeviceScoreEntry).score) >= 0.5)
      .sort(([, left], [, right]) => Math.abs((right as PulseDeviceScoreEntry).score) - Math.abs((left as PulseDeviceScoreEntry).score))
      .slice(0, limit),
  ) as T;
}

function decayScore(score: number, updatedAt: string, now: Date): number {
  const elapsedDays = Math.max(0, now.getTime() - Date.parse(updatedAt)) / DAY_MS;
  return clamp(score * 0.5 ** (elapsedDays / SCORE_HALF_LIFE_DAYS), -SCORE_LIMIT, SCORE_LIMIT);
}

function isForm4(item: PulseItem): boolean {
  if (item.kind !== "filing") return false;
  const formType = String(item.metadata.form_type ?? "");
  return formType === "4" || formType === "4/A";
}

function sameCalendarDay(left: PulseItem, right: PulseItem): boolean {
  return left.occurred_at.slice(0, 10) === right.occurred_at.slice(0, 10);
}

function countKind(items: PulseItem[], kind: PulseItemKind): number {
  return items.filter((item) => item.kind === kind).length;
}

function toLinkAction(action: PulseItem["primary_action"] | undefined): PulseLinkAction | null {
  return action?.type === "link" ? action : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScoreEntry(value: unknown): value is PulseDeviceScoreEntry {
  return isRecord(value)
    && typeof value.score === "number"
    && Number.isFinite(value.score)
    && typeof value.updated_at === "string"
    && !Number.isNaN(Date.parse(value.updated_at));
}

function isExposure(value: unknown): value is PulseDeviceExposure {
  return isRecord(value)
    && typeof value.impression_count === "number"
    && Number.isFinite(value.impression_count)
    && typeof value.last_seen_at === "string"
    && !Number.isNaN(Date.parse(value.last_seen_at))
    && (value.last_opened_at === null || typeof value.last_opened_at === "string")
    && (value.source_opened_at === null || typeof value.source_opened_at === "string")
    && (value.last_interacted_at === null || typeof value.last_interacted_at === "string");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const PULSE_ITEM_KINDS: PulseItemKind[] = [
  "filing",
  "analysis",
  "checkup",
  "question",
  "resurface",
  "learning",
];
