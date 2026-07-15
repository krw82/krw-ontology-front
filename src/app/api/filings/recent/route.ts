import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { normalizeFilingTicker } from "@/lib/filing-notifications/company-identifiers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow, UserFilingSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 12;

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const requestedTicker = request.nextUrl.searchParams.get("ticker");
  const ticker = requestedTicker ? normalizeFilingTicker(requestedTicker) : null;
  if (requestedTicker && !ticker) {
    return Response.json({ error: { code: "validation_error", message: "종목 코드가 올바르지 않습니다." } }, { status: 400 });
  }
  const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "3");
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(Math.floor(parsedLimit), MAX_LIMIT)) : 3;
  const admin = getSupabaseAdmin();
  let subscriptionQuery = admin
    .from("user_filing_subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .eq("enabled", true);
  if (ticker) subscriptionQuery = subscriptionQuery.eq("ticker", ticker);
  const { data: subscriptions, error: subscriptionError } = await subscriptionQuery.returns<UserFilingSubscriptionRow[]>();
  if (subscriptionError) {
    return Response.json({ error: { code: "service_unavailable", message: "공시 구독을 불러오지 못했습니다." } }, { status: 503 });
  }
  const cikToTicker = new Map<string, string>();
  for (const subscription of subscriptions ?? []) {
    if (!cikToTicker.has(subscription.cik)) cikToTicker.set(subscription.cik, subscription.ticker);
  }
  const ciks = [...cikToTicker.keys()];
  if (!ciks.length) return Response.json({ filings: [] });

  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - 90);
  const { data: events, error: eventError } = await admin
    .from("sec_filing_events")
    .select("*")
    .in("cik", ciks)
    .gte("filing_date", fromDate.toISOString().slice(0, 10))
    .order("accepted_at", { ascending: false, nullsFirst: false })
    .order("filing_date", { ascending: false })
    .limit(limit)
    .returns<SecFilingEventRow[]>();
  if (eventError) {
    return Response.json({ error: { code: "service_unavailable", message: "최근 공시를 불러오지 못했습니다." } }, { status: 503 });
  }
  return Response.json({
    filings: (events ?? []).map((event) => ({ ...event, display_ticker: cikToTicker.get(event.cik) ?? event.ticker })),
  });
}
