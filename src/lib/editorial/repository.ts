import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  Database,
  PulseEditorialAssetRow,
  PulseEditorialEntryRow,
} from "@/types/database";

export const PULSE_EDITORIAL_BUCKET = "pulse-editorial";

const MAX_PULSE_EDITORIAL_CANDIDATES = 48;

export type PulseEditorialEntryWithAssets = PulseEditorialEntryRow & {
  pulse_editorial_assets: PulseEditorialAssetRow[];
};

/** The small projection needed to compose a public Pulse learning card. */
export type PulseEditorialPublishedEntry = Pick<
  PulseEditorialEntryRow,
  | "id"
  | "slug"
  | "status"
  | "format"
  | "title"
  | "body"
  | "ticker"
  | "action_label"
  | "action_href"
  | "publish_at"
  | "expires_at"
  | "created_at"
> & {
  pulse_editorial_assets: Array<
    Pick<PulseEditorialAssetRow, "position" | "storage_path" | "alt_text">
  >;
};

export async function listPulseEditorialEntries(
  supabase: SupabaseClient<Database>,
): Promise<PulseEditorialEntryWithAssets[]> {
  const { data, error } = await supabase
    .from("pulse_editorial_entries")
    .select("*, pulse_editorial_assets(*)")
    .order("updated_at", { ascending: false })
    .returns<PulseEditorialEntryWithAssets[]>();
  if (error) throw error;
  return data ?? [];
}

async function listPublishedPulseEditorialEntries(
  supabase: SupabaseClient<Database>,
): Promise<PulseEditorialPublishedEntry[]> {
  const { data, error } = await supabase
    .from("pulse_editorial_entries")
    .select("id, slug, status, format, title, body, ticker, action_label, action_href, publish_at, expires_at, created_at, pulse_editorial_assets(position, storage_path, alt_text)")
    .eq("status", "published")
    .not("publish_at", "is", null)
    .order("publish_at", { ascending: false })
    .limit(MAX_PULSE_EDITORIAL_CANDIDATES)
    .returns<PulseEditorialPublishedEntry[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Editorial cards participate in the global Pulse revision. Do not keep a
 * process-local cache here: a database-triggered revision can be observed by
 * another web instance before an in-memory cache has been invalidated. Pulse
 * only calls this after a revision change, so the bounded shared-content read
 * is preferable to serving a revision/content mismatch.
 */
export async function getPublishedPulseEditorialEntries(): Promise<
  PulseEditorialPublishedEntry[]
> {
  return listPublishedPulseEditorialEntries(getSupabaseAdmin());
}

export function editorialPublicUrl(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): string {
  return supabase.storage.from(PULSE_EDITORIAL_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
