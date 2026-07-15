import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed } from "@/lib/pulse/composer";
import { decodePulseCursor } from "@/lib/pulse/cursor";
import { isPulseFeedEnabled } from "@/lib/pulse/enabled";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  filter: z.enum(["all", "filing", "checkup", "question", "resurface", "learning"]).default("all"),
  cursor: z.string().max(2_000).refine((value) => decodePulseCursor(value) !== null).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(20),
  since: z.iso.datetime().optional(),
});

export async function GET(request: NextRequest) {
  if (!isPulseFeedEnabled()) {
    return Response.json({ error: { code: "not_found", message: "Pulse feed is not enabled" } }, { status: 404 });
  }
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json({ error: { code: "validation_error", message: "피드 요청 값이 올바르지 않습니다." } }, { status: 400 });
  }
  const decodedCursor = parsed.data.cursor ? decodePulseCursor(parsed.data.cursor) : null;
  if (decodedCursor && decodedCursor.filter !== parsed.data.filter) {
    return Response.json({ error: { code: "validation_error", message: "커서와 필터가 일치하지 않습니다." } }, { status: 400 });
  }

  try {
    const includeNotebookSources = await canAccessMenuFeature(
      user.id,
      user.email,
      "research_notebook",
    ).catch(() => false);
    const response = await composePulseFeed({
      supabase: getSupabaseAdmin(),
      userId: user.id,
      includeNotebookSources,
      ...parsed.data,
    });
    return Response.json(response, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return Response.json({ error: { code: "service_unavailable", message: "피드를 불러오지 못했습니다." } }, { status: 503 });
  }
}
