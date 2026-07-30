import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import {
  cancelTossBillingOperation,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ operationId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const rateLimitResponse = await checkBillingMutationRateLimit(user.id, "confirm");
  if (rateLimitResponse) return rateLimitResponse;
  const { operationId } = await params;

  try {
    await cancelTossBillingOperation({ userId: user.id, operationId });
    return Response.json(
      { operationId, status: "cancelled" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof TossBillingFlowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return Response.json(
      {
        error: {
          code: "billing_operation_cancel_failed",
          message: "결제 작업을 취소하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
