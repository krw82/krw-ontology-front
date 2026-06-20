import { getAuthUser, handleAuthError } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  cancelCurrentTossSubscription,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const rateLimitResponse = await checkBillingMutationRateLimit(
    user.id,
    "cancel",
  );
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const result = await cancelCurrentTossSubscription(user.id);
    return Response.json(result);
  } catch (error) {
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
    return Response.json(
      {
        error: {
          code: "subscription_cancel_failed",
          message: "구독 해지 예약에 실패했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
