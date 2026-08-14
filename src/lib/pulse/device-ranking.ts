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
const RESURFACE_COOLDOWN_MS = 28 * DAY_MS;
const LEARNING_CONSUMPTION_COOLDOWN_MS = 7 * DAY_MS;
const SCORE_LIMIT = 30;
const LOCAL_ADJUSTMENT_LIMIT = 12;
const LOCAL_RANK_SHIFT = 1.25;
const FLAT_MIX_TOP_WINDOW = 6;
const MAX_TOP_TICKER_COUNT = 2;
const MAX_COMPLETED_ANALYSIS_COUNT = 2;
const FORM4_STACK_TARGET_INDEX = 3;
const RECENT_STORY_EXCLUSION_GENERATIONS = 2;
const RECENT_REGULAR_SELECTION_GENERATIONS = 3;
const RECENT_NEWS_SELECTION_GENERATIONS = 2;
const TARGET_REGULAR_REFRESH_REPLACEMENT_COUNT = 3;
const TARGET_REBASE_REFRESH_REPLACEMENT_COUNT = 5;
const REGULAR_ANCHOR_REBASE_INTERVAL = 4;
const MIN_VISIBLE_NEWS = 4;
const MAX_VISIBLE_NEWS = 5;
const ABUNDANT_NEWS_CANDIDATE_COUNT = 8;
// The source may retain a wider five-day news reservoir, but Pulse renders a
// current-events first screen. Never spend one of its news slots on an issue
// older than two days when non-news work can fill the remaining space.
const NEWS_FIRST_SCREEN_FRESHNESS_MS = 48 * 60 * 60 * 1_000;

export const PULSE_DEVICE_PROFILE_VERSION = 7;

export interface PulseDeviceScoreEntry {
  score: number;
  updated_at: string;
}

/**
 * Exposure is intentionally private to this browser. A view is counted at
 * most once per local refresh generation, so one long scroll cannot make a
 * card disappear while the user is still looking at the same feed.
 */
export interface PulseDeviceExposure {
  impression_count: number;
  last_seen_at: string;
  last_seen_generation: number;
  /**
   * A refresh selection is not an impression. It only prevents the same
   * ordinary card from being chosen as a "new" replacement again immediately.
   */
  last_selected_generation: number;
  last_opened_at: string | null;
  source_opened_at: string | null;
  last_interacted_at: string | null;
  consumed_at: string | null;
}

export interface PulseDeviceStoryAnchor {
  item_id: string | null;
  anchored_at: string | null;
}

/**
 * Private, account-scoped browser data. It holds no card copy or research
 * content and deliberately never synchronizes back to the server. `device_id`
 * is a first-party cookie/local-storage identifier, not an account identifier.
 */
export interface PulseDeviceProfile {
  version: typeof PULSE_DEVICE_PROFILE_VERSION;
  ranking_version: "rule_v10_research_completion";
  device_id: string | null;
  updated_at: string;
  sequence: number;
  /** Advances only after a successful, intentional feed refresh. */
  refresh_generation: number;
  story_anchor: PulseDeviceStoryAnchor;
  ticker_scores: Record<string, PulseDeviceScoreEntry>;
  kind_scores: Partial<Record<PulseItemKind, PulseDeviceScoreEntry>>;
  item_exposures: Record<string, PulseDeviceExposure>;
}

/** A legacy client may still send `impression` during a rolling deploy. */
export type PulseDeviceSignal =
  | "view"
  | "impression"
  | "open"
  | "source_open"
  | "consume"
  | "save"
  | "unsave"
  | "review"
  | "unreview"
  | "snooze"
  | "dismiss";

export interface DevicePulseSlate {
  items: PulseItem[];
  summary: PulseFeedSummary;
  /** IDs selected for the current first screen, including rotating news. */
  refreshable_item_ids: string[];
  /** Aggregate context only; no ticker or account identifier is logged. */
  story_context: PulseStoryContext;
  refresh: {
    ordinary_visible_count: number;
    retained_ordinary_count: number;
    replacement_ordinary_count: number;
    cooldown_relaxed_count: number;
    mode: PulseRefreshMode;
    anchor_rebased: boolean;
  };
}

export type PulseStoryContext = "personal" | "editorial" | "explore" | "none";
export type PulseRefreshMode = "steady" | "rebase" | "none";

export function createPulseDeviceProfile(
  now = new Date(),
  deviceId: string | null = null,
): PulseDeviceProfile {
  return {
    version: PULSE_DEVICE_PROFILE_VERSION,
    ranking_version: "rule_v10_research_completion",
    device_id: deviceId,
    updated_at: now.toISOString(),
    sequence: 0,
    refresh_generation: 0,
    story_anchor: { item_id: null, anchored_at: null },
    ticker_scores: {},
    kind_scores: {},
    item_exposures: {},
  };
}

