import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decodePulseCursor, encodeLegacyPulseCursor } from "@/lib/pulse/cursor";
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
import {
  applyPulseItemStates,
  getPulseItemStates,
  markPulseItemsFirstSeen,
} from "@/lib/pulse/item-state";
import { getPulsePreferences } from "@/lib/pulse/preferences";
import { rankPulseCandidates } from "@/lib/pulse/ranking";
import { buildCheckupCandidate } from "@/lib/pulse/sources/checkup";
import { getFilingCandidates } from "@/lib/pulse/sources/filings";
import { buildLearningCandidates } from "@/lib/pulse/sources/learning";
import { getQuestionCandidates } from "@/lib/pulse/sources/questions";
import {
  getRawResurfaceCandidates,
  selectResurfaceCandidate,
} from "@/lib/pulse/sources/resurface";
import { buildPulseSummary } from "@/lib/pulse/summary";
import type {
  PulseFeedResponse,
  PulseFilter,
  PulseItem,
  PulseItemKind,
  PulseSourceStatus,
} from "@/types/api-contracts";
import type { Database } from "@/types/database";

/**
 * The pre-v2 composer is retained for exactly one release behind
 * `PULSE_P0_V2_ENABLED`. It is intentionally isolated from the v2 composer so
 * an operational rollback does not change state tables or require a migration.
 */
