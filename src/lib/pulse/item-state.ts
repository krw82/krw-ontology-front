import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { Database, UserPulseItemStateRow } from "@/types/database";

const RESURFACE_COOLDOWN_MS = 28 * 24 * 60 * 60 * 1_000;
const QUESTION_FATIGUE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;

export async function getPulseItemStates(
  supabase: SupabaseClient<Database>,
  userId: string,
  itemKeys: string[],
): Promise<Map<string, UserPulseItemStateRow>> {
  if (itemKeys.length === 0) return new Map();
  const { data, error } = await supabase
    .from("user_pulse_item_states")
    .select("*")
    .eq("user_id", userId)
    .in("item_key", itemKeys);
  if (error) {
    if (isMissingPulseStateTable(error)) return new Map();
    throw error;
  }
  return new Map(data.map((row) => [row.item_key, row]));
}

/** Applies user-owned visibility state before any rotation, summary, or rank. */
export function applyPulseItemStates(
  candidates: PulseCandidate[],
  states: Map<string, UserPulseItemStateRow>,
  now: Date,
  timezone: string,
): PulseCandidate[] {
  return candidates.flatMap<PulseCandidate>((candidate) => {
    const state = states.get(candidate.item_key);
    if (!state) return [{ ...candidate, state: "new" as const }];
    if (state.dismissed_at) return [];
    if (state.snoozed_until && Date.parse(state.snoozed_until) > now.getTime()) return [];
    if (isOnCooldown(candidate, state, now, timezone)) return [];

    const reviewedAt = state.reviewed_at ?? state.read_at ?? candidate.reviewed_at ?? candidate.read_at;
    return [{
      ...candidate,
      reviewed_at: reviewedAt,
      read_at: state.read_at ?? reviewedAt ?? candidate.read_at,
      saved_at: state.saved_at ?? candidate.saved_at,
      snoozed_until: state.snoozed_until ?? candidate.snoozed_until,
      is_pinned: Boolean(state.saved_at) || candidate.is_pinned,
      state: reviewedAt ? "reviewed" : state.last_seen_at ? "seen" : "new",
    }];
  });
}

export async function markPulseItemsFirstSeen(
  supabase: SupabaseClient<Database>,
  userId: string,
  candidates: PulseCandidate[],
  now: Date,
): Promise<void> {
  if (candidates.length === 0) return;
  const { error } = await supabase.from("user_pulse_item_states").upsert(
    candidates.map((candidate) => ({
      user_id: userId,
      item_key: candidate.item_key,
      kind: candidate.kind,
      source_type: candidate.source_type,
      source_id: candidate.source_id,
      first_seen_at: now.toISOString(),
    })),
    { onConflict: "user_id,item_key", ignoreDuplicates: true },
  );
  if (error && !isMissingPulseStateTable(error)) throw error;
}

export function hasRecentKindImpression(
  states: Map<string, UserPulseItemStateRow>,
  kind: UserPulseItemStateRow["kind"],
  now: Date,
  timezone: string,
  cooldownMs: number,
): boolean {
  return [...states.values()].some((state) => state.kind === kind
    && Boolean(state.last_seen_at)
    && Date.parse(state.last_seen_at!) > now.getTime() - cooldownMs
    && (kind !== "learning" || localIsoWeekKey(new Date(state.last_seen_at!), timezone) === localIsoWeekKey(now, timezone)));
}

function isOnCooldown(
  candidate: PulseCandidate,
  state: UserPulseItemStateRow,
  now: Date,
  timezone: string,
): boolean {
  if (!state.last_seen_at) return false;
  const lastSeen = Date.parse(state.last_seen_at);
  if (candidate.kind === "resurface") return lastSeen > now.getTime() - RESURFACE_COOLDOWN_MS;
  if (candidate.kind === "learning") return localIsoWeekKey(new Date(lastSeen), timezone) === localIsoWeekKey(now, timezone);
  if (candidate.kind !== "question") return false;

  if (localDateKey(new Date(lastSeen), timezone) === localDateKey(now, timezone)) return true;
  return state.impression_count >= 3
    && !state.reviewed_at
    && !state.saved_at
    && lastSeen > now.getTime() - QUESTION_FATIGUE_COOLDOWN_MS;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function localIsoWeekKey(date: Date, timezone: string): string {
  const [year, month, day] = localDateKey(date, timezone).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function isMissingPulseStateTable(error: { code?: string | null; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || Boolean(error.message?.includes("user_pulse_item_states"));
}