export function isPulseDeviceProfile(value: unknown): value is PulseDeviceProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Partial<PulseDeviceProfile>;
  return profile.version === PULSE_DEVICE_PROFILE_VERSION
    && profile.ranking_version === "rule_v10_research_completion"
    && (profile.device_id === null || typeof profile.device_id === "string")
    && typeof profile.updated_at === "string"
    && typeof profile.sequence === "number"
    && typeof profile.refresh_generation === "number"
    && isStoryAnchor(profile.story_anchor)
    && isRecord(profile.ticker_scores)
    && isRecord(profile.kind_scores)
    && isRecord(profile.item_exposures);
}

/**
 * A profile is intentionally device-local. If the first-party device id no
 * longer matches (new browser/profile reset), start a clean deterministic
 * ranking rather than accidentally importing behavior from another device.
 */
export function bindPulseDeviceProfileToDevice(
  input: PulseDeviceProfile,
  deviceId: string | null,
  now = new Date(),
): PulseDeviceProfile {
  const profile = normalizePulseDeviceProfile(input, now);
  // If privacy settings prevent a stable device identifier, do not quietly
  // reuse an account-scoped profile. A deterministic base feed is safer than
  // pretending this browser is the same device after storage was cleared.
  if (!deviceId) return createPulseDeviceProfile(now);
  if (profile.device_id && profile.device_id !== deviceId) {
    return createPulseDeviceProfile(now, deviceId);
  }
  if (profile.device_id === deviceId) return profile;
  return {
    ...profile,
    device_id: deviceId,
    updated_at: now.toISOString(),
  };
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
  if (!isStoryAnchor(profile.story_anchor)) {
    profile.story_anchor = { item_id: null, anchored_at: null };
  }
  profile.updated_at = now.toISOString();
  return profile;
}

/**
 * Records an intentional refresh generation. A viewed story loses its anchor
 * and may rotate; passive status polling and a failed request never call this
 * function. An unviewed story is not treated as a negative signal.
 */
export function advancePulseDeviceRefresh(
  input: PulseDeviceProfile,
  selectedItemIdsOrNow: readonly string[] | Date = [],
  suppliedNow = new Date(),
): PulseDeviceProfile {
  // Keep the former two-argument `(profile, now)` form valid for cached
  // callers during a rolling deploy while allowing the feed to commit the
  // visible ordinary-card set before it advances a generation.
  const selectedItemIds = selectedItemIdsOrNow instanceof Date ? [] : selectedItemIdsOrNow;
  const now = selectedItemIdsOrNow instanceof Date ? selectedItemIdsOrNow : suppliedNow;
  const profile = normalizePulseDeviceProfile(input, now);
  const nowIso = now.toISOString();
  for (const itemId of new Set(selectedItemIds)) {
    if (!itemId) continue;
    const exposure = profile.item_exposures[itemId] ?? createExposure(nowIso);
    exposure.last_selected_generation = profile.refresh_generation;
    profile.item_exposures[itemId] = exposure;
  }
  const anchorId = profile.story_anchor.item_id;
  const exposure = anchorId ? profile.item_exposures[anchorId] : null;
  const shouldReleaseStoryAnchor = Boolean(
    anchorId && exposure && exposure.last_seen_generation === profile.refresh_generation,
  );
  profile.refresh_generation = Math.min(Number.MAX_SAFE_INTEGER, profile.refresh_generation + 1);
  if (shouldReleaseStoryAnchor) {
    profile.story_anchor = { item_id: null, anchored_at: null };
  }
  profile.sequence += 1;
  profile.updated_at = now.toISOString();
  return profile;
}

export function applyPulseDeviceSignal(
  input: PulseDeviceProfile,
  item: Pick<PulseItem, "id" | "ticker" | "kind" | "feed_slot" | "metadata">,
  signal: PulseDeviceSignal,
  now = new Date(),
): PulseDeviceProfile {
  const profile = normalizePulseDeviceProfile(input, now);
  const nowIso = now.toISOString();
  const exposure = profile.item_exposures[item.id] ?? createExposure(nowIso);
  const isView = signal === "view" || signal === "impression";

  if (isView) {
    // A card can stay onscreen for minutes and re-render several times. Count
    // it once for this intentional refresh, not once for every render.
    if (exposure.last_seen_generation !== profile.refresh_generation) {
      exposure.impression_count = Math.min(99, exposure.impression_count + 1);
      exposure.last_seen_generation = profile.refresh_generation;
    }
    exposure.last_seen_at = nowIso;
    if (isEarlyCompanyStory(item) && profile.story_anchor.item_id === null) {
      profile.story_anchor = { item_id: item.id, anchored_at: nowIso };
    }
  }
  if (signal === "open") {
    exposure.last_opened_at = nowIso;
    exposure.last_interacted_at = nowIso;
    if (item.kind === "learning") exposure.consumed_at = nowIso;
    applyScores(profile, item, 3, 1, nowIso);
  }
  if (signal === "source_open") {
    exposure.source_opened_at = nowIso;
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 6, 2, nowIso);
  }
  if (signal === "consume") {
    exposure.consumed_at = nowIso;
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 4, 1, nowIso);
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
  if (signal === "dismiss") {
    exposure.last_interacted_at = nowIso;
    applyScores(profile, item, 0, -2, nowIso);
  }

  profile.item_exposures[item.id] = exposure;
  profile.sequence += 1;
  profile.updated_at = nowIso;
  return normalizePulseDeviceProfile(profile, now);
}

