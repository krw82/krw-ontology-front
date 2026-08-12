import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import { TossBillingFlowError } from "@/lib/billing/toss-billing-error";
import { requestTossAutoRefund } from "@/lib/billing/toss-refunds";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof TossBillingFlowError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return Response.json(
    {
      error: {
        code: "auto_refund_failed",
        message: "자동 환불을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const rateLimitResponse = await checkBillingMutationRateLimit(user.id, "refund");
  if (rateLimitResponse) return rateLimitResponse;

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
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
  const paymentId = (payload as Record<string, unknown>).paymentId;
  if (typeof paymentId !== "string" || !UUID_PATTERN.test(paymentId)) {
    return Response.json(
      {
        error: {
          code: "invalid_payment_id",
          message: "환불할 결제 정보를 확인하지 못했습니다.",
        },
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(
      await requestTossAutoRefund({ userId: user.id, paymentId }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
