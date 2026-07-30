import "server-only";

/**
 * Emergency circuit breaker for monetary mutations. V2 is the only billing
 * flow when this is enabled; turning it off makes the product read-only and
 * never routes a request through a legacy payment path.
 */
export function areBillingWritesEnabled(
  env: { BILLING_WRITES_ENABLED?: string } = process.env as {
    BILLING_WRITES_ENABLED?: string;
  },
): boolean {
  return env.BILLING_WRITES_ENABLED !== "0";
}

export const BILLING_WRITES_DISABLED_MESSAGE =
  "결제 변경을 잠시 점검하고 있습니다. 현재 구독 상태는 유지됩니다.";
