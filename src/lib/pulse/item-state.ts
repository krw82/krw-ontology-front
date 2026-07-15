import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { Database, UserPulseItemStateRow } from "@/types/database";

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
    if (error.code === "42P01" || error.code === "PGRST205" || error.message.includes("user_pulse_item_states")) return new Map();
    throw error;
  }
  return new Map(data.map((row) => [row.item_key, row]));
}

export function applyPulseItemStates(
  candidates: PulseCandidate[],
  states: Map<string, UserPulseItemStateRow>,
  now: Date,
): PulseCandidate[] {
  return candidates.flatMap((candidate) => {
    const state = states.get(candidate.item_key);
    if (!state) return [candidate];
    if (state.dismissed_at) return [];
    if (state.snoozed_until && Date.parse(state.snoozed_until) > now.getTime()) return [];
    if (
      candidate.kind === "resurface" &&
      state.last_seen_at &&
      Date.parse(state.last_seen_at) > now.getTime() - 28 * 24 * 60 * 60 * 1_000
    ) return [];
    return [{
      ...candidate,
      read_at: state.read_at ?? candidate.read_at,
      saved_at: state.saved_at ?? candidate.saved_at,
      snoozed_until: state.snoozed_until ?? candidate.snoozed_until,
      is_pinned: Boolean(state.saved_at) || candidate.is_pinned,
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
  if (error && error.code !== "42P01" && error.code !== "PGRST205" && !error.message.includes("user_pulse_item_states")) {
    throw error;
  }
}
