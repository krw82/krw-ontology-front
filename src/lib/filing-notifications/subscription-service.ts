import { ensureSecCompanyIdentifier } from "@/lib/filing-notifications/company-identifiers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type EnableFilingSubscriptionResult =
  | { status: "on" }
  | { status: "unsupported" }
  | { status: "error" };

/**
 * 관심=알림 통일: 구독 생성은 개수 검사 없이 여기서만 한다.
 * 상한은 coverage 한도(setCompanyCoverageLevelWithEvent)가 좌우한다.
 */
export async function enableFilingSubscription(input: {
  userId: string;
  ticker: string;
}): Promise<EnableFilingSubscriptionResult> {
  try {
    const admin = getSupabaseAdmin();
    const identifier = await ensureSecCompanyIdentifier(input.ticker);
    if (!identifier?.cik) return { status: "unsupported" };
    const now = new Date().toISOString();
    const { error } = await admin
      .from("user_filing_subscriptions")
      .upsert(
        {
          user_id: input.userId,
          ticker: input.ticker,
          cik: identifier.cik,
          enabled: true,
          subscribed_at: now,
          disabled_at: null,
        },
        { onConflict: "user_id,ticker" },
      );
    if (error) return { status: "error" };
    const [{ error: pollError }, { error: preferenceError }] = await Promise.all([
      admin
        .from("sec_filing_poll_state")
        .upsert(
          { cik: identifier.cik, enabled: true, next_poll_at: now },
          { onConflict: "cik" },
        ),
      admin
        .from("filing_notification_preferences")
        .upsert(
          { user_id: input.userId },
          { onConflict: "user_id", ignoreDuplicates: true },
        ),
    ]);
    if (pollError || preferenceError) return { status: "error" };
    return { status: "on" };
  } catch {
    return { status: "error" };
  }
}

export async function disableFilingSubscription(input: {
  userId: string;
  ticker: string;
}): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { error } = await admin
      .from("user_filing_subscriptions")
      .update({ enabled: false, disabled_at: now })
      .eq("user_id", input.userId)
      .eq("ticker", input.ticker)
      .eq("enabled", true);
    return !error;
  } catch {
    return false;
  }
}
