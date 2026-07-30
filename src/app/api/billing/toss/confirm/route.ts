import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import {
  confirmTossBillingOperation,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        code: "billing_confirm_failed",
        message: "결제 요청을 처리하지 못했습니다.",
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

  const rateLimitResponse = await checkBillingMutationRateLimit(user.id, "confirm");
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
  const operationId = (payload as Record<string, unknown>).operationId;
  if (typeof operationId !== "string" || !operationId.trim()) {
    return Response.json(
      {
        error: {
          code: "billing_operation_id_invalid",
          message: "결제 작업을 찾을 수 없습니다.",
        },
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(
      await confirmTossBillingOperation({
        userId: user.id,
        operationId,
        requestOrigin: new URL(request.url).origin,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
