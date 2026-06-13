import type { AgentRunSummary, Message, RunStatus, Session } from "@/types/api-contracts";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { normalizeTicker, normalizeTickers } from "@/lib/ontology/ticker";

export interface LoadedChatState {
  messages: Message[];
  streamingContent: string;
  activeRunId: string | null;
  activeAssistantMessageId: string | null;
  activeRunStartedAt: string | null;
  status: RunStatus | "idle";
}

export function buildChatSessionHref(
  sessionId: string,
  options: { locale?: Locale; ticker?: string | null } = {},
): string {
  const params = new URLSearchParams();
  const ticker = normalizeTicker(options.ticker ?? "");
  if (ticker) params.set("ticker", ticker);
  appendLocaleParam(params, options.locale);
  const localeQuery = params.toString();
  return `/chat?sessionId=${encodeURIComponent(sessionId)}${
    localeQuery ? `&${localeQuery}` : ""
  }`;
}

export function buildNewChatHref(
  params?: URLSearchParams,
  options: { locale?: Locale } = {},
): string {
  const nextParams = new URLSearchParams(params);
  const ticker = nextParams.get("ticker");
  if (ticker) {
    const normalizedTicker = normalizeTicker(ticker);
    if (normalizedTicker) {
      nextParams.set("ticker", normalizedTicker);
    } else {
      nextParams.delete("ticker");
    }
  }
  appendLocaleParam(nextParams, options.locale);
  const query = nextParams.toString();
  return `/chat/new${query ? `?${query}` : ""}`;
}

function appendLocaleParam(params: URLSearchParams, locale?: Locale): void {
  if (!locale || locale === DEFAULT_LOCALE) return;
  params.set("locale", locale);
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

  return normalizeTickers(tickers);
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
    latestRun?.status === "pending" ||
    latestRun?.status === "queued" ||
    latestRun?.status === "running";

  if (!isActiveRun || !latestRun) {
    return {
      messages,
      streamingContent: "",
      activeRunId: latestRun?.id ?? null,
      activeAssistantMessageId: latestRun?.assistant_message_id ?? null,
      activeRunStartedAt: null,
      status: latestRun?.status ?? "idle",
    };
  }

  const streamingAssistant = findStreamingAssistantMessage(
    messages,
    latestRun.assistant_message_id,
  );
  const activeStatus = latestRun.status === "pending" ? "queued" : latestRun.status;

  return {
    messages: streamingAssistant
      ? messages.filter((message) => message.id !== streamingAssistant.id)
      : messages,
    streamingContent: "",
    activeRunId: latestRun.id,
    activeAssistantMessageId: streamingAssistant?.id ?? latestRun.assistant_message_id,
    activeRunStartedAt: activeStatus === "running" ? latestRun.started_at : null,
    status: activeStatus,
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