/**
 * The server authorizes the candidate reservoir; this function merely applies
 * bounded device-local ordering, a single story choice, and display-aware
 * Form 4 composition. It does not write to Supabase or infer new content.
 */
export function selectDevicePulseSlate(
  feed: Pick<PulseFeedResponse, "candidate_items" | "active_analysis_items" | "visible_limit">,
  inputProfile: PulseDeviceProfile,
  now = new Date(),
): DevicePulseSlate {
  const profile = normalizePulseDeviceProfile(inputProfile, now);
  const candidatesById = new Map<string, PulseItem>();
  for (const item of feed.candidate_items) candidatesById.set(item.id, item);
  // Active analysis is a compatibility fallback for an older cached response.
  for (const item of feed.active_analysis_items) {
    if (!candidatesById.has(item.id)) candidatesById.set(item.id, item);
  }
  const activeAnalysisIds = new Set([
    ...feed.active_analysis_items.map((item) => item.id),
    // A V5/V10 response can carry an active analysis in the candidate
    // reservoir as a compatibility fallback. It still belongs only in the
    // dedicated research activity rail.
    ...feed.candidate_items
      .filter((item) => item.kind === "analysis" && item.phase === "active")
      .map((item) => item.id),
  ]);

  const eligible = [...candidatesById.values()]
    // Active analyses render in the dedicated status rail, not again inside
    // the ordinary first-screen budget.
    .filter((item) => !activeAnalysisIds.has(item.id))
    .filter((item) => !isLocallySuppressed(item, profile, now))
    .map((item) => applyDeviceSeenState(item, profile));
  const earlyStories = eligible.filter(isEarlyCompanyStory);
  const selectedStory = selectCompanyStory(earlyStories, profile);
  const newsCandidates = eligible
    .filter((item) => item.kind === "news")
    .sort((left, right) => compareItems(left, right, profile));
  const selectedNews = selectNewsItems(newsCandidates, feed.visible_limit, profile, now);
  const selectedNewsIds = new Set(selectedNews.map((item) => item.id));
  const remainingNews = newsCandidates.filter((item) => !selectedNewsIds.has(item.id));
  const ordered = eligible
    .filter((item) => !isEarlyCompanyStory(item) && item.kind !== "news")
    .sort((left, right) => compareItems(left, right, profile));
  const composed = composeDisplayAwareSlate(
    ordered,
    selectedStory,
    selectedNews,
    remainingNews,
    profile,
    feed.visible_limit,
  );

  return {
    items: composed.items,
    summary: buildDevicePulseSummary(composed.items, feed.active_analysis_items),
    refreshable_item_ids: composed.refreshableItemIds,
    story_context: companyStoryContext(selectedStory),
    refresh: composed.refresh,
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
      news: countKind(actionable, "news"),
    },
    primary_action: toLinkAction(actionable[0]?.primary_action),
  };
}

function composeDisplayAwareSlate(
  ordered: PulseItem[],
  story: PulseItem | null,
  selectedNews: PulseItem[],
  remainingNews: PulseItem[],
  profile: PulseDeviceProfile,
  visibleLimit: number,
): {
  items: PulseItem[];
  refreshableItemIds: string[];
  refresh: DevicePulseSlate["refresh"];
} {
  const normalizedVisibleLimit = Math.max(0, Math.floor(visibleLimit));
  if (normalizedVisibleLimit === 0) {
    return {
      items: [],
      refreshableItemIds: [],
      refresh: emptyRefreshComposition(),
    };
  }
  const regularForm4 = ordered.filter(isRegularForm4);
  const base = regularForm4.length >= 2
    ? ordered.filter((item) => !isRegularForm4(item))
    : ordered;
  const mixed = mixFlatDeviceItems(base, base.length);
  const fixedDisplayEntryCount = Number(story !== null) + Number(regularForm4.length >= 2);
  const refreshWindow = selectRefreshableWindow(
    mixed,
    Math.max(0, normalizedVisibleLimit - fixedDisplayEntryCount - selectedNews.length),
    profile,
  );
  const withStory = story ? insertCompanyStory(refreshWindow.items, story, profile) : refreshWindow.items;

  const withFixedEntries = regularForm4.length < 2
    ? withStory
    : insertAtIndex(
      withStory,
      Math.min(
        Math.max(FORM4_STACK_TARGET_INDEX, leadingProtectedCount(withStory)),
        withStory.length,
      ),
      regularForm4,
    );
  const withNews = insertNewsItems(withFixedEntries, selectedNews, normalizedVisibleLimit, profile);

  // `buildPulseFeedDisplayEntries` turns this contiguous run into one visual
  // card. Putting it after a few distinct entries prevents one trading day
  // from consuming the first screen, while keeping every trade expandable.
  return {
    items: [...withNews, ...remainingNews],
    refreshableItemIds: [...refreshWindow.refreshableItemIds, ...selectedNews.map((item) => item.id)],
    refresh: refreshWindow.refresh,
  };
}

