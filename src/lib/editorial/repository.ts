import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  Database,
  PulseEditorialAssetRow,
  PulseEditorialDistributionRow,
  PulseEditorialEntryRow,
  PulseEditorialSeriesRow,
} from "@/types/database";

export const PULSE_EDITORIAL_BUCKET = "pulse-editorial";

const MAX_PULSE_EDITORIAL_CANDIDATES = 48;

export type PulseEditorialSeriesOption = Pick<
  PulseEditorialSeriesRow,
  "id" | "ticker" | "slug" | "status" | "title" | "summary"
>;

export type PulseEditorialEntryWithAssets = PulseEditorialEntryRow & {
  pulse_editorial_assets: PulseEditorialAssetRow[];
  pulse_editorial_series?: PulseEditorialSeriesRow | null;
  pulse_editorial_distributions?: PulseEditorialDistributionRow[];
};

export type PulseEditorialAdminEntry = PulseEditorialEntryWithAssets & {
  pulse_editorial_distributions: PulseEditorialDistributionRow[];
};

/** A legacy standalone entry that can still render in Pulse without a series. */
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
    Pick<PulseEditorialAssetRow, "id" | "position" | "storage_path" | "alt_text" | "width" | "height">
  >;
};

export type PulseEditorialPublishedSeries = Pick<
  PulseEditorialSeriesRow,
  "id" | "ticker" | "slug" | "status" | "title" | "summary"
>;

export type PulseEditorialPublishedSeriesEntry = PulseEditorialPublishedEntry & {
  series_id: string;
  episode_number: number;
  company_visible: boolean;
  pulse_editorial_series: PulseEditorialPublishedSeries | null;
};

export type PulseEditorialActiveDistribution = Pick<
  PulseEditorialDistributionRow,
  "id" | "entry_id" | "channel" | "status" | "placement" | "priority" | "starts_at" | "ends_at" | "created_at"
> & {
  pulse_editorial_entries: PulseEditorialPublishedSeriesEntry | null;
};

export type PulseEditorialCompanySeries = PulseEditorialPublishedSeries & {
  entries: PulseEditorialPublishedSeriesEntry[];
};

