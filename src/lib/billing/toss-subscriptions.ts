import "server-only";

import { randomUUID } from "crypto";
import { getConfiguredBillingRedirectOrigin } from "@/lib/auth/origin";
import {
  addCalendarMonthsIso,
  calculateProratedUpgradeAmountKrw,
  getFirstWeeklyBoundaryAtOrAfterIso,
  getRenewalGraceUntilIso,
  getRenewalRetryAtIso,
} from "@/lib/billing/billing-cycle";
import { getBillingPlanFromStore } from "@/lib/billing/plan-store";
import {
  chargeTossBillingKey,
  deleteTossBillingKey,
  generateTossOrderId,
  getTossPaymentsConfig,
  getTossPaymentByOrderId,
  isTossPaymentsConfigured,
  issueTossBillingKey,
  TossPaymentsError,
  type TossBillingKeyResponse,
  type TossPaymentResponse,
} from "@/lib/billing/toss";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  BillingPlanVersionRow,
  BillingTossCheckoutSessionRow,
  BillingTossCustomerRow,
  BillingTossPaymentRow,
  BillingTossPlanKey,
  BillingTossSubscriptionRow,
  Json,
  UserEntitlementRow,
} from "@/types/database";

const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const MAX_RENEWAL_BATCH = 25;
const RENEWAL_LEASE_SECONDS = 5 * 60;

export class TossBillingFlowError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "TossBillingFlowError";
    this.code = code;
    this.status = status;
  }
}

export interface StartTossCheckoutResult {
  clientKey: string;
  customerKey: string;
  method: "CARD";
  successUrl: string;
  failUrl: string;
  sessionId: string;
  plan: {
    key: BillingTossPlanKey;
    label: string;
    amountKrw: number;
    orderName: string;
  };
}

export interface CompleteTossCheckoutResult {
  status: "paid" | "already_paid";
  planKey: BillingTossPlanKey;
  paymentId?: string;
  subscriptionId?: string;
}

export interface RenewDueTossSubscriptionsResult {
  checked: number;
  renewed: number;
  failed: number;
  expired: number;
}

export interface TossSubscriptionSummary {
  id: string;
  planKey: BillingTossPlanKey;
  status: BillingTossSubscriptionRow["status"];
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  pendingPlanKey: BillingTossPlanKey | null;
}

export interface ChangeTossPlanResult {
  status:
    | "upgraded"
    | "downgrade_scheduled"
    | "plan_change_cancelled"
    | "already_current";
  planKey: BillingTossPlanKey;
  effectiveAt: string;
  chargedAmountKrw: number;
}

function isPaidPlanKey(value: unknown): value is BillingTossPlanKey {
  return value === "standard" || value === "pro";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonObject(value: unknown): Json {
  if (value == null) return {};
  return JSON.parse(JSON.stringify(value)) as Json;
}

function getApprovedAt(payment: TossPaymentResponse): string {
  return (
    stringValue(payment.approvedAt) ??
    stringValue(payment.requestedAt) ??
    new Date().toISOString()
  );
}

function tossErrorCode(error: unknown): string {
  if (error instanceof TossPaymentsError) return error.code;
  if (error instanceof TossBillingFlowError) return error.code;
  return "billing_error";
}

function tossErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "결제 처리 중 오류가 발생했습니다.";
}

function isTossPaymentNotFound(error: unknown): boolean {
  return (
    error instanceof TossPaymentsError &&
    (error.status === 404 ||
      error.code === "NOT_FOUND_PAYMENT" ||
      error.code === "NOT_FOUND")
  );
}

function assertCompletedPayment({
  response,
  expectedAmountKrw,
  expectedOrderId,
}: {
  response: TossPaymentResponse;
  expectedAmountKrw: number;
  expectedOrderId: string;
}) {
  if (response.status !== "DONE") {
    throw new TossBillingFlowError(
      "payment_not_done",
      "자동결제 승인이 완료 상태가 아닙니다.",
      502,
    );
  }
  if (
    response.orderId !== expectedOrderId ||
    response.totalAmount !== expectedAmountKrw
  ) {
    throw new TossBillingFlowError(
      "payment_mismatch",
      "결제 승인 정보가 저장된 주문과 다릅니다.",
      502,
    );
  }
}

async function reconcilePaymentByOrderId(
  payment: BillingTossPaymentRow,
): Promise<TossPaymentResponse | null> {
  try {
    const response = await getTossPaymentByOrderId(payment.order_id);
    assertCompletedPayment({
      response,
      expectedAmountKrw: payment.amount_krw,
      expectedOrderId: payment.order_id,
    });
    return response;
  } catch (error) {
    if (isTossPaymentNotFound(error)) return null;
    throw error;
  }
}

async function loadCurrentPlanVersion(
  planKey: BillingTossPlanKey,
): Promise<BillingPlanVersionRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_plan_versions")
    .select(
      "id, plan_key, plan_version, monthly_price_krw, weekly_credit_limit_raw, credit_policy_version, provider_price_id, effective_from, effective_to, is_current, created_at",
    )
    .eq("plan_key", planKey)
    .eq("is_current", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle<BillingPlanVersionRow>();

  if (error || !data) {
    throw new TossBillingFlowError(
      "plan_version_missing",
      "현재 플랜 버전을 찾을 수 없습니다.",
      500,
    );
  }
  return data;
}

