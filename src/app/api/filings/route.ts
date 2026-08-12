import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow, UserFilingNotificationRow, UserFilingSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketIssueInboxRow = {
  id: string;
  published_at: string | null;
  updated_at: string | null;
};

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

  const eventIds = Array.from(new Set((notifications ?? [])
    .map((notification) => notification.filing_event_id)
    .filter((id): id is string => Boolean(id))));
  const marketIssueIds = Array.from(new Set((notifications ?? [])
    .map((notification) => notification.market_issue_id)
    .filter((id): id is string => Boolean(id))));
  const eventsById = new Map<string, SecFilingEventRow>();
  const marketIssuesById = new Map<string, MarketIssueInboxRow>();
  const [eventsResult, marketIssuesResult] = await Promise.all([
    eventIds.length
      ? admin
      .from("sec_filing_events")
      .select("*")
      .in("id", eventIds)
      .returns<SecFilingEventRow[]>()
      : Promise.resolve({ data: [] as SecFilingEventRow[] }),
    marketIssueIds.length
      ? admin
        .from("market_issues")
        .select("id,published_at,updated_at")
        .in("id", marketIssueIds)
        .eq("state", "published")
        .is("merged_into_issue_id", null)
        .returns<MarketIssueInboxRow[]>()
      : Promise.resolve({ data: [] as MarketIssueInboxRow[] }),
  ]);
  for (const event of eventsResult.data ?? []) eventsById.set(event.id, event);
  for (const issue of marketIssuesResult.data ?? []) marketIssuesById.set(issue.id, issue);

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
      if (notification.filing_event_id) {
        const filing = eventsById.get(notification.filing_event_id);
        return filing
          ? [{ ...notification, filing: { ...filing, display_ticker: tickerByCik.get(filing.cik) ?? filing.ticker } }]
          : [];
      }
      if (notification.market_issue_id) {
        const issue = marketIssuesById.get(notification.market_issue_id);
        const occurredAt = issue?.published_at ?? issue?.updated_at ?? notification.created_at;
        const ticker = notification.ticker ?? "시장";
        return issue ? [{
          ...notification,
          filing: {
            id: issue.id,
            ticker,
            display_ticker: ticker,
            form_type: "시장 뉴스",
            filing_date: occurredAt.slice(0, 10),
            is_amendment: false,
          },
        }] : [];
      }
      return [];
    }),
  });
}
