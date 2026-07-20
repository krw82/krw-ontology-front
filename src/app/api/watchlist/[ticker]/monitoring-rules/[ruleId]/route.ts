import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse, requireIndexedTicker } from "@/lib/watchlist/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string; ruleId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker, ruleId } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;
  if (!z.uuid().safeParse(ruleId).success) {
    return errorResponse(404, "not_found", "다음 확인 조건을 찾지 못했습니다.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_monitoring_rules")
    .update({ enabled: false })
    .eq("id", ruleId)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker)
    .select("id")
    .maybeSingle();
  if (error) {
    return errorResponse(500, "internal_error", "다음 확인 조건을 끄지 못했습니다.");
  }
  if (!data) {
    return errorResponse(404, "not_found", "다음 확인 조건을 찾지 못했습니다.");
  }
  return Response.json({ success: true, rule_id: ruleId });
}
