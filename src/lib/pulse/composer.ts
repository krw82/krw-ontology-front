import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  encodePulseCursor,
  isPulseCursorV2,
  type PulseCursorV2,
} from "@/lib/pulse/cursor";
import { isPulseSourceEnabled } from "@/lib/pulse/enabled";
import {
  encodePulseItemId,
  normalizePulseDateTime,
  PULSE_MAX_PAGE_SIZE,
  PULSE_PAGE_SIZE,
  pulseItemSchema,
  type PulseCandidate,
  type PulseRankedCandidate,
} from "@/lib/pulse/contract";
import { decodePulseCursor } from "@/lib/pulse/cursor";
import {
  applyPulseItemStates,
  getPulseItemStates,
  hasRecentKindImpression,
  markPulseItemsFirstSeen,
} from "@/lib/pulse/item-state";
import { getPulsePreferences } from "@/lib/pulse/preferences";
import {
  comparePulseSortKeys,
  rankPulseCandidates,
  reorderFirstPageWindow,
  sortKeyOf,
} from "@/lib/pulse/ranking";
import { selectLearningCandidate, buildLearningCandidates } from "@/lib/pulse/sources/learning";
import { getAnalysisCandidates } from "@/lib/pulse/sources/analysis";
import { getFilingCandidates } from "@/lib/pulse/sources/filings";
import { getQuestionCandidates } from "@/lib/pulse/sources/questions";
import { getRawResurfaceCandidates, selectResurfaceCandidate } from "@/lib/pulse/sources/resurface";
import { buildPulseSummary } from "@/lib/pulse/summary";
import type {
  PulseFeedResponse,
  PulseFilter,
  PulseItem,
  PulseItemKind,
  PulseSourceStatus,
} from "@/types/api-contracts";
import type { Database } from "@/types/database";

const SOURCE_KINDS = ["filing", "analysis", "question", "resurface", "learning"] as const satisfies readonly PulseItemKind[];

export interface ComposePulseFeedOptions {
  supabase: SupabaseClient<Database>;
  userId: string;
  includeNotebookSources: boolean;
  filter?: PulseFilter;
  cursor?: string | null;
  limit?: number;
  since?: string | null;
  now?: Date;
}

/**
 * Builds a deterministic, finite research inbox. Source retrieval is parallel;
 * no LLM, credit reservation, or new agent run is started from this path.
 */
export async function composePulseFeed({
  supabase,
  userId,
  includeNotebookSources,
  filter = "all",
  cursor,
  limit = PULSE_PAGE_SIZE,
  since,
  now = new Date(),
}: ComposePulseFeedOptions): Promise<PulseFeedResponse> {
  const decodedCursor = decodePulseCursor(cursor);
  const cursorV2 = isPulseCursorV2(decodedCursor) ? decodedCursor : null;
  const snapshotAt = cursorV2 ? new Date(cursorV2.snapshot_at) : now;
  const preferences = await getPulsePreferences(supabase, userId);
  const enabledKinds = new Set(preferences.enabled_kinds);
  const resurfaceCadence = preferences.resurface_cadence === "biweekly" ? "biweekly" : "weekly";

  const settled = await Promise.allSettled([
    loadSource("filing", enabledKinds.has("filing"), () => getFilingCandidates(supabase, userId, snapshotAt)),
    loadSource("analysis", enabledKinds.has("analysis"), () => getAnalysisCandidates(supabase, userId, snapshotAt)),
    loadSource(
      "question",
      includeNotebookSources
        && isQuestionCadenceDay(preferences.question_cadence, preferences.timezone, snapshotAt)
        && enabledKinds.has("question"),
      () => getQuestionCandidates(supabase, userId, snapshotAt),
    ),
    loadSource(
      "resurface",
      isPulseSourceEnabled("resurface")
        && includeNotebookSources
        && preferences.resurface_cadence !== "off"
        && preferences.resurfacing_enabled
        && enabledKinds.has("resurface"),
      () => getRawResurfaceCandidates(supabase, userId, snapshotAt),
    ),
    loadSource(
      "learning",
      isPulseSourceEnabled("learning")
        && preferences.learning_cadence !== "off"
        && preferences.learning_enabled
        && enabledKinds.has("learning"),
      async () => buildLearningCandidates(snapshotAt),
    ),
  ] as const);

  const sources = settled.map((result, index) => result.status === "fulfilled"
    ? result.value
    : { items: [], status: degradedStatus(SOURCE_KINDS[index]) });
  const sourceStatuses = sources.map((source) => source.status);
  const mutedTickers = new Set(preferences.muted_tickers);
  const sourceCandidates = sources
    .flatMap((source) => source.items)
    .filter((item) => !item.ticker || !mutedTickers.has(item.ticker))
    .filter((item) => filter === "all" || item.kind === filter);

  const holdingTickers = await getHoldingTickers(supabase, userId).catch(() => new Set<string>());
  const withHoldings = sourceCandidates.map((item) => ({
    ...item,
    is_holding: Boolean(item.ticker && holdingTickers.has(item.ticker)),
  }));
  const states = await getPulseItemStates(supabase, userId, withHoldings.map((item) => item.item_key));
  const stateful = applyPulseItemStates(withHoldings, states, snapshotAt, preferences.timezone);

  // Rotation follows per-item hidden/snoozed/fatigue state, ensuring a hidden
  // first candidate never makes the whole resurface/learning source disappear.
  const resurface = hasRecentKindImpression(
    states,
    "resurface",
    snapshotAt,
    preferences.timezone,
    28 * 24 * 60 * 60 * 1_000,
  )
    ? []
    : selectResurfaceCandidate(
      stateful.filter((item) => item.kind === "resurface"),
      userId,
      snapshotAt,
      resurfaceCadence,
    );
  const learning = hasRecentKindImpression(
    states,
    "learning",
    snapshotAt,
    preferences.timezone,
    7 * 24 * 60 * 60 * 1_000,
  )
    ? []
    : selectLearningCandidate(
      stateful.filter((item) => item.kind === "learning"),
      userId,
      snapshotAt,
    );
  const candidates = [
    ...stateful.filter((item) => item.kind !== "resurface" && item.kind !== "learning"),
    ...resurface,
    ...learning,
  ];
  const ranked = rankPulseCandidates(candidates, snapshotAt);
  const summary = buildPulseSummary(ranked);

  const afterBoundary = cursorV2
    ? ranked.filter((item) => comparePulseSortKeys(item, cursorV2.boundary) > 0)
    : ranked;
  const boundedLimit = Math.max(1, Math.min(limit, PULSE_MAX_PAGE_SIZE));
  const rawWindow = afterBoundary.slice(0, boundedLimit);
  const displayItems = cursorV2 ? rawWindow : reorderFirstPageWindow(rawWindow);

  await markPulseItemsFirstSeen(supabase, userId, rawWindow, snapshotAt).catch((error) => {
    console.warn("[pulse] failed to mark first delivered", {
      error_code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
    });
  });

  const nextCursor = rawWindow.length > 0 && afterBoundary.length > rawWindow.length
    ? encodePulseCursor(makeCursor(snapshotAt, sortKeyOf(rawWindow[rawWindow.length - 1])))
    : null;
  const sinceTime = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : null;

  return {
    generated_at: snapshotAt.toISOString(),
    snapshot_at: snapshotAt.toISOString(),
    timezone: preferences.timezone,
    date_label: formatDateLabel(snapshotAt, preferences.timezone),
    filter,
    summary,
    items: displayItems.map(toPublicItem),
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
    new_item_count: sinceTime === null
      ? 0
      : ranked.filter((item) => item.actionable
        && item.kind !== "learning"
        && item.kind !== "resurface"
        && Date.parse(item.available_at) > sinceTime).length,
    source_statuses: sourceStatuses,
  };
}

