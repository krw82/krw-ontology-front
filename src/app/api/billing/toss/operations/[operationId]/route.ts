import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  getTossBillingOperationForUser,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operationId: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { operationId } = await params;
  try {
    const operation = await getTossBillingOperationForUser({
      userId: user.id,
      operationId,
    });
    return Response.json(
      {
        operation: {
          id: operation.id,
          kind: operation.kind,
          status: operation.status,
          fromPlanKey: operation.from_plan_key,
          targetPlanKey: operation.target_plan_key,
          chargedTodayKrw: operation.quoted_amount_krw,
          nextChargeKrw: operation.next_amount_krw,
          effectiveAt: operation.effective_at,
          nextBillingAt: operation.next_billing_at,
          failureCode: operation.failure_code,
          failureMessage: operation.failure_message,
          expiresAt: operation.expires_at,
          completedAt: operation.completed_at,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
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
          code: "billing_operation_lookup_failed",
          message: "결제 작업을 확인하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