function selectRefreshableWindow(
  items: PulseItem[],
  requestedVisibleCount: number,
  profile: PulseDeviceProfile,
): {
  items: PulseItem[];
  refreshableItemIds: string[];
  refresh: DevicePulseSlate["refresh"];
} {
  const visibleCount = Math.min(Math.max(0, requestedVisibleCount), items.length);
  if (visibleCount === 0) {
    return {
      items,
      refreshableItemIds: [],
      refresh: emptyRefreshComposition(),
    };
  }

  const protectedItems = items.filter(isProtectedTopFeedItem).slice(0, visibleCount);
  const ordinaryItems = items.filter((item) => !isProtectedTopFeedItem(item));
  const ordinaryVisibleCount = Math.max(0, visibleCount - protectedItems.length);
  const mode = regularRefreshMode(profile);
  const requestedReplacements = Math.min(
    mode === "rebase"
      ? TARGET_REBASE_REFRESH_REPLACEMENT_COUNT
      : TARGET_REGULAR_REFRESH_REPLACEMENT_COUNT,
    ordinaryVisibleCount,
  );
  const window = mode === "rebase"
    ? selectRebasedOrdinaryWindow(
      ordinaryItems,
      ordinaryVisibleCount,
      requestedReplacements,
      profile,
    )
    : selectSteadyOrdinaryWindow(
      ordinaryItems,
      ordinaryVisibleCount,
      requestedReplacements,
      profile,
    );
  const ordinaryVisibleItems = window.items;
  const firstScreen = [...protectedItems, ...ordinaryVisibleItems];
  const firstScreenIds = new Set(firstScreen.map((item) => item.id));
  const tail = items.filter((item) => !firstScreenIds.has(item.id));
  const replacementOrdinaryCount = ordinaryVisibleItems.filter(
    (item) => !wasSelectedInPreviousGeneration(item, profile),
  ).length;

  return {
    items: [...firstScreen, ...tail],
    refreshableItemIds: ordinaryVisibleItems.map((item) => item.id),
    refresh: {
      ordinary_visible_count: ordinaryVisibleItems.length,
      retained_ordinary_count: ordinaryVisibleItems.length - replacementOrdinaryCount,
      replacement_ordinary_count: replacementOrdinaryCount,
      cooldown_relaxed_count: window.cooldownRelaxedCount,
      mode,
      anchor_rebased: mode === "rebase" && window.rebased,
    },
  };
}

function selectSteadyOrdinaryWindow(
  items: PulseItem[],
  visibleCount: number,
  requestedReplacements: number,
  profile: PulseDeviceProfile,
): { items: PulseItem[]; cooldownRelaxedCount: number; rebased: boolean } {
  const anchorCount = Math.max(0, visibleCount - requestedReplacements);
  const anchors = items.slice(0, anchorCount);
  const rotations = selectRotatingItems(items.slice(anchorCount), requestedReplacements, profile);
  return {
    items: fillOrdinaryWindow(
      interleaveAnchorsAndRotations(anchors, rotations.items, visibleCount),
      items,
      visibleCount,
    ),
    cooldownRelaxedCount: rotations.cooldownRelaxedCount,
    rebased: false,
  };
}

/**
 * The normal three-card rotation protects reading continuity. Every fourth
 * manual refresh, re-select the retained cards from the previous visible
 * window instead of preserving server ranks 1..N forever. That lets former
 * anchors leave the screen while keeping a useful majority in place.
 */
function selectRebasedOrdinaryWindow(
  items: PulseItem[],
  visibleCount: number,
  requestedReplacements: number,
  profile: PulseDeviceProfile,
): { items: PulseItem[]; cooldownRelaxedCount: number; rebased: boolean } {
  const previousVisible = items
    .filter((item) => wasSelectedInPreviousGeneration(item, profile))
    .sort((left, right) => compareItems(left, right, profile));
  if (previousVisible.length === 0) {
    return selectSteadyOrdinaryWindow(items, visibleCount, requestedReplacements, profile);
  }

  const retainCount = Math.max(0, visibleCount - requestedReplacements);
  const retained = stablePickRebasedRetainedItems(previousVisible, retainCount, profile)
    .sort((left, right) => compareItems(left, right, profile));
  const retainedIds = new Set(retained.map((item) => item.id));
  const rotations = selectRotatingItems(
    items.filter((item) => !retainedIds.has(item.id)),
    requestedReplacements,
    profile,
  );
  return {
    items: fillOrdinaryWindow(
      interleaveAnchorsAndRotations(retained, rotations.items, visibleCount),
      items,
      visibleCount,
    ),
    cooldownRelaxedCount: rotations.cooldownRelaxedCount,
    rebased: true,
  };
}

