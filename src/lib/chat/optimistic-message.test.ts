import { describe, expect, it } from "vitest";
import { removeOptimisticUserMessage } from "./optimistic-message";
import type { Message } from "@/types/api-contracts";

const baseMessage = {
  session_id: "session-1",
  created_at: "2026-05-31T00:00:00.000Z",
  updated_at: "2026-05-31T00:00:00.000Z",
  status: "completed",
} satisfies Partial<Message>;

describe("removeOptimisticUserMessage", () => {
  it("removes only the matching optimistic user message", () => {
    const messages: Message[] = [
      {
        ...baseMessage,
        id: "user-1",
        role: "user",
        content: "failed optimistic message",
      },
      {
        ...baseMessage,
        id: "assistant-1",
        role: "assistant",
        content: "persisted answer",
      },
    ];

    expect(removeOptimisticUserMessage(messages, "user-1")).toEqual([
      messages[1],
    ]);
  });

  it("does not remove assistant messages with the same id defensively", () => {
    const messages: Message[] = [
      {
        ...baseMessage,
        id: "same-id",
        role: "assistant",
        content: "assistant",
      },
    ];

    expect(removeOptimisticUserMessage(messages, "same-id")).toEqual(messages);
  });
});
