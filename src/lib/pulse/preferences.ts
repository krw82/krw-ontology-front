import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PULSE_ITEM_KINDS } from "@/lib/pulse/contract";
import type { PulsePreferences, PulsePreferencesPatch } from "@/types/api-contracts";
import type { Database, UserPulsePreferencesRow } from "@/types/database";

export const DEFAULT_PULSE_TIMEZONE = "Asia/Seoul";

export function defaultPulsePreferences(): PulsePreferences {
  return {
    timezone: DEFAULT_PULSE_TIMEZONE,
    enabled_kinds: [...PULSE_ITEM_KINDS],
    muted_tickers: [],
    daily_checkup_enabled: true,
    daily_checkup_at: "08:30:00",
    question_cadence: "daily",
    resurface_cadence: "weekly",
    learning_cadence: "weekly",
    learning_enabled: true,
    resurfacing_enabled: true,
    updated_at: null,
  };
}

export function pulsePreferencesFromRow(
  row: UserPulsePreferencesRow | null,
): PulsePreferences {
  if (!row) return defaultPulsePreferences();
  return {
    timezone: row.timezone,
    enabled_kinds: row.enabled_kinds,
    muted_tickers: row.muted_tickers,
    daily_checkup_enabled: row.daily_checkup_enabled,
    daily_checkup_at: row.daily_checkup_at,
    question_cadence: row.question_cadence,
    resurface_cadence: row.resurface_cadence,
    learning_cadence: row.learning_cadence,
    learning_enabled: row.learning_enabled,
    resurfacing_enabled: row.resurfacing_enabled,
    updated_at: row.updated_at,
  };
}

export async function getPulsePreferences(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<PulsePreferences> {
  const { data, error } = await supabase
    .from("user_pulse_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingPulseTable(error)) return defaultPulsePreferences();
    throw error;
  }
  return pulsePreferencesFromRow(data);
}

export async function updatePulsePreferences(
  supabase: SupabaseClient<Database>,
  userId: string,
  patch: PulsePreferencesPatch,
): Promise<PulsePreferences> {
  const normalized = {
    ...patch,
    muted_tickers: patch.muted_tickers?.map((ticker) => ticker.trim().toUpperCase()),
  };
  const { data, error } = await supabase
    .from("user_pulse_preferences")
    .upsert({ user_id: userId, ...normalized }, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return pulsePreferencesFromRow(data);
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isMissingPulseTable(error: { code?: string | null; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || Boolean(error.message?.includes("user_pulse_preferences"));
}
