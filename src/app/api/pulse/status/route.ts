import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getPulseFeedStatus } from "@/lib/pulse/status";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  revision: z.string().min(1).max(128).optional(),
}).strict();

/** V3 lightweight poll: one revision RPC, no candidate or chat scans. */
export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "validation_error", message: "피드 버전 값이 올바르지 않습니다." } },
      { status: 400 },
    );
  }

  try {
    const status = await getPulseFeedStatus({
      supabase: getSupabaseAdmin(),
      userId: user.id,
      revision: parsed.data.revision ?? null,
    });
    return Response.json(status, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return Response.json(
      { error: { code: "service_unavailable", message: "피드 변경 여부를 확인하지 못했습니다." } },
      { status: 503 },
    );
  }
}
