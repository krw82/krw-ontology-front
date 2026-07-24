import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed } from "@/lib/pulse/composer";
import { isPulseItemVersionMap } from "@/lib/pulse/delta";
import { PULSE_PAGE_SIZE } from "@/lib/pulse/contract";
import { getPulseFeedRevision } from "@/lib/pulse/revision";
import type {
  PulseFeedDeltaResponse,
  PulseFeedResponse,
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
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const now = new Date();
  const supabase = getSupabaseAdmin();
  try {
    const revision = await getPulseFeedRevision(supabase, user.id, now);
    if (parsed.data.revision === revision.value) {
      return Response.json(unchangedDelta(revision.value, now), { headers: PRIVATE_HEADERS });
    }

    const includeNotebookSources = await canAccessMenuFeature(
      user.id,
      user.email,
      "research_notebook",
    ).catch(() => false);
    const feed = await composePulseFeed({
      supabase,
      userId: user.id,
      includeNotebookSources,
      filter: "all",
      limit: PULSE_PAGE_SIZE,
      since: null,
      now,
      revision,
    });
    return Response.json(buildDelta(feed, parsed.data.item_versions), { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json(
      { error: { code: "service_unavailable", message: "피드 변경사항을 불러오지 못했습니다." } },
      { status: 503 },
    );
  }
}

export function buildDelta(
  feed: PulseFeedResponse,
  knownItemVersions: Record<string, string>,
): PulseFeedDeltaResponse {
  const currentItems = [...feed.candidate_items, ...feed.active_analysis_items];
  const currentIds = new Set(currentItems.map((item) => item.id));
  const knownIds = new Set(Object.keys(knownItemVersions));
  const upserts = currentItems.filter((item) =>
    knownItemVersions[item.id] !== feed.item_versions[item.id]);
  const removedItemIds = Object.keys(knownItemVersions).filter((id) => !currentIds.has(id));
  return {
    generated_at: feed.generated_at,
    revision: feed.revision,
    changed: true,
    snapshot: {
      ranking_version: feed.ranking_version,
      timezone: feed.timezone,
      date_label: feed.date_label,
      filter: feed.filter,
      visible_limit: feed.visible_limit,
      new_item_count: feed.new_item_count,
      source_statuses: feed.source_statuses,
    },
    ordered_candidate_ids: feed.candidate_items.map((item) => item.id),
    active_analysis_item_ids: feed.active_analysis_items.map((item) => item.id),
    upserts,
    removed_item_ids: removedItemIds,
    item_versions: feed.item_versions,
    refresh_summary: buildRefreshSummary(
      feed,
      knownIds,
      upserts,
      removedItemIds,
    ),
  };
}

function unchangedDelta(revision: string, now: Date): PulseFeedDeltaResponse {
  return {
    generated_at: now.toISOString(),
    revision,
    changed: false,
    snapshot: null,
    ordered_candidate_ids: [],
    active_analysis_item_ids: [],
    upserts: [] as PulseItem[],
    removed_item_ids: [],
    item_versions: {},
    refresh_summary: emptyRefreshSummary(),
  };
}

function buildRefreshSummary(
  feed: PulseFeedResponse,
  knownIds: Set<string>,
  upserts: PulseItem[],
  removedItemIds: string[],
): PulseFeedRefreshSummary {
  return {
    // A card that was already in the device snapshot but moved between the
    // active-analysis and candidate lists is an update, not a false “new”.
    added_candidate_count: feed.candidate_items.filter((item) => !knownIds.has(item.id)).length,
    updated_item_count: upserts.filter((item) => knownIds.has(item.id)).length,
    removed_item_count: removedItemIds.length,
  };
}

function emptyRefreshSummary(): PulseFeedRefreshSummary {
  return {
    added_candidate_count: 0,
    updated_item_count: 0,
    removed_item_count: 0,
  };
}
