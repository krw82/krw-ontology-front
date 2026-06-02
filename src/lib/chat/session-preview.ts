import type { MessageRow } from "@/types/database";
import {
  CANCELLED_ASSISTANT_MESSAGE,
  FAILED_ASSISTANT_MESSAGE,
} from "@/lib/chat/message-status";
import { sanitizeAssistantPreviewContent } from "@/lib/chat/assistant-content";

const AUTH_ERROR_PATTERNS = [/not logged in/i, /please run \/login/i];

export function buildSessionPreview(
  message: Pick<MessageRow, "content" | "status"> & Partial<Pick<MessageRow, "role">>,
): string {
  if (message.status === "failed") {
    return FAILED_ASSISTANT_MESSAGE;
  }

  if (message.status === "cancelled") {
    return CANCELLED_ASSISTANT_MESSAGE;
  }

  if (AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message.content))) {
    return "KRW-AI 인증이 필요합니다.";
  }

  const visibleContent =
    message.role === "user"
      ? message.content.replace(/\s+/g, " ").trim()
      : sanitizeAssistantPreviewContent(message.content);

  return visibleContent.slice(0, 100);
}