async function getOrCreateTossCustomerKey(
  userId: string,
): Promise<BillingTossCustomerRow> {
  const admin = getSupabaseAdmin();
  const { data: existing, error: readError } = await admin
    .from("billing_toss_customers")
    .select("user_id, customer_key, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle<BillingTossCustomerRow>();

  if (readError) {
    throw new TossBillingFlowError(
      "customer_lookup_failed",
      "결제 고객 정보를 불러오지 못했습니다.",
      500,
    );
  }
  if (existing) return existing;

  const customerKey = randomUUID();
  const { data, error } = await admin
    .from("billing_toss_customers")
    .insert({ user_id: userId, customer_key: customerKey })
    .select("user_id, customer_key, created_at, updated_at")
    .single<BillingTossCustomerRow>();

  if (!error && data) return data;

  const { data: raced, error: racedError } = await admin
    .from("billing_toss_customers")
    .select("user_id, customer_key, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle<BillingTossCustomerRow>();

  if (racedError || !raced) {
    throw new TossBillingFlowError(
      "customer_create_failed",
      "결제 고객 정보를 만들지 못했습니다.",
      500,
    );
  }
  return raced;
}

async function loadCheckoutSession(
  userId: string,
  sessionId: string,
): Promise<BillingTossCheckoutSessionRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_checkout_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle<BillingTossCheckoutSessionRow>();

  if (error || !data) {
    throw new TossBillingFlowError(
      "checkout_session_missing",
      "결제 세션을 찾을 수 없습니다.",
      404,
    );
  }
  return data;
}

async function markCheckoutFailed({
  session,
  code,
  message,
}: {
  session: BillingTossCheckoutSessionRow;
  code: string;
  message: string;
}) {
  const admin = getSupabaseAdmin();
  await admin
    .from("billing_toss_checkout_sessions")
    .update({
      status: code === "PAY_PROCESS_CANCELED" ? "cancelled" : "failed",
      failure_code: code,
      failure_message: message,
    })
    .eq("id", session.id);
}

async function loadInitialPayment(
  session: BillingTossCheckoutSessionRow,
): Promise<BillingTossPaymentRow> {
  const admin = getSupabaseAdmin();
  const { data: existing, error: existingError } = await admin
    .from("billing_toss_payments")
    .select("*")
    .eq("checkout_session_id", session.id)
    .eq("payment_kind", "initial")
    .maybeSingle<BillingTossPaymentRow>();

  if (existingError) {
    throw new TossBillingFlowError(
      "payment_lookup_failed",
      "결제 승인 정보를 불러오지 못했습니다.",
      500,
    );
  }
  if (existing) return existing;

  const { data, error } = await admin
    .from("billing_toss_payments")
    .insert({
      user_id: session.user_id,
      checkout_session_id: session.id,
      subscription_id: null,
      plan_key: session.plan_key,
      plan_version_id: session.plan_version_id,
      payment_kind: "initial",
      order_id: generateTossOrderId("krw"),
      order_name: session.order_name,
      idempotency_key: randomUUID(),
      amount_krw: session.amount_krw,
    })
    .select("*")
    .single<BillingTossPaymentRow>();

  if (error || !data) {
    throw new TossBillingFlowError(
      "payment_create_failed",
      "결제 승인 정보를 만들지 못했습니다.",
      500,
    );
  }
  return data;
}

function extractStoredBillingAuth(
  session: BillingTossCheckoutSessionRow,
): TossBillingKeyResponse | null {
  const response = session.provider_response;
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }
  const billingAuthorization = (response as Record<string, Json | undefined>)[
    "billingAuthorization"
  ];
  if (
    !billingAuthorization ||
    typeof billingAuthorization !== "object" ||
    Array.isArray(billingAuthorization)
  ) {
    return null;
  }
  const billingKey = stringValue(
    (billingAuthorization as Record<string, unknown>).billingKey,
  );
  const customerKey = stringValue(
    (billingAuthorization as Record<string, unknown>).customerKey,
  );
  if (!billingKey || !customerKey) return null;
  return billingAuthorization as unknown as TossBillingKeyResponse;
}

async function issueOrLoadBillingKey({
  session,
  authKey,
  customerKey,
}: {
  session: BillingTossCheckoutSessionRow;
  authKey: string;
  customerKey: string;
}): Promise<TossBillingKeyResponse> {
  const stored = extractStoredBillingAuth(session);
  if (stored) return stored;

  const admin = getSupabaseAdmin();
  const authorization = await issueTossBillingKey({
    authKey,
    customerKey,
    idempotencyKey: session.billing_key_idempotency_key,
  });

  await admin
    .from("billing_toss_checkout_sessions")
    .update({
      status: "auth_succeeded",
      auth_key_received_at: new Date().toISOString(),
      provider_response: jsonObject({
        billingAuthorization: authorization,
      }),
    })
    .eq("id", session.id);

  return authorization;
}

async function activatePaidEntitlement({
  userId,
  planKey,
  planVersionId,
  providerPriceId,
  customerKey,
  subscriptionId,
  periodStart,
  periodEnd,
  creditAnchorAt,
}: {
  userId: string;
  planKey: BillingTossPlanKey;
  planVersionId: string | null;
  providerPriceId: string | null;
  customerKey: string;
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  creditAnchorAt: string;
}) {
  await assertBillingEntitlementIsMutable(userId);
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("user_entitlements").upsert(
    {
      user_id: userId,
      plan_key: planKey,
      status: "active",
      current_period_start: periodStart,
      current_period_end: periodEnd,
      billing_period_start: periodStart,
      billing_period_end: periodEnd,
      credit_anchor_at: creditAnchorAt,
      plan_version_id: planVersionId,
      provider_customer_id: customerKey,
      provider_subscription_id: subscriptionId,
      provider_price_id: providerPriceId,
      cancel_at_period_end: false,
      plan_change_pending: null,
      grace_until: null,
      entitlement_updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    throw new TossBillingFlowError(
      "entitlement_update_failed",
      "구독 권한을 반영하지 못했습니다.",
      500,
    );
  }
}

async function loadExistingEntitlement(
  userId: string,
): Promise<UserEntitlementRow | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_entitlements")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<UserEntitlementRow>();

  if (error) return null;
  return data ?? null;
}

async function loadBillingEntitlementPlanKey(
  userId: string,
): Promise<UserEntitlementRow["plan_key"] | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_entitlements")
    .select("plan_key")
    .eq("user_id", userId)
    .maybeSingle<Pick<UserEntitlementRow, "plan_key">>();
  if (error) {
    throw new TossBillingFlowError(
      "billing_entitlement_lookup_failed",
      "결제 권한 상태를 확인하지 못했습니다.",
      500,
    );
  }
  return data?.plan_key ?? null;
}

async function assertBillingEntitlementIsMutable(userId: string) {
  if ((await loadBillingEntitlementPlanKey(userId)) !== "internal") return;
  throw new TossBillingFlowError(
    "internal_entitlement_billing_forbidden",
    "내부 운영 계정은 유료 구독을 변경할 수 없습니다.",
    409,
  );
}

