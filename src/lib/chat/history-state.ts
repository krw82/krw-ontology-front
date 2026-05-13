import type { AgentRunSummary, Message, RunStatus, Session } from "@/types/api-contracts";

export interface LoadedChatState {
  messages: Message[];
  streamingContent: string;
  activeRunId: string | null;
  activeAssistantMessageId: string | null;
  status: RunStatus | "idle";
}

export function buildChatSessionHref(sessionId: string): string {
  return `/chat?sessionId=${encodeURIComponent(sessionId)}`;
}

export function getSessionTickers(
  session: Pick<Session, "default_tickers"> | null | undefined,
  fallbackTicker?: string | null,
): string[] {
  const fromSession = session?.default_tickers ?? [];
  const tickers = fromSession.length > 0
    ? fromSession
    : fallbackTicker
      ? [fallbackTicker]
      : [];

  return Array.from(
    new Set(
      tickers
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

export function deriveLoadedChatState(
  messages: Message[],
  runs: AgentRunSummary[],
): LoadedChatState {
  const latestRun = [...runs]
    .filter((run) => run.started_at)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .at(-1);
  const isActiveRun =
    latestRun?.status === "pending" || latestRun?.status === "running";

  if (!isActiveRun || !latestRun) {
    return {
      messages,
      streamingContent: "",
      activeRunId: latestRun?.id ?? null,
      activeAssistantMessageId: latestRun?.assistant_message_id ?? null,
      status: latestRun?.status ?? "idle",
    };
  }

  const streamingAssistant = findStreamingAssistantMessage(
    messages,
    latestRun.assistant_message_id,
  );

  return {
    messages: streamingAssistant
      ? messages.filter((message) => message.id !== streamingAssistant.id)
      : messages,
    streamingContent: streamingAssistant?.content ?? "",
    activeRunId: latestRun.id,
    activeAssistantMessageId: streamingAssistant?.id ?? latestRun.assistant_message_id,
    status: "running",
  };
}

function findStreamingAssistantMessage(
  messages: Message[],
  assistantMessageId: string | null,
): Message | null {
  if (assistantMessageId) {
    const message = messages.find((candidate) => candidate.id === assistantMessageId);
    if (message?.role === "assistant") return message;
  }

  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        (message.status === "streaming" || message.status === "pending"),
    ) ?? null;
}
