import type { ErrorCode } from "@/types/api-contracts";
import { toErrorCode } from "@/types/api-contracts";

const PUBLIC_ERROR_MESSAGES: Record<ErrorCode, string> = {
  auth_required: "로그인이 필요합니다.",
  authentication_error: "인증 정보를 확인하지 못했습니다. 다시 로그인해주세요.",
  service_unavailable: "서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
  not_found: "요청한 항목을 찾지 못했습니다.",
  forbidden: "이 작업을 할 권한이 없습니다.",
  coverage_limit_reached: "Free 플랜에서는 기업 3개까지 커버리지에 추가할 수 있습니다.",
  judgment_revision_conflict: "다른 화면에서 판단이 먼저 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.",
  active_run_exists: "이미 응답을 생성 중입니다.",
  no_active_run: "진행 중인 응답이 없습니다.",
  quota_exceeded: "주간 분석 한도에 도달했습니다.",
  cost_cap_exceeded: "주간 분석 한도에 도달했습니다.",
  tool_budget_exceeded:
    "답변 생성 중 문제가 발생했습니다. 같은 질문으로 다시 시도하거나 범위를 조금 좁혀주세요.",
  concurrency_limit: "현재 요청이 많습니다. 잠시 후 다시 시도해주세요.",
  lease_expired: "분석 시간이 초과되었습니다. 다시 시도해주세요.",
  cancelled: "응답 생성을 취소했습니다.",
  mcp_unavailable: "온톨로지 도구 연결을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
  worker_unavailable: "분석 워커가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
  mcp_error: "온톨로지 도구 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  claude_api_error: "에이전트 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  claude_rate_limited:
    "분석 서비스가 잠시 바쁩니다. 잠시 후 다시 시도해주세요.",
  rate_limited: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  validation_error: "요청 형식이 올바르지 않습니다.",
  internal_error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
};

export function publicErrorMessage(code: string | null | undefined): string {
  return PUBLIC_ERROR_MESSAGES[toErrorCode(code ?? "internal_error")];
}

export function publicAgentErrorMessage(params: {
  code?: string | null;
  fallbackCode?: ErrorCode;
}): string {
  return publicErrorMessage(params.code ?? params.fallbackCode ?? "claude_api_error");
}
