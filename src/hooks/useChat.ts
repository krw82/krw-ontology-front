"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type {
  Message,
  StreamingEventType,
  RunStatus,
  StreamingCitation,
  ChatCitation,
  StreamingToolCallStart,
  StreamingToolCallEnd,
  QuotaStatus,
  ReleaseMetadata,
  ErrorCode,
  GetChatSessionResponse,
  Session,
  ResearchArtifact,
  ResearchActivityUpdate,
  MCPToolName,
} from "@/types/api-contracts";
import { getChatContentLimit } from "@/lib/chat-limits";
import { deriveLoadedChatState } from "@/lib/chat/history-state";

interface UseChatOptions {
  sessionId: string;
  scopeType?: "global" | "company";
  defaultTickers?: string[];
  defaultDocumentTypes?: string[];
  onSessionCreated?: (sessionId: string) => void;
}

export interface ToolCallState {
  tool_call_id: string;
  tool_name: string;
  status: "running" | "completed" | "failed";
  duration_ms?: number;
}

export interface ChatState {
  session: Session | null;
  messages: Message[];
  status: RunStatus | "idle";
  streamingContent: string;
  error: string | null;
  activity: ResearchActivityUpdate | null;
  toolCalls: ToolCallState[];
  citations: ChatCitation[];
  richAnswers: ResearchArtifact[];
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

function createInitialChatState(): ChatState {
  return {
    session: null,
    messages: [],
    status: "idle",
    streamingContent: "",
    error: null,
    activity: null,
    toolCalls: [],
    citations: [],
    richAnswers: [],
    runId: null,
    usage: null,
    release: null,
    quota: null,
  };
}

function mergeRichAnswers(
  current: ResearchArtifact[],
  incoming: ResearchArtifact[],
): ResearchArtifact[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((artifact) => [artifact.id, artifact]));
  for (const artifact of incoming) {
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values());
}

function activityForTool(toolName: MCPToolName): ResearchActivityUpdate {
  if (
    toolName === "krw_ontology_catalog" ||
    toolName === "krw_ontology_topic_map" ||
    toolName === "krw_ontology_plan_query"
  ) {
    return {
      stage: "connecting",
      label: "자료 연결 확인 중",
    };
  }

  if (
    toolName === "krw_ontology_trace" ||
    toolName === "krw_ontology_chain" ||
    toolName === "krw_ontology_quality" ||
    toolName === "krw_ontology_compare"
  ) {
    return {
      stage: "checking_evidence",
      label: "핵심 근거 정리 중",
    };
  }

  return {
    stage: "researching",
    label: "관련 근거 확인 중",
  };
}

