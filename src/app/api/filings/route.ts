import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow, UserFilingNotificationRow, UserFilingSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const admin = getSupabaseAdmin();
  const { data: notifications, error } = await admin
    .from("user_filing_notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<UserFilingNotificationRow[]>();
  if (error) {
    return Response.json({ error: { code: "service_unavailable", message: "공시 알림을 불러오지 못했습니다." } }, { status: 503 });
  }

  const eventIds = (notifications ?? []).map((notification) => notification.filing_event_id);
  const eventsById = new Map<string, SecFilingEventRow>();
  if (eventIds.length) {
    const { data: events } = await admin
      .from("sec_filing_events")
      .select("*")
      .in("id", eventIds)
      .returns<SecFilingEventRow[]>();
    for (const event of events ?? []) eventsById.set(event.id, event);
  }

  const ciks = Array.from(new Set([...eventsById.values()].map((event) => event.cik)));
  const { data: subscriptions } = ciks.length
    ? await admin
      .from("user_filing_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .in("cik", ciks)
      .order("enabled", { ascending: false })
      .returns<UserFilingSubscriptionRow[]>()
    : { data: [] as UserFilingSubscriptionRow[] };
  const tickerByCik = new Map<string, string>();
  for (const subscription of subscriptions ?? []) {
    if (!tickerByCik.has(subscription.cik)) tickerByCik.set(subscription.cik, subscription.ticker);
  }

  return Response.json({
    notifications: (notifications ?? []).flatMap((notification) => {
      const filing = eventsById.get(notification.filing_event_id);
      return filing ? [{ ...notification, filing: { ...filing, display_ticker: tickerByCik.get(filing.cik) ?? filing.ticker } }] : [];
    }),
  });
}
