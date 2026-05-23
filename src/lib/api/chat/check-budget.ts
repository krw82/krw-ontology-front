import {
  reserveExecutionBudget,
  type ExecutionBudgetCheckResult,
} from "@/lib/concurrency/execution-budget";
import type { ErrorCode } from "@/types/api-contracts";

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId?: string,
) {
  return Response.json(
    { error: { code, message }, request_id: requestId },
    { status },
  );
}

/**
 * Reserves execution budget before an agent run can start. The reservation is
 * idempotent by request_id at the database layer.
 */
export async function reserveBudgetStep(
  userId: string,
  requestId: string,
  userEmail?: string | null,
): Promise<
  | { ok: true; budget: ExecutionBudgetCheckResult }
  | { ok: false; response: Response }
> {
  const budget = await reserveExecutionBudget(userId, requestId, userEmail);

  if (!budget.allowed) {
    if (budget.reason === "internal_error") {
      return {
        ok: false,
        response: errorResponse(
          500,
          "internal_error",
          "분석 크레딧 정보를 확인하지 못했습니다.",
          requestId,
        ),
      };
    }

    return {
      ok: false,
      response: errorResponse(
        429,
        "cost_cap_exceeded",
        "사용할 수 있는 분석 크레딧을 모두 사용했습니다.",
        requestId,
      ),
    };
  }

  return { ok: true, budget };
}