function stablePickRebasedRetainedItems(
  candidates: PulseItem[],
  count: number,
  profile: PulseDeviceProfile,
): PulseItem[] {
  const available = [...candidates];
  const selected: PulseItem[] = [];
  for (let slot = 0; slot < count && available.length > 0; slot += 1) {
    const index = stableIndex(
      `${profile.device_id ?? "new-device"}:${profile.refresh_generation}:rebase-retain:${slot}`,
      available.length,
    );
    const [picked] = available.splice(index, 1);
    if (picked) selected.push(picked);
  }
  return selected;
}

function fillOrdinaryWindow(
  selected: PulseItem[],
  candidates: PulseItem[],
  count: number,
): PulseItem[] {
  const selectedIds = new Set(selected.map((item) => item.id));
  const filled = [...selected];
  for (const candidate of candidates) {
    if (filled.length >= count) break;
    if (selectedIds.has(candidate.id)) continue;
    selectedIds.add(candidate.id);
    filled.push(candidate);
  }
  return filled;
}

function regularRefreshMode(profile: PulseDeviceProfile): PulseRefreshMode {
  return profile.refresh_generation > 0
    && profile.refresh_generation % REGULAR_ANCHOR_REBASE_INTERVAL === 0
    ? "rebase"
    : "steady";
}

function selectRotatingItems(
  candidates: PulseItem[],
  count: number,
  profile: PulseDeviceProfile,
): { items: PulseItem[]; cooldownRelaxedCount: number } {
  if (count <= 0 || candidates.length === 0) {
    return { items: [], cooldownRelaxedCount: 0 };
  }
  const fresh = candidates.filter((item) => !wasSelectedRecently(item, profile));
  const selected = stablePickItems(fresh, count, profile, "fresh");
  if (selected.length >= count) return { items: selected, cooldownRelaxedCount: 0 };

  // A small or temporarily stale reservoir must never turn into a blank feed.
  // Reuse the least-recently selected alternative only after all fresh choices
  // are exhausted, and surface the fact through refresh telemetry.
  const selectedIds = new Set(selected.map((item) => item.id));
  const fallbackCandidates = candidates
    .filter((item) => !selectedIds.has(item.id))
    .sort((left, right) => compareByOldestSelection(left, right, profile));
  const fallback = stablePickItems(
    fallbackCandidates,
    count - selected.length,
    profile,
    "cooldown-fallback",
  );
  return {
    items: [...selected, ...fallback],
    cooldownRelaxedCount: fallback.length,
  };
}

function stablePickItems(
  candidates: PulseItem[],
  count: number,
  profile: PulseDeviceProfile,
  seedNamespace: string,
): PulseItem[] {
  const available = [...candidates];
  const selected: PulseItem[] = [];
  for (let slot = 0; slot < count && available.length > 0; slot += 1) {
    const topBandSize = Math.min(FLAT_MIX_TOP_WINDOW, available.length);
    const index = stableIndex(
      `${profile.device_id ?? "new-device"}:${profile.refresh_generation}:${seedNamespace}:${slot}`,
      topBandSize,
    );
    const [picked] = available.splice(index, 1);
    if (picked) selected.push(picked);
  }
  return selected;
}

function interleaveAnchorsAndRotations(
  anchors: PulseItem[],
  rotations: PulseItem[],
  count: number,
): PulseItem[] {
  const rotationSlots = new Set(rotationSlotIndexes(count, rotations.length));
  const selected: PulseItem[] = [];
  let anchorIndex = 0;
  let rotationIndex = 0;
  for (let position = 0; position < count; position += 1) {
    const rotated = rotationSlots.has(position) ? rotations[rotationIndex++] : undefined;
    const anchor = rotated ? undefined : anchors[anchorIndex++];
    const next = rotated ?? anchor;
    if (next) selected.push(next);
  }
  // The normal loop covers the expected case. This preserves a useful screen
  // if an unusually sparse source provided fewer anchors than expected.
  for (const remaining of [...anchors.slice(anchorIndex), ...rotations.slice(rotationIndex)]) {
    if (selected.length >= count) break;
    selected.push(remaining);
  }
  return selected;
}

function rotationSlotIndexes(count: number, rotationCount: number): number[] {
  if (count <= 0 || rotationCount <= 0) return [];
  const slots = new Set<number>();
  for (let index = 1; index <= rotationCount; index += 1) {
    const requested = Math.floor(index * count / (rotationCount + 1));
    slots.add(Math.min(count - 1, Math.max(0, requested)));
  }
  return [...slots];
}

function wasSelectedRecently(item: PulseItem, profile: PulseDeviceProfile): boolean {
  const selectedGeneration = profile.item_exposures[item.id]?.last_selected_generation;
  return typeof selectedGeneration === "number"
    && selectedGeneration >= 0
    && selectedGeneration >= profile.refresh_generation - RECENT_REGULAR_SELECTION_GENERATIONS;
}

function wasSelectedInPreviousGeneration(item: PulseItem, profile: PulseDeviceProfile): boolean {
  return profile.item_exposures[item.id]?.last_selected_generation === profile.refresh_generation - 1;
}