export function useChat({
  sessionId,
  scopeType = "global",
  defaultTickers = [],
  defaultDocumentTypes = [],
  onSessionCreated,
}: UseChatOptions) {
  const [state, setState] = useState<ChatState>(() => createInitialChatState());

  const abortRef = useRef<AbortController | null>(null);
  const statusRef = useRef<ChatState["status"]>("idle");
  const finalizedRef = useRef(false);
  const streamingContentRef = useRef("");
  const lastEventIdRef = useRef<string>("");
  const retryCountRef = useRef(0);
  const activeRunIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(sessionId || null);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    if (sessionId) {
      activeSessionIdRef.current = sessionId;
      return;
    }

    activeSessionIdRef.current = null;
    activeRunIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    finalizedRef.current = false;
    streamingContentRef.current = "";
    lastEventIdRef.current = "";
    retryCountRef.current = 0;
    setState(createInitialChatState());
  }, [sessionId]);

  const handleSSEEvent = useCallback((eventType: StreamingEventType, data: unknown) => {
    switch (eventType) {
      case "run_started": {
        const d = data as {
          run_id: string;
          message_id: string;
          session_id?: string;
        };
        if (!sessionId && d.session_id) {
          activeSessionIdRef.current = d.session_id;
          onSessionCreated?.(d.session_id);
        }
        activeRunIdRef.current = d.run_id;
        activeAssistantMessageIdRef.current = d.message_id;
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((message) => ({
            ...message,
            session_id: d.session_id ?? message.session_id,
          })),
          runId: d.run_id,
          activity: {
            stage: "preparing",
            label: "분석 준비 중",
          },
          status: "running",
        }));
        break;
      }
      case "activity_update": {
        const d = data as ResearchActivityUpdate;
        setState((prev) => ({
          ...prev,
          activity: d,
        }));
        break;
      }
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
          activity: activityForTool(d.tool_name),
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
          rich_answers?: ResearchArtifact[];
          artifacts?: ResearchArtifact[];
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
                  session_id:
                    activeSessionIdRef.current || sessionId,
                  role: "assistant" as const,
                  content: finalContent,
                  status: "completed" as const,
                  created_at: new Date().toISOString(),
                },
              ]
            : prev.messages;
          return {
            ...prev,
            messages: newMessages,
            streamingContent: "",
            activity: null,
            runId: d.run_id,
            release: d.release,
            usage: d.usage,
            quota: d.quota,
            richAnswers: mergeRichAnswers(
              prev.richAnswers,
              d.rich_answers ?? d.artifacts ?? [],
            ),
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
                session_id: activeSessionIdRef.current || sessionId,
                role: "assistant",
                content: trimmed,
                status: "failed",
                created_at: new Date().toISOString(),
              }
            : null;
          return {
            ...prev,
            status: "failed",
            error: d.error_message,
            streamingContent: "",
            activity: null,
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
          activity: null,
        }));
        break;
      }
    }
  }, [onSessionCreated, sessionId]);

  const readStream = useCallback(
    async (response: Response): Promise<boolean> => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("응답 스트림을 열지 못했습니다.");

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
    },
    [handleSSEEvent],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || statusRef.current === "running") return;
      const contentLimit = getChatContentLimit(content);
      if (content.length > contentLimit) {
        setState((prev) => ({
          ...prev,
          error: `메시지가 너무 깁니다. 최대 ${contentLimit.toLocaleString()}자까지 입력할 수 있습니다.`,
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
        session_id: sessionId || "pending",
        role: "user",
        content: content.trim(),
        status: "completed",
        created_at: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        status: "running",
        streamingContent: "",
        error: null,
        activity: {
          stage: "preparing",
          label: "분석 준비 중",
        },
        toolCalls: [],
        citations: [],
        richAnswers: [],
        usage: null,
        release: null,
        quota: null,
      }));

      const abortController = new AbortController();
      abortRef.current = abortController;

      const MAX_RETRIES = 3;
      const RETRY_BASE_DELAY_MS = 1000;

      try {
        const response = await fetch("/api/chat/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            ...(sessionId ? { session_id: sessionId } : {}),
            content: content.trim(),
            request_id: requestId,
            scope_type: scopeType,
            default_tickers: defaultTickers,
            default_document_types: defaultDocumentTypes,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(
            errorData?.error?.message || `요청에 실패했습니다: ${response.status}`,
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
            if (!activeRunIdRef.current) break;

            try {
              const reconnectParams = new URLSearchParams({
                session_id: activeSessionIdRef.current || sessionId,
                run_id: activeRunIdRef.current ?? "",
                last_event_id: lastEventIdRef.current,
                content_length: String(streamingContentRef.current.length),
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
                    session_id: activeSessionIdRef.current || sessionId,
                    role: "assistant",
                    content: trimmed,
                    status: "completed",
                    created_at: new Date().toISOString(),
                  }
                : null;
              return {
                ...prev,
                messages: partialMessage
                  ? [...prev.messages, partialMessage]
                  : prev.messages,
                streamingContent: "",
                activity: null,
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
                activity: null,
                status: "completed",
              };
            }
            return {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: crypto.randomUUID(),
                  session_id: activeSessionIdRef.current || sessionId,
                  role: "assistant",
                  content: c,
                  status: "completed",
                  created_at: new Date().toISOString(),
                },
              ],
              streamingContent: "",
              activity: null,
              status: "completed",
            };
          });
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setState((prev) => ({ ...prev, status: "cancelled", activity: null }));
        } else {
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: (err as Error).message,
            activity: null,
          }));
        }
      } finally {
        abortRef.current = null;
      }
    },
    [
      defaultDocumentTypes,
      defaultTickers,
      readStream,
      scopeType,
      sessionId,
    ],
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
      const loaded = deriveLoadedChatState(data.messages || [], data.runs || []);
      finalizedRef.current = loaded.status !== "running";
      activeRunIdRef.current = loaded.activeRunId;
      activeAssistantMessageIdRef.current = loaded.activeAssistantMessageId;
      streamingContentRef.current = loaded.streamingContent;
      setState((prev) => ({
        ...prev,
        session: data.session,
        messages: loaded.messages,
        status: loaded.status,
        activity:
          loaded.status === "running"
            ? {
                stage: "preparing",
                label: "분석 상태 복원 중",
              }
            : null,
        streamingContent: loaded.streamingContent,
        runId: loaded.activeRunId,
        citations: (data.citations ?? []) as ChatCitation[],
        richAnswers: data.rich_answers ?? data.research_artifacts ?? [],
        ...(data.runs && data.runs.length > 0
          ? {
              usage:
                data.runs[data.runs.length - 1].input_tokens != null
                  ? {
                      input_tokens:
                        data.runs[data.runs.length - 1].input_tokens ?? 0,
                      output_tokens:
                        data.runs[data.runs.length - 1].output_tokens ?? 0,
                      estimated_cost_usd:
                        data.runs[data.runs.length - 1].estimated_cost_usd ?? 0,
                      latency_ms:
                        data.runs[data.runs.length - 1].latency_ms ?? 0,
                    }
                  : prev.usage,
            }
          : {}),
      }));
    } catch {
      setState((prev) => ({ ...prev, error: "채팅을 불러오지 못했습니다." }));
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (state.status !== "running" || !state.runId) return;
    if (abortRef.current) return;

    const abortController = new AbortController();
    abortRef.current = abortController;
    finalizedRef.current = false;
    activeRunIdRef.current = state.runId;

    const reconnect = async () => {
      try {
        const reconnectParams = new URLSearchParams({
          session_id: sessionId,
          run_id: state.runId ?? "",
          last_event_id: lastEventIdRef.current,
          content_length: String(streamingContentRef.current.length),
        });
        const response = await fetch(
          `/api/chat/run/reconnect?${reconnectParams}`,
          { signal: abortController.signal },
        );
        if (response.ok) {
          await readStream(response);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setState((prev) => ({
            ...prev,
            error: "실행 중인 응답을 다시 연결하지 못했습니다.",
          }));
        }
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = null;
        }
      }
    };

    reconnect();

    return () => {
      abortController.abort();
      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
    };
  }, [readStream, sessionId, state.runId, state.status]);

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
