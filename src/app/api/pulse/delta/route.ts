import type { NextRequest } from "next/server";
import { z } from "zod";
import { ANONYMOUS_PULSE_USER_ID, getOptionalAuthUser, handleAuthError } from "@/lib/auth";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed } from "@/lib/pulse/composer";
import { buildPulseFeedDelta, isPulseItemVersionMap } from "@/lib/pulse/delta";
import { PULSE_PAGE_SIZE } from "@/lib/pulse/contract";
import { getPulseFeedRevision } from "@/lib/pulse/revision";
import type {
  PulseFeedDeltaResponse,
  PulseFeedRefreshSummary,
  PulseItem,
} from "@/types/api-contracts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  revision: z.string().min(1).max(128).nullable().optional(),
  item_versions: z.record(z.string().min(1).max(512), z.string().regex(/^v1-[0-9a-z]+$/)).default({}),
}).strict().superRefine((input, context) => {
  if (Object.keys(input.item_versions).length > 50) {
    context.addIssue({ code: "custom", message: "Too many cached Pulse items." });
  }
});

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * Returns only cards the device cannot render from its account-scoped local
 * snapshot. The server still composes against authoritative private state.
 */
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isPulseItemVersionMap(parsed.data?.item_versions)) {
    return Response.json(
      { error: { code: "validation_error", message: "피드 동기화 값이 올바르지 않습니다." } },
      { status: 400 },
    );
  }

  let user;
  try {
    user = await getOptionalAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  const userId = user?.id ?? ANONYMOUS_PULSE_USER_ID;

  const now = new Date();
  const supabase = getSupabaseAdmin();
  try {
    const revision = await getPulseFeedRevision(supabase, userId, now);
    if (parsed.data.revision === revision.value) {
      return Response.json(unchangedDelta(revision.value, now), { headers: PRIVATE_HEADERS });
    }

    const includeNotebookSources = await canAccessMenuFeature(
      userId,
      user?.email,
      "research_notebook",
    ).catch(() => false);
    const feed = await composePulseFeed({
      supabase,
      userId,
      includeNotebookSources,
      filter: "all",
      limit: PULSE_PAGE_SIZE,
      since: null,
      now,
      revision,
    });
    return Response.json(buildPulseFeedDelta(feed, parsed.data.item_versions), { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json(
      { error: { code: "service_unavailable", message: "피드 변경사항을 불러오지 못했습니다." } },
      { status: 503 },
    );
  }
}

function unchangedDelta(revision: string, now: Date): PulseFeedDeltaResponse {
  return {
    generated_at: now.toISOString(),
    revision,
    changed: false,
    snapshot: null,
    ordered_candidate_ids: [],
    active_analysis_item_ids: [],
    completed_analysis_item_ids: [],
    upserts: [] as PulseItem[],
    removed_item_ids: [],
    item_versions: {},
    refresh_summary: emptyRefreshSummary(),
  };
}

function emptyRefreshSummary(): PulseFeedRefreshSummary {
  return {
    added_candidate_count: 0,
    updated_item_count: 0,
    removed_item_count: 0,
  };
}