function compareByOldestSelection(
  left: PulseItem,
  right: PulseItem,
  profile: PulseDeviceProfile,
): number {
  const leftGeneration = profile.item_exposures[left.id]?.last_selected_generation ?? -1;
  const rightGeneration = profile.item_exposures[right.id]?.last_selected_generation ?? -1;
  if (leftGeneration !== rightGeneration) return leftGeneration - rightGeneration;
  return left.server_rank - right.server_rank || left.id.localeCompare(right.id);
}

function emptyRefreshComposition(): DevicePulseSlate["refresh"] {
  return {
    ordinary_visible_count: 0,
    retained_ordinary_count: 0,
    replacement_ordinary_count: 0,
    cooldown_relaxed_count: 0,
    mode: "none",
    anchor_rebased: false,
  };
}

function selectCompanyStory(items: PulseItem[], profile: PulseDeviceProfile): PulseItem | null {
  if (items.length === 0) return null;
  const anchored = profile.story_anchor.item_id
    ? items.find((item) => item.id === profile.story_anchor.item_id)
    : undefined;
  if (anchored) return anchored;

  // Do not immediately cycle a user back to a story they have just seen. A
  // two-refresh window makes a pull-to-refresh sequence feel genuinely mixed
  // when several stories are active; with a smaller pool it safely falls back
  // instead of creating a gap.
  const unseenRecently = items.filter((item) => {
    const seenGeneration = profile.item_exposures[item.id]?.last_seen_generation;
    return seenGeneration === undefined
      || seenGeneration < profile.refresh_generation - RECENT_STORY_EXCLUSION_GENERATIONS;
  });
  const rotatingCandidates = (unseenRecently.length > 0 ? unseenRecently : items)
    .sort((left, right) => left.id.localeCompare(right.id));
  // The server labels each candidate as account-relevant, editorial, or
  // exploratory. The device applies that bounded mix locally, so a new
  // browser may reset safely without sending exposure history to Supabase.
  const seed = `${profile.device_id ?? "new-device"}:${profile.refresh_generation}:company-story`;
  return stableWeightedChoice(rotatingCandidates, seed, companyStoryWeight);
}

/**
 * News is intentionally chosen as a small, separately rotating lane. It
 * guarantees three cards whenever the reviewed-news reservoir has three
 * candidates, adds a fourth only with a healthy supply, and tries a personal
 * item before filling the remaining market context. All choice state remains
 * in the browser profile; no exposure history is uploaded.
 */
function selectNewsItems(
  candidates: PulseItem[],
  visibleLimit: number,
  profile: PulseDeviceProfile,
  now: Date,
): PulseItem[] {
  const timelyCandidates = candidates.filter((item) => isTimelyFirstScreenNews(item, now));
  const targetCount = targetNewsCount(timelyCandidates.length, visibleLimit);
  if (targetCount === 0) return [];
  const fresh = timelyCandidates.filter((item) => !wasNewsSelectedRecently(item, profile));
  const selected: PulseItem[] = [];
  const add = (items: PulseItem[], count: number, namespace: string) => {
    const selectedIds = new Set(selected.map((item) => item.id));
    const picks = stablePickWeightedNews(
      items.filter((item) => !selectedIds.has(item.id)),
      count,
      profile,
      namespace,
    );
    selected.push(...picks);
  };

  // A follow/watchlist or recent-research match is never a hard filter: cold
  // starts still receive market breadth, while a personal news item wins the
  // first available news position when one exists.
  add(fresh.filter(isPersonalNews), 1, "news-personal");
  add(fresh, targetCount - selected.length, "news-fresh");
  if (selected.length < targetCount) {
    const fallback = timelyCandidates
      .filter((item) => !selected.some((chosen) => chosen.id === item.id))
      .sort((left, right) => compareByOldestSelection(left, right, profile));
    add(fallback, targetCount - selected.length, "news-cooldown-fallback");
  }
  return selected.slice(0, targetCount);
}

function targetNewsCount(candidateCount: number, visibleLimit: number): number {
  const screenCapacity = Math.max(0, Math.floor(visibleLimit));
  if (candidateCount <= 0 || screenCapacity <= 0) return 0;
  const desired = candidateCount >= ABUNDANT_NEWS_CANDIDATE_COUNT
    ? MAX_VISIBLE_NEWS
    : MIN_VISIBLE_NEWS;
  return Math.min(desired, candidateCount, screenCapacity);
}

function isTimelyFirstScreenNews(item: PulseItem, now: Date): boolean {
  const occurredAt = Date.parse(item.occurred_at);
  if (!Number.isFinite(occurredAt)) return false;
  const age = now.getTime() - occurredAt;
  return age >= 0 && age <= NEWS_FIRST_SCREEN_FRESHNESS_MS;
}

