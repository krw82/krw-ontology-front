import "server-only";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { getConfiguredBillingRedirectOrigin } from "@/lib/auth/origin";
import { areBillingWritesEnabled } from "@/lib/billing/billing-writes";
import {
  addCalendarMonthsIso,
  getFirstWeeklyBoundaryAtOrAfterIso,
  getRenewalGraceUntilIso,
  getRenewalRetryAtIso,
} from "@/lib/billing/billing-cycle";
import { getBillingPlan } from "@/lib/billing/plans";
import {
  chargeTossBillingKey,
  deleteTossBillingKey,
  generateTossOrderId,
  getTossPaymentsConfig,
  getTossPaymentByOrderId,
  isTossPaymentsCheckoutConfigured,
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
  BillingTossOperationKind,
  BillingTossOperationRow,
  BillingTossOperationStatus,
  BillingTossPaymentRow,
  BillingTossPlanKey,
  BillingTossRetiredBillingKeyRow,
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

export interface RenewDueTossSubscriptionsResult {
  checked: number;
  renewed: number;
  failed: number;
  expired: number;
  recovered: number;
}

export interface TossBillingOperationQuote {
  operationId: string;
  kind: BillingTossOperationKind;
  fromPlanKey: BillingTossPlanKey | null;
  targetPlanKey: BillingTossPlanKey | null;
  chargedTodayKrw: number;
  nextChargeKrw: number;
  effectiveAt: string | null;
  nextBillingAt: string | null;
  expiresAt: string;
}

export interface TossBillingCheckoutAuth {
  clientKey: string;
  customerKey: string;
  method: "CARD";
  successUrl: string;
  failUrl: string;
}

export interface ConfirmTossBillingOperationResult {
  operationId: string;
  status: BillingTossOperationStatus;
  checkout?: TossBillingCheckoutAuth;
}

export interface CompleteTossBillingCallbackResult {
  operationId: string;
  status: "paid" | "already_paid" | "payment_recovery_pending";
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

function assertBillingWritesAreEnabled() {
  if (areBillingWritesEnabled()) return;
  throw new TossBillingFlowError(
    "billing_writes_disabled",
    "결제 변경을 잠시 점검하고 있습니다. 현재 구독 상태는 유지됩니다.",
    503,
  );
}

function callbackTokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createCallbackToken(): string {
  return randomBytes(32).toString("base64url");
}

function hasValidCallbackToken(
  session: BillingTossCheckoutSessionRow,
  callbackToken: string | null | undefined,
): boolean {
  if (!callbackToken || !session.callback_token_hash) return false;
  const expected = Buffer.from(session.callback_token_hash, "hex");
  const actual = Buffer.from(callbackTokenHash(callbackToken), "hex");
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

function isOpenOperationStatus(
  status: BillingTossOperationStatus,
): status is
  | "prepared"
  | "awaiting_auth"
  | "processing"
  | "payment_uncertain"
  | "paid_pending_apply" {
  return [
    "prepared",
    "awaiting_auth",
    "processing",
    "payment_uncertain",
    "paid_pending_apply",
  ].includes(status);
}

function toOperationQuote(
  operation: BillingTossOperationRow,
): TossBillingOperationQuote {
  return {
    operationId: operation.id,
    kind: operation.kind,
    fromPlanKey: operation.from_plan_key,
    targetPlanKey: operation.target_plan_key,
    chargedTodayKrw: operation.quoted_amount_krw,
    nextChargeKrw: operation.next_amount_krw,
    effectiveAt: operation.effective_at,
    nextBillingAt: operation.next_billing_at,
    expiresAt: operation.expires_at,
  };
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
  if (error instanceof TossBillingFlowError) return error.message;
  // Provider payloads are retained only in the protected payment record for
  // reconciliation. Do not copy an arbitrary upstream message into an
  // operation that is rendered back to the buyer.
  if (error instanceof TossPaymentsError) {
    return "결제 요청이 승인되지 않았습니다. 카드 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  return "결제 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

function isTossPaymentNotFound(error: unknown): boolean {
  return (
    error instanceof TossPaymentsError &&
    (error.status === 404 ||
      error.code === "NOT_FOUND_PAYMENT" ||
      error.code === "NOT_FOUND")
  );
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
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

async function loadCheckoutSessionForCallback(
  sessionId: string,
): Promise<BillingTossCheckoutSessionRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_checkout_sessions")
    .select("*")
    .eq("id", sessionId)
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

async function loadTossBillingOperation(
  userId: string,
  operationId: string,
): Promise<BillingTossOperationRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_operations")
    .select("*")
    .eq("id", operationId)
    .eq("user_id", userId)
    .maybeSingle<BillingTossOperationRow>();
  if (error || !data) {
    throw new TossBillingFlowError(
      "billing_operation_missing",
      "결제 작업을 찾을 수 없습니다.",
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
    .eq("id", session.id)
    .in("status", ["created", "auth_succeeded", "processing"]);
}

async function markCheckoutProcessing(
  session: BillingTossCheckoutSessionRow,
): Promise<BillingTossCheckoutSessionRow> {
  if (session.status === "paid") return session;
  if (session.status === "processing") return session;
  if (session.status !== "created" && session.status !== "auth_succeeded") {
    throw new TossBillingFlowError(
      "checkout_session_not_actionable",
      "이 결제 세션은 더 이상 진행할 수 없습니다.",
      409,
    );
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_checkout_sessions")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
      failure_code: null,
      failure_message: null,
    })
    .eq("id", session.id)
    .in("status", ["created", "auth_succeeded"])
    .select("*")
    .maybeSingle<BillingTossCheckoutSessionRow>();

  if (!error && data) return data;

  const refreshed = await loadCheckoutSession(session.user_id, session.id);
  if (refreshed.status === "paid" || refreshed.status === "processing") {
    return refreshed;
  }
  throw new TossBillingFlowError(
    "checkout_session_not_actionable",
    "이 결제 세션은 더 이상 진행할 수 없습니다.",
    409,
  );
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
      operation_id: session.operation_id,
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

  if (!error && data) return data;

  // Two success redirects for the same billing auth may race. The unique
  // checkout-session index is the source of truth; load its winner instead of
  // creating a second Toss order.
  if (isUniqueConstraintViolation(error)) {
    const { data: raced, error: racedError } = await admin
      .from("billing_toss_payments")
      .select("*")
      .eq("checkout_session_id", session.id)
      .eq("payment_kind", "initial")
      .maybeSingle<BillingTossPaymentRow>();
    if (!racedError && raced) return raced;
  }

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

  const { error } = await admin
    .from("billing_toss_checkout_sessions")
    .update({
      status: session.status === "processing" ? "processing" : "auth_succeeded",
      auth_key_received_at: new Date().toISOString(),
      provider_response: jsonObject({
        billingAuthorization: authorization,
      }),
    })
    .eq("id", session.id);
  if (error) {
    throw new TossBillingFlowError(
      "billing_authorization_store_failed",
      "결제 인증 정보를 저장하지 못했습니다.",
      500,
    );
  }

  return authorization;
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

async function loadSubscriptionById(
  userId: string,
  subscriptionId: string,
): Promise<BillingTossSubscriptionRow> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_subscriptions")
    .select("*")
    .eq("id", subscriptionId)
    .eq("user_id", userId)
    .maybeSingle<BillingTossSubscriptionRow>();
  if (error || !data) {
    throw new TossBillingFlowError(
      "subscription_lookup_failed",
      "구독 정보를 확인하지 못했습니다.",
      500,
    );
  }
  return data;
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

type PaidPaymentOperation = "initial" | "renewal" | "upgrade";

async function markPaymentFulfillmentFailed(
  payment: BillingTossPaymentRow,
  error: unknown,
) {
  const admin = getSupabaseAdmin();
  await admin
    .from("billing_toss_payments")
    .update({
      fulfillment_status: "failed",
      fulfillment_error: tossErrorMessage(error).slice(0, 500),
      fulfillment_attempted_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .eq("status", "paid");
}

async function finalizePaidBillingPayment({
  operation,
  userId,
  subscriptionId,
  payment,
  plan,
  periodStart,
  periodEnd,
  creditAnchorAt,
  customerKey,
  checkoutSessionId,
  billingKey,
  billingKeyIssuedAt,
  cardSnapshot,
  renewalLeaseOwner,
  deferPlanChangeUntil,
  now,
}: {
  operation: PaidPaymentOperation;
  userId: string;
  subscriptionId: string;
  payment: BillingTossPaymentRow;
  plan: BillingPlanVersionRow;
  periodStart: string;
  periodEnd: string;
  creditAnchorAt: string;
  customerKey: string;
  checkoutSessionId: string | null;
  billingKey: string | null;
  billingKeyIssuedAt: string | null;
  cardSnapshot: Json;
  renewalLeaseOwner: string | null;
  deferPlanChangeUntil: string | null;
  now: Date;
}): Promise<{ subscriptionId: string; alreadyApplied: boolean }> {
  const admin = getSupabaseAdmin();
  const nowIso = now.toISOString();
  const { data, error } = await admin.rpc("finalize_toss_billing_payment", {
    p_operation: operation,
    p_user_id: userId,
    p_subscription_id: subscriptionId,
    p_payment_id: payment.id,
    p_checkout_session_id: checkoutSessionId,
    p_plan_version_id: plan.id,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_credit_anchor_at: creditAnchorAt,
    p_customer_key: customerKey,
    p_billing_key: billingKey,
    p_billing_key_issued_at: billingKeyIssuedAt,
    p_card_snapshot: cardSnapshot,
    p_paid_at: payment.paid_at ?? nowIso,
    p_renewal_lease_owner: renewalLeaseOwner,
    p_defer_plan_change_until: deferPlanChangeUntil,
    p_now: nowIso,
  });

  if (error || !data?.[0]?.subscription_id) {
    if (error) await markPaymentFulfillmentFailed(payment, error);
    const message = error?.message ?? "결제 반영 결과가 비어 있습니다.";
    if (message.includes("billing_open_subscription_exists")) {
      throw new TossBillingFlowError(
        "subscription_already_exists",
        "이미 활성화된 유료 구독이 있어 새 결제를 반영하지 않았습니다. 문의 코드와 함께 고객지원에 알려주세요.",
        409,
      );
    }
    if (message.includes("internal_entitlement_billing_forbidden")) {
      throw new TossBillingFlowError(
        "internal_entitlement_billing_forbidden",
        "내부 운영 계정은 유료 구독을 변경할 수 없습니다.",
        409,
      );
    }
    throw new TossBillingFlowError(
      "payment_fulfillment_pending",
      "결제는 승인됐지만 구독 반영을 재시도 중입니다. 잠시 후 다시 확인해 주세요.",
      503,
    );
  }

  return {
    subscriptionId: data[0].subscription_id,
    alreadyApplied: Boolean(data[0].already_applied),
  };
}

function getRenewalPlanChangeDeferral({
  subscription,
  targetPlan,
  periodStart,
  creditAnchorAt,
  now,
}: {
  subscription: BillingTossSubscriptionRow;
  targetPlan: BillingPlanVersionRow;
  periodStart: string;
  creditAnchorAt: string;
  now: Date;
}): string | null {
  const isDowngrade =
    subscription.plan_key === "pro" && targetPlan.plan_key === "standard";
  if (!isDowngrade) return null;
  const effectiveAt = getFirstWeeklyBoundaryAtOrAfterIso({
    anchor: creditAnchorAt,
    at: periodStart,
  });
  return new Date(effectiveAt).getTime() > now.getTime() ? effectiveAt : null;
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
      fulfillment_status: "pending",
      fulfillment_error: null,
      fulfillment_attempted_at: null,
      fulfillment_applied_at: null,
      requested_at: stringValue(response.requestedAt),
      approved_at: stringValue(response.approvedAt),
      paid_at: paidAt,
    })
    .eq("id", payment.id)
    .select("*")
    .single<BillingTossPaymentRow>();

  if (!error && data) return data;

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
    const reconciled = await reconcilePaymentByOrderId(payment);
    if (reconciled) return reconciled;

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
      error instanceof TossBillingFlowError &&
      (error.code === "payment_not_done" || error.code === "payment_mismatch")
    ) {
      try {
        await updatePaymentUncertain(payment, error);
      } catch {
        // Keep the original reconciliation error. The operation itself still
        // retains the provider order id for worker recovery.
      }
      throw new TossBillingFlowError(
        "payment_result_uncertain",
        "결제 결과를 확인하고 있습니다. 기존 주문만 다시 조회합니다.",
        503,
      );
    }
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

  // The renewal lease normally serializes this path, while a plan-change
  // request can still race with a retry. The partial period index gives both
  // callers one durable order id to reconcile against Toss.
  if (isUniqueConstraintViolation(error)) {
    const { data: racedRows, error: racedError } = await admin
      .from("billing_toss_payments")
      .select("*")
      .eq("subscription_id", subscription.id)
      .eq("payment_kind", paymentKind)
      .eq("billing_period_start", periodStart)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .returns<BillingTossPaymentRow[]>();
    const raced = racedRows?.[0] ?? null;
    if (
      !racedError &&
      raced &&
      (raced.status === "pending" || raced.status === "paid")
    ) {
      return raced;
    }
  }

  if (error || !data) {
    throw new TossBillingFlowError(
      "payment_create_failed",
      "결제 시도 정보를 만들지 못했습니다.",
      500,
    );
  }
  return data;
}

async function loadOrCreateOperationUpgradePayment({
  operation,
  subscription,
  planVersion,
}: {
  operation: BillingTossOperationRow;
  subscription: BillingTossSubscriptionRow;
  planVersion: BillingPlanVersionRow;
}): Promise<BillingTossPaymentRow> {
  const admin = getSupabaseAdmin();
  const { data: existing, error: existingError } = await admin
    .from("billing_toss_payments")
    .select("*")
    .eq("operation_id", operation.id)
    .maybeSingle<BillingTossPaymentRow>();
  if (existingError) {
    throw new TossBillingFlowError(
      "payment_lookup_failed",
      "업그레이드 결제 정보를 불러오지 못했습니다.",
      500,
    );
  }
  if (existing) return existing;

  const { data, error } = await admin
    .from("billing_toss_payments")
    .insert({
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      checkout_session_id: null,
      operation_id: operation.id,
      plan_key: planVersion.plan_key as BillingTossPlanKey,
      plan_version_id: planVersion.id,
      payment_kind: "upgrade",
      order_id: generateTossOrderId("krw"),
      order_name: `KRW Ontology ${planVersion.plan_key} 플랜 업그레이드`,
      idempotency_key: randomUUID(),
      amount_krw: operation.quoted_amount_krw,
      billing_period_start: subscription.current_period_start,
      billing_period_end: subscription.current_period_end,
      attempt_number: 1,
    })
    .select("*")
    .single<BillingTossPaymentRow>();

  if (isUniqueConstraintViolation(error)) {
    const { data: raced, error: racedError } = await admin
      .from("billing_toss_payments")
      .select("*")
      .eq("operation_id", operation.id)
      .maybeSingle<BillingTossPaymentRow>();
    if (!racedError && raced) return raced;
  }
  if (error || !data) {
    throw new TossBillingFlowError(
      "payment_create_failed",
      "업그레이드 결제 정보를 만들지 못했습니다.",
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
      (error.code === "payment_result_uncertain" ||
        error.code === "payment_not_done" ||
        error.code === "payment_mismatch")
    ) {
      if (error.code !== "payment_result_uncertain") {
        try {
          await updatePaymentUncertain(payment, error);
        } catch {
          // Keep the original reconciliation error. The payment row still has
          // the same idempotent order id and will be queried again later.
        }
      }
      throw new TossBillingFlowError(
        "payment_result_uncertain",
        "결제 결과를 확인하고 있습니다. 기존 주문만 다시 조회합니다.",
        503,
      );
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
  const retryAt =
    new Date(graceUntil).getTime() <= now.getTime()
      ? null
      : getRenewalRetryAtIso({
          now,
          attemptCount: subscription.renewal_attempt_count,
        });
  const { data, error } = await admin.rpc("apply_toss_renewal_failure", {
    p_user_id: subscription.user_id,
    p_subscription_id: subscription.id,
    p_grace_until: graceUntil,
    p_retry_at: retryAt,
    p_next_attempt_count: nextAttemptCount,
    p_now: nowIso,
  });
  if (error || (data !== "grace" && data !== "expired")) {
    throw new TossBillingFlowError(
      "renewal_failure_apply_failed",
      "결제 실패 상태를 안전하게 반영하지 못했습니다.",
      500,
    );
  }
}

async function releaseTossRenewalLease({
  subscription,
  leaseOwner,
}: {
  subscription: BillingTossSubscriptionRow;
  leaseOwner: string;
}) {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("billing_toss_subscriptions")
    .update({
      renewal_lease_owner: null,
      renewal_lease_expires_at: null,
    })
    .eq("id", subscription.id)
    .eq("renewal_lease_owner", leaseOwner);
  if (error) {
    throw new TossBillingFlowError(
      "renewal_lease_release_failed",
      "결제 확인 대기 lease를 해제하지 못했습니다.",
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

  let paidPayment: BillingTossPaymentRow;
  try {
    paidPayment = await chargeStoredPayment({ subscription, payment });
  } catch (error) {
    if (
      error instanceof TossBillingFlowError &&
      error.code === "payment_result_uncertain"
    ) {
      try {
        await releaseTossRenewalLease({ subscription, leaseOwner });
      } catch (leaseError) {
        console.warn("[billing] failed to release uncertain renewal lease", {
          subscriptionId: subscription.id,
          code: tossErrorCode(leaseError),
        });
      }
      throw error;
    }
    await handleRenewalFailure({ subscription, now });
    throw error;
  }

  const entitlement = await loadExistingEntitlement(subscription.user_id);
  const creditAnchorAt =
    entitlement?.credit_anchor_at ?? subscription.current_period_start;
  await finalizePaidBillingPayment({
    operation: "renewal",
    userId: subscription.user_id,
    subscriptionId: subscription.id,
    payment: paidPayment,
    plan: targetPlan,
    periodStart,
    periodEnd,
    creditAnchorAt,
    customerKey: subscription.customer_key,
    checkoutSessionId: null,
    billingKey: null,
    billingKeyIssuedAt: null,
    cardSnapshot: {},
    renewalLeaseOwner: leaseOwner,
    deferPlanChangeUntil: getRenewalPlanChangeDeferral({
      subscription,
      targetPlan,
      periodStart,
      creditAnchorAt,
      now,
    }),
    now,
  });
}

async function finalizeTossTerminalSubscriptions(
  nowIso: string,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc(
    "finalize_toss_terminal_subscriptions",
    {
      p_now: nowIso,
      p_limit: MAX_RENEWAL_BATCH,
    },
  );
  if (error || typeof data !== "number") {
    throw new TossBillingFlowError(
      "terminal_subscription_finalize_failed",
      "종료된 구독 상태를 안전하게 반영하지 못했습니다.",
      500,
    );
  }
  return data;
}

async function reconcileTerminalTossSubscriptions(nowIso: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_subscriptions")
    .select("*")
    .in("status", ["cancelled", "expired"])
    .eq("billing_key_delete_pending", true)
    .order("updated_at", { ascending: true })
    .limit(MAX_RENEWAL_BATCH)
    .returns<BillingTossSubscriptionRow[]>();

  if (error || !data?.length) return;

  for (const subscription of data) {
    if (
      !subscription.billing_key_delete_pending ||
      !isTossPaymentsCheckoutConfigured()
    ) {
      continue;
    }
    try {
      const { data: sharedBillingKey, error: sharedBillingKeyError } = await admin
        .from("billing_toss_subscriptions")
        .select("id")
        .eq("user_id", subscription.user_id)
        .neq("id", subscription.id)
        .eq("billing_key", subscription.billing_key)
        .in("status", ["active", "past_due", "grace", "pending_cancel"])
        .limit(1)
        .maybeSingle<Pick<BillingTossSubscriptionRow, "id">>();
      if (sharedBillingKeyError) {
        throw new TossBillingFlowError(
          "billing_key_reuse_lookup_failed",
          "결제 수단 재사용 여부를 확인하지 못했습니다.",
          500,
        );
      }
      if (sharedBillingKey) {
        // A new subscription can reuse an existing key. It owns the key now,
        // so the old terminal record must not revoke it.
        await admin
          .from("billing_toss_subscriptions")
          .update({ billing_key_delete_pending: false })
          .eq("id", subscription.id)
          .eq("billing_key_delete_pending", true);
        continue;
      }
      await deleteTossBillingKey(subscription.billing_key);
      await admin
        .from("billing_toss_subscriptions")
        .update({
          billing_key_delete_pending: false,
          billing_key_deleted_at: nowIso,
        })
        .eq("id", subscription.id)
        .eq("billing_key_delete_pending", true);
    } catch (error) {
      console.warn("[billing] failed to delete terminal Toss billing key", {
        subscriptionId: subscription.id,
        code: tossErrorCode(error),
      });
    }
  }
}

async function reconcilePaidTossPaymentFulfillments(
  now: Date,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_payments")
    .select("*")
    .eq("status", "paid")
    .is("operation_id", null)
    .in("fulfillment_status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(MAX_RENEWAL_BATCH)
    .returns<BillingTossPaymentRow[]>();

  if (error || !data?.length) return 0;

  let recovered = 0;
  for (const payment of data) {
    try {
      const plan = payment.plan_version_id
        ? await loadPlanVersionById(payment.plan_version_id)
        : null;
      if (!plan || plan.plan_key !== payment.plan_key) {
        throw new TossBillingFlowError(
          "plan_version_missing",
          "결제한 플랜 버전을 확인하지 못했습니다.",
          500,
        );
      }

      if (payment.payment_kind === "initial") {
        if (!payment.checkout_session_id) {
          throw new TossBillingFlowError(
            "checkout_session_missing",
            "최초 결제 세션을 찾을 수 없습니다.",
            500,
          );
        }
        const session = await loadCheckoutSession(
          payment.user_id,
          payment.checkout_session_id,
        );
        const authorization = extractStoredBillingAuth(session);
        if (!authorization) {
          throw new TossBillingFlowError(
            "billing_authorization_missing",
            "자동결제 인증 정보를 찾을 수 없습니다.",
            500,
          );
        }
        const paidAt = payment.paid_at ?? now.toISOString();
        const entitlement = await loadExistingEntitlement(payment.user_id);
        const keepWeeklyAnchor =
          entitlement?.status === "active" &&
          isPaidPlanKey(entitlement.plan_key) &&
          entitlement.credit_anchor_at;
        await finalizePaidBillingPayment({
          operation: "initial",
          userId: payment.user_id,
          subscriptionId: randomUUID(),
          payment,
          plan,
          periodStart: paidAt,
          periodEnd: addCalendarMonthsIso(paidAt, 1),
          creditAnchorAt: keepWeeklyAnchor || paidAt,
          customerKey: authorization.customerKey,
          checkoutSessionId: session.id,
          billingKey: authorization.billingKey,
          billingKeyIssuedAt: stringValue(authorization.authenticatedAt),
          cardSnapshot: jsonObject(authorization.card ?? {}),
          renewalLeaseOwner: null,
          deferPlanChangeUntil: null,
          now,
        });
      } else {
        if (
          !payment.subscription_id ||
          !payment.billing_period_start ||
          !payment.billing_period_end
        ) {
          throw new TossBillingFlowError(
            "payment_period_missing",
            "결제 반영에 필요한 구독 기간을 찾을 수 없습니다.",
            500,
          );
        }
        const subscription = await loadSubscriptionById(
          payment.user_id,
          payment.subscription_id,
        );
        const entitlement = await loadExistingEntitlement(payment.user_id);
        const creditAnchorAt =
          entitlement?.credit_anchor_at ?? subscription.current_period_start;
        await finalizePaidBillingPayment({
          operation: payment.payment_kind,
          userId: payment.user_id,
          subscriptionId: subscription.id,
          payment,
          plan,
          periodStart: payment.billing_period_start,
          periodEnd: payment.billing_period_end,
          creditAnchorAt,
          customerKey: subscription.customer_key,
          checkoutSessionId: null,
          billingKey: null,
          billingKeyIssuedAt: null,
          cardSnapshot: {},
          renewalLeaseOwner:
            payment.payment_kind === "renewal"
              ? subscription.renewal_lease_owner
              : null,
          deferPlanChangeUntil:
            payment.payment_kind === "renewal"
              ? getRenewalPlanChangeDeferral({
                  subscription,
                  targetPlan: plan,
                  periodStart: payment.billing_period_start,
                  creditAnchorAt,
                  now,
                })
              : null,
          now,
        });
      }
      recovered += 1;
    } catch (error) {
      await markPaymentFulfillmentFailed(payment, error);
      console.warn("[billing] failed to reconcile paid payment fulfillment", {
        paymentId: payment.id,
        paymentKind: payment.payment_kind,
        code: tossErrorCode(error),
      });
    }
  }

  return recovered;
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
  const expired = await finalizeTossTerminalSubscriptions(nowIso);
  await reconcileTerminalTossSubscriptions(nowIso);
  const v2Recovered = await reconcileTossBillingV2Operations({
    now,
    allowCharge: areBillingWritesEnabled(),
  });
  const settledPayments = await reconcilePaidTossPaymentFulfillments(now);
  const recovered = v2Recovered + settledPayments;
  await reconcileRetiredTossBillingKeys(nowIso);
  if (!areBillingWritesEnabled() || !isTossPaymentsCheckoutConfigured()) {
    return { checked: 0, renewed: 0, failed: 0, expired, recovered };
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
    return { checked: 0, renewed: 0, failed: 0, expired, recovered };
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

  await finalizeTossTerminalSubscriptions(nowIso);
  await reconcileTerminalTossSubscriptions(nowIso);

  return {
    checked: data?.length ?? 0,
    renewed,
    failed,
    expired,
    recovered,
  };
}

const BILLING_OPERATION_KINDS: BillingTossOperationKind[] = [
  "subscribe",
  "upgrade",
  "downgrade",
  "cancel_subscription",
  "resume_subscription",
  "cancel_plan_change",
  "replace_payment_method",
];

function isBillingOperationKind(value: unknown): value is BillingTossOperationKind {
  return (
    typeof value === "string" &&
    BILLING_OPERATION_KINDS.includes(value as BillingTossOperationKind)
  );
}

function isPlanSelectionOperation(kind: BillingTossOperationKind): boolean {
  return kind === "subscribe" || kind === "upgrade" || kind === "downgrade";
}

function billingOperationRpcError(
  error: { message?: string } | null,
  fallbackCode: string,
  fallbackMessage: string,
): TossBillingFlowError {
  const message = error?.message ?? "";
  if (message.includes("billing_operation_in_progress")) {
    return new TossBillingFlowError(
      "billing_operation_in_progress",
      "다른 결제 작업을 확인 중입니다. 완료된 뒤 다시 시도해 주세요.",
      409,
    );
  }
  if (
    message.includes("billing_state_inconsistent") ||
    message.includes("billing_operation_state_changed") ||
    message.includes("state_changed")
  ) {
    return new TossBillingFlowError(
      "billing_state_changed",
      "구독 상태가 바뀌어 금액을 다시 확인해야 합니다.",
      409,
    );
  }
  if (message.includes("billing_cancellation_already_pending")) {
    return new TossBillingFlowError(
      "billing_cancellation_already_pending",
      "이미 해지가 예약되어 있습니다.",
      409,
    );
  }
  if (message.includes("billing_plan_change_already_pending")) {
    return new TossBillingFlowError(
      "billing_plan_change_already_pending",
      "이미 다음 결제일 플랜 변경이 예약되어 있습니다.",
      409,
    );
  }
  if (message.includes("billing_period_ended")) {
    return new TossBillingFlowError(
      "billing_period_ended",
      "현재 결제 기간 종료를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
      409,
    );
  }
  if (message.includes("billing_payment_method_not_changeable")) {
    return new TossBillingFlowError(
      "billing_payment_method_not_changeable",
      "결제 유예 상태에서만 결제 수단을 변경할 수 있습니다.",
      409,
    );
  }
  if (message.includes("internal_entitlement_billing_forbidden")) {
    return new TossBillingFlowError(
      "internal_entitlement_billing_forbidden",
      "내부 운영 계정은 유료 구독을 변경할 수 없습니다.",
      409,
    );
  }
  return new TossBillingFlowError(fallbackCode, fallbackMessage, 500);
}

export async function prepareTossBillingOperation({
  userId,
  kind,
  targetPlanKey = null,
}: {
  userId: string;
  kind: unknown;
  targetPlanKey?: unknown;
}): Promise<TossBillingOperationQuote> {
  assertBillingWritesAreEnabled();
  if (!isBillingOperationKind(kind)) {
    throw new TossBillingFlowError(
      "billing_operation_kind_invalid",
      "지원하지 않는 결제 요청입니다.",
    );
  }
  if (isPlanSelectionOperation(kind) && !isPaidPlanKey(targetPlanKey)) {
    throw new TossBillingFlowError(
      "billing_target_plan_invalid",
      "Standard 또는 Pro 플랜을 선택해 주세요.",
    );
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("prepare_toss_billing_operation", {
    p_user_id: userId,
    p_kind: kind,
    p_target_plan_key: isPaidPlanKey(targetPlanKey) ? targetPlanKey : null,
  });
  if (error || !data?.[0]?.operation_id) {
    throw billingOperationRpcError(
      error,
      "billing_quote_prepare_failed",
      "결제 금액을 준비하지 못했습니다.",
    );
  }

  return toOperationQuote(
    await loadTossBillingOperation(userId, data[0].operation_id),
  );
}

export async function getTossBillingOperationForUser({
  userId,
  operationId,
}: {
  userId: string;
  operationId: string;
}): Promise<BillingTossOperationRow> {
  return loadTossBillingOperation(userId, operationId);
}

async function markTossBillingOperationRecoverable({
  userId,
  operationId,
  status,
  error,
}: {
  userId: string;
  operationId: string;
  status: "failed" | "payment_uncertain" | "paid_pending_apply";
  error: unknown;
}) {
  const rpc = await getSupabaseAdmin().rpc(
    "mark_toss_billing_operation_recoverable",
    {
      p_user_id: userId,
      p_operation_id: operationId,
      p_status: status,
      p_failure_code: tossErrorCode(error),
      p_failure_message: tossErrorMessage(error),
    },
  );
  if (rpc.error) {
    throw billingOperationRpcError(
      rpc.error,
      "billing_operation_update_failed",
      "결제 작업 상태를 저장하지 못했습니다.",
    );
  }
}

async function linkPaymentToTossBillingOperation({
  operation,
  payment,
}: {
  operation: BillingTossOperationRow;
  payment: BillingTossPaymentRow;
}) {
  const { error } = await getSupabaseAdmin()
    .from("billing_toss_operations")
    .update({ payment_id: payment.id })
    .eq("id", operation.id)
    .eq("user_id", operation.user_id);
  if (error) {
    throw new TossBillingFlowError(
      "billing_operation_payment_link_failed",
      "결제 작업을 저장하지 못했습니다.",
      500,
    );
  }
}

async function markTossBillingOperationProcessing(
  operation: BillingTossOperationRow,
) {
  const { data, error } = await getSupabaseAdmin()
    .from("billing_toss_operations")
    .update({ status: "processing" })
    .eq("id", operation.id)
    .eq("user_id", operation.user_id)
    .in("status", ["awaiting_auth", "processing"])
    .select("id")
    .maybeSingle<Pick<BillingTossOperationRow, "id">>();
  if (error || !data) {
    throw new TossBillingFlowError(
      "billing_operation_not_actionable",
      "이 결제 작업은 더 이상 진행할 수 없습니다.",
      409,
    );
  }
}

async function makeCheckoutAuth(
  session: BillingTossCheckoutSessionRow,
): Promise<TossBillingCheckoutAuth> {
  const config = getTossPaymentsConfig();
  return {
    clientKey: config.clientKey,
    customerKey: session.customer_key,
    method: "CARD",
    successUrl: session.success_url,
    failUrl: session.fail_url,
  };
}

async function loadOpenCheckoutForOperation(
  operationId: string,
): Promise<BillingTossCheckoutSessionRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("billing_toss_checkout_sessions")
    .select("*")
    .eq("operation_id", operationId)
    .in("status", ["created", "auth_succeeded", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<BillingTossCheckoutSessionRow>();
  if (error) {
    throw new TossBillingFlowError(
      "checkout_session_lookup_failed",
      "결제 세션을 확인하지 못했습니다.",
      500,
    );
  }
  return data ?? null;
}

async function createOrLoadTossOperationCheckout({
  operation,
  requestOrigin,
}: {
  operation: BillingTossOperationRow;
  requestOrigin: string;
}): Promise<TossBillingCheckoutAuth> {
  if (
    operation.kind !== "subscribe" &&
    operation.kind !== "replace_payment_method"
  ) {
    throw new TossBillingFlowError(
      "billing_checkout_not_required",
      "이 요청에는 결제 수단 인증이 필요하지 않습니다.",
      409,
    );
  }
  if (!isTossPaymentsCheckoutConfigured()) {
    throw new TossBillingFlowError(
      "billing_provider_not_configured",
      "결제 연동 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }

  const existing = await loadOpenCheckoutForOperation(operation.id);
  if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
    return makeCheckoutAuth(existing);
  }
  if (existing) {
    await getSupabaseAdmin()
      .from("billing_toss_checkout_sessions")
      .update({
        status: "expired",
        failure_code: "checkout_expired",
        failure_message: "결제 세션이 만료되었습니다.",
      })
      .eq("id", existing.id)
      .in("status", ["created", "auth_succeeded", "processing"]);
  }

  const planKey = operation.target_plan_key ?? operation.from_plan_key;
  if (!isPaidPlanKey(planKey)) {
    throw new TossBillingFlowError(
      "billing_checkout_plan_missing",
      "결제할 플랜 정보를 찾을 수 없습니다.",
      500,
    );
  }
  const planVersion = operation.target_plan_version_id
    ? await loadPlanVersionById(operation.target_plan_version_id)
    : null;
  const billableAmount = Math.max(
    1,
    operation.quoted_amount_krw ||
      operation.next_amount_krw ||
      planVersion?.monthly_price_krw ||
      0,
  );
  const origin = getConfiguredBillingRedirectOrigin(requestOrigin);
  if (!origin) {
    throw new TossBillingFlowError(
      "billing_redirect_origin_not_configured",
      "결제 리다이렉트 주소가 설정되지 않았습니다.",
      503,
    );
  }

  const sessionId = randomUUID();
  const callbackToken = createCallbackToken();
  const successUrl = new URL("/api/billing/toss/success", origin);
  successUrl.searchParams.set("sessionId", sessionId);
  successUrl.searchParams.set("callbackToken", callbackToken);
  const failUrl = new URL("/api/billing/toss/fail", origin);
  failUrl.searchParams.set("sessionId", sessionId);
  failUrl.searchParams.set("callbackToken", callbackToken);
  const customer = await getOrCreateTossCustomerKey(operation.user_id);
  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS).toISOString();
  const orderName =
    operation.kind === "replace_payment_method"
      ? `KRW Ontology ${planKey} 결제 수단 변경`
      : `KRW Ontology ${getBillingPlan(planKey).label} 월 구독`;

  const { data, error } = await getSupabaseAdmin()
    .from("billing_toss_checkout_sessions")
    .insert({
      id: sessionId,
      user_id: operation.user_id,
      plan_key: planKey,
      plan_version_id: operation.target_plan_version_id,
      amount_krw: billableAmount,
      order_name: orderName,
      customer_key: customer.customer_key,
      success_url: successUrl.toString(),
      fail_url: failUrl.toString(),
      purpose:
        operation.kind === "replace_payment_method"
          ? "replace_payment_method"
          : "initial_subscription",
      operation_id: operation.id,
      callback_token_hash: callbackTokenHash(callbackToken),
      expires_at: expiresAt,
    })
    .select("*")
    .single<BillingTossCheckoutSessionRow>();

  if (isUniqueConstraintViolation(error)) {
    const raced = await loadOpenCheckoutForOperation(operation.id);
    if (raced) return makeCheckoutAuth(raced);
  }
  if (error || !data) {
    throw new TossBillingFlowError(
      "checkout_session_create_failed",
      "결제 인증 세션을 만들지 못했습니다.",
      500,
    );
  }

  const { error: operationError } = await getSupabaseAdmin()
    .from("billing_toss_operations")
    .update({ checkout_session_id: data.id })
    .eq("id", operation.id)
    .eq("user_id", operation.user_id)
    .in("status", ["awaiting_auth", "processing"]);
  if (operationError) {
    throw new TossBillingFlowError(
      "billing_operation_checkout_link_failed",
      "결제 인증 작업을 저장하지 못했습니다.",
      500,
    );
  }
  return makeCheckoutAuth(data);
}

async function finalizeTossBillingV2Payment({
  operation,
  payment,
  authorization,
}: {
  operation: BillingTossOperationRow;
  payment: BillingTossPaymentRow;
  authorization: TossBillingKeyResponse | null;
}): Promise<{ subscriptionId: string; alreadyApplied: boolean }> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin().rpc(
    "finalize_toss_billing_v2_payment",
    {
      p_user_id: operation.user_id,
      p_operation_id: operation.id,
      p_payment_id: payment.id,
      p_billing_key: authorization?.billingKey ?? null,
      p_billing_key_issued_at: authorization
        ? stringValue(authorization.authenticatedAt)
        : null,
      p_card_snapshot: authorization ? jsonObject(authorization.card ?? {}) : {},
      p_now: nowIso,
    },
  );
  if (error || !data?.[0]?.subscription_id) {
    const fulfillmentError = billingOperationRpcError(
      error,
      "payment_fulfillment_pending",
      "결제는 승인됐지만 구독 반영을 재시도하고 있습니다.",
    );
    await markPaymentFulfillmentFailed(payment, fulfillmentError);
    await markTossBillingOperationRecoverable({
      userId: operation.user_id,
      operationId: operation.id,
      status: "paid_pending_apply",
      error: fulfillmentError,
    });
    throw new TossBillingFlowError(
      "payment_fulfillment_pending",
      "결제는 승인됐지만 구독 반영을 재시도하고 있습니다.",
      503,
    );
  }
  return {
    subscriptionId: data[0].subscription_id,
    alreadyApplied: Boolean(data[0].already_applied),
  };
}

async function processTossBillingUpgradeOperation(
  operation: BillingTossOperationRow,
): Promise<ConfirmTossBillingOperationResult> {
  let payment: BillingTossPaymentRow | null = null;
  try {
    if (operation.kind !== "upgrade" || !operation.subscription_id) {
      throw new TossBillingFlowError(
        "billing_upgrade_operation_invalid",
        "업그레이드 작업 정보를 찾을 수 없습니다.",
        409,
      );
    }
    if (!isTossPaymentsCheckoutConfigured()) {
      throw new TossBillingFlowError(
        "billing_provider_not_configured",
        "결제 연동 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
        503,
      );
    }
    if (!operation.target_plan_version_id) {
      throw new TossBillingFlowError(
        "billing_upgrade_plan_missing",
        "업그레이드 플랜 정보를 찾을 수 없습니다.",
        500,
      );
    }

    const subscription = await loadSubscriptionById(
      operation.user_id,
      operation.subscription_id,
    );
    const plan = await loadPlanVersionById(operation.target_plan_version_id);
    if (!plan || !isPaidPlanKey(plan.plan_key)) {
      throw new TossBillingFlowError(
        "billing_upgrade_plan_missing",
        "업그레이드 플랜 정보를 찾을 수 없습니다.",
        500,
      );
    }
    payment = await loadOrCreateOperationUpgradePayment({
      operation,
      subscription,
      planVersion: plan,
    });
    await linkPaymentToTossBillingOperation({ operation, payment });

    if (payment.status !== "paid") {
      payment = await chargeStoredPayment({ subscription, payment });
    }

    await finalizeTossBillingV2Payment({
      operation,
      payment,
      authorization: null,
    });
    return { operationId: operation.id, status: "succeeded" };
  } catch (error) {
    const flowError = error instanceof TossBillingFlowError ? error : null;
    const recoveryStatus =
      flowError?.code === "payment_result_uncertain"
        ? "payment_uncertain"
        : flowError?.code === "payment_fulfillment_pending" ||
            payment?.status === "paid"
          ? "paid_pending_apply"
          : "failed";
    try {
      await markTossBillingOperationRecoverable({
        userId: operation.user_id,
        operationId: operation.id,
        status: recoveryStatus,
        error,
      });
    } catch (markError) {
      console.error("[billing] could not persist V2 upgrade recovery state", {
        operationId: operation.id,
        code: tossErrorCode(markError),
      });
    }
    throw error;
  }
}

export async function confirmTossBillingOperation({
  userId,
  operationId,
  requestOrigin,
}: {
  userId: string;
  operationId: string;
  requestOrigin: string;
}): Promise<ConfirmTossBillingOperationResult> {
  assertBillingWritesAreEnabled();
  const beforeConfirmation = await loadTossBillingOperation(userId, operationId);
  if (
    isOpenOperationStatus(beforeConfirmation.status) &&
    (beforeConfirmation.kind === "subscribe" ||
      beforeConfirmation.kind === "replace_payment_method" ||
      (beforeConfirmation.kind === "upgrade" &&
        beforeConfirmation.quoted_amount_krw > 0)) &&
    !isTossPaymentsCheckoutConfigured()
  ) {
    throw new TossBillingFlowError(
      "billing_provider_not_configured",
      "결제 연동 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }

  const { data, error } = await getSupabaseAdmin().rpc(
    "confirm_toss_billing_operation",
    {
      p_user_id: userId,
      p_operation_id: operationId,
    },
  );
  if (error || !data?.[0]?.operation_id || !data[0].operation_status) {
    throw billingOperationRpcError(
      error,
      "billing_operation_confirm_failed",
      "결제 요청을 확인하지 못했습니다.",
    );
  }

  const operation = await loadTossBillingOperation(userId, operationId);
  if (operation.status === "awaiting_auth") {
    return {
      operationId: operation.id,
      status: operation.status,
      checkout: await createOrLoadTossOperationCheckout({
        operation,
        requestOrigin,
      }),
    };
  }
  if (operation.status === "processing" && operation.kind === "upgrade") {
    return processTossBillingUpgradeOperation(operation);
  }
  return { operationId: operation.id, status: operation.status };
}

export async function cancelTossBillingOperation({
  userId,
  operationId,
}: {
  userId: string;
  operationId: string;
}): Promise<void> {
  assertBillingWritesAreEnabled();
  const { data, error } = await getSupabaseAdmin().rpc(
    "cancel_toss_billing_operation",
    {
      p_user_id: userId,
      p_operation_id: operationId,
    },
  );
  if (error) {
    throw billingOperationRpcError(
      error,
      "billing_operation_cancel_failed",
      "결제 작업을 취소하지 못했습니다.",
    );
  }
  if (!data) {
    throw new TossBillingFlowError(
      "billing_operation_not_cancellable",
      "이미 결제 결과를 확인하고 있어 취소할 수 없습니다.",
      409,
    );
  }
}

async function retryTossPaymentAfterBillingKeyReplacement({
  userId,
  subscriptionId,
}: {
  userId: string;
  subscriptionId: string;
}): Promise<boolean> {
  const workerId = `billing-card-recovery-${randomUUID()}`;
  const { data: claimed, error } = await getSupabaseAdmin().rpc(
    "claim_toss_subscription_for_payment_recovery",
    {
      p_user_id: userId,
      p_subscription_id: subscriptionId,
      p_worker_id: workerId,
      p_lease_seconds: RENEWAL_LEASE_SECONDS,
    },
  );
  if (error) {
    throw billingOperationRpcError(
      error,
      "billing_payment_recovery_claim_failed",
      "새 결제 수단으로 미납 결제를 확인하지 못했습니다.",
    );
  }
  if (!claimed) return false;

  const subscription = await loadSubscriptionById(userId, subscriptionId);
  try {
    await renewSubscription(subscription, new Date());
    return true;
  } catch (error) {
    // The renewal function has already moved the subscription to the correct
    // grace/expired state. Card replacement itself remains successful.
    console.warn("[billing] card replacement recovery charge failed", {
      subscriptionId,
      code: tossErrorCode(error),
    });
    return false;
  }
}

async function completeInitialTossBillingOperation({
  operation,
  session,
  authKey,
  customerKey,
}: {
  operation: BillingTossOperationRow;
  session: BillingTossCheckoutSessionRow;
  authKey: string;
  customerKey: string;
}): Promise<CompleteTossBillingCallbackResult> {
  let processingSession = session;
  let authorization: TossBillingKeyResponse | null = null;
  let payment: BillingTossPaymentRow | null = null;

  try {
    await assertBillingEntitlementIsMutable(operation.user_id);
    processingSession = await markCheckoutProcessing(session);
    await markTossBillingOperationProcessing(operation);
    authorization = await issueOrLoadBillingKey({
      session: processingSession,
      authKey,
      customerKey,
    });
    payment = await loadInitialPayment(processingSession);
    await linkPaymentToTossBillingOperation({ operation, payment });
    // The circuit breaker blocks newly-confirmed mutations, but a buyer may
    // already have finished Toss authentication when it is enabled. Persist
    // that authorization so it cannot be lost with the redirect, then leave
    // the charge for the recovery worker after writes are re-enabled.
    if (!areBillingWritesEnabled() && payment.status !== "paid") {
      return {
        operationId: operation.id,
        status: "payment_recovery_pending",
      };
    }
    const paymentResponse = await chargeInitialPayment({
      session: processingSession,
      authorization,
      payment,
    });
    let paidPayment: BillingTossPaymentRow;
    try {
      paidPayment =
        payment.status === "paid"
          ? payment
          : await updatePaymentPaid(payment, paymentResponse);
    } catch (paymentStoreError) {
      try {
        await updatePaymentUncertain(payment, paymentStoreError);
      } catch {
        // The worker can still find this operation and reconcile the same
        // provider order; do not downgrade a possibly paid charge to failed.
      }
      throw new TossBillingFlowError(
        "payment_result_uncertain",
        "결제 결과를 확인하고 있습니다. 기존 주문만 다시 조회합니다.",
        503,
      );
    }
    const settlement = await finalizeTossBillingV2Payment({
      operation,
      payment: paidPayment,
      authorization,
    });
    return {
      operationId: operation.id,
      status: settlement.alreadyApplied ? "already_paid" : "paid",
    };
  } catch (error) {
    if (
      error instanceof TossBillingFlowError &&
      (error.code === "payment_result_uncertain" ||
        error.code === "payment_fulfillment_pending")
    ) {
      if (payment) {
        await markTossBillingOperationRecoverable({
          userId: operation.user_id,
          operationId: operation.id,
          status:
            error.code === "payment_result_uncertain"
              ? "payment_uncertain"
              : "paid_pending_apply",
          error,
        });
      }
      throw error;
    }

    await markCheckoutFailed({
      session: processingSession,
      code: tossErrorCode(error),
      message: tossErrorMessage(error),
    });
    await markTossBillingOperationRecoverable({
      userId: operation.user_id,
      operationId: operation.id,
      status: "failed",
      error,
    });
    if (authorization) {
      try {
        await deleteTossBillingKey(authorization.billingKey);
      } catch {
        // It is safe to retry the provider's idempotent deletion during a
        // support repair; never risk masking the original checkout error.
      }
    }
    throw error;
  }
}

async function completeReplacementTossBillingOperation({
  operation,
  session,
  authKey,
  customerKey,
}: {
  operation: BillingTossOperationRow;
  session: BillingTossCheckoutSessionRow;
  authKey: string;
  customerKey: string;
}): Promise<CompleteTossBillingCallbackResult> {
  let processingSession = session;
  let authorization: TossBillingKeyResponse | null = null;
  let replacementApplied = false;
  try {
    processingSession = await markCheckoutProcessing(session);
    await markTossBillingOperationProcessing(operation);
    authorization = await issueOrLoadBillingKey({
      session: processingSession,
      authKey,
      customerKey,
    });
    const { data, error } = await getSupabaseAdmin().rpc(
      "finalize_toss_billing_key_replacement",
      {
        p_user_id: operation.user_id,
        p_operation_id: operation.id,
        p_billing_key: authorization.billingKey,
        p_billing_key_issued_at: stringValue(authorization.authenticatedAt),
        p_card_snapshot: jsonObject(authorization.card ?? {}),
      },
    );
    if (error || !data?.[0]?.subscription_id) {
      throw billingOperationRpcError(
        error,
        "billing_key_replacement_failed",
        "결제 수단 변경을 저장하지 못했습니다.",
      );
    }
    replacementApplied = true;
    let recovered = false;
    if (areBillingWritesEnabled()) {
      try {
        recovered = await retryTossPaymentAfterBillingKeyReplacement({
          userId: operation.user_id,
          subscriptionId: data[0].subscription_id,
        });
      } catch (recoveryError) {
        console.warn("[billing] card replacement recovery could not start", {
          subscriptionId: data[0].subscription_id,
          code: tossErrorCode(recoveryError),
        });
      }
    }
    return {
      operationId: operation.id,
      status: recovered ? "paid" : "payment_recovery_pending",
    };
  } catch (error) {
    if (replacementApplied) {
      throw error;
    }
    await markCheckoutFailed({
      session: processingSession,
      code: tossErrorCode(error),
      message: tossErrorMessage(error),
    });
    await markTossBillingOperationRecoverable({
      userId: operation.user_id,
      operationId: operation.id,
      status: "failed",
      error,
    });
    if (authorization) {
      try {
        await deleteTossBillingKey(authorization.billingKey);
      } catch {
        // Best effort only; the original key is still authoritative unless
        // the replacement transaction committed.
      }
    }
    throw error;
  }
}

export async function completeTossBillingOperationCallback({
  sessionId,
  callbackToken,
  authKey,
  customerKey,
}: {
  sessionId: string;
  callbackToken: string;
  authKey: string;
  customerKey: string;
}): Promise<CompleteTossBillingCallbackResult> {
  const session = await loadCheckoutSessionForCallback(sessionId);
  if (!hasValidCallbackToken(session, callbackToken)) {
    throw new TossBillingFlowError(
      "billing_callback_token_invalid",
      "결제 콜백을 확인하지 못했습니다.",
      400,
    );
  }
  if (!session.operation_id) {
    throw new TossBillingFlowError(
      "billing_operation_missing",
      "결제 작업을 찾을 수 없습니다.",
      409,
    );
  }
  const operation = await loadTossBillingOperation(
    session.user_id,
    session.operation_id,
  );
  if (operation.status === "succeeded") {
    return { operationId: operation.id, status: "already_paid" };
  }
  if (operation.status === "prepared") {
    throw new TossBillingFlowError(
      "billing_operation_not_confirmed",
      "결제 금액 확인이 완료되지 않은 작업입니다.",
      409,
    );
  }
  if (!isOpenOperationStatus(operation.status)) {
    throw new TossBillingFlowError(
      "billing_operation_not_actionable",
      "이 결제 작업은 더 이상 진행할 수 없습니다.",
      409,
    );
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    const error = new TossBillingFlowError(
      "checkout_expired",
      "결제 인증 시간이 만료되었습니다. 금액을 다시 확인해 주세요.",
      410,
    );
    await markCheckoutFailed({
      session,
      code: error.code,
      message: error.message,
    });
    await markTossBillingOperationRecoverable({
      userId: operation.user_id,
      operationId: operation.id,
      status: "failed",
      error,
    });
    throw error;
  }
  if (session.customer_key !== customerKey) {
    const error = new TossBillingFlowError(
      "customer_key_mismatch",
      "결제 고객 정보를 확인하지 못했습니다.",
    );
    await markCheckoutFailed({
      session,
      code: error.code,
      message: error.message,
    });
    await markTossBillingOperationRecoverable({
      userId: operation.user_id,
      operationId: operation.id,
      status: "failed",
      error,
    });
    throw error;
  }

  if (
    operation.kind === "subscribe" &&
    session.purpose === "initial_subscription"
  ) {
    return completeInitialTossBillingOperation({
      operation,
      session,
      authKey,
      customerKey,
    });
  }
  if (
    operation.kind === "replace_payment_method" &&
    session.purpose === "replace_payment_method"
  ) {
    return completeReplacementTossBillingOperation({
      operation,
      session,
      authKey,
      customerKey,
    });
  }
  throw new TossBillingFlowError(
    "billing_callback_purpose_invalid",
    "결제 인증 작업이 현재 요청과 일치하지 않습니다.",
    409,
  );
}

export async function markTossBillingOperationCallbackFailed({
  sessionId,
  callbackToken,
  code,
}: {
  sessionId: string;
  callbackToken: string;
  code: string;
}): Promise<string | null> {
  const session = await loadCheckoutSessionForCallback(sessionId);
  if (!hasValidCallbackToken(session, callbackToken)) {
    throw new TossBillingFlowError(
      "billing_callback_token_invalid",
      "결제 콜백을 확인하지 못했습니다.",
      400,
    );
  }
  await markCheckoutFailed({
    session,
    code: code.slice(0, 100),
    message: "자동결제 인증이 완료되지 않았습니다.",
  });
  if (!session.operation_id) return null;

  const operation = await loadTossBillingOperation(
    session.user_id,
    session.operation_id,
  );
  if (operation.status === "prepared" || operation.status === "awaiting_auth") {
    await markTossBillingOperationRecoverable({
      userId: operation.user_id,
      operationId: operation.id,
      status: "failed",
      error: new TossBillingFlowError(
        code.slice(0, 100) || "billing_auth_failed",
        "자동결제 인증이 완료되지 않았습니다.",
      ),
    });
  }
  return operation.id;
}

export async function getTossBillingOperationIdForCallback({
  sessionId,
  callbackToken,
}: {
  sessionId: string;
  callbackToken: string;
}): Promise<string | null> {
  const session = await loadCheckoutSessionForCallback(sessionId);
  if (!hasValidCallbackToken(session, callbackToken)) return null;
  return session.operation_id;
}

async function loadPaymentForTossBillingOperation(
  operation: BillingTossOperationRow,
): Promise<BillingTossPaymentRow | null> {
  const query = getSupabaseAdmin()
    .from("billing_toss_payments")
    .select("*")
    .eq("operation_id", operation.id)
    .limit(1)
    .maybeSingle<BillingTossPaymentRow>();
  const { data, error } = await query;
  if (error) {
    throw new TossBillingFlowError(
      "payment_lookup_failed",
      "결제 작업의 승인 정보를 확인하지 못했습니다.",
      500,
    );
  }
  return data ?? null;
}

async function finalizeReplacementFromStoredAuthorization({
  operation,
  authorization,
  allowCharge,
}: {
  operation: BillingTossOperationRow;
  authorization: TossBillingKeyResponse;
  allowCharge: boolean;
}): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "finalize_toss_billing_key_replacement",
    {
      p_user_id: operation.user_id,
      p_operation_id: operation.id,
      p_billing_key: authorization.billingKey,
      p_billing_key_issued_at: stringValue(authorization.authenticatedAt),
      p_card_snapshot: jsonObject(authorization.card ?? {}),
    },
  );
  if (error || !data?.[0]?.subscription_id) {
    throw billingOperationRpcError(
      error,
      "billing_key_replacement_failed",
      "결제 수단 변경을 저장하지 못했습니다.",
    );
  }
  if (allowCharge) {
    await retryTossPaymentAfterBillingKeyReplacement({
      userId: operation.user_id,
      subscriptionId: data[0].subscription_id,
    });
  }
  return true;
}

async function reconcileTossBillingV2Operations({
  now,
  allowCharge,
}: {
  now: Date;
  allowCharge: boolean;
}): Promise<number> {
  const admin = getSupabaseAdmin();
  const nowIso = now.toISOString();
  const { error: expiryError } = await admin.rpc("expire_toss_billing_operations", {
    p_now: nowIso,
  });
  if (expiryError) {
    throw billingOperationRpcError(
      expiryError,
      "billing_operation_expiry_failed",
      "만료된 결제 작업을 정리하지 못했습니다.",
    );
  }

  const { data, error } = await admin
    .from("billing_toss_operations")
    .select("*")
    .in("status", ["processing", "payment_uncertain", "paid_pending_apply"])
    .order("updated_at", { ascending: true })
    .limit(MAX_RENEWAL_BATCH)
    .returns<BillingTossOperationRow[]>();
  if (error || !data?.length) return 0;

  let recovered = 0;
  for (const operation of data) {
    let payment: BillingTossPaymentRow | null = null;
    try {
      if (operation.kind === "upgrade") {
        if (operation.status === "paid_pending_apply") {
          payment = await loadPaymentForTossBillingOperation(operation);
          if (!payment || payment.status !== "paid") {
            throw new TossBillingFlowError(
              "billing_operation_payment_missing",
              "승인된 업그레이드 결제를 찾을 수 없습니다.",
              500,
            );
          }
          await finalizeTossBillingV2Payment({
            operation,
            payment,
            authorization: null,
          });
          recovered += 1;
          continue;
        }

        if (!allowCharge) {
          payment = await loadPaymentForTossBillingOperation(operation);
          if (payment?.status === "pending" && isTossPaymentsCheckoutConfigured()) {
            const response = await reconcilePaymentByOrderId(payment);
            if (response) payment = await updatePaymentPaid(payment, response);
          }
          if (payment?.status === "paid") {
            await finalizeTossBillingV2Payment({
              operation,
              payment,
              authorization: null,
            });
            recovered += 1;
          }
          continue;
        }

        await processTossBillingUpgradeOperation(operation);
        recovered += 1;
        continue;
      }

      if (!operation.checkout_session_id) {
        if (new Date(operation.expires_at).getTime() <= now.getTime()) {
          await markTossBillingOperationRecoverable({
            userId: operation.user_id,
            operationId: operation.id,
            status: "failed",
            error: new TossBillingFlowError(
              "checkout_session_missing",
              "결제 인증 시간이 만료되었습니다.",
            ),
          });
        }
        continue;
      }

      const session = await loadCheckoutSession(
        operation.user_id,
        operation.checkout_session_id,
      );
      const authorization = extractStoredBillingAuth(session);
      if (operation.kind === "replace_payment_method") {
        if (!authorization) {
          if (new Date(operation.expires_at).getTime() <= now.getTime()) {
            await markTossBillingOperationRecoverable({
              userId: operation.user_id,
              operationId: operation.id,
              status: "failed",
              error: new TossBillingFlowError(
                "billing_authorization_missing",
                "결제 수단 인증 시간이 만료되었습니다.",
              ),
            });
          }
          continue;
        }
        await finalizeReplacementFromStoredAuthorization({
          operation,
          authorization,
          allowCharge,
        });
        recovered += 1;
        continue;
      }

      if (operation.kind !== "subscribe") continue;
      payment = await loadPaymentForTossBillingOperation(operation);
      if (payment?.status === "pending" && isTossPaymentsCheckoutConfigured()) {
        const response = await reconcilePaymentByOrderId(payment);
        if (response) payment = await updatePaymentPaid(payment, response);
      }
      if (!payment && authorization && allowCharge) {
        payment = await loadInitialPayment(session);
        await linkPaymentToTossBillingOperation({ operation, payment });
      }
      if (payment?.status !== "paid" && authorization && payment && allowCharge) {
        const response = await chargeInitialPayment({
          session,
          authorization,
          payment,
        });
        payment = await updatePaymentPaid(payment, response);
      }
      if (payment?.status === "paid") {
        await finalizeTossBillingV2Payment({
          operation,
          payment,
          authorization,
        });
        recovered += 1;
      } else if (
        new Date(operation.expires_at).getTime() <= now.getTime() &&
        !authorization
      ) {
        await markTossBillingOperationRecoverable({
          userId: operation.user_id,
          operationId: operation.id,
          status: "failed",
          error: new TossBillingFlowError(
            "billing_authorization_missing",
            "결제 인증 시간이 만료되었습니다.",
          ),
        });
      }
    } catch (caught) {
      const isPendingFulfillment =
        caught instanceof TossBillingFlowError &&
        caught.code === "payment_fulfillment_pending";
      const isUncertain =
        caught instanceof TossBillingFlowError &&
        caught.code === "payment_result_uncertain";
      if (!isPendingFulfillment) {
        await markTossBillingOperationRecoverable({
          userId: operation.user_id,
          operationId: operation.id,
          status:
            payment?.status === "paid" || isPendingFulfillment
              ? "paid_pending_apply"
              : isUncertain
                ? "payment_uncertain"
                : "failed",
          error: caught,
        });
      }
      console.warn("[billing] failed to reconcile V2 operation", {
        operationId: operation.id,
        kind: operation.kind,
        code: tossErrorCode(caught),
      });
    }
  }
  return recovered;
}

async function reconcileRetiredTossBillingKeys(nowIso: string): Promise<void> {
  if (!isTossPaymentsCheckoutConfigured()) return;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_toss_retired_billing_keys")
    .select("*")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(MAX_RENEWAL_BATCH)
    .returns<BillingTossRetiredBillingKeyRow[]>();
  if (error || !data?.length) return;

  for (const key of data) {
    try {
      const { data: shared, error: sharedError } = await admin
        .from("billing_toss_subscriptions")
        .select("id")
        .eq("user_id", key.user_id)
        .neq("id", key.subscription_id)
        .eq("billing_key", key.billing_key)
        .in("status", ["active", "past_due", "grace", "pending_cancel"])
        .limit(1)
        .maybeSingle<Pick<BillingTossSubscriptionRow, "id">>();
      if (sharedError) throw sharedError;
      if (!shared) await deleteTossBillingKey(key.billing_key);
      await admin
        .from("billing_toss_retired_billing_keys")
        .update({
          status: "deleted",
          failure_code: shared ? "key_still_in_use" : null,
          attempted_at: nowIso,
          deleted_at: nowIso,
        })
        .eq("id", key.id);
    } catch (caught) {
      await admin
        .from("billing_toss_retired_billing_keys")
        .update({
          status: "failed",
          failure_code: tossErrorCode(caught).slice(0, 100),
          attempted_at: nowIso,
        })
        .eq("id", key.id);
      console.warn("[billing] failed to retire prior billing key", {
        retiredKeyId: key.id,
        code: tossErrorCode(caught),
      });
    }
  }
}