async function loadOpenSubscription(
  userId: string,
): Promise<BillingTossSubscriptionRow | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "past_due", "grace", "pending_cancel"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<BillingTossSubscriptionRow>();

  if (error) {
    throw new TossBillingFlowError(
      "subscription_lookup_failed",
      "현재 구독 정보를 확인하지 못했습니다.",
      500,
    );
  }
  return data ?? null;
}

export async function getCurrentTossSubscriptionSummary(
  userId: string,
): Promise<TossSubscriptionSummary | null> {
  const subscription = await loadOpenSubscription(userId);
  if (!subscription) return null;
  return {
    id: subscription.id,
    planKey: subscription.plan_key,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    pendingPlanKey: subscription.pending_plan_key,
  };
}

async function createSubscriptionAfterPayment({
  session,
  authorization,
  payment,
  paidAt,
  periodEnd,
  creditAnchorAt,
}: {
  session: BillingTossCheckoutSessionRow;
  authorization: TossBillingKeyResponse;
  payment: BillingTossPaymentRow;
  paidAt: string;
  periodEnd: string;
  creditAnchorAt: string;
}): Promise<BillingTossSubscriptionRow> {
  const admin = getSupabaseAdmin();
  const { data: existingSubscription, error: existingError } = await admin
    .from("billing_toss_subscriptions")
    .select("*")
    .eq("last_payment_id", payment.id)
    .maybeSingle<BillingTossSubscriptionRow>();

  if (existingError) {
    throw new TossBillingFlowError(
      "subscription_lookup_failed",
      "구독 정보를 확인하지 못했습니다.",
      500,
    );
  }
  if (existingSubscription) {
    const planVersion = session.plan_version_id
      ? await loadPlanVersionById(session.plan_version_id)
      : null;
    await activatePaidEntitlement({
      userId: session.user_id,
      planKey: session.plan_key,
      planVersionId: session.plan_version_id,
      providerPriceId: planVersion?.provider_price_id ?? null,
      customerKey: authorization.customerKey,
      subscriptionId: existingSubscription.id,
      periodStart: existingSubscription.current_period_start,
      periodEnd: existingSubscription.current_period_end,
      creditAnchorAt,
    });
    return existingSubscription;
  }

  await admin
    .from("billing_toss_subscriptions")
    .update({
      status: "cancelled",
      cancel_at_period_end: false,
      cancelled_at: new Date().toISOString(),
    })
    .eq("user_id", session.user_id)
    .in("status", ["active", "past_due", "grace", "pending_cancel"]);

  const { data: subscription, error } = await admin
    .from("billing_toss_subscriptions")
    .insert({
      user_id: session.user_id,
      plan_key: session.plan_key,
      plan_version_id: session.plan_version_id,
      status: "active",
      customer_key: authorization.customerKey,
      billing_key: authorization.billingKey,
      billing_method: "CARD",
      billing_key_issued_at: stringValue(authorization.authenticatedAt),
      card_snapshot: jsonObject(authorization.card ?? {}),
      current_period_start: paidAt,
      current_period_end: periodEnd,
      next_billing_at: periodEnd,
      renewal_due_at: periodEnd,
      last_payment_id: payment.id,
    })
    .select("*")
    .single<BillingTossSubscriptionRow>();

  if (error || !subscription) {
    throw new TossBillingFlowError(
      "subscription_create_failed",
      "구독 정보를 저장하지 못했습니다.",
      500,
    );
  }

  await admin
    .from("billing_toss_payments")
    .update({ subscription_id: subscription.id })
    .eq("id", payment.id);

  const planVersion = session.plan_version_id
    ? await loadPlanVersionById(session.plan_version_id)
    : null;
  await activatePaidEntitlement({
    userId: session.user_id,
    planKey: session.plan_key,
    planVersionId: session.plan_version_id,
    providerPriceId: planVersion?.provider_price_id ?? null,
    customerKey: authorization.customerKey,
    subscriptionId: subscription.id,
    periodStart: paidAt,
    periodEnd,
    creditAnchorAt,
  });

  return subscription;
}

async function loadPlanVersionById(
  id: string,
): Promise<BillingPlanVersionRow | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_plan_versions")
    .select(
      "id, plan_key, plan_version, monthly_price_krw, weekly_credit_limit_raw, credit_policy_version, provider_price_id, effective_from, effective_to, is_current, created_at",
    )
    .eq("id", id)
    .maybeSingle<BillingPlanVersionRow>();

  if (error) return null;
  return data ?? null;
}