function stablePickWeightedNews(
  candidates: PulseItem[],
  count: number,
  profile: PulseDeviceProfile,
  namespace: string,
): PulseItem[] {
  // `candidates` already carries the server's utility order, including
  // freshness. Do not replace it with ID order here: that allowed a 4-day-old
  // issue to win a first-screen slot over today's higher-ranked news.
  const available = [...candidates];
  const selected: PulseItem[] = [];
  for (let slot = 0; slot < count && available.length > 0; slot += 1) {
    const picked = stableWeightedChoice(
      available,
      `${profile.device_id ?? "new-device"}:${profile.refresh_generation}:${namespace}:${slot}`,
      newsSelectionWeight,
    );
    if (!picked) break;
    selected.push(picked);
    available.splice(available.findIndex((item) => item.id === picked.id), 1);
  }
  return selected;
}

function newsSelectionWeight(item: PulseItem): number {
  return 1
    + Number(item.feed_slot === "signal") * 4
    + Number(item.coverage_level === "interest") * 3
    + Number(item.metadata.market_issue_followed_match === true) * 5
    + Number(item.metadata.market_issue_personal_match === true) * 2
    + Number(item.metadata.market_issue_research_match === true) * 2
    + (item.priority === "high" ? 2 : item.priority === "normal" ? 1 : 0);
}

function isPersonalNews(item: PulseItem): boolean {
  return item.coverage_level === "interest"
    || item.feed_slot === "signal"
    || item.metadata.market_issue_followed_match === true
    || item.metadata.market_issue_personal_match === true
    || item.metadata.market_issue_research_match === true;
}

function wasNewsSelectedRecently(item: PulseItem, profile: PulseDeviceProfile): boolean {
  const selectedGeneration = profile.item_exposures[item.id]?.last_selected_generation;
  return typeof selectedGeneration === "number"
    && selectedGeneration >= 0
    && selectedGeneration >= profile.refresh_generation - RECENT_NEWS_SELECTION_GENERATIONS;
}

/** Places news through the first scroll, never in one consecutive block. */
function insertNewsItems(
  items: PulseItem[],
  news: PulseItem[],
  visibleLimit: number,
  profile: PulseDeviceProfile,
): PulseItem[] {
  const mixed = [...items];
  for (const [slot, item] of news.entries()) {
    const requested = requestedNewsIndex(slot, news.length, visibleLimit, profile);
    const insertionIndex = findNewsInsertionIndex(mixed, item, requested, visibleLimit);
    mixed.splice(insertionIndex, 0, item);
  }
  return mixed;
}

function requestedNewsIndex(
  slot: number,
  count: number,
  visibleLimit: number,
  profile: PulseDeviceProfile,
): number {
  const capacity = Math.max(1, Math.floor(visibleLimit));
  const evenlySpaced = Math.floor((slot + 1) * capacity / (count + 1));
  const jitter = stableIndex(
    `${profile.device_id ?? "new-device"}:${profile.refresh_generation}:news-position:${slot}`,
    3,
  ) - 1;
  return Math.max(0, Math.min(capacity - 1, evenlySpaced + jitter));
}

function findNewsInsertionIndex(
  items: PulseItem[],
  item: PulseItem,
  requested: number,
  visibleLimit: number,
): number {
  const minimum = leadingProtectedCount(items);
  const maximum = Math.min(items.length, Math.max(minimum, Math.floor(visibleLimit) - 1));
  const target = Math.max(minimum, Math.min(maximum, requested));
  const options = Array.from({ length: maximum - minimum + 1 }, (_, offset) => minimum + offset)
    .sort((left, right) => Math.abs(left - target) - Math.abs(right - target) || left - right);
  const nonAdjacent = options.find((index) => canInsertNewsAt(items, item, index, true));
  if (nonAdjacent !== undefined) return nonAdjacent;
  const distinctTicker = options.find((index) => canInsertNewsAt(items, item, index, false));
  return distinctTicker ?? target;
}

function canInsertNewsAt(
  items: PulseItem[],
  item: PulseItem,
  index: number,
  requireTickerDiversity: boolean,
): boolean {
  const previous = items[index - 1];
  const next = items[index];
  if (previous?.kind === "news" || next?.kind === "news") return false;
  if (!requireTickerDiversity || !item.ticker) return true;
  return previous?.ticker !== item.ticker && next?.ticker !== item.ticker;
}

function insertCompanyStory(
  items: PulseItem[],
  story: PulseItem,
  profile: PulseDeviceProfile,
): PulseItem[] {
  const requestedIndex = 1 + stableIndex(
    `${profile.device_id ?? "new-device"}:${profile.refresh_generation}:company-story-position`,
    2,
  );
  const insertAt = Math.min(
    Math.max(requestedIndex, leadingProtectedCount(items)),
    items.length,
  );
  return insertAtIndex(items, insertAt, [story]);
}

function leadingProtectedCount(items: PulseItem[]): number {
  let count = 0;
  for (const item of items) {
    if (!isProtectedTopFeedItem(item)) break;
    count += 1;
  }
  return count;
}

function isProtectedTopFeedItem(item: PulseItem): boolean {
  return item.priority === "urgent"
    || (item.kind === "analysis" && item.phase === "active");
}

