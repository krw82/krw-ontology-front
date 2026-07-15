import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const { ruleId } = await params;
  if (!z.string().uuid().safeParse(ruleId).success) return Response.json({ error: { code: "validation_error", message: "키워드 규칙 식별자가 올바르지 않습니다." } }, { status: 400 });
  const { data, error } = await getSupabaseAdmin()
    .from("user_filing_keyword_rules")
    .delete()
    .eq("id", ruleId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: { code: "service_unavailable", message: "키워드 규칙을 삭제하지 못했습니다." } }, { status: 503 });
  if (!data) return Response.json({ error: { code: "not_found", message: "키워드 규칙을 찾지 못했습니다." } }, { status: 404 });
  await recordAnalyticsEvent({ eventName: "alert_rule_removed", userId: user.id, properties: { rule_id: ruleId } });
  return Response.json({ ok: true });
}
