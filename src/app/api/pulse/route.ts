import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed } from "@/lib/pulse/composer";
import { PULSE_MAX_PAGE_SIZE, PULSE_PAGE_SIZE } from "@/lib/pulse/contract";
import {
  createStaticPulseE2EFeed,
  shouldUseStaticPulseE2EFixture,
} from "@/lib/pulse/e2e-fixture";
import {
  getPulseFeedRevision,
  matchesPulseFeedETag,
  pulseFeedETag,
} from "@/lib/pulse/revision";
import { ServerTiming } from "@/lib/performance/server-timing";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  filter: z.literal("all").default("all"),
  limit: z.coerce.number().int().min(1).max(PULSE_MAX_PAGE_SIZE).default(PULSE_PAGE_SIZE),
}).strict();

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  let user;
  try {
    user = await timing.measure("auth", () => getAuthUser());
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "validation_error", message: "피드 요청 값이 올바르지 않습니다." } },
      { status: 400 },
    );
  }

  if (await shouldUseStaticPulseE2EFixture()) {
    const fixture = createStaticPulseE2EFeed();
    return Response.json(fixture, {
      headers: timing.headers({ ...PRIVATE_HEADERS, ETag: pulseFeedETag(fixture.revision) }),
    });
  }

  const now = new Date();
  const supabase = getSupabaseAdmin();
  try {
    const revision = await timing.measure("revision", () =>
      getPulseFeedRevision(supabase, user.id, now));
    if (matchesPulseFeedETag(request.headers.get("if-none-match"), revision.value)) {
      return new Response(null, {
        status: 304,
        headers: timing.headers({ ...PRIVATE_HEADERS, ETag: pulseFeedETag(revision.value) }),
      });
    }

    const includeNotebookSources = await timing.measure(
      "access",
      () => canAccessMenuFeature(user.id, user.email, "research_notebook").catch(() => false),
    );
    const response = await timing.measure("compose", () => composePulseFeed({
      supabase,
      userId: user.id,
      includeNotebookSources,
      ...parsed.data,
      now,
      revision,
    }));
    return Response.json(response, {
      headers: timing.headers({ ...PRIVATE_HEADERS, ETag: pulseFeedETag(response.revision) }),
    });
  } catch {
    return Response.json(
      { error: { code: "service_unavailable", message: "피드를 불러오지 못했습니다." } },
      { status: 503 },
    );
  }
}