function insertAtIndex<T>(items: T[], index: number, additions: T[]): T[] {
  const next = [...items];
  next.splice(index, 0, ...additions);
  return next;
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
  // Generic learning has a lower first-scroll priority. A chosen company
  // story has already been placed explicitly above this function.
  if (item.feed_slot === "learning") return false;

  if (item.ticker) {
    const sameTicker = selected.filter((candidate) => candidate.ticker === item.ticker).length;
    if (sameTicker >= MAX_TOP_TICKER_COUNT) return false;
  }
  if (item.feed_slot === "discovery") {
    const discoveryCount = selected.filter((candidate) => candidate.feed_slot === "discovery").length;
    if (discoveryCount >= 1) return false;
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
  const nowMs = now.getTime();
  if (item.kind === "analysis" && item.phase === "completed" && exposure.last_opened_at) return true;
  if (item.kind === "learning" && exposure.consumed_at && isRecent(exposure.consumed_at, nowMs, LEARNING_CONSUMPTION_COOLDOWN_MS)) {
    return true;
  }
  if (item.feed_slot === "resurface" && (exposure.last_opened_at || exposure.source_opened_at)) {
    return isRecent(exposure.last_opened_at ?? exposure.source_opened_at!, nowMs, RESURFACE_COOLDOWN_MS);
  }
  // Passive views only lower the local score. Suppressing ordinary cards here
  // made a Form 4-heavy candidate pool visibly run out of content after three
  // scrolls; refresh-window backfill handles limited supply without gaps.
  return false;
}

function isRecent(value: string, nowMs: number, windowMs: number): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > nowMs - windowMs;
}

function applyDeviceSeenState(item: PulseItem, profile: PulseDeviceProfile): PulseItem {
  const exposure = profile.item_exposures[item.id];
  // A selection record is deliberately not a visible impression. It should
  // guide refresh rotation without making an unseen card look read.
  if (item.state !== "new" || !exposure || exposure.impression_count <= 0) return item;
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

function isRegularForm4(item: PulseItem): boolean {
  return isForm4(item) && item.priority !== "urgent";
}

function isEarlyCompanyStory(item: Pick<PulseItem, "kind" | "feed_slot" | "metadata">): boolean {
  return item.kind === "learning"
    && item.feed_slot === "learning"
    && item.metadata.editorial_placement === "early";
}

function editorialPriority(item: PulseItem): number {
  const value = item.metadata.editorial_priority;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function editorialStoryWeight(item: PulseItem): number {
  return 1 + clamp(Math.round(editorialPriority(item)), 0, 4);
}

function companyStoryWeight(item: PulseItem): number {
  return editorialStoryWeight(item) + storyContextWeight(companyStoryContext(item));
}

function companyStoryContext(item: PulseItem | null): PulseStoryContext {
  if (!item) return "none";
  const role = item.metadata.editorial_candidate_role;
  if (role === "personal" || role === "explore" || role === "editorial") return role;
  // Cached V7 candidates did not carry an explicit role. Treat them as
  // editorial rather than relying on an account-specific client inference.
  return "editorial";
}

function storyContextWeight(context: PulseStoryContext): number {
  if (context === "personal") return 7;
  if (context === "editorial") return 3;
  if (context === "explore") return 1;
  return 0;
}

function stableWeightedChoice<T>(items: T[], seed: string, weightOf: (item: T) => number): T | null {
  if (items.length === 0) return null;
  const weights = items.map((item) => Math.max(1, weightOf(item)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = stableUnitInterval(seed) * total;
  for (const [index, weight] of weights.entries()) {
    cursor -= weight;
    if (cursor < 0) return items[index] ?? null;
  }
  return items.at(-1) ?? null;
}

function stableIndex(seed: string, size: number): number {
  if (size <= 1) return 0;
  return Math.floor(stableUnitInterval(seed) * size);
}

function stableUnitInterval(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 2 ** 32;
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

function isStoryAnchor(value: unknown): value is PulseDeviceStoryAnchor {
  return isRecord(value)
    && (value.item_id === null || typeof value.item_id === "string")
    && (value.anchored_at === null || typeof value.anchored_at === "string");
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
    && typeof value.last_seen_generation === "number"
    && Number.isFinite(value.last_seen_generation)
    && typeof value.last_selected_generation === "number"
    && Number.isFinite(value.last_selected_generation)
    && (value.last_opened_at === null || typeof value.last_opened_at === "string")
    && (value.source_opened_at === null || typeof value.source_opened_at === "string")
    && (value.last_interacted_at === null || typeof value.last_interacted_at === "string")
    && (value.consumed_at === null || typeof value.consumed_at === "string");
}

function createExposure(nowIso: string): PulseDeviceExposure {
  return {
    impression_count: 0,
    last_seen_at: nowIso,
    last_seen_generation: -1,
    last_selected_generation: -1,
    last_opened_at: null,
    source_opened_at: null,
    last_interacted_at: null,
    consumed_at: null,
  };
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
  "news",
];
