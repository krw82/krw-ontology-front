import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { ensureSecCompanyIdentifier, normalizeFilingTicker } from "@/lib/filing-notifications/company-identifiers";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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
    const identifier = await ensureSecCompanyIdentifier(ticker);
    if (!identifier?.cik) {
      return Response.json({ error: { code: "unsupported_company", message: "SEC 공시 식별자를 찾지 못했습니다." } }, { status: 422 });
    }
    const now = new Date().toISOString();
    const { data: subscription, error } = await admin
      .from("user_filing_subscriptions")
      .upsert(
        {
          user_id: auth.user.id,
          ticker,
          cik: identifier.cik,
          enabled: true,
          subscribed_at: now,
          disabled_at: null,
        },
        { onConflict: "user_id,ticker" },
      )
      .select("*")
      .single<UserFilingSubscriptionRow>();
    if (error || !subscription) throw new Error(error?.message ?? "subscription_unavailable");
    const [{ error: pollError }, { error: preferenceError }] = await Promise.all([
      admin.from("sec_filing_poll_state").upsert(
        { cik: identifier.cik, enabled: true, next_poll_at: now },
        { onConflict: "cik" },
      ),
      admin.from("filing_notification_preferences").upsert(
        { user_id: auth.user.id },
        { onConflict: "user_id", ignoreDuplicates: true },
      ),
    ]);
    if (pollError || preferenceError) throw new Error(pollError?.message ?? preferenceError?.message ?? "poll_state_unavailable");
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

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("user_filing_subscriptions")
    .update({ enabled: false, disabled_at: now })
    .eq("id", subscription.id)
    .eq("user_id", auth.user.id);
  if (updateError) return Response.json({ error: { code: "service_unavailable", message: "공시 구독을 해제하지 못했습니다." } }, { status: 503 });

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
