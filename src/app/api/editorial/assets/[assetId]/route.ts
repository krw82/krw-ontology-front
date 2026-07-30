import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { isEditorialAdmin, isLocalEditorialAdminRequest } from "@/lib/editorial/access";
import { PULSE_EDITORIAL_BUCKET } from "@/lib/editorial/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  PulseEditorialAssetRow,
  PulseEditorialEntryRow,
  PulseEditorialSeriesRow,
} from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assetIdSchema = z.string().uuid();

type EditorialAssetAccessEntry = Pick<
  PulseEditorialEntryRow,
  "series_id" | "company_visible" | "status" | "publish_at" | "expires_at"
> & {
  pulse_editorial_series: Pick<PulseEditorialSeriesRow, "status"> | null;
};

type EditorialAssetAccessRow = Pick<
  PulseEditorialAssetRow,
  "id" | "storage_path" | "mime_type" | "byte_size"
> & {
  pulse_editorial_entries: EditorialAssetAccessEntry | null;
};

function missingAssetResponse() {
  return new Response(null, { status: 404 });
}

function isPublicAsset(entry: EditorialAssetAccessEntry | null, now: number): boolean {
  if (!entry || entry.status !== "published" || !entry.publish_at) return false;
  const publishAt = Date.parse(entry.publish_at);
  const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : null;
  if (!Number.isFinite(publishAt) || publishAt > now) return false;
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) return false;

  // Legacy entries are public Pulse cards. Series entries are public only when
  // the company page can render the parent series as well.
  return entry.series_id === null
    || (entry.company_visible && entry.pulse_editorial_series?.status === "published");
}

export async function GET(request: Request, context: RouteContext<"/api/editorial/assets/[assetId]">) {
  const { assetId } = await context.params;
  if (!assetIdSchema.safeParse(assetId).success) return missingAssetResponse();

  const { data: asset, error } = await getSupabaseAdmin()
    .from("pulse_editorial_assets")
    .select("id, storage_path, mime_type, byte_size, pulse_editorial_entries!inner(series_id, company_visible, status, publish_at, expires_at, pulse_editorial_series(status))")
    .eq("id", assetId)
    .maybeSingle<EditorialAssetAccessRow>();
  if (error || !asset) return missingAssetResponse();

  const user = await getAuthUser().catch(() => null);
  const canInspectDraft = Boolean(user && isLocalEditorialAdminRequest(request) && isEditorialAdmin(user));
  const publicAsset = isPublicAsset(asset.pulse_editorial_entries, Date.now());
  if (!publicAsset && !canInspectDraft) return missingAssetResponse();

  const { data, error: downloadError } = await getSupabaseAdmin()
    .storage
    .from(PULSE_EDITORIAL_BUCKET)
    .download(asset.storage_path);
  if (downloadError || !data) return missingAssetResponse();

  const hasExpiry = Boolean(asset.pulse_editorial_entries?.expires_at);
  return new Response(data, {
    headers: {
      "Content-Type": asset.mime_type,
      "Content-Length": String(asset.byte_size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": publicAsset
        ? hasExpiry
          ? "public, max-age=3600, s-maxage=3600"
          : "public, max-age=31536000, immutable"
        : "private, no-store",
    },
  });
}