async function activateFreeEntitlement({
  userId,
  customerKey,
  subscriptionId,
  nowIso,
}: {
  userId: string;
  customerKey: string;
  subscriptionId: string;
  nowIso: string;
}) {
  const admin = getSupabaseAdmin();
  if ((await loadBillingEntitlementPlanKey(userId)) === "internal") {
    const internalAccessEnd = "9999-12-31T23:59:59.000Z";
    const { error: preserveError } = await admin
      .from("user_entitlements")
      .update({
        status: "active",
        current_period_end: internalAccessEnd,
        billing_period_end: internalAccessEnd,
        grace_until: null,
        cancel_at_period_end: false,
        plan_change_pending: null,
        entitlement_updated_at: nowIso,
      })
      .eq("user_id", userId)
      .eq("plan_key", "internal");
    if (preserveError) {
      throw new TossBillingFlowError(
        "internal_entitlement_preservation_failed",
        "내부 운영 권한을 보존하지 못했습니다.",
        500,
      );
    }
    return;
  }
  const { data: freePlan, error: planError } = await admin
    .from("billing_plan_versions")
    .select(
      "id, plan_key, plan_version, monthly_price_krw, weekly_credit_limit_raw, credit_policy_version, provider_price_id, effective_from, effective_to, is_current, created_at",
    )
    .eq("plan_key", "free")
    .eq("is_current", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle<BillingPlanVersionRow>();
  if (planError || !freePlan) {
    throw new TossBillingFlowError(
      "free_plan_version_missing",
      "무료 플랜 버전을 찾을 수 없습니다.",
      500,
    );
  }

  const accessEnd = addCalendarMonthsIso(nowIso, 1200);
  const { error } = await admin.from("user_entitlements").upsert(
    {
      user_id: userId,
      plan_key: "free",
      status: "active",
      current_period_start: nowIso,
      current_period_end: accessEnd,
      billing_period_start: nowIso,
      billing_period_end: accessEnd,
      credit_anchor_at: null,
      plan_version_id: freePlan.id,
      provider_customer_id: customerKey,
      provider_subscription_id: subscriptionId,
      provider_price_id: freePlan.provider_price_id,
      cancel_at_period_end: false,
      plan_change_pending: null,
      grace_until: null,
      entitlement_updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    throw new TossBillingFlowError(
      "free_entitlement_update_failed",
      "무료 플랜 전환을 반영하지 못했습니다.",
      500,
    );
  }
}

async function updatePaymentPaid(
  payment: BillingTossPaymentRow,
  response: TossPaymentResponse,
): Promise<BillingTossPaymentRow> {
  const admin = getSupabaseAdmin();
  const paidAt = getApprovedAt(response);
  const { data, error } = await admin
    .from("billing_toss_payments")
    .update({
      status: "paid",
      provider_payment_key: response.paymentKey,
      provider_status: response.status,
      provider_response: jsonObject(response),
      failure_code: null,
      failure_message: null,
      requested_at: stringValue(response.requestedAt),
      approved_at: stringValue(response.approvedAt),
      paid_at: paidAt,
    })
    .eq("id", payment.id)
    .select("*")
    .single<BillingTossPaymentRow>();

  if (error || !data) {
    throw new TossBillingFlowError(
      "payment_update_failed",
      "결제 승인 결과를 저장하지 못했습니다.",
      500,
    );
  }
  return data;
}

async function updatePaymentFailed({
  payment,
  error,
}: {
  payment: BillingTossPaymentRow;
  error: unknown;
}) {
  const admin = getSupabaseAdmin();
  await admin
    .from("billing_toss_payments")
    .update({
      status: "failed",
      failure_code: tossErrorCode(error),
      failure_message: tossErrorMessage(error),
      provider_response:
        error instanceof TossPaymentsError ? jsonObject(error.payload) : {},
    })
    .eq("id", payment.id);
}

async function updatePaymentUncertain(
  payment: BillingTossPaymentRow,
  error: unknown,
) {
  const admin = getSupabaseAdmin();
  await admin
    .from("billing_toss_payments")
    .update({
      status: "pending",
      failure_code: "payment_result_uncertain",
      failure_message: tossErrorMessage(error),
    })
    .eq("id", payment.id);
}

async function chargeInitialPayment({
  session,
  authorization,
  payment,
  userEmail,
  userName,
}: {
  session: BillingTossCheckoutSessionRow;
  authorization: TossBillingKeyResponse;
  payment: BillingTossPaymentRow;
  userEmail?: string | null;
  userName?: string | null;
}): Promise<TossPaymentResponse> {
  if (payment.status === "paid" && payment.provider_response) {
    return payment.provider_response as unknown as TossPaymentResponse;
  }

  try {
    if (payment.failure_code === "payment_result_uncertain") {
      const reconciled = await reconcilePaymentByOrderId(payment);
      if (reconciled) return reconciled;
    }

    const response = await chargeTossBillingKey({
      billingKey: authorization.billingKey,
      customerKey: authorization.customerKey,
      amountKrw: payment.amount_krw,
      orderId: payment.order_id,
      orderName: payment.order_name,
      customerEmail: userEmail,
      customerName: userName,
      idempotencyKey: payment.idempotency_key,
    });

    assertCompletedPayment({
      response,
      expectedAmountKrw: session.amount_krw,
      expectedOrderId: payment.order_id,
    });
    return response;
  } catch (error) {
    if (
      !(error instanceof TossPaymentsError) &&
      !(error instanceof TossBillingFlowError)
    ) {
      await updatePaymentUncertain(payment, error);
      throw new TossBillingFlowError(
        "payment_result_uncertain",
        "결제 결과를 확인 중입니다. 잠시 후 이 페이지를 새로고침해 주세요.",
        503,
      );
    }
    await updatePaymentFailed({ payment, error });
    await markCheckoutFailed({
      session,
      code: tossErrorCode(error),
      message: tossErrorMessage(error),
    });
    throw error;
  }
}

export async function startTossBillingCheckout({
  userId,
  planKey,
  requestOrigin,
}: {
  userId: string;
  planKey: unknown;
  requestOrigin: string;
}): Promise<StartTossCheckoutResult> {
  if (!isPaidPlanKey(planKey)) {
    throw new TossBillingFlowError(
      "unsupported_plan",
      "유료 구독은 Standard 또는 Pro 플랜만 선택할 수 있습니다.",
    );
  }

  const plan = await getBillingPlanFromStore(planKey);
  if (plan.monthlyPriceKrw <= 0) {
    throw new TossBillingFlowError(
      "plan_not_billable",
      "결제 가능한 유료 플랜이 아닙니다.",
    );
  }

  if (!isTossPaymentsConfigured()) {
    throw new TossBillingFlowError(
      "billing_provider_not_configured",
      "결제 준비 중입니다.",
      503,
    );
  }

  await assertBillingEntitlementIsMutable(userId);

  const existingSubscription = await loadOpenSubscription(userId);
  if (existingSubscription) {
    throw new TossBillingFlowError(
      "subscription_already_exists",
      "기존 유료 구독은 플랜 변경 기능으로 조정해 주세요.",
      409,
    );
  }

  const config = getTossPaymentsConfig();
  const planVersion = await loadCurrentPlanVersion(planKey);
  const customer = await getOrCreateTossCustomerKey(userId);
  const origin = getConfiguredBillingRedirectOrigin(requestOrigin);
  if (!origin) {
    throw new TossBillingFlowError(
      "billing_redirect_origin_not_configured",
      "결제 리다이렉트 origin 환경변수가 설정되지 않았습니다.",
      503,
    );
  }
  const sessionId = randomUUID();
  const successUrl = `${origin}/api/billing/toss/success?sessionId=${sessionId}`;
  const failUrl = `${origin}/api/billing/toss/fail?sessionId=${sessionId}`;
  const orderName = `KRW Ontology ${plan.label} 월 구독`;
  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS).toISOString();

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_checkout_sessions")
    .insert({
      id: sessionId,
      user_id: userId,
      plan_key: planKey,
      plan_version_id: planVersion.id,
      amount_krw: plan.monthlyPriceKrw,
      order_name: orderName,
      customer_key: customer.customer_key,
      success_url: successUrl,
      fail_url: failUrl,
      expires_at: expiresAt,
    })
    .select("*")
    .single<BillingTossCheckoutSessionRow>();

  if (error || !data) {
    throw new TossBillingFlowError(
      "checkout_session_create_failed",
      "결제 세션을 만들지 못했습니다.",
      500,
    );
  }

  return {
    clientKey: config.clientKey,
    customerKey: customer.customer_key,
    method: "CARD",
    successUrl,
    failUrl,
    sessionId,
    plan: {
      key: planKey,
      label: plan.label,
      amountKrw: plan.monthlyPriceKrw,
      orderName,
    },
  };
}

export async function completeTossBillingCheckout({
  userId,
  sessionId,
  authKey,
  customerKey,
  userEmail,
  userName,
}: {
  userId: string;
  sessionId: string;
  authKey: string;
  customerKey: string;
  userEmail?: string | null;
  userName?: string | null;
}): Promise<CompleteTossCheckoutResult> {
  const session = await loadCheckoutSession(userId, sessionId);

  if (session.status === "paid") {
    return {
      status: "already_paid",
      planKey: session.plan_key,
    };
  }
  await assertBillingEntitlementIsMutable(userId);
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await markCheckoutFailed({
      session,
      code: "checkout_expired",
      message: "결제 세션이 만료되었습니다.",
    });
    throw new TossBillingFlowError(
      "checkout_expired",
      "결제 세션이 만료되었습니다.",
      410,
    );
  }
  if (session.customer_key !== customerKey) {
    await markCheckoutFailed({
      session,
      code: "customer_key_mismatch",
      message: "결제 고객 키가 세션과 다릅니다.",
    });
    throw new TossBillingFlowError(
      "customer_key_mismatch",
      "결제 고객 키가 세션과 다릅니다.",
      400,
    );
  }

  const existingEntitlement = await loadExistingEntitlement(userId);
  const keepWeeklyAnchor =
    existingEntitlement?.status === "active" &&
    isPaidPlanKey(existingEntitlement.plan_key) &&
    existingEntitlement.credit_anchor_at;

  const authorization = await issueOrLoadBillingKey({
    session,
    authKey,
    customerKey,
  });
  const payment = await loadInitialPayment(session);
  const paymentResponse = await chargeInitialPayment({
    session,
    authorization,
    payment,
    userEmail,
    userName,
  });
  const paidPayment =
    payment.status === "paid" ? payment : await updatePaymentPaid(payment, paymentResponse);
  const paidAt = paidPayment.paid_at ?? getApprovedAt(paymentResponse);
  const periodEnd = addCalendarMonthsIso(paidAt, 1);
  const subscription = await createSubscriptionAfterPayment({
    session,
    authorization,
    payment: paidPayment,
    paidAt,
    periodEnd,
    creditAnchorAt: keepWeeklyAnchor || paidAt,
  });

  const admin = getSupabaseAdmin();
  await admin
    .from("billing_toss_checkout_sessions")
    .update({
      status: "paid",
      provider_response: jsonObject({
        billingAuthorization: authorization,
        initialPayment: paymentResponse,
      }),
    })
    .eq("id", session.id);

  return {
    status: "paid",
    planKey: session.plan_key,
    paymentId: paidPayment.id,
    subscriptionId: subscription.id,
  };
}