function toPublicItem(candidate: PulseRankedCandidate): PulseItem {
  const {
    item_key,
    is_holding,
    is_pinned,
    lane,
    priority_rank,
    holding_rank,
    saved_rank,
    ...item
  } = candidate;
  void is_holding;
  void is_pinned;
  void lane;
  void priority_rank;
  void holding_rank;
  void saved_rank;
  return pulseItemSchema.parse({
    ...item,
    id: encodePulseItemId(item_key),
    phase: item.phase ?? null,
    occurred_at: normalizePulseDateTime(item.occurred_at),
    available_at: normalizePulseDateTime(item.available_at),
    expires_at: normalizePulseDateTime(item.expires_at),
    reviewed_at: normalizePulseDateTime(item.reviewed_at),
    read_at: normalizePulseDateTime(item.read_at),
    saved_at: normalizePulseDateTime(item.saved_at),
    snoozed_until: normalizePulseDateTime(item.snoozed_until),
  });
}

function makeCursor(snapshotAt: Date, boundary: PulseCursorV2["boundary"]): PulseCursorV2 {
  return { version: 2, snapshot_at: snapshotAt.toISOString(), filter: "all", boundary };
}

async function loadSource(
  source: (typeof SOURCE_KINDS)[number],
  enabled: boolean,
  load: () => Promise<PulseCandidate[]>,
): Promise<{ items: PulseCandidate[]; status: PulseSourceStatus }> {
  if (!enabled) return { items: [], status: { source, status: "unavailable", item_count: 0 } };
  const startedAt = performance.now();
  const items = await load();
  return {
    items,
    status: {
      source,
      status: items.length > 0 ? "ready" : "empty",
      item_count: items.length,
      latency_ms: Math.round(performance.now() - startedAt),
    },
  };
}

function degradedStatus(source: (typeof SOURCE_KINDS)[number]): PulseSourceStatus {
  return { source, status: "degraded", item_count: 0 };
}

async function getHoldingTickers(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("user_company_marks")
    .select("ticker")
    .eq("user_id", userId)
    .eq("is_holding", true);
  if (error) throw error;
  return new Set(data.map((row) => row.ticker));
}

function formatDateLabel(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
}

function isQuestionCadenceDay(
  cadence: "daily" | "three_weekly" | "off",
  timezone: string,
  now: Date,
): boolean {
  if (cadence === "off") return false;
  if (cadence === "daily") return true;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  return weekday === "Mon" || weekday === "Wed" || weekday === "Fri";
}
