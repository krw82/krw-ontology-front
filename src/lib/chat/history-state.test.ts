import { describe, expect, it } from "vitest";
import {
  buildChatSessionHref,
  deriveLoadedChatState,
  getSessionTickers,
} from "./history-state";
import type { AgentRunSummary, Message } from "@/types/api-contracts";

const baseMessage = {
  session_id: "session-1",
  created_at: "2026-05-12T00:00:00.000Z",
  updated_at: "2026-05-12T00:00:00.000Z",
} satisfies Partial<Message>;

const baseRun = {
  model: "sonnet",
  started_at: "2026-05-12T00:00:01.000Z",
  finished_at: null,
  latency_ms: null,
  input_tokens: null,
  output_tokens: null,
  estimated_cost_usd: null,
  ontology_release_id: null,
  index_generated_at: null,
  error_code: null,
  assistant_message_id: null,
} satisfies Omit<AgentRunSummary, "id" | "status">;

describe("chat history state", () => {
  it("builds stable session URLs", () => {
    expect(buildChatSessionHref("abc 123")).toBe("/chat?sessionId=abc%20123");
  });

  it("prefers persisted session tickers over URL fallback", () => {
    expect(
      getSessionTickers(
        { default_tickers: [" nvda ", "NVDA", "tsm"] },
        "005930",
      ),
    ).toEqual(["NVDA", "TSM"]);
  });

  it("uses the URL ticker while a new session is still loading", () => {
    expect(getSessionTickers(null, "005930")).toEqual(["005930"]);
  });

  it("extracts a streaming assistant message from visible history", () => {
    const messages: Message[] = [
      {
        ...baseMessage,
        id: "user-1",
        role: "user",
        content: "NVDA 알려줘",
        status: "completed",
      },
      {
        ...baseMessage,
        id: "assistant-1",
        role: "assistant",
        content: "작성 중",
        status: "streaming",
      },
    ];
    const runs: AgentRunSummary[] = [
      {
        ...baseRun,
        id: "run-1",
        status: "running",
        assistant_message_id: "assistant-1",
      },
    ];

    const state = deriveLoadedChatState(messages, runs);

    expect(state.status).toBe("running");
    expect(state.activeRunId).toBe("run-1");
    expect(state.activeAssistantMessageId).toBe("assistant-1");
    expect(state.activeRunStartedAt).toBe("2026-05-12T00:00:01.000Z");
    expect(state.streamingContent).toBe("작성 중");
    expect(state.messages.map((message) => message.id)).toEqual(["user-1"]);
  });

  it("treats queued runs as active so reconnect can attach before the worker starts", () => {
    const messages: Message[] = [
      {
        ...baseMessage,
        id: "user-1",
        role: "user",
        content: "AAPL 분석해줘",
        status: "completed",
      },
      {
        ...baseMessage,
        id: "assistant-1",
        role: "assistant",
        content: "",
        status: "pending",
      },
    ];
    const runs: AgentRunSummary[] = [
      {
        ...baseRun,
        id: "run-1",
        status: "queued",
        assistant_message_id: "assistant-1",
      },
    ];

    const state = deriveLoadedChatState(messages, runs);

    expect(state.status).toBe("running");
    expect(state.activeRunId).toBe("run-1");
    expect(state.activeAssistantMessageId).toBe("assistant-1");
    expect(state.streamingContent).toBe("");
    expect(state.messages.map((message) => message.id)).toEqual(["user-1"]);
  });

  it("keeps completed assistant messages in visible history", () => {
    const messages: Message[] = [
      {
        ...baseMessage,
        id: "assistant-1",
        role: "assistant",
        content: "완료",
        status: "completed",
      },
    ];
    const runs: AgentRunSummary[] = [
      {
        ...baseRun,
        id: "run-1",
        status: "completed",
        assistant_message_id: "assistant-1",
      },
    ];

    const state = deriveLoadedChatState(messages, runs);

    expect(state.status).toBe("completed");
    expect(state.activeRunStartedAt).toBeNull();
    expect(state.streamingContent).toBe("");
    expect(state.messages).toHaveLength(1);
  });
});
