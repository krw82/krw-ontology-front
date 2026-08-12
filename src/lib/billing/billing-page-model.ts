import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  BillingTossOperationRow,
  BillingTossSubscriptionRow,
  UserEntitlementRow,
} from "@/types/database";

const OPEN_OPERATION_STATUSES = [
  "prepared",
  "awaiting_auth",
  "processing",
  "payment_uncertain",
  "paid_pending_apply",
] as const;

export type BillingUiState =
  | "free"
  | "active"
  | "pending_cancel"
  | "grace"
  | "past_due"
  | "processing"
  | "unavailable";

export interface BillingPageModel {
  state: BillingUiState;
  subscription: BillingTossSubscriptionRow | null;
  activeOperation: BillingTossOperationRow | null;
  requestedOperation: BillingTossOperationRow | null;
  unavailableReason: string | null;
}

function isPaidEntitlement(
  entitlement: Pick<
    UserEntitlementRow,
    "plan_key" | "status" | "provider_subscription_id"
  > | null,
): boolean {
  return Boolean(
    entitlement &&
      (entitlement.plan_key === "lite" ||
        entitlement.plan_key === "standard" ||
        entitlement.plan_key === "pro") &&
      ["active", "past_due", "grace"].includes(entitlement.status),
  );
}

export function resolveBillingUiState({
  subscription,
  activeOperation,
}: Pick<BillingPageModel, "subscription" | "activeOperation">): BillingUiState {
  // Payment reconciliation has priority over a historical subscription state.
  // The UI must not offer another mutation while one durable operation remains
  // open, including when Toss has already charged but DB fulfillment lags.
  // A prepared quote has not been confirmed and is replaceable by a new quote,
  // so a page reload must not trap a user in a fake "processing" screen.
  if (activeOperation && activeOperation.status !== "prepared") {
    return "processing";
  }
  if (!subscription) return "free";
  if (subscription.status === "pending_cancel") return "pending_cancel";
  if (subscription.status === "grace") return "grace";
  if (subscription.status === "past_due") return "past_due";
  return "active";
}

export function operationResultMessage(
  operation: BillingTossOperationRow | null,
): { tone: "success" | "error" | "info"; message: string } | null {
  if (!operation) return null;

  if (operation.status === "succeeded") {
    const messageByKind: Record<BillingTossOperationRow["kind"], string> = {
      subscribe: "구독 결제가 완료되었습니다. 새 플랜이 적용되었습니다.",
      upgrade: "업그레이드가 완료되었습니다. 새 플랜을 바로 이용할 수 있습니다.",
      downgrade: "플랜 변경이 다음 결제일부터 예약되었습니다.",
      cancel_subscription:
        "구독 해지 상태가 반영되었습니다. 남은 이용 기간은 그대로 유지됩니다.",
      resume_subscription: "해지 예약을 취소했습니다. 구독이 계속 유지됩니다.",
      cancel_plan_change: "예약된 플랜 변경을 취소했습니다.",
      replace_payment_method:
        "결제 수단이 변경되었습니다. 미납 결제를 바로 다시 확인합니다.",
    };
    return { tone: "success", message: messageByKind[operation.kind] };
  }

  if (operation.status === "failed" || operation.status === "cancelled") {
    return {
      tone: "error",
      message:
        operation.failure_message ??
        "요청을 완료하지 못했습니다. 기존 구독 상태는 유지됩니다.",
    };
  }

  if (operation.status === "expired") {
    return {
      tone: "info",
      message: "이전 결제 확인 시간이 만료되었습니다. 금액을 다시 확인해 주세요.",
    };
  }

  return null;
}

/**
 * Produces the one UI state used by every plan card. A subscription query
 * failure is intentionally surfaced as unavailable instead of falling back to
 * Free, preventing accidental duplicate checkout while the source of truth is
 * unknown.
 */
export async function getBillingPageModel({
  userId,
  requestedOperationId,
}: {
  userId: string;
  requestedOperationId: string | null;
}): Promise<BillingPageModel> {
  const admin = getSupabaseAdmin();
  const [subscriptionResult, entitlementResult, activeOperationResult, requestedOperationResult] =
    await Promise.all([
      admin
        .from("billing_toss_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["active", "past_due", "grace", "pending_cancel"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<BillingTossSubscriptionRow>(),
      admin
        .from("user_entitlements")
        .select("plan_key, status, provider_subscription_id")
        .eq("user_id", userId)
        .maybeSingle<
          Pick<
            UserEntitlementRow,
            "plan_key" | "status" | "provider_subscription_id"
          >
        >(),
      admin
        .from("billing_toss_operations")
        .select("*")
        .eq("user_id", userId)
        .in("status", [...OPEN_OPERATION_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<BillingTossOperationRow>(),
      requestedOperationId
        ? admin
            .from("billing_toss_operations")
            .select("*")
            .eq("id", requestedOperationId)
            .eq("user_id", userId)
            .maybeSingle<BillingTossOperationRow>()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (
    subscriptionResult.error ||
    entitlementResult.error ||
    activeOperationResult.error ||
    requestedOperationResult.error
  ) {
    return {
      state: "unavailable",
      subscription: null,
      activeOperation: null,
      requestedOperation: null,
      unavailableReason:
        "구독 상태를 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const subscription = subscriptionResult.data ?? null;
  const entitlement = entitlementResult.data ?? null;
  const activeOperation = activeOperationResult.data ?? null;
  const requestedOperation = requestedOperationResult.data ?? null;

  if (
    subscription &&
    (entitlement?.provider_subscription_id !== subscription.id ||
      entitlement.plan_key !== subscription.plan_key)
  ) {
    return {
      state: "unavailable",
      subscription,
      activeOperation,
      requestedOperation,
      unavailableReason:
        "구독과 이용 권한을 동기화하고 있습니다. 결제 변경은 잠시 후 다시 시도해 주세요.",
    };
  }

  if (!subscription && isPaidEntitlement(entitlement)) {
    return {
      state: "unavailable",
      subscription: null,
      activeOperation,
      requestedOperation,
      unavailableReason:
        "구독 상태를 동기화하고 있습니다. 결제 변경은 잠시 후 다시 시도해 주세요.",
    };
  }

  return {
    state: resolveBillingUiState({ subscription, activeOperation }),
    subscription,
    activeOperation,
    requestedOperation,
    unavailableReason: null,
  };
}
