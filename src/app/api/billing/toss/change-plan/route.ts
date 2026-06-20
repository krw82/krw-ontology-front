import { getAuthUser, handleAuthError } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  changeCurrentTossPlan,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    "change_plan",
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
    return Response.json(
      await changeCurrentTossPlan({
        userId: user.id,
        targetPlanKey: payload.planKey,
      }),
    );
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
          code: "plan_change_failed",
          message: "플랜 변경에 실패했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
