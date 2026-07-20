import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UserRetentionMilestoneRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A lightweight status read for the company index. The full onboarding route
 * also reconciles progress across multiple tables and is intentionally not on
 * this first-paint path.
 */
export async function GET() {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { data, error } = await getSupabaseAdmin()
    .from("user_retention_milestones")
    .select("achieved_at")
    .eq("user_id", user.id)
    .eq("milestone", "coverage_activated")
    .maybeSingle<Pick<UserRetentionMilestoneRow, "achieved_at">>();

  if (error) {
    return Response.json(
      { error: { code: "service_unavailable", message: "온보딩 상태를 불러오지 못했습니다." } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return Response.json(
    { coverage_activated: Boolean(data?.achieved_at) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