export async function markTossBillingCheckoutFailed({
  userId,
  sessionId,
  code,
  message,
}: {
  userId: string;
  sessionId: string;
  code: string;
  message: string;
}) {
  const session = await loadCheckoutSession(userId, sessionId);
  await markCheckoutFailed({ session, code, message });
}

async function loadOrCreatePeriodPayment({
  subscription,
  planVersion,
  paymentKind,
  amountKrw,
  periodStart,
  periodEnd,
  orderName,
}: {
  subscription: BillingTossSubscriptionRow;
  planVersion: BillingPlanVersionRow;
  paymentKind: "renewal" | "upgrade";
  amountKrw: number;
  periodStart: string;
  periodEnd: string;
  orderName: string;
}): Promise<BillingTossPaymentRow> {
  const admin = getSupabaseAdmin();
  const { data: existingRows, error: existingError } = await admin
    .from("billing_toss_payments")
    .select("*")
    .eq("subscription_id", subscription.id)
    .eq("payment_kind", paymentKind)
    .eq("billing_period_start", periodStart)
    .eq("plan_key", planVersion.plan_key as BillingTossPlanKey)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .returns<BillingTossPaymentRow[]>();

  if (existingError) {
    throw new TossBillingFlowError(
      "payment_lookup_failed",
      "결제 시도 정보를 불러오지 못했습니다.",
      500,
    );
  }

  const existing = existingRows?.[0] ?? null;
  if (existing && (existing.status === "pending" || existing.status === "paid")) {
    return existing;
  }

  const { data, error } = await admin
    .from("billing_toss_payments")
    .insert({
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      checkout_session_id: null,
      plan_key: planVersion.plan_key as BillingTossPlanKey,
      plan_version_id: planVersion.id,
      payment_kind: paymentKind,
      order_id: generateTossOrderId("krw"),
      order_name: orderName,
      idempotency_key: randomUUID(),
      amount_krw: amountKrw,
      billing_period_start: periodStart,
      billing_period_end: periodEnd,
      attempt_number: (existing?.attempt_number ?? 0) + 1,
    })
    .select("*")
    .single<BillingTossPaymentRow>();

  if (error || !data) {
    throw new TossBillingFlowError(
      "payment_create_failed",
      "결제 시도 정보를 만들지 못했습니다.",
      500,
    );
  }
  return data;
}

