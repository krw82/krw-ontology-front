import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { buildPrivateFilingRss } from "@/lib/filing-notifications/feeds";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow, UserFilingFeedTokenRow, UserFilingSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return new Response("Not found", { status: 404 });
  const admin = getSupabaseAdmin();
  const { data: feedToken } = await admin.from("user_filing_feed_tokens").select("*")
    .eq("token_hash", createHash("sha256").update(token).digest("hex")).is("revoked_at", null).maybeSingle<UserFilingFeedTokenRow>();
  if (!feedToken) return new Response("Not found", { status: 404 });
  const { data: subscriptions } = await admin.from("user_filing_subscriptions").select("*").eq("user_id", feedToken.user_id).eq("enabled", true).returns<UserFilingSubscriptionRow[]>();
  const ciks = [...new Set((subscriptions ?? []).map((subscription) => subscription.cik))];
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { data: events } = ciks.length
    ? await admin.from("sec_filing_events").select("*").in("cik", ciks).gte("filing_date", since).order("accepted_at", { ascending: false, nullsFirst: false }).limit(100).returns<SecFilingEventRow[]>()
    : { data: [] as SecFilingEventRow[] };
  const tickerByCik = new Map((subscriptions ?? []).map((subscription) => [subscription.cik, subscription.ticker]));
  await admin.from("user_filing_feed_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", feedToken.id);
  return new Response(buildPrivateFilingRss({ origin: request.nextUrl.origin, events: (events ?? []).map((event) => ({ ...event, display_ticker: tickerByCik.get(event.cik) ?? event.ticker })) }), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
