import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingPollStateRow, UserFilingSubscriptionRow } from "@/types/database";

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
  const { data: subscriptions, error: subscriptionError } = await admin
    .from("user_filing_subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .eq("enabled", true)
    .returns<UserFilingSubscriptionRow[]>();
  if (subscriptionError) return Response.json({ error: { code: "service_unavailable", message: "공시 모니터링 상태를 불러오지 못했습니다." } }, { status: 503 });
  const ciks = Array.from(new Set((subscriptions ?? []).map((subscription) => subscription.cik)));
  if (!ciks.length) return Response.json({ status: "not_tracking", tracked_companies: 0, last_success_at: null, overdue_companies: 0 });
  const { data: states, error: stateError } = await admin
    .from("sec_filing_poll_state")
    .select("*")
    .in("cik", ciks)
    .returns<SecFilingPollStateRow[]>();
  if (stateError) return Response.json({ error: { code: "service_unavailable", message: "공시 모니터링 상태를 불러오지 못했습니다." } }, { status: 503 });
  const now = Date.now();
  const overdue = (states ?? []).filter((state) => !state.last_success_at || now - Date.parse(state.last_success_at) > 15 * 60 * 1000);
  const latest = (states ?? []).map((state) => state.last_success_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return Response.json({
    status: overdue.length ? "attention" : "healthy",
    tracked_companies: ciks.length,
    last_success_at: latest,
    overdue_companies: overdue.length,
  });
}