async function chargeStoredPayment({
  subscription,
  payment,
}: {
  subscription: BillingTossSubscriptionRow;
  payment: BillingTossPaymentRow;
}): Promise<BillingTossPaymentRow> {
  if (payment.status === "paid") return payment;

  try {
    if (payment.failure_code === "payment_result_uncertain") {
      const reconciled = await reconcilePaymentByOrderId(payment);
      if (reconciled) {
        try {
          return await updatePaymentPaid(payment, reconciled);
        } catch (error) {
          await updatePaymentUncertain(payment, error);
          throw new TossBillingFlowError(
            "payment_result_uncertain",
            "승인된 결제 결과를 저장하지 못했습니다. 기존 주문을 재조회합니다.",
            503,
          );
        }
      }
    }

    const response = await chargeTossBillingKey({
      billingKey: subscription.billing_key,
      customerKey: subscription.customer_key,
      amountKrw: payment.amount_krw,
      orderId: payment.order_id,
      orderName: payment.order_name,
      idempotencyKey: payment.idempotency_key,
    });
    assertCompletedPayment({
      response,
      expectedAmountKrw: payment.amount_krw,
      expectedOrderId: payment.order_id,
    });
    try {
      return await updatePaymentPaid(payment, response);
    } catch (error) {
      await updatePaymentUncertain(payment, error);
      throw new TossBillingFlowError(
        "payment_result_uncertain",
        "승인된 결제 결과를 저장하지 못했습니다. 기존 주문을 재조회합니다.",
        503,
      );
    }
  } catch (error) {
    if (
      error instanceof TossBillingFlowError &&
      error.code === "payment_result_uncertain"
    ) {
      throw error;
    }
    if (
      !(error instanceof TossPaymentsError) &&
      !(error instanceof TossBillingFlowError)
    ) {
      await updatePaymentUncertain(payment, error);
      throw new TossBillingFlowError(
        "payment_result_uncertain",
        "결제 결과를 확인하지 못했습니다. 기존 주문을 재조회합니다.",
        503,
      );
    }
    await updatePaymentFailed({ payment, error });
    throw error;
  }
}

