import type { Message } from "@/types/api-contracts";

export function removeOptimisticUserMessage(
  messages: Message[],
  messageId: string,
): Message[] {
  return messages.filter(
    (message) => !(message.id === messageId && message.role === "user"),
  );
}
