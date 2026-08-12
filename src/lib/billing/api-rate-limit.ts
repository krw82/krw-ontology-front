import {
  checkDurableRateLimits,
  readPositiveIntEnv,
} from "@/lib/api/rate-limit";

const DEFAULT_BILLING_MUTATIONS_PER_USER_PER_MINUTE = 5;

export async function checkBillingMutationRateLimit(
  userId: string,
  action:
    | "quote"
    | "confirm"
    | "checkout"
    | "change_plan"
    | "cancel"
    | "refund",
): Promise<Response | null> {
  const result = await checkDurableRateLimits([
    {
      key: `user:${userId}`,
      bucket: `billing_${action}:user:minute`,
      limit: readPositiveIntEnv(
        "BILLING_MUTATIONS_PER_USER_PER_MINUTE",
        DEFAULT_BILLING_MUTATIONS_PER_USER_PER_MINUTE,
      ),
    },
  ]);
  if (result.ok) return null;

  const headers =
    result.retryAfterSeconds === undefined
      ? undefined
      : { "Retry-After": String(result.retryAfterSeconds) };
  return Response.json(
    {
      error: {
        code: result.code,
        message:
          result.status === 429
            ? "결제 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
            : "결제 요청 제한 상태를 확인하지 못했습니다.",
      },
    },
    { status: result.status, headers },
  );
}