export async function listPulseEditorialEntries(
  supabase: SupabaseClient<Database>,
): Promise<PulseEditorialEntryWithAssets[]> {
  const { data, error } = await supabase
    .from("pulse_editorial_entries")
    .select("*, pulse_editorial_assets(*), pulse_editorial_series(*)")
    .order("updated_at", { ascending: false })
    .returns<PulseEditorialEntryWithAssets[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getPulseEditorialEntryForAdmin(
  supabase: SupabaseClient<Database>,
  entryId: string,
): Promise<PulseEditorialAdminEntry | null> {
  const { data, error } = await supabase
    .from("pulse_editorial_entries")
    .select("*, pulse_editorial_assets(*), pulse_editorial_series(*), pulse_editorial_distributions(*)")
    .eq("id", entryId)
    .maybeSingle<PulseEditorialAdminEntry>();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    pulse_editorial_assets: [...(data.pulse_editorial_assets ?? [])]
      .sort((left, right) => left.position - right.position),
    pulse_editorial_distributions: [...(data.pulse_editorial_distributions ?? [])]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
  };
}

export async function listPulseEditorialSeries(
  supabase: SupabaseClient<Database>,
): Promise<PulseEditorialSeriesOption[]> {
  const { data, error } = await supabase
    .from("pulse_editorial_series")
    .select("id, ticker, slug, status, title, summary")
    .order("updated_at", { ascending: false })
    .limit(MAX_PULSE_EDITORIAL_CANDIDATES)
    .returns<PulseEditorialSeriesOption[]>();
  if (error) throw error;
  return data ?? [];
}

async function listPublishedLegacyPulseEditorialEntries(
  supabase: SupabaseClient<Database>,
): Promise<PulseEditorialPublishedEntry[]> {
  const { data, error } = await supabase
    .from("pulse_editorial_entries")
    .select("id, slug, status, format, title, body, ticker, action_label, action_href, publish_at, expires_at, created_at, pulse_editorial_assets(id, position, storage_path, alt_text, width, height)")
    .eq("status", "published")
    .is("series_id", null)
    .not("publish_at", "is", null)
    .order("publish_at", { ascending: false })
    .limit(MAX_PULSE_EDITORIAL_CANDIDATES)
    .returns<PulseEditorialPublishedEntry[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Standalone editorial cards retain their old delivery behavior. New company
 * stories require a distribution record and deliberately do not leak to Pulse
 * merely because they are published on a company page.
 */
export async function getPublishedPulseEditorialEntries(): Promise<
  PulseEditorialPublishedEntry[]
> {
  return listPublishedLegacyPulseEditorialEntries(getSupabaseAdmin());
}

export async function getActivePulseEditorialDistributions(
  now: Date,
): Promise<PulseEditorialActiveDistribution[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("pulse_editorial_distributions")
    .select("id, entry_id, channel, status, placement, priority, starts_at, ends_at, created_at, pulse_editorial_entries!inner(id, slug, series_id, episode_number, company_visible, status, format, title, body, ticker, action_label, action_href, publish_at, expires_at, created_at, pulse_editorial_assets(id, position, storage_path, alt_text, width, height), pulse_editorial_series!inner(id, ticker, slug, status, title, summary))")
    .eq("channel", "pulse")
    .eq("status", "active")
    .order("priority", { ascending: false })
    .order("starts_at", { ascending: false })
    .limit(MAX_PULSE_EDITORIAL_CANDIDATES)
    .returns<PulseEditorialActiveDistribution[]>();
  if (error) throw error;

  const current = now.getTime();
  return (data ?? []).filter((distribution) => {
    const entry = distribution.pulse_editorial_entries;
    const series = entry?.pulse_editorial_series;
    const startsAt = distribution.starts_at ? Date.parse(distribution.starts_at) : Number.NaN;
    const endsAt = distribution.ends_at ? Date.parse(distribution.ends_at) : null;
    const publishedAt = entry?.publish_at ? Date.parse(entry.publish_at) : Number.NaN;
    return distribution.status === "active"
      && Number.isFinite(startsAt)
      && startsAt <= current
      && (endsAt === null || (Number.isFinite(endsAt) && endsAt > current))
      && entry?.status === "published"
      && Number.isFinite(publishedAt)
      && publishedAt <= current
      && series?.status === "published";
  });
}

/** Canonical company-page series. Distribution state never affects this read. */
export async function getPublishedCompanyEditorialSeries(
  ticker: string,
): Promise<PulseEditorialCompanySeries[]> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) return [];
  const now = new Date();
  const { data, error } = await getSupabaseAdmin()
    .from("pulse_editorial_entries")
    .select("id, slug, series_id, episode_number, company_visible, status, format, title, body, ticker, action_label, action_href, publish_at, expires_at, created_at, pulse_editorial_assets(id, position, storage_path, alt_text, width, height), pulse_editorial_series!inner(id, ticker, slug, status, title, summary)")
    .eq("ticker", normalizedTicker)
    .eq("status", "published")
    .eq("company_visible", true)
    .not("series_id", "is", null)
    .not("publish_at", "is", null)
    .lte("publish_at", now.toISOString())
    .order("episode_number", { ascending: true })
    .limit(MAX_PULSE_EDITORIAL_CANDIDATES)
    .returns<PulseEditorialPublishedSeriesEntry[]>();
  if (error) throw error;

  const groups = new Map<string, PulseEditorialCompanySeries>();
  for (const entry of data ?? []) {
    const series = entry.pulse_editorial_series;
    const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : null;
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())) continue;
    if (!series || series.status !== "published" || !entry.series_id || entry.episode_number === null) continue;
    const existing = groups.get(series.id) ?? { ...series, entries: [] };
    existing.entries.push({
      ...entry,
      pulse_editorial_assets: [...entry.pulse_editorial_assets]
        .sort((left, right) => left.position - right.position),
    });
    groups.set(series.id, existing);
  }

  return [...groups.values()]
    .map((series) => ({
      ...series,
      entries: series.entries.sort((left, right) => left.episode_number - right.episode_number),
    }))
    .sort((left, right) => right.entries.length - left.entries.length || left.title.localeCompare(right.title));
}

export function editorialPublicUrl(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): string {
  return supabase.storage.from(PULSE_EDITORIAL_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

/**
 * Keep public pages on the app origin.  Besides avoiding a separate CSP source,
 * the route can refuse draft assets even though the underlying Storage bucket is
 * public for performant delivery of already-published editorial art.
 */
export function editorialAssetUrl(assetId: string): string {
  return `/api/editorial/assets/${encodeURIComponent(assetId)}`;
}
