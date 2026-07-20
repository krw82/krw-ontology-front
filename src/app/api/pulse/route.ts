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
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  filter: z.literal("all").default("all"),
  limit: z.coerce.number().int().min(1).max(PULSE_MAX_PAGE_SIZE).default(PULSE_PAGE_SIZE),
  since: z.iso.datetime().optional(),
}).strict();

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "피드 요청 값이 올바르지 않습니다.",
        },
      },
      { status: 400 },
    );
  }
  if (await shouldUseStaticPulseE2EFixture()) {
    return Response.json(createStaticPulseE2EFeed(), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
  try {
    const includeNotebookSources = await canAccessMenuFeature(
      user.id,
      user.email,
      "research_notebook",
    ).catch(() => false);
    const options = {
      supabase: getSupabaseAdmin(),
      userId: user.id,
      includeNotebookSources,
      ...parsed.data,
    };
    const response = await composePulseFeed(options);
    return Response.json(response, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "피드를 불러오지 못했습니다.",
        },
      },
      { status: 503 },
    );
  }
}
