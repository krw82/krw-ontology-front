import { getAuthUser, handleAuthError } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  startTossBillingCheckout,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof TossBillingFlowError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  if (
    error instanceof Error &&
    error.message.includes("Missing required environment variable")
  ) {
    return Response.json(
      {
        error: {
          code: "billing_provider_not_configured",
          message: "Toss Payments 환경변수가 설정되지 않았습니다.",
        },
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      error: {
        code: "billing_checkout_failed",
        message: "결제 시작에 실패했습니다.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const rateLimitResponse = await checkBillingMutationRateLimit(
    user.id,
    "checkout",
  );
  if (rateLimitResponse) return rateLimitResponse;

  let payload: { planKey?: unknown };
  try {
    payload = (await request.json()) as { planKey?: unknown };
  } catch {
    return Response.json(
      {
        error: {
          code: "invalid_json",
          message: "요청 본문이 올바른 JSON이 아닙니다.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await startTossBillingCheckout({
      userId: user.id,
      planKey: payload.planKey,
      requestOrigin: new URL(request.url).origin,
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
