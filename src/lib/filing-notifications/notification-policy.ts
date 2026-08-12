import type { FilingNotificationPreferencesRow, SecForm4EventSummaryRow } from "@/types/database";

export type FilingAlertPriority = "urgent" | "normal" | "digest";
export const DEFAULT_FORM4_IMMEDIATE_MIN_VALUE_USD = 1_000_000;

export function isFilingInboxEligible(params: {
  formType: string;
  isAmendment: boolean;
  acceptedAt: string | null;
  firstSeenAt: string;
  subscribedAt: string;
  baselineCompletedAt: string | null;
  preference: FilingNotificationPreferencesRow | undefined;
}): boolean {
  const eventTime = params.acceptedAt ?? params.firstSeenAt;
  if (Date.parse(eventTime) < Date.parse(params.subscribedAt)) return false;
  // First observations without SEC acceptance timestamps are history only.
  if (!params.baselineCompletedAt && !params.acceptedAt) return false;
  const preference = params.preference;
  if (!preference) return true;
  if (!preference.enabled) return false;
  if (params.formType.startsWith("4")) {
    return preference.notify_form4 && preference.insider_notification_mode !== "none";
  }
  return params.formType.startsWith("8-K") ? preference.notify_8k : preference.notify_6k;
}

/**
 * Amendments always remain available in the filing inbox when the form is
 * enabled. Their default is simply no browser push, which preserves the audit
 * trail without turning routine corrections into noise.
 */
export function shouldQueueImmediateFilingPush(params: {
  formType?: string;
  isAmendment: boolean;
  priority: FilingAlertPriority;
  preference: FilingNotificationPreferencesRow | undefined;
  form4Summary?: Pick<SecForm4EventSummaryRow, "reported_purchase_value" | "reported_sale_value"> | null;
  deliveryMode?: FilingNotificationPreferencesRow["delivery_mode"];
}): boolean {
  const preference = params.preference;
  if (params.isAmendment && !preference?.include_amendments) return false;
  const deliveryMode = params.deliveryMode ?? preference?.delivery_mode ?? "important_immediate";
  if (deliveryMode === "daily_digest") return false;
  if (deliveryMode === "all_immediate") return true;
  if (params.priority === "digest") return false;
  if (!params.formType?.startsWith("4")) return true;
  return form4ReportedValue(params.form4Summary) >= (preference?.form4_immediate_min_value_usd ?? DEFAULT_FORM4_IMMEDIATE_MIN_VALUE_USD);
}

function form4ReportedValue(
  summary: Pick<SecForm4EventSummaryRow, "reported_purchase_value" | "reported_sale_value"> | null | undefined,
): number {
  return Math.max(summary?.reported_purchase_value ?? 0, summary?.reported_sale_value ?? 0);
}

/** Urgent regulatory events bypass the short per-ticker batching window. */
export function shouldBatchFilingPush(priority: FilingAlertPriority): boolean {
  return priority !== "urgent";
}

// Retained for existing callers while the filing worker is migrated to the
// separate inbox and push decisions above.
export const isFilingNotificationEligible = isFilingInboxEligible;
