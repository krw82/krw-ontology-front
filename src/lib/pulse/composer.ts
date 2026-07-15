import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { encodePulseCursor, decodePulseCursor } from "@/lib/pulse/cursor";
import { isPulseSourceEnabled } from "@/lib/pulse/enabled";
import {
  encodePulseItemId,
  PULSE_MAX_PAGE_SIZE,
  PULSE_PAGE_SIZE,
  pulseItemSchema,
  type PulseCandidate,
} from "@/lib/pulse/contract";
import { applyPulseItemStates, getPulseItemStates, markPulseItemsFirstSeen } from "@/lib/pulse/item-state";
import { getPulsePreferences } from "@/lib/pulse/preferences";
import { rankPulseCandidates } from "@/lib/pulse/ranking";
import { buildCheckupCandidate } from "@/lib/pulse/sources/checkup";
import { getFilingCandidates } from "@/lib/pulse/sources/filings";
import { buildLearningCandidates } from "@/lib/pulse/sources/learning";
import { getQuestionCandidates } from "@/lib/pulse/sources/questions";
import { getResurfaceCandidates } from "@/lib/pulse/sources/resurface";
import type {
  PulseFeedResponse,
  PulseFilter,
  PulseItemKind,
  PulseSourceStatus,
} from "@/types/api-contracts";
import type { Database } from "@/types/database";

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
  const preferences = await getPulsePreferences(supabase, userId);
  const resurfaceCadence = preferences.resurface_cadence === "biweekly" ? "biweekly" : "weekly";
  const enabledKinds = new Set(preferences.enabled_kinds);
  const sourceKinds: PulseItemKind[] = ["filing", "question", "resurface", "learning"];
  const settledSources = await Promise.allSettled([
    settleSource("filing", enabledKinds.has("filing"), () => getFilingCandidates(supabase, userId, now)),
    settleSource("question", includeNotebookSources && isQuestionCadenceDay(preferences.question_cadence, preferences.timezone, now) && enabledKinds.has("question"), () => getQuestionCandidates(supabase, userId, now)),
    settleSource("resurface", isPulseSourceEnabled("resurface") && includeNotebookSources && preferences.resurface_cadence !== "off" && preferences.resurfacing_enabled && enabledKinds.has("resurface"), () => getResurfaceCandidates(supabase, userId, now, resurfaceCadence)),
    settleSource("learning", isPulseSourceEnabled("learning") && preferences.learning_cadence !== "off" && preferences.learning_enabled && enabledKinds.has("learning"), async () => buildLearningCandidates(now)),
  ]);
  const sources = settledSources.map((result, index) => result.status === "fulfilled"
    ? result.value
    : {
        items: [],
        status: { source: sourceKinds[index], status: "degraded" as const, item_count: 0 },
      });
  const sourceStatuses: PulseSourceStatus[] = sources.map((source) => source.status);
  const sourceCandidates = sources.flatMap((source) => source.items);

  const checkup = preferences.daily_checkup_enabled && enabledKinds.has("checkup")
    ? buildCheckupCandidate({
        urgentFilings: sourceCandidates.filter((item) => item.kind === "filing" && item.priority === "urgent" && !item.read_at).length,
        unreadFilings: sourceCandidates.filter((item) => item.kind === "filing" && !item.read_at).length,
        openQuestions: sourceCandidates.filter((item) => item.kind === "question").length,
        staleNotes: sourceCandidates.filter((item) => item.kind === "resurface").length,
      }, preferences.timezone, now, preferences.daily_checkup_at)
    : null;
  sourceStatuses.push({
    source: "checkup",
    status: checkup ? "ready" : "empty",
    item_count: checkup ? 1 : 0,
  });

  const muted = new Set(preferences.muted_tickers);
  const filteredCandidates = [...sourceCandidates, ...(checkup ? [checkup] : [])]
    .filter((item) => !item.ticker || !muted.has(item.ticker))
    .filter((item) => filter === "all" || item.kind === filter);
  const holdingTickers = await getHoldingTickers(supabase, userId).catch(() => new Set<string>());
  const candidates = filteredCandidates.map((item) => ({
    ...item,
    is_holding: Boolean(item.ticker && holdingTickers.has(item.ticker)),
  }));
  const states = await getPulseItemStates(supabase, userId, candidates.map((item) => item.item_key));
  const stateful = applyPulseItemStates(candidates, states, now);
  const decodedCursor = decodePulseCursor(cursor);
  const offset = decodedCursor?.filter === filter ? decodedCursor.offset : 0;
  const rankedAt = decodedCursor?.filter === filter
    ? new Date(decodedCursor.generated_at)
    : now;
  const ranked = rankPulseCandidates(
    stateful.filter((item) => Date.parse(item.available_at) <= rankedAt.getTime()),
    rankedAt,
  );
  const boundedLimit = Math.max(1, Math.min(limit, PULSE_MAX_PAGE_SIZE));
  const page = ranked.slice(offset, offset + boundedLimit);
  await markPulseItemsFirstSeen(supabase, userId, page, now).catch((error) => {
    console.warn("[pulse] failed to mark first seen", {
      error_code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
    });
  });
  const nextOffset = offset + page.length;
  const generatedAt = rankedAt.toISOString();
  const nextCursor = nextOffset < ranked.length
    ? encodePulseCursor({ version: 1, offset: nextOffset, filter, generated_at: generatedAt })
    : null;
  const sinceTime = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : null;

  return {
    generated_at: generatedAt,
    timezone: preferences.timezone,
    date_label: formatDateLabel(now, preferences.timezone),
    filter,
    items: page.map(({ item_key, is_holding, is_pinned, ...item }) => {
      void is_holding;
      void is_pinned;
      return pulseItemSchema.parse({ ...item, id: encodePulseItemId(item_key) });
    }),
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
    new_item_count: sinceTime === null ? 0 : ranked.filter((item) => Date.parse(item.available_at) > sinceTime).length,
    source_statuses: sourceStatuses,
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

async function settleSource(
  source: PulseItemKind,
  enabled: boolean,
  load: () => Promise<PulseCandidate[]>,
): Promise<{ items: PulseCandidate[]; status: PulseSourceStatus }> {
  if (!enabled) return { items: [], status: { source, status: "unavailable", item_count: 0 } };
  const startedAt = performance.now();
  try {
    const items = await load();
    return { items, status: { source, status: items.length > 0 ? "ready" : "empty", item_count: items.length, latency_ms: Math.round(performance.now() - startedAt) } };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    console.warn("[pulse] source degraded", {
      source,
      latency_ms: latencyMs,
      error_code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
    });
    return { items: [], status: { source, status: "degraded", item_count: 0, latency_ms: latencyMs } };
  }
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
