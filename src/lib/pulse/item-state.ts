import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { Database, UserPulseItemStateRow } from "@/types/database";

const PULSE_STATE_QUERY_CHUNK_SIZE = 100;
const PULSE_STATE_QUERY_CONCURRENCY = 3;

export async function getPulseItemStates(
  supabase: SupabaseClient<Database>,
  userId: string,
  itemKeys: string[],
): Promise<Map<string, UserPulseItemStateRow>> {
  const uniqueItemKeys = [...new Set(itemKeys)];
  if (uniqueItemKeys.length === 0) return new Map();

  const rows: UserPulseItemStateRow[] = [];
  for (let index = 0; index < uniqueItemKeys.length; index += PULSE_STATE_QUERY_CHUNK_SIZE * PULSE_STATE_QUERY_CONCURRENCY) {
    const batch = uniqueItemKeys.slice(index, index + PULSE_STATE_QUERY_CHUNK_SIZE * PULSE_STATE_QUERY_CONCURRENCY);
    const batchRows = await Promise.all(batch
      .reduce<string[][]>((chunks, itemKey, itemIndex) => {
        const chunkIndex = Math.floor(itemIndex / PULSE_STATE_QUERY_CHUNK_SIZE);
        const chunk = chunks[chunkIndex] ?? [];
        chunk.push(itemKey);
        chunks[chunkIndex] = chunk;
        return chunks;
      }, [])
      .map(async (chunk) => {
        const { data, error } = await supabase
          .from("user_pulse_item_states")
          .select("*")
          .eq("user_id", userId)
          .in("item_key", chunk);
        if (error) {
          if (isMissingPulseStateTable(error)) return [];
          throw error;
        }
        return data ?? [];
      }));
    rows.push(...batchRows.flat());
  }
  return new Map(rows.map((row) => [row.item_key, row]));
}

/** Applies user-owned visibility state before any rotation, summary, or rank. */
export function applyPulseItemStates(
  candidates: PulseCandidate[],
  states: Map<string, UserPulseItemStateRow>,
  now: Date,
): PulseCandidate[] {
  return candidates.flatMap<PulseCandidate>((candidate) => {
    const state = states.get(candidate.item_key);
    if (!state) return [{ ...candidate, state: "new" as const }];
    if (state.dismissed_at) return [];
    if (state.snoozed_until && Date.parse(state.snoozed_until) > now.getTime()) return [];
    const reviewedAt = state.reviewed_at ?? candidate.reviewed_at;
    // Some pre-V4 rows were created without an actual impression or action.
    // Do not turn those legacy placeholders into a misleading "seen" penalty.
    const hasMeaningfulState = Boolean(
      state.first_seen_at || state.saved_at || state.snoozed_until,
    );
    return [{
      ...candidate,
      reviewed_at: reviewedAt,
      saved_at: state.saved_at ?? candidate.saved_at,
      snoozed_until: state.snoozed_until ?? candidate.snoozed_until,
      is_pinned: Boolean(state.saved_at) || candidate.is_pinned,
      // Exposure and fatigue live only on the device. A server row without an
      // actual action is a legacy placeholder rather than evidence of viewing.
      state: reviewedAt ? "reviewed" : hasMeaningfulState ? "seen" : "new",
    }];
  });
}

function isMissingPulseStateTable(error: { code?: string | null; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || Boolean(error.message?.includes("user_pulse_item_states"));
}
