"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type {
  Message,
  StreamingEventType,
  RunStatus,
  StreamingCitation,
  StreamingToolCallStart,
  StreamingToolCallEnd,
  QuotaStatus,
  ReleaseMetadata,
  ErrorCode,
  GetChatSessionResponse,
} from "@/types/api-contracts";
import { getChatContentLimit } from "@/lib/chat-limits";

interface UseChatOptions {
  sessionId: string;
}

export interface ToolCallState {
  tool_call_id: string;
  tool_name: string;
  status: "running" | "completed" | "failed";
  duration_ms?: number;
}

export interface ChatState {
  messages: Message[];
  status: RunStatus | "idle";
  streamingContent: string;
  error: string | null;
  toolCalls: ToolCallState[];
  citations: StreamingCitation[];
  runId: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    latency_ms: number;
  } | null;
  release: ReleaseMetadata | null;
  quota: QuotaStatus | null;
}

export function useChat({ sessionId }: UseChatOptions) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    status: "idle",
    streamingContent: "",
    error: null,
    toolCalls: [],
    citations: [],
    runId: null,
    usage: null,
    release: null,
    quota: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const statusRef = useRef<ChatState["status"]>("idle");
  const finalizedRef = useRef(false);
  const streamingContentRef = useRef("");
  const lastEventIdRef = useRef<string>("");
  const retryCountRef = useRef(0);
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  const handleSSEEvent = useCallback((eventType: StreamingEventType, data: unknown) => {
    switch (eventType) {
      case "token": {
        const d = data as { text: string };
        if (d.text) {
          setState((prev) => {
            const next = prev.streamingContent + d.text;
            streamingContentRef.current = next;
            return { ...prev, streamingContent: next };
          });
        }
        break;
      }
      case "tool_call_start": {
        const d = data as StreamingToolCallStart;
        setState((prev) => ({
          ...prev,
          toolCalls: [
            ...prev.toolCalls,
            {
              tool_call_id: d.tool_call_id,
              tool_name: d.tool_name,
              status: "running",
            },
          ],
        }));
        break;
      }
      case "tool_call_end": {
        const d = data as StreamingToolCallEnd;
        setState((prev) => ({
          ...prev,
          toolCalls: prev.toolCalls.map((tc) =>
            tc.tool_call_id === d.tool_call_id
              ? {
                  ...tc,
                  status: d.error_message ? "failed" : "completed",
                  duration_ms: d.duration_ms,
                }
              : tc,
          ),
        }));
        break;
      }
      case "citation": {
        const d = data as StreamingCitation;
        setState((prev) => ({
          ...prev,
          citations: [...prev.citations, d],
        }));
        break;
      }
      case "done": {
        const d = data as {
          run_id: string;
          message_id: string;
          content?: string;
          release: ReleaseMetadata;
          usage: {
            input_tokens: number;
            output_tokens: number;
            estimated_cost_usd: number;
            latency_ms: number;
          };
          quota: QuotaStatus;
        };
        finalizedRef.current = true;
        activeRunIdRef.current = d.run_id;
        setState((prev) => {
          const finalContent = (d.content ?? prev.streamingContent).trim();
          const newMessages = finalContent
            ? [
                ...prev.messages,
                {
                  id: d.message_id || crypto.randomUUID(),
                  session_id: sessionId,
                  role: "assistant" as const,
                  content: finalContent,
                  created_at: new Date().toISOString(),
                },
              ]
            : prev.messages;
          return {
            ...prev,
            messages: newMessages,
            streamingContent: "",
            runId: d.run_id,
            release: d.release,
            usage: d.usage,
            quota: d.quota,
            status: "completed",
          };
        });
        break;
      }
      case "error": {
        const d = data as {
          run_id: string;
          error_code: ErrorCode;
          error_message: string;
        };
        finalizedRef.current = true;
        setState((prev) => {
          const trimmed = prev.streamingContent.trim();
          const partialMessage: Message | null = trimmed
            ? {
                id: crypto.randomUUID(),
                session_id: prev.messages[0]?.session_id ?? "",
                role: "assistant",
                content: trimmed,
                created_at: new Date().toISOString(),
              }
            : null;
          return {
            ...prev,
            status: "failed",
            error: d.error_message,
            streamingContent: "",
            messages: partialMessage
              ? [...prev.messages, partialMessage]
              : prev.messages,
          };
        });
        break;
      }
      case "cancelled": {
        finalizedRef.current = true;
        setState((prev) => ({
          ...prev,
          status: "cancelled",
        }));
        break;
      }
    }
  }, [sessionId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return;
      if (!content.trim() || statusRef.current === "running") return;
      const contentLimit = getChatContentLimit(content);
      if (content.length > contentLimit) {
        setState((prev) => ({
          ...prev,
          error: `Message too long (max ${contentLimit.toLocaleString()} chars)`,
        }));
        return;
      }

      const requestId = crypto.randomUUID();

      finalizedRef.current = false;
      streamingContentRef.current = "";
      lastEventIdRef.current = "";
      retryCountRef.current = 0;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        role: "user",
        content: content.trim(),
        created_at: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        status: "running",
        streamingContent: "",
        error: null,
        toolCalls: [],
        citations: [],
        usage: null,
        release: null,
        quota: null,
      }));

      const abortController = new AbortController();
      abortRef.current = abortController;

      const MAX_RETRIES = 3;
      const RETRY_BASE_DELAY_MS = 1000;

      async function readStream(response: Response): Promise<boolean> {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const eventBlock = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            let eventType: StreamingEventType | null = null;
            const dataLines: string[] = [];
            let eventId: string | null = null;

            for (const line of eventBlock.split("\n")) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim() as StreamingEventType;
              } else if (line.startsWith("data: ")) {
                dataLines.push(line.slice(6));
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5));
              } else if (line.startsWith("id: ")) {
                eventId = line.slice(4).trim();
              }
            }

            if (eventId) {
              lastEventIdRef.current = eventId;
            }

            if (eventType && dataLines.length > 0) {
              try {
                const data = JSON.parse(dataLines.join("\n"));
                handleSSEEvent(eventType, data);
              } catch {
                // Ignore parse errors for incomplete data
              }
            }
          }
        }

        return finalizedRef.current;
      }

      try {
        const response = await fetch("/api/chat/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            session_id: sessionId,
            content: content.trim(),
            request_id: requestId,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(
            errorData?.error?.message || `Request failed: ${response.status}`,
          );
        }

        const wasFinalized = await readStream(response);

        // If stream ended without a "done"/"error"/"cancelled" event, attempt reconnect
        if (!wasFinalized && !abortController.signal.aborted) {
          let reconnected = false;

          while (retryCountRef.current < MAX_RETRIES && !finalizedRef.current) {
            retryCountRef.current++;
            const delay = RETRY_BASE_DELAY_MS * retryCountRef.current;
            await new Promise((r) => setTimeout(r, delay));

            if (finalizedRef.current || abortController.signal.aborted) break;

            try {
              const reconnectParams = new URLSearchParams({
                session_id: sessionId,
                run_id: activeRunIdRef.current ?? "",
                last_event_id: lastEventIdRef.current,
              });
              const retryResp = await fetch(
                `/api/chat/run/reconnect?${reconnectParams}`,
                { signal: abortController.signal },
              );

              if (!retryResp.ok) continue;

              const retryFinalized = await readStream(retryResp);
              if (retryFinalized) {
                reconnected = true;
                break;
              }
            } catch {
              // Retry failed, continue to next attempt
            }
          }

          if (!reconnected && !finalizedRef.current) {
            // Final fallback: save partial content as message
            setState((prev) => {
              if (prev.status !== "running") return prev;
              const trimmed = prev.streamingContent.trim();
              const partialMessage: Message | null = trimmed
                ? {
                    id: crypto.randomUUID(),
                    session_id: sessionId,
                    role: "assistant",
                    content: trimmed,
                    created_at: new Date().toISOString(),
                  }
                : null;
              return {
                ...prev,
                messages: partialMessage
                  ? [...prev.messages, partialMessage]
                  : prev.messages,
                streamingContent: "",
                status: "completed",
              };
            });
          }
        }

        // Finalization fallback: only if "done" was never received and no partial saved
        if (!finalizedRef.current) {
          setState((prev) => {
            if (prev.status === "failed") return prev;
            if (prev.status !== "running") return prev;
            const c = prev.streamingContent.trim();
            if (!c) {
              return {
                ...prev,
                streamingContent: "",
                status: "completed",
              };
            }
            return {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: crypto.randomUUID(),
                  session_id: sessionId,
                  role: "assistant",
                  content: c,
                  created_at: new Date().toISOString(),
                },
              ],
              streamingContent: "",
              status: "completed",
            };
          });
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setState((prev) => ({ ...prev, status: "cancelled" }));
        } else {
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: (err as Error).message,
          }));
        }
      } finally {
        abortRef.current = null;
      }
    },
    [handleSSEEvent, sessionId],
  );

  const cancelRun = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    try {
      await fetch(`/api/chat/${sessionId}/cancel`, { method: "POST" });
    } catch {
      // Ignore cancel errors
    }
  }, [sessionId]);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/chat/${sessionId}`);
      if (!res.ok) return;
      const data: GetChatSessionResponse = await res.json();
      setState((prev) => ({
        ...prev,
        messages: data.messages || [],
        ...(data.runs && data.runs.length > 0
          ? {
              runId: data.runs[data.runs.length - 1].id,
              usage:
                data.runs[data.runs.length - 1].input_tokens != null
                  ? {
                      input_tokens:
                        data.runs[data.runs.length - 1].input_tokens ?? 0,
                      output_tokens:
                        data.runs[data.runs.length - 1].output_tokens ?? 0,
                      estimated_cost_usd: 0,
                      latency_ms:
                        data.runs[data.runs.length - 1].latency_ms ?? 0,
                    }
                  : prev.usage,
            }
          : {}),
      }));
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to load session" }));
    }
  }, [sessionId]);

  return useMemo(
    () => ({
      ...state,
      sendMessage,
      cancelRun,
      loadSession,
    }),
    [state, sendMessage, cancelRun, loadSession]
  );
}
