import {
  reserveExecutionBudget,
  type ExecutionBudgetCheckResult,
} from "@/lib/concurrency/execution-budget";
import type { ResearchMode } from "@/lib/research-mode";
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
 * Opens an idempotent execution-budget record before an agent run can start.
 * Credits are charged after completion and capped at the remaining balance.
 */
export async function reserveBudgetStep(
  userId: string,
  requestId: string,
  userEmail?: string | null,
  researchMode?: ResearchMode,
): Promise<
  | { ok: true; budget: ExecutionBudgetCheckResult }
  | { ok: false; response: Response }
> {
  const budget = await reserveExecutionBudget(
    userId,
    requestId,
    userEmail,
    researchMode,
  );

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
