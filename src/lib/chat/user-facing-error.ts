const GENERIC_ANALYSIS_ERROR =
  "잠시 후 다시 시도해주세요.";

const TEMPORARY_ANALYSIS_ERROR =
  "분석 서비스가 잠시 바쁩니다. 잠시 후 다시 시도해주세요.";

const WEEKLY_LIMIT_ERROR = "주간 분석 한도에 도달했습니다.";

const INTERNAL_DETAIL_PATTERN =
  /anthropic|api[_ -]?key|authentication_failed|invalid api key|krw-ai|server restart|restart the server|서버를 재시작|서버 실행 환경|worker lease|stack trace|\bat\s+.+\(.+\.tsx?:\d+|\binternal server error\b/i;

const TEMPORARY_FAILURE_PATTERN =
  /rate limit|\b429\b|service unavailable|temporarily unavailable|timeout|timed out|networkerror|failed to fetch/i;

const WEEKLY_LIMIT_PATTERN =
  /주간 분석 한도|quota_exceeded|cost_cap_exceeded|크레딧.*한도|analysis credit/i;

const SAFE_CHAT_MESSAGE_PATTERNS = [
  /^메시지가 너무 깁니다\./,
  /^메시지를 입력해야 합니다\./,
  /^현재 답변 생성 중입니다\./,
  /^채팅 세션을 만들지 못했습니다\./,
  /^새 채팅 메시지를 준비하지 못했습니다\./,
  /^인덱스에 있는 회사만 채팅할 수 있습니다\./,
  /^요청 형식이 올바르지 않습니다\./,
  /^로그인이 필요합니다\./,
  /^인증 정보를 확인하지 못했습니다\./,
  /^이 작업을 할 권한이 없습니다\./,
  /^요청한 항목을 찾지 못했습니다\./,
  /^응답 생성을 취소했습니다\./,
] as const;

const INPUT_ERROR_PATTERN =
  /^메시지가 너무 깁니다\.|^메시지를 입력해야 합니다\.|^요청 형식이 올바르지 않습니다\./;

function firstLine(message: string | null | undefined): string {
  return (message ?? "").split("\n")[0]?.trim() ?? "";
}

export function isWeeklyAnalysisLimitError(
  message: string | null | undefined,
): boolean {
  return WEEKLY_LIMIT_PATTERN.test(message ?? "");
}

export function isChatInputError(message: string | null | undefined): boolean {
  return INPUT_ERROR_PATTERN.test(firstLine(message));
}

/**
 * Lets the chat surface retain intentional validation messages while never
 * reflecting provider credentials, stack details, or deployment instructions.
 */
export function toUserFacingChatError(
  message: string | null | undefined,
): string {
  const cleaned = firstLine(message);
  if (!cleaned) return GENERIC_ANALYSIS_ERROR;
  if (isWeeklyAnalysisLimitError(cleaned)) return WEEKLY_LIMIT_ERROR;
  if (TEMPORARY_FAILURE_PATTERN.test(cleaned)) return TEMPORARY_ANALYSIS_ERROR;
  if (INTERNAL_DETAIL_PATTERN.test(cleaned)) return GENERIC_ANALYSIS_ERROR;
  if (SAFE_CHAT_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return cleaned;
  }
  return GENERIC_ANALYSIS_ERROR;
}

/** Error boundaries should never show a raw thrown error to the user. */
export function toUserFacingBoundaryError(
  message: string | null | undefined,
): string {
  if (TEMPORARY_FAILURE_PATTERN.test(firstLine(message))) {
    return TEMPORARY_ANALYSIS_ERROR;
  }
  return "문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

export const USER_FACING_ANALYSIS_ERRORS = {
  generic: GENERIC_ANALYSIS_ERROR,
  temporary: TEMPORARY_ANALYSIS_ERROR,
  weeklyLimit: WEEKLY_LIMIT_ERROR,
} as const;
