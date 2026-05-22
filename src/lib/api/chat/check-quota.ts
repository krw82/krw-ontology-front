import { checkQuota as checkQuotaImpl, type QuotaCheckResult } from "@/lib/concurrency/quota";
import type { ErrorCode } from "@/types/api-contracts";

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId?: string
) {
  return Response.json(
    { error: { code, message }, request_id: requestId },
    { status }
  );
}

/**
 * Checks the daily quota for the user.
 * Returns the quota result on success, or an error Response.
 */
export async function checkQuotaStep(
  userId: string,
  requestId?: string
): Promise<{ ok: true; quota: QuotaCheckResult } | { ok: false; response: Response }> {
  const quota = await checkQuotaImpl(userId);

  if (!quota.allowed) {
    if (quota.reason === "internal_error") {
      return {
        ok: false,
        response: errorResponse(
          500,
          "internal_error",
          "사용량 정보를 확인하지 못했습니다.",
          requestId,
        ),
      };
    }

    return {
      ok: false,
      response: errorResponse(
        429,
        quota.reason ?? "quota_exceeded",
        quota.reason === "quota_exceeded"
          ? "Daily question limit exceeded"
          : "Daily cost cap exceeded",
        requestId
      ),
    };
  }

  return { ok: true, quota };
}