async function applyRenewedEntitlement({
  subscription,
  targetPlan,
  periodStart,
  periodEnd,
  now,
}: {
  subscription: BillingTossSubscriptionRow;
  targetPlan: BillingPlanVersionRow;
  periodStart: string;
  periodEnd: string;
  now: Date;
}) {
  const existingEntitlement = await loadExistingEntitlement(subscription.user_id);
  const creditAnchorAt =
    existingEntitlement?.credit_anchor_at ?? subscription.current_period_start;
  const isDowngrade =
    subscription.plan_key === "pro" && targetPlan.plan_key === "standard";
  const effectiveAt = isDowngrade
    ? getFirstWeeklyBoundaryAtOrAfterIso({
        anchor: creditAnchorAt,
        at: periodStart,
      })
    : periodStart;

  if (!isDowngrade || new Date(effectiveAt).getTime() <= now.getTime()) {
    await activatePaidEntitlement({
      userId: subscription.user_id,
      planKey: targetPlan.plan_key as BillingTossPlanKey,
      planVersionId: targetPlan.id,
      providerPriceId: targetPlan.provider_price_id,
      customerKey: subscription.customer_key,
      subscriptionId: subscription.id,
      periodStart,
      periodEnd,
      creditAnchorAt,
    });
    return;
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("user_entitlements")
    .update({
      status: "active",
      current_period_start: periodStart,
      current_period_end: periodEnd,
      billing_period_start: periodStart,
      billing_period_end: periodEnd,
      provider_customer_id: subscription.customer_key,
      provider_subscription_id: subscription.id,
      provider_price_id: targetPlan.provider_price_id,
      cancel_at_period_end: false,
      grace_until: null,
      plan_change_pending: jsonObject({
        plan_key: targetPlan.plan_key,
        plan_version_id: targetPlan.id,
        effective_at: effectiveAt,
      }),
      entitlement_updated_at: now.toISOString(),
    })
    .eq("user_id", subscription.user_id);
  if (error) {
    throw new TossBillingFlowError(
      "entitlement_plan_change_failed",
      "다운그레이드 권한 일정을 반영하지 못했습니다.",
      500,
    );
  }
}

async function handleRenewalFailure({
  subscription,
  now,
}: {
  subscription: BillingTossSubscriptionRow;
  now: Date;
}) {
  const nowIso = now.toISOString();
  const graceUntil =
    subscription.grace_until ??
    getRenewalGraceUntilIso(subscription.renewal_due_at);
  const nextAttemptCount = subscription.renewal_attempt_count + 1;
  const admin = getSupabaseAdmin();

  if (new Date(graceUntil).getTime() <= now.getTime()) {
    const { error: subscriptionError } = await admin
      .from("billing_toss_subscriptions")
      .update({
        status: "expired",
        grace_until: graceUntil,
        renewal_attempt_count: nextAttemptCount,
        renewal_lease_owner: null,
        renewal_lease_expires_at: null,
      })
      .eq("id", subscription.id);
    if (subscriptionError) {
      throw new TossBillingFlowError(
        "renewal_expiry_update_failed",
        "만료된 구독 상태를 저장하지 못했습니다.",
        500,
      );
    }
    await activateFreeEntitlement({
      userId: subscription.user_id,
      customerKey: subscription.customer_key,
      subscriptionId: subscription.id,
      nowIso,
    });
    return;
  }

  const retryAt = getRenewalRetryAtIso({
    now,
    attemptCount: subscription.renewal_attempt_count,
  });
  const { error: subscriptionError } = await admin
    .from("billing_toss_subscriptions")
    .update({
      status: "grace",
      grace_until: graceUntil,
      renewal_attempt_count: nextAttemptCount,
      next_billing_at: retryAt,
      renewal_lease_owner: null,
      renewal_lease_expires_at: null,
    })
    .eq("id", subscription.id);
  if (subscriptionError) {
    throw new TossBillingFlowError(
      "renewal_grace_update_failed",
      "결제 유예 상태를 저장하지 못했습니다.",
      500,
    );
  }
  const { error: entitlementError } = await admin
    .from("user_entitlements")
    .update({
      status: "grace",
      grace_until: graceUntil,
      entitlement_updated_at: nowIso,
    })
    .eq("user_id", subscription.user_id)
    .eq("provider_subscription_id", subscription.id);
  if (entitlementError) {
    throw new TossBillingFlowError(
      "renewal_grace_entitlement_update_failed",
      "결제 유예 권한을 저장하지 못했습니다.",
      500,
    );
  }
}

async function renewSubscription(
  subscription: BillingTossSubscriptionRow,
  now: Date,
): Promise<void> {
  const leaseOwner = subscription.renewal_lease_owner;
  if (!leaseOwner) {
    throw new TossBillingFlowError(
      "renewal_lease_missing",
      "갱신 구독 lease가 없습니다.",
      409,
    );
  }
  await assertBillingEntitlementIsMutable(subscription.user_id);
  const targetPlanKey = subscription.pending_plan_key ?? subscription.plan_key;
  const targetPlan =
    (subscription.pending_plan_version_id
      ? await loadPlanVersionById(subscription.pending_plan_version_id)
      : null) ?? (await loadCurrentPlanVersion(targetPlanKey));
  const amountKrw = targetPlan.monthly_price_krw;
  if (amountKrw <= 0) {
    throw new TossBillingFlowError(
      "renewal_plan_missing",
      "갱신할 플랜 금액을 찾을 수 없습니다.",
      500,
    );
  }

  const periodStart = subscription.renewal_due_at;
  const periodEnd = addCalendarMonthsIso(periodStart, 1);
  const payment = await loadOrCreatePeriodPayment({
    subscription,
    planVersion: targetPlan,
    paymentKind: "renewal",
    amountKrw,
    periodStart,
    periodEnd,
    orderName: `KRW Ontology ${targetPlan.plan_key} 월 구독 갱신`,
  });

  try {
    const paidPayment = await chargeStoredPayment({ subscription, payment });
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("billing_toss_subscriptions")
      .update({
        plan_key: targetPlan.plan_key as BillingTossPlanKey,
        plan_version_id: targetPlan.id,
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        renewal_due_at: periodEnd,
        next_billing_at: periodEnd,
        grace_until: null,
        renewal_attempt_count: 0,
        renewal_lease_owner: null,
        renewal_lease_expires_at: null,
        pending_plan_key: null,
        pending_plan_version_id: null,
        last_payment_id: paidPayment.id,
      })
      .eq("id", subscription.id)
      .eq("renewal_lease_owner", leaseOwner);
    if (error) {
      throw new TossBillingFlowError(
        "subscription_renewal_update_failed",
        "갱신된 구독 정보를 저장하지 못했습니다.",
        500,
      );
    }

    await applyRenewedEntitlement({
      subscription,
      targetPlan,
      periodStart,
      periodEnd,
      now,
    });
  } catch (error) {
    await handleRenewalFailure({ subscription, now });
    throw error;
  }
}

async function expirePendingCancelledSubscriptions(nowIso: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_subscriptions")
    .select("*")
    .eq("status", "pending_cancel")
    .lte("current_period_end", nowIso)
    .returns<BillingTossSubscriptionRow[]>();

  if (error || !data?.length) return 0;

  for (const subscription of data) {
    await admin
      .from("billing_toss_subscriptions")
      .update({
        status: "cancelled",
        cancelled_at: nowIso,
        pending_plan_key: null,
        pending_plan_version_id: null,
        renewal_lease_owner: null,
        renewal_lease_expires_at: null,
      })
      .eq("id", subscription.id);
    await activateFreeEntitlement({
      userId: subscription.user_id,
      customerKey: subscription.customer_key,
      subscriptionId: subscription.id,
      nowIso,
    });
    try {
      await deleteTossBillingKey(subscription.billing_key);
    } catch (error) {
      console.warn("[billing] failed to delete cancelled Toss billing key", {
        subscriptionId: subscription.id,
        code: tossErrorCode(error),
      });
    }
  }

  return data.length;
}

export async function renewDueTossSubscriptions({
  now = new Date(),
  limit = MAX_RENEWAL_BATCH,
  workerId = `billing-${randomUUID()}`,
}: {
  now?: Date;
  limit?: number;
  workerId?: string;
} = {}): Promise<RenewDueTossSubscriptionsResult> {
  const nowIso = now.toISOString();
  const expired = await expirePendingCancelledSubscriptions(nowIso);
  if (!isTossPaymentsConfigured()) {
    return { checked: 0, renewed: 0, failed: 0, expired };
  }

  const admin = getSupabaseAdmin();
  const batchLimit = Math.min(Math.max(limit, 1), MAX_RENEWAL_BATCH);
  const { data: claims, error: claimError } = await admin.rpc(
    "claim_due_toss_subscriptions",
    {
      p_worker_id: workerId,
      p_now: nowIso,
      p_limit: batchLimit,
      p_lease_seconds: RENEWAL_LEASE_SECONDS,
    },
  );

  if (claimError) {
    throw new TossBillingFlowError(
      "renewal_claim_failed",
      "갱신 대상 구독을 선점하지 못했습니다.",
      500,
    );
  }

  const subscriptionIds = (claims ?? []).map((row) => row.subscription_id);
  if (subscriptionIds.length === 0) {
    return { checked: 0, renewed: 0, failed: 0, expired };
  }

  const { data, error } = await admin
    .from("billing_toss_subscriptions")
    .select("*")
    .in("id", subscriptionIds)
    .eq("renewal_lease_owner", workerId)
    .returns<BillingTossSubscriptionRow[]>();
  if (error) {
    throw new TossBillingFlowError(
      "renewal_lookup_failed",
      "선점한 갱신 구독을 불러오지 못했습니다.",
      500,
    );
  }

  let renewed = 0;
  let failed = 0;
  for (const subscription of data ?? []) {
    try {
      await renewSubscription(subscription, now);
      renewed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    checked: data?.length ?? 0,
    renewed,
    failed,
    expired,
  };
}

export async function changeCurrentTossPlan({
  userId,
  targetPlanKey,
  now = new Date(),
}: {
  userId: string;
  targetPlanKey: unknown;
  now?: Date;
}): Promise<ChangeTossPlanResult> {
  if (!isPaidPlanKey(targetPlanKey)) {
    throw new TossBillingFlowError(
      "unsupported_plan",
      "Standard 또는 Pro 플랜만 선택할 수 있습니다.",
    );
  }
  if (!isTossPaymentsConfigured()) {
    throw new TossBillingFlowError(
      "billing_provider_not_configured",
      "결제 준비 중입니다.",
      503,
    );
  }

  await assertBillingEntitlementIsMutable(userId);

  const subscription = await loadOpenSubscription(userId);
  if (!subscription) {
    throw new TossBillingFlowError(
      "subscription_missing",
      "변경할 유료 구독을 찾을 수 없습니다.",
      404,
    );
  }
  if (subscription.status !== "active" || subscription.cancel_at_period_end) {
    throw new TossBillingFlowError(
      "subscription_not_changeable",
      "현재 상태에서는 플랜을 변경할 수 없습니다.",
      409,
    );
  }

  const admin = getSupabaseAdmin();
  if (targetPlanKey === subscription.plan_key) {
    if (!subscription.pending_plan_key) {
      return {
        status: "already_current",
        planKey: subscription.plan_key,
        effectiveAt: now.toISOString(),
        chargedAmountKrw: 0,
      };
    }

    await admin
      .from("billing_toss_subscriptions")
      .update({
        pending_plan_key: null,
        pending_plan_version_id: null,
      })
      .eq("id", subscription.id);
    await admin
      .from("user_entitlements")
      .update({
        plan_change_pending: null,
        entitlement_updated_at: now.toISOString(),
      })
      .eq("user_id", userId);
    return {
      status: "plan_change_cancelled",
      planKey: subscription.plan_key,
      effectiveAt: now.toISOString(),
      chargedAmountKrw: 0,
    };
  }

  const currentPlan =
    (subscription.plan_version_id
      ? await loadPlanVersionById(subscription.plan_version_id)
      : null) ?? (await loadCurrentPlanVersion(subscription.plan_key));
  const targetPlan = await loadCurrentPlanVersion(targetPlanKey);

  if (targetPlan.monthly_price_krw < currentPlan.monthly_price_krw) {
    const { error } = await admin
      .from("billing_toss_subscriptions")
      .update({
        pending_plan_key: targetPlanKey,
        pending_plan_version_id: targetPlan.id,
      })
      .eq("id", subscription.id);
    if (error) {
      throw new TossBillingFlowError(
        "downgrade_schedule_failed",
        "다운그레이드 예약을 저장하지 못했습니다.",
        500,
      );
    }
    await admin
      .from("user_entitlements")
      .update({
        plan_change_pending: jsonObject({
          plan_key: targetPlanKey,
          plan_version_id: targetPlan.id,
          scheduled_for: subscription.renewal_due_at,
          effective_at: null,
        }),
        entitlement_updated_at: now.toISOString(),
      })
      .eq("user_id", userId);
    return {
      status: "downgrade_scheduled",
      planKey: targetPlanKey,
      effectiveAt: subscription.renewal_due_at,
      chargedAmountKrw: 0,
    };
  }

  const amountKrw = calculateProratedUpgradeAmountKrw({
    currentMonthlyPriceKrw: currentPlan.monthly_price_krw,
    targetMonthlyPriceKrw: targetPlan.monthly_price_krw,
    periodStart: subscription.current_period_start,
    periodEnd: subscription.current_period_end,
    now,
  });
  let paidPayment: BillingTossPaymentRow | null = null;
  if (amountKrw > 0) {
    const payment = await loadOrCreatePeriodPayment({
      subscription,
      planVersion: targetPlan,
      paymentKind: "upgrade",
      amountKrw,
      periodStart: subscription.current_period_start,
      periodEnd: subscription.current_period_end,
      orderName: `KRW Ontology ${targetPlan.plan_key} 플랜 업그레이드`,
    });
    paidPayment = await chargeStoredPayment({ subscription, payment });
  }

  const { error: subscriptionError } = await admin
    .from("billing_toss_subscriptions")
    .update({
      plan_key: targetPlanKey,
      plan_version_id: targetPlan.id,
      pending_plan_key: null,
      pending_plan_version_id: null,
      last_payment_id: paidPayment?.id ?? subscription.last_payment_id,
    })
    .eq("id", subscription.id);
  if (subscriptionError) {
    throw new TossBillingFlowError(
      "upgrade_subscription_update_failed",
      "업그레이드된 구독 정보를 저장하지 못했습니다.",
      500,
    );
  }

  const entitlement = await loadExistingEntitlement(userId);
  await activatePaidEntitlement({
    userId,
    planKey: targetPlanKey,
    planVersionId: targetPlan.id,
    providerPriceId: targetPlan.provider_price_id,
    customerKey: subscription.customer_key,
    subscriptionId: subscription.id,
    periodStart: subscription.current_period_start,
    periodEnd: subscription.current_period_end,
    creditAnchorAt:
      entitlement?.credit_anchor_at ?? subscription.current_period_start,
  });

  return {
    status: "upgraded",
    planKey: targetPlanKey,
    effectiveAt: now.toISOString(),
    chargedAmountKrw: amountKrw,
  };
}

export async function cancelCurrentTossSubscription(userId: string): Promise<{
  status: "pending_cancel";
  subscriptionId: string;
  currentPeriodEnd: string;
}> {
  const admin = getSupabaseAdmin();
  const { data: subscription, error } = await admin
    .from("billing_toss_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "grace", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<BillingTossSubscriptionRow>();

  if (error || !subscription) {
    throw new TossBillingFlowError(
      "subscription_missing",
      "해지할 활성 구독을 찾을 수 없습니다.",
      404,
    );
  }

  const { error: updateError } = await admin
    .from("billing_toss_subscriptions")
    .update({
      status: "pending_cancel",
      cancel_at_period_end: true,
      pending_plan_key: null,
      pending_plan_version_id: null,
    })
    .eq("id", subscription.id);

  if (updateError) {
    throw new TossBillingFlowError(
      "subscription_cancel_failed",
      "구독 해지 예약을 저장하지 못했습니다.",
      500,
    );
  }

  await admin
    .from("user_entitlements")
    .update({
      cancel_at_period_end: true,
      plan_change_pending: null,
      entitlement_updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider_subscription_id", subscription.id);

  return {
    status: "pending_cancel",
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.current_period_end,
  };
}
