import "server-only";

import { randomUUID } from "crypto";
import { requireEnv } from "@/lib/env";

const DEFAULT_TOSS_API_BASE_URL = "https://api.tosspayments.com";

export interface TossPaymentsConfig {
  clientKey: string;
  secretKey: string;
  apiBaseUrl: string;
}

export type TossPaymentsKeyMode = "test" | "live";

export interface TossBillingKeyResponse {
  mId?: string;
  customerKey: string;
  authenticatedAt?: string;
  method?: string;
  billingKey: string;
  card?: Record<string, unknown> | null;
  cardCompany?: string | null;
  cardNumber?: string | null;
  transfers?: unknown;
  easyPay?: unknown;
}

export interface TossPaymentResponse {
  mId?: string;
  version?: string;
  paymentKey: string;
  status: string;
  orderId: string;
  orderName: string;
  requestedAt?: string;
  approvedAt?: string;
  totalAmount: number;
  balanceAmount?: number;
  currency: "KRW" | string;
  method?: string;
  type?: string;
  card?: Record<string, unknown> | null;
  failure?: {
    code?: string;
    message?: string;
  } | null;
  receipt?: {
    url?: string;
  } | null;
  checkout?: {
    url?: string;
  } | null;
}

export class TossPaymentsError extends Error {
  readonly code: string;
  readonly status: number;
  readonly payload: unknown;

  constructor({
    code,
    message,
    status,
    payload,
  }: {
    code: string;
    message: string;
    status: number;
    payload: unknown;
  }) {
    super(message);
    this.name = "TossPaymentsError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

export function getTossPaymentsConfig(): TossPaymentsConfig {
  const clientKey = requireEnv("TOSS_PAYMENTS_CLIENT_KEY");
  const secretKey = requireEnv("TOSS_PAYMENTS_SECRET_KEY");
  const env = {
    ...process.env,
    TOSS_PAYMENTS_CLIENT_KEY: clientKey,
    TOSS_PAYMENTS_SECRET_KEY: secretKey,
  };
  if (!isTossPaymentsConfigured(env)) {
    throw new Error(
      "Toss Payments client and secret keys must be a matching test or live pair.",
    );
  }
  if (requiresLiveTossKeys(env) && !isTossPaymentsLiveConfigured(env)) {
    throw new Error("Toss Payments live keys are required in production.");
  }
  return {
    clientKey,
    secretKey,
    apiBaseUrl:
      process.env.TOSS_PAYMENTS_API_BASE_URL?.replace(/\/+$/, "") ||
      DEFAULT_TOSS_API_BASE_URL,
  };
}

function isUsableTossKey(value: string | undefined, prefixes: string[]) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("...")) return false;
  return prefixes.some((prefix) => trimmed.startsWith(prefix));
}

function modeForTossKey(
  value: string | undefined,
  kind: "client" | "secret",
): TossPaymentsKeyMode | null {
  const prefixes =
    kind === "client"
      ? {
          test: "test_ck_",
          live: "live_ck_",
        }
      : {
          test: "test_sk_",
          live: "live_sk_",
        };
  if (isUsableTossKey(value, [prefixes.test])) return "test";
  if (isUsableTossKey(value, [prefixes.live])) return "live";
  return null;
}

export function getTossPaymentsKeyMode(
  env: Record<string, string | undefined> = process.env,
): TossPaymentsKeyMode | null {
  const clientMode = modeForTossKey(env.TOSS_PAYMENTS_CLIENT_KEY, "client");
  const secretMode = modeForTossKey(env.TOSS_PAYMENTS_SECRET_KEY, "secret");
  return clientMode && clientMode === secretMode ? clientMode : null;
}

function requiresLiveTossKeys(env: Record<string, string | undefined>) {
  const ontologyEnv = env.KRW_ONTOLOGY_ENV?.trim().toLowerCase();
  if (ontologyEnv) return ontologyEnv === "prod";
  return env.NODE_ENV === "production";
}

export function isTossPaymentsConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return getTossPaymentsKeyMode(env) !== null;
}

export function isTossPaymentsCheckoutConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  const mode = getTossPaymentsKeyMode(env);
  return mode !== null && (!requiresLiveTossKeys(env) || mode === "live");
}

export function isTossPaymentsLiveConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return getTossPaymentsKeyMode(env) === "live";
}

export function buildTossBasicAuthorization(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`;
}

export function generateTossOrderId(prefix = "krw"): string {
  const compactUuid = randomUUID().replaceAll("-", "").slice(0, 20);
  return `${prefix}_${Date.now()}_${compactUuid}`.slice(0, 64);
}

function errorPayloadValue(
  payload: unknown,
  key: "code" | "message",
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function parseTossResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function tossApiRequest<T>(
  path: string,
  {
    method,
    body,
    idempotencyKey,
  }: {
    method: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<T> {
  const config = getTossPaymentsConfig();
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: buildTossBasicAuthorization(config.secretKey),
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = await parseTossResponse(response);

  if (!response.ok) {
    throw new TossPaymentsError({
      code: errorPayloadValue(payload, "code") ?? "TOSS_API_ERROR",
      message:
        errorPayloadValue(payload, "message") ??
        `Toss Payments API failed with ${response.status}`,
      status: response.status,
      payload,
    });
  }

  return payload as T;
}

export async function issueTossBillingKey({
  authKey,
  customerKey,
  idempotencyKey,
}: {
  authKey: string;
  customerKey: string;
  idempotencyKey: string;
}): Promise<TossBillingKeyResponse> {
  return tossApiRequest<TossBillingKeyResponse>(
    "/v1/billing/authorizations/issue",
    {
      method: "POST",
      idempotencyKey,
      body: {
        authKey,
        customerKey,
      },
    },
  );
}

export async function chargeTossBillingKey({
  billingKey,
  customerKey,
  amountKrw,
  orderId,
  orderName,
  customerEmail,
  customerName,
  idempotencyKey,
}: {
  billingKey: string;
  customerKey: string;
  amountKrw: number;
  orderId: string;
  orderName: string;
  customerEmail?: string | null;
  customerName?: string | null;
  idempotencyKey: string;
}): Promise<TossPaymentResponse> {
  const body: Record<string, unknown> = {
    customerKey,
    amount: amountKrw,
    orderId,
    orderName,
  };
  if (customerEmail) body.customerEmail = customerEmail;
  if (customerName) body.customerName = customerName;

  return tossApiRequest<TossPaymentResponse>(
    `/v1/billing/${encodeURIComponent(billingKey)}`,
    {
      method: "POST",
      idempotencyKey,
      body,
    },
  );
}

export async function deleteTossBillingKey(
  billingKey: string,
): Promise<Record<string, unknown>> {
  return tossApiRequest<Record<string, unknown>>(
    `/v1/billing/${encodeURIComponent(billingKey)}`,
    {
      method: "DELETE",
    },
  );
}

export async function getTossPaymentByPaymentKey(
  paymentKey: string,
): Promise<TossPaymentResponse> {
  return tossApiRequest<TossPaymentResponse>(
    `/v1/payments/${encodeURIComponent(paymentKey)}`,
    {
      method: "GET",
    },
  );
}

export async function getTossPaymentByOrderId(
  orderId: string,
): Promise<TossPaymentResponse> {
  return tossApiRequest<TossPaymentResponse>(
    `/v1/payments/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
    },
  );
}
