import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTossBasicAuthorization,
  cancelTossPayment,
  chargeTossBillingKey,
  generateTossOrderId,
  getTossPaymentsKeyMode,
  getTossPaymentByOrderId,
  issueTossBillingKey,
  isTossPaymentsCheckoutConfigured,
  isTossPaymentsConfigured,
  isTossPaymentsLiveConfigured,
} from "./toss";

describe("Toss Payments billing client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("builds Basic auth with the required trailing colon", () => {
    expect(buildTossBasicAuthorization("test_sk_abc")).toBe(
      `Basic ${Buffer.from("test_sk_abc:", "utf8").toString("base64")}`,
    );
  });

  it("generates order ids in the Toss-safe character set and length", () => {
    const orderId = generateTossOrderId("krw");
    expect(orderId).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    expect(orderId.length).toBeLessThanOrEqual(64);
  });

  it("detects whether Toss keys are ready for checkout", () => {
    expect(
      isTossPaymentsConfigured({
        TOSS_PAYMENTS_CLIENT_KEY: "test_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "test_sk_123",
      }),
    ).toBe(true);
    expect(
      isTossPaymentsConfigured({
        TOSS_PAYMENTS_CLIENT_KEY: "test_ck_...",
        TOSS_PAYMENTS_SECRET_KEY: "test_sk_...",
      }),
    ).toBe(false);
    expect(
      isTossPaymentsConfigured({
        TOSS_PAYMENTS_CLIENT_KEY: undefined,
        TOSS_PAYMENTS_SECRET_KEY: "test_sk_123",
      }),
    ).toBe(false);
    expect(
      isTossPaymentsConfigured({
        TOSS_PAYMENTS_CLIENT_KEY: "live_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "test_sk_123",
      }),
    ).toBe(false);
  });

  it("requires a matching live pair for production checkout while allowing test pairs outside prod", () => {
    expect(
      getTossPaymentsKeyMode({
        TOSS_PAYMENTS_CLIENT_KEY: "live_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "live_sk_123",
      }),
    ).toBe("live");
    expect(
      getTossPaymentsKeyMode({
        TOSS_PAYMENTS_CLIENT_KEY: "test_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "live_sk_123",
      }),
    ).toBeNull();
    expect(
      isTossPaymentsCheckoutConfigured({
        NODE_ENV: "production",
        TOSS_PAYMENTS_CLIENT_KEY: "test_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "test_sk_123",
      }),
    ).toBe(false);
    expect(
      isTossPaymentsCheckoutConfigured({
        KRW_ONTOLOGY_ENV: "staging",
        NODE_ENV: "production",
        TOSS_PAYMENTS_CLIENT_KEY: "test_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "test_sk_123",
      }),
    ).toBe(true);
    expect(
      isTossPaymentsCheckoutConfigured({
        KRW_ONTOLOGY_ENV: "prod",
        TOSS_PAYMENTS_CLIENT_KEY: "live_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "live_sk_123",
      }),
    ).toBe(true);
  });

  it("detects whether Toss live keys are ready for production renewals", () => {
    expect(
      isTossPaymentsLiveConfigured({
        TOSS_PAYMENTS_CLIENT_KEY: "live_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "live_sk_123",
      }),
    ).toBe(true);
    expect(
      isTossPaymentsLiveConfigured({
        TOSS_PAYMENTS_CLIENT_KEY: "test_ck_123",
        TOSS_PAYMENTS_SECRET_KEY: "test_sk_123",
      }),
    ).toBe(false);
    expect(
      isTossPaymentsLiveConfigured({
        TOSS_PAYMENTS_CLIENT_KEY: "live_ck_...",
        TOSS_PAYMENTS_SECRET_KEY: "live_sk_123",
      }),
    ).toBe(false);
  });

  it("charges a billing key with server API auth and idempotency", async () => {
    vi.stubEnv("TOSS_PAYMENTS_CLIENT_KEY", "test_ck_123");
    vi.stubEnv("TOSS_PAYMENTS_SECRET_KEY", "test_sk_123");
    vi.stubEnv("TOSS_PAYMENTS_API_BASE_URL", "https://toss.example");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          paymentKey: "pay_123",
          status: "DONE",
          orderId: "order_123",
          orderName: "KRW Ontology Standard 월 구독",
          totalAmount: 7900,
          currency: "KRW",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await chargeTossBillingKey({
      billingKey: "bill=key",
      customerKey: "customer-key",
      amountKrw: 7900,
      orderId: "order_123",
      orderName: "KRW Ontology Standard 월 구독",
      idempotencyKey: "00000000-0000-4000-8000-000000000000",
    });

    expect(response.status).toBe("DONE");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://toss.example/v1/billing/bill%3Dkey",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.headers).toMatchObject({
      Authorization: buildTossBasicAuthorization("test_sk_123"),
      "Content-Type": "application/json",
      "Idempotency-Key": "00000000-0000-4000-8000-000000000000",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      customerKey: "customer-key",
      amount: 7900,
      orderId: "order_123",
      orderName: "KRW Ontology Standard 월 구독",
    });
  });

  it("maps Toss API errors into TossPaymentsError", async () => {
    vi.stubEnv("TOSS_PAYMENTS_CLIENT_KEY", "test_ck_123");
    vi.stubEnv("TOSS_PAYMENTS_SECRET_KEY", "test_sk_123");
    vi.stubEnv("TOSS_PAYMENTS_API_BASE_URL", "https://toss.example");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: "UNAUTHORIZED_KEY",
            message: "잘못된 시크릿 키입니다.",
          }),
          { status: 401 },
        ),
      ),
    );

    await expect(
      issueTossBillingKey({
        authKey: "auth_key",
        customerKey: "customer-key",
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED_KEY",
      status: 401,
      message: "잘못된 시크릿 키입니다.",
    });
  });

  it("cancels a payment with a durable idempotency key and optional partial amount", async () => {
    vi.stubEnv("TOSS_PAYMENTS_CLIENT_KEY", "test_ck_123");
    vi.stubEnv("TOSS_PAYMENTS_SECRET_KEY", "test_sk_123");
    vi.stubEnv("TOSS_PAYMENTS_API_BASE_URL", "https://toss.example");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          paymentKey: "pay/cancel",
          status: "CANCELED",
          orderId: "order_123",
          orderName: "KRW Ontology Standard 월 구독",
          totalAmount: 7900,
          balanceAmount: 0,
          currency: "KRW",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await cancelTossPayment({
      paymentKey: "pay/cancel",
      cancelReason: "7일 이내 미사용 자동 환불",
      cancelAmountKrw: 7900,
      idempotencyKey: "00000000-0000-4000-8000-000000000000",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://toss.example/v1/payments/pay%2Fcancel/cancel",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.headers).toMatchObject({
      "Idempotency-Key": "00000000-0000-4000-8000-000000000000",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      cancelReason: "7일 이내 미사용 자동 환불",
      cancelAmount: 7900,
    });
  });

  it("queries a payment by merchant order id for reconciliation", async () => {
    vi.stubEnv("TOSS_PAYMENTS_CLIENT_KEY", "test_ck_123");
    vi.stubEnv("TOSS_PAYMENTS_SECRET_KEY", "test_sk_123");
    vi.stubEnv("TOSS_PAYMENTS_API_BASE_URL", "https://toss.example");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          paymentKey: "pay_123",
          status: "DONE",
          orderId: "order/123",
          orderName: "KRW Ontology Pro 월 구독",
          totalAmount: 29_000,
          currency: "KRW",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getTossPaymentByOrderId("order/123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://toss.example/v1/payments/orders/order%2F123",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
