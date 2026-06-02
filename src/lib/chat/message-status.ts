export const CANCELLED_ASSISTANT_MESSAGE = "응답 생성을 취소했습니다.";
export const FAILED_ASSISTANT_MESSAGE = "응답 생성에 실패했습니다.";

export function cancelledAssistantContent(content: string | null | undefined) {
  const trimmed = content?.trim() ?? "";
  return trimmed || CANCELLED_ASSISTANT_MESSAGE;
}
