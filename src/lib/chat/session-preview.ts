import type { MessageRow } from "@/types/database";

const AUTH_ERROR_PATTERNS = [/not logged in/i, /please run \/login/i];

export function buildSessionPreview(
  message: Pick<MessageRow, "content" | "status">,
): string {
  if (message.status === "failed") {
    return "응답 생성에 실패했습니다.";
  }

  if (AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message.content))) {
    return "KRW-AI 인증이 필요합니다.";
  }

  return message.content.replace(/\s+/g, " ").trim().slice(0, 100);
}
