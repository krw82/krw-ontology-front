import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { normalizeFilingTicker } from "@/lib/filing-notifications/company-identifiers";
import {
  disableFilingSubscription,
  enableFilingSubscription,
} from "@/lib/filing-notifications/subscription-service";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { recordRetentionMilestone } from "@/lib/retention/milestones";
import type { UserFilingSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_FILING_SUBSCRIPTIONS_PER_USER = 20;

async function requireUser() {
  try {
    const user = await getAuthUser();
    if (!user) throw new Error("No user");
    return { user } as const;
  } catch (error) {
    return { response: handleAuthError(error) } as const;
  }
}

async function tickerFromParams(params: Promise<{ ticker: string }>): Promise<string | null> {
  const { ticker } = await params;
  return normalizeFilingTicker(ticker);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const ticker = await tickerFromParams(params);
  if (!ticker) return Response.json({ error: { code: "validation_error", message: "종목 코드가 올바르지 않습니다." } }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const [{ data: existing }, { count, error: countError }] = await Promise.all([
      admin.from("user_filing_subscriptions").select("id, enabled").eq("user_id", auth.user.id).eq("ticker", ticker).maybeSingle<{ id: string; enabled: boolean }>(),
      admin.from("user_filing_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).eq("enabled", true),
    ]);
    if (countError) throw new Error(countError.message);
    if (!existing?.enabled && (count ?? 0) >= MAX_FILING_SUBSCRIPTIONS_PER_USER) {
      return Response.json({ error: { code: "limit_reached", message: `공시 알림 기업은 최대 ${MAX_FILING_SUBSCRIPTIONS_PER_USER}개까지 등록할 수 있습니다.` } }, { status: 409 });
    }
    const subscriptionResult = await enableFilingSubscription({
      userId: auth.user.id,
      ticker,
    });
    if (subscriptionResult.status === "unsupported") {
      return Response.json({ error: { code: "unsupported_company", message: "SEC 공시 식별자를 찾지 못했습니다." } }, { status: 422 });
    }
    if (subscriptionResult.status === "error") {
      throw new Error("subscription_unavailable");
    }
    const { data: subscription, error: selectError } = await admin
      .from("user_filing_subscriptions")
      .select("*")
      .eq("user_id", auth.user.id)
      .eq("ticker", ticker)
      .maybeSingle<UserFilingSubscriptionRow>();
    if (selectError || !subscription) throw new Error(selectError?.message ?? "subscription_unavailable");
    await recordRetentionMilestone(auth.user.id, "first_filing_subscription", { ticker });
    return Response.json({ subscription, sync_status: "pending" });
  } catch {
    return Response.json({ error: { code: "service_unavailable", message: "공시 구독을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." } }, { status: 503 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const ticker = await tickerFromParams(params);
  if (!ticker) return Response.json({ error: { code: "validation_error", message: "종목 코드가 올바르지 않습니다." } }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: subscription, error: findError } = await admin
    .from("user_filing_subscriptions")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("ticker", ticker)
    .maybeSingle<UserFilingSubscriptionRow>();
  if (findError) return Response.json({ error: { code: "service_unavailable", message: "공시 구독을 확인하지 못했습니다." } }, { status: 503 });
  if (!subscription || !subscription.enabled) return Response.json({ ok: true, already_disabled: true });

  const disabled = await disableFilingSubscription({
    userId: auth.user.id,
    ticker,
  });
  if (!disabled) return Response.json({ error: { code: "service_unavailable", message: "공시 구독을 해제하지 못했습니다." } }, { status: 503 });

  const { count, error: countError } = await admin
    .from("user_filing_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("cik", subscription.cik)
    .eq("enabled", true);
  if (!countError && count === 0) {
    await admin.from("sec_filing_poll_state").update({ enabled: false }).eq("cik", subscription.cik);
  }
  return Response.json({ ok: true });
}
