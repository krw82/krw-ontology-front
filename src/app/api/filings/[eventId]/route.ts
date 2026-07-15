import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { loadFilingDocuments } from "@/lib/filing-notifications/filing-documents";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { FilingKeywordMatchRow, SecFilingEventRow, UserFilingSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const { eventId } = await params;
  if (!z.string().uuid().safeParse(eventId).success) {
    return Response.json({ error: { code: "validation_error", message: "공시 식별자가 올바르지 않습니다." } }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const { data: filing, error: filingError } = await admin
    .from("sec_filing_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle<SecFilingEventRow>();
  if (filingError) return Response.json({ error: { code: "service_unavailable", message: "공시를 불러오지 못했습니다." } }, { status: 503 });
  if (!filing) return Response.json({ error: { code: "not_found", message: "공시를 찾지 못했습니다." } }, { status: 404 });

  const [{ data: subscription }, { data: notification }] = await Promise.all([
    admin
      .from("user_filing_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .eq("cik", filing.cik)
      .order("enabled", { ascending: false })
      .limit(1)
      .maybeSingle<UserFilingSubscriptionRow>(),
    admin
      .from("user_filing_notifications")
      .select("id, read_at")
      .eq("user_id", user.id)
      .eq("filing_event_id", filing.id)
      .maybeSingle<{ id: string; read_at: string | null }>(),
  ]);
  if (!subscription && !notification) {
    return Response.json({ error: { code: "forbidden", message: "구독한 기업의 공시만 확인할 수 있습니다." } }, { status: 403 });
  }
  if (notification && !notification.read_at) {
    await admin
      .from("user_filing_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notification.id)
      .eq("user_id", user.id);
  }
  let documentResult;
  let unreadCount: number | null = null;
  let keywordMatches: FilingKeywordMatchRow[] = [];
  try {
    [documentResult, { count: unreadCount }, keywordMatches] = await Promise.all([
      loadFilingDocuments(filing),
      admin
        .from("user_filing_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null),
      (async () => {
        const { data, error } = await admin
          .from("filing_keyword_matches")
          .select("*")
          .eq("user_id", user.id)
          .eq("filing_event_id", filing.id)
          .order("created_at", { ascending: true })
          .returns<FilingKeywordMatchRow[]>();
        if (error) throw error;
        return data ?? [];
      })(),
    ]);
  } catch {
    return Response.json({ error: { code: "service_unavailable", message: "공시 첨부를 불러오지 못했습니다." } }, { status: 503 });
  }
  return Response.json({
    filing: { ...filing, display_ticker: subscription?.ticker ?? filing.ticker, enrichment_status: documentResult.status },
    documents: documentResult.documents,
    keyword_matches: keywordMatches,
    unread_count: unreadCount ?? 0,
  });
}
