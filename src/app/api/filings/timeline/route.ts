import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { expectedFilingWindow, summarizeFilingTimeline } from "@/lib/filing-notifications/filing-timeline";
import { normalizeFilingTicker } from "@/lib/filing-notifications/company-identifiers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow, UserFilingSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const ticker = normalizeFilingTicker(request.nextUrl.searchParams.get("ticker") ?? "");
  if (!ticker) return Response.json({ error: { code: "validation_error", message: "종목 코드가 올바르지 않습니다." } }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: subscription, error: subscriptionError } = await admin
    .from("user_filing_subscriptions").select("*").eq("user_id", user.id).eq("ticker", ticker).maybeSingle<UserFilingSubscriptionRow>();
  if (subscriptionError) return Response.json({ error: { code: "service_unavailable", message: "공시 구독을 확인하지 못했습니다." } }, { status: 503 });
  if (!subscription?.enabled) return Response.json({ error: { code: "not_found", message: "공시 알림을 켠 기업에서만 타임라인을 볼 수 있습니다." } }, { status: 404 });

  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - 365);
  const { data: events, error: eventsError } = await admin
    .from("sec_filing_events").select("*").eq("cik", subscription.cik).gte("filing_date", fromDate.toISOString().slice(0, 10))
    .order("accepted_at", { ascending: false, nullsFirst: false }).order("filing_date", { ascending: false }).limit(120)
    .returns<SecFilingEventRow[]>();
  if (eventsError) return Response.json({ error: { code: "service_unavailable", message: "공시 타임라인을 불러오지 못했습니다." } }, { status: 503 });
  const filings = events ?? [];
  const eventIds = filings.map((event) => event.id);
  const { count: unreadCount } = eventIds.length
    ? await admin.from("user_filing_notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("filing_event_id", eventIds).is("read_at", null)
    : { count: 0 };
  const recentAmendments = filings.filter((event) => event.is_amendment).slice(0, 3)
    .map((event) => ({ id: event.id, form_type: event.form_type, filing_date: event.filing_date, primary_event_tag: event.primary_event_tag }));
  const last = filings[0] ?? null;

  return Response.json({
    ticker,
    last_filing_at: last?.accepted_at ?? (last ? `${last.filing_date}T00:00:00Z` : null),
    filings_last_90_days: filings.filter((event) => event.filing_date >= new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)).length,
    event_type_counts: summarizeFilingTimeline(filings.filter((event) => event.filing_date >= new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10))),
    unread_count: unreadCount ?? 0,
    recent_amendments: recentAmendments,
    expected_window: expectedFilingWindow(filings),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
