import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecCompanyIdentifierRow, UserFilingSubscriptionRow } from "@/types/database";

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
  const { data: subscriptions, error } = await admin
    .from("user_filing_subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .order("enabled", { ascending: false })
    .order("ticker", { ascending: true })
    .returns<UserFilingSubscriptionRow[]>();
  if (error) {
    return Response.json({ error: { code: "service_unavailable", message: "공시 구독 목록을 불러오지 못했습니다." } }, { status: 503 });
  }
  const tickers = (subscriptions ?? []).map((subscription) => subscription.ticker);
  const { data: identifiers } = tickers.length
    ? await admin.from("sec_company_identifiers").select("*").in("ticker", tickers).returns<SecCompanyIdentifierRow[]>()
    : { data: [] as SecCompanyIdentifierRow[] };
  const identifierByTicker = new Map((identifiers ?? []).map((identifier) => [identifier.ticker, identifier]));
  return Response.json({
    subscriptions: (subscriptions ?? []).map((subscription) => ({
      ...subscription,
      company_name: identifierByTicker.get(subscription.ticker)?.company_name ?? null,
    })),
  });
}