export async function composeLegacyPulseFeed({
  supabase,
  userId,
  includeNotebookSources,
  filter = "all",
  cursor,
  limit = PULSE_PAGE_SIZE,
  since,
  now = new Date(),
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  includeNotebookSources: boolean;
  filter?: PulseFilter;
  cursor?: string | null;
  limit?: number;
  since?: string | null;
  now?: Date;
}): Promise<PulseFeedResponse> {
  const preferences = await getPulsePreferences(supabase, userId);
  const enabledKinds = new Set(preferences.enabled_kinds);
  const resurfaceCadence =
    preferences.resurface_cadence === "biweekly" ? "biweekly" : "weekly";
  const sourceKinds: PulseItemKind[] = [
    "filing",
    "question",
    "resurface",
    "learning",
  ];
  const settled = await Promise.allSettled([
    loadSource("filing", enabledKinds.has("filing"), () =>
      getFilingCandidates(supabase, userId, now),
    ),
    loadSource(
      "question",
      includeNotebookSources &&
        isQuestionCadenceDay(
          preferences.question_cadence,
          preferences.timezone,
          now,
        ) &&
        enabledKinds.has("question"),
      () => getQuestionCandidates(supabase, userId, now),
    ),
    loadSource(
      "resurface",
      isPulseSourceEnabled("resurface") &&
        includeNotebookSources &&
        preferences.resurface_cadence !== "off" &&
        preferences.resurfacing_enabled &&
        enabledKinds.has("resurface"),
      async () =>
        selectResurfaceCandidate(
          await getRawResurfaceCandidates(supabase, userId, now),
          userId,
          now,
          resurfaceCadence,
        ),
    ),
    loadSource(
      "learning",
      isPulseSourceEnabled("learning") &&
        preferences.learning_cadence !== "off" &&
        preferences.learning_enabled &&
        enabledKinds.has("learning"),
      async () => buildLearningCandidates(now),
    ),
  ] as const);
  const sources = settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          items: [],
          status: {
            source: sourceKinds[index],
            status: "degraded" as const,
            item_count: 0,
          },
        },
  );
  const sourceStatuses: PulseSourceStatus[] = sources.map(
    (source) => source.status,
  );
  const sourceCandidates = sources.flatMap((source) => source.items);
  const checkup =
    preferences.daily_checkup_enabled && enabledKinds.has("checkup")
      ? buildCheckupCandidate(
          {
            urgentFilings: sourceCandidates.filter(
              (item) =>
                item.kind === "filing" &&
                item.priority === "urgent" &&
                !item.read_at,
            ).length,
            unreadFilings: sourceCandidates.filter(
              (item) => item.kind === "filing" && !item.read_at,
            ).length,
            openQuestions: sourceCandidates.filter(
              (item) => item.kind === "question",
            ).length,
            staleNotes: sourceCandidates.filter(
              (item) => item.kind === "resurface",
            ).length,
          },
          preferences.timezone,
          now,
          preferences.daily_checkup_at,
        )
      : null;
  sourceStatuses.push({
    source: "checkup",
    status: checkup ? "ready" : "empty",
    item_count: checkup ? 1 : 0,
  });

  const mutedTickers = new Set(preferences.muted_tickers);
  const filtered = [...sourceCandidates, ...(checkup ? [checkup] : [])]
    .filter((item) => !item.ticker || !mutedTickers.has(item.ticker))
    .filter((item) => filter === "all" || item.kind === filter);
  const holdingTickers = await getHoldingTickers(supabase, userId).catch(
    () => new Set<string>(),
  );
  const withHoldings = filtered.map((item) => ({
    ...item,
    is_holding: Boolean(item.ticker && holdingTickers.has(item.ticker)),
  }));
  const states = await getPulseItemStates(
    supabase,
    userId,
    withHoldings.map((item) => item.item_key),
  );
  const stateful = applyPulseItemStates(
    withHoldings,
    states,
    now,
    preferences.timezone,
  );
  const decodedCursor = decodePulseCursor(cursor);
  const cursorV1 =
    decodedCursor?.version === 1 && decodedCursor.filter === filter
      ? decodedCursor
      : null;
  const offset = cursorV1?.offset ?? 0;
  const rankedAt = cursorV1 ? new Date(cursorV1.generated_at) : now;
  const ranked = rankPulseCandidates(
    stateful.filter(
      (item) => Date.parse(item.available_at) <= rankedAt.getTime(),
    ),
    rankedAt,
  );
  const boundedLimit = Math.max(1, Math.min(limit, PULSE_MAX_PAGE_SIZE));
  const page = ranked.slice(offset, offset + boundedLimit);
  await markPulseItemsFirstSeen(supabase, userId, page, now).catch(
    () => undefined,
  );
  const nextOffset = offset + page.length;
  const generatedAt = rankedAt.toISOString();
  const nextCursor =
    nextOffset < ranked.length
      ? encodeLegacyPulseCursor({
          version: 1,
          offset: nextOffset,
          filter,
          generated_at: generatedAt,
        })
      : null;
  const sinceTime =
    since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : null;

  return {
    generated_at: generatedAt,
    snapshot_at: generatedAt,
    timezone: preferences.timezone,
    date_label: formatDateLabel(now, preferences.timezone),
    filter,
    summary: buildPulseSummary(ranked),
    items: page.map(toPublicItem),
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
    new_item_count:
      sinceTime === null
        ? 0
        : ranked.filter((item) => Date.parse(item.available_at) > sinceTime)
            .length,
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
    occurred_at: normalizePulseDateTime(item.occurred_at),
    available_at: normalizePulseDateTime(item.available_at),
    expires_at: normalizePulseDateTime(item.expires_at),
    reviewed_at: normalizePulseDateTime(item.reviewed_at),
    read_at: normalizePulseDateTime(item.read_at),
    saved_at: normalizePulseDateTime(item.saved_at),
    snoozed_until: normalizePulseDateTime(item.snoozed_until),
  });
}

async function loadSource(
  source: PulseItemKind,
  enabled: boolean,
  load: () => Promise<PulseCandidate[]>,
): Promise<{ items: PulseCandidate[]; status: PulseSourceStatus }> {
  if (!enabled)
    return {
      items: [],
      status: { source, status: "unavailable", item_count: 0 },
    };
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
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(now);
  return weekday === "Mon" || weekday === "Wed" || weekday === "Fri";
}
