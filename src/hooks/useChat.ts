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
  ExecutionBudgetStatus,
  ReleaseMetadata,
  ErrorCode,
  GetChatSessionResponse,
  GetChatEvidenceResponse,
  Session,
  ResearchActivityUpdate,
  MCPToolName,
  ToolCall,
} from "@/types/api-contracts";
import { getChatContentLimit } from "@/lib/chat-limits";
import { deriveLoadedChatState } from "@/lib/chat/history-state";
import { removeOptimisticUserMessage } from "@/lib/chat/optimistic-message";
import { createClientId } from "@/lib/client-id";
import {
  DEFAULT_RESEARCH_MODE,
  type ResearchMode,
} from "@/lib/research-mode";
import {
  DEFAULT_ANALYSIS_MODE,
  type AnalysisMode,
} from "@/lib/analysis-mode";

interface UseChatOptions {
  sessionId: string;
  scopeType?: "global" | "company";
  defaultTickers?: string[];
  defaultDocumentTypes?: string[];
  researchMode?: ResearchMode;
  analysisMode?: AnalysisMode;
  onSessionCreated?: (sessionId: string) => void;
}

interface SendMessageOptions {
  sessionId?: string;
  requestId?: string;
}

export type SendMessageResult =
  | { ok: true }
  | { ok: false; message: string };

export interface ToolCallState {
  tool_call_id: string;
  tool_name: MCPToolName;
  status: "running" | "completed" | "failed";
  arguments?: Record<string, unknown>;
  duration_ms?: number;
  result_summary?: string | null;
  started_at?: number;
  finished_at?: number;
}

export interface ChatState {
  session: Session | null;
  messages: Message[];
  status: RunStatus | "idle";
  isHydratingSession: boolean;
  streamingContent: string;
  error: string | null;
  activity: ResearchActivityUpdate | null;
  toolCalls: ToolCallState[];
  citations: ChatCitation[];
  runDurationsByMessageId: Record<string, number>;
  runId: string | null;
  runStartedAt: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    latency_ms: number;
  } | null;
  release: ReleaseMetadata | null;
  executionBudget: ExecutionBudgetStatus | null;
}

function createInitialChatState(): ChatState {
  return {
    session: null,
    messages: [],
    status: "idle",
    isHydratingSession: false,
    streamingContent: "",
    error: null,
    activity: null,
    toolCalls: [],
    citations: [],
    runDurationsByMessageId: {},
    runId: null,
    runStartedAt: null,
    usage: null,
    release: null,
    executionBudget: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function mapToolCallState(toolCall: ToolCall): ToolCallState {
  return {
    tool_call_id: toolCall.tool_use_id ?? toolCall.id,
    tool_name: toolCall.tool_name,
    status: toolCall.error_message
      ? "failed"
      : toolCall.finished_at
        ? "completed"
        : "running",
    arguments: isPlainObject(toolCall.arguments_json)
      ? toolCall.arguments_json
      : undefined,
    result_summary: toolCall.result_summary,
    started_at: toolCall.started_at
      ? new Date(toolCall.started_at).getTime()
      : undefined,
    finished_at: toolCall.finished_at
      ? new Date(toolCall.finished_at).getTime()
      : undefined,
  };
}

function latestCompletedAssistantMessageId(messages: Message[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.status === "completed")
    ?.id;
}

function activityForTool(toolName: MCPToolName): ResearchActivityUpdate {
  if (
    toolName === "route_news_question" ||
    toolName === "resolve_news_entities" ||
    toolName === "search_company_news_events" ||
    toolName === "search_market_news_events" ||
    toolName === "search_news_by_domain" ||
    toolName === "read_news_sources" ||
    toolName === "build_news_timeline" ||
    toolName === "audit_news_sources"
  ) {
    return {
      stage: "researching",
      label: "최신 뉴스 이벤트 확인 중",
    };
  }

  if (
    toolName === "krw_ontology_catalog" ||
    toolName === "krw_ontology_company_context" ||
    toolName === "krw_ontology_index_context" ||
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useChat({
  sessionId,
  scopeType = "global",
  defaultTickers = [],
  defaultDocumentTypes = [],
  researchMode = DEFAULT_RESEARCH_MODE,
  analysisMode = DEFAULT_ANALYSIS_MODE,
  onSessionCreated,
}: UseChatOptions) {
  const [state, setState] = useState<ChatState>(() => createInitialChatState());

  const abortRef = useRef<AbortController | null>(null);
  const statusRef = useRef<ChatState["status"]>("idle");
  const finalizedRef = useRef(false);
  const streamingContentRef = useRef("");
  const lastEventIdRef = useRef<string>("");
  const activeRunIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(sessionId || null);
  const sendInFlightRef = useRef(false);
  const sessionSyncRequestedRef = useRef(false);
  const streamGenerationRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      streamGenerationRef.current += 1;
      sendInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (sessionId) {
      const previousSessionId = activeSessionIdRef.current;
      if (previousSessionId && previousSessionId !== sessionId) {
        abortRef.current?.abort();
        streamGenerationRef.current += 1;
        activeRunIdRef.current = null;
        activeRequestIdRef.current = null;
        activeAssistantMessageIdRef.current = null;
        finalizedRef.current = true;
        streamingContentRef.current = "";
        lastEventIdRef.current = "";
        sessionSyncRequestedRef.current = false;
        setState({
          ...createInitialChatState(),
          isHydratingSession: true,
        });
      }
      activeSessionIdRef.current = sessionId;
      return;
    }

    abortRef.current?.abort();
    streamGenerationRef.current += 1;
    activeSessionIdRef.current = null;
    activeRunIdRef.current = null;
    activeRequestIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    finalizedRef.current = false;
    streamingContentRef.current = "";
    lastEventIdRef.current = "";
    sessionSyncRequestedRef.current = false;
    setState(createInitialChatState());
  }, [sessionId]);

  const handleSSEEvent = useCallback((eventType: StreamingEventType, data: unknown) => {
    switch (eventType) {
      case "run_started": {
        const d = data as {
          run_id: string;
          message_id: string;
          session_id?: string;
          request_id?: string;
          started_at?: string;
        };
        if (
          !sessionId &&
          d.session_id &&
          activeSessionIdRef.current !== d.session_id
        ) {
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
          runStartedAt: d.started_at ?? new Date().toISOString(),
          activity: {
            stage: "preparing",
            label: "분석 준비 중",
          },
          status: "running",
          isHydratingSession: false,
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
          // Raw agent text can contain planning notes before tool calls. Keep
          // it out of the visible chat surface; the user-facing Markdown is
          // committed only by the terminal `done.content` payload.
          streamingContentRef.current += d.text;
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
              arguments: d.arguments,
              started_at: d.started_at ? Date.parse(d.started_at) : Date.now(),
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
                  result_summary: d.result_summary,
                  finished_at: Date.now(),
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
          execution_budget: ExecutionBudgetStatus;
        };
        finalizedRef.current = true;
        activeRunIdRef.current = d.run_id;
        activeRequestIdRef.current = null;
        sessionSyncRequestedRef.current = false;
        setState((prev) => {
          const finalContent = (d.content ?? "").trim();
          let newMessages = prev.messages;
          if (finalContent) {
            const messageId = d.message_id || createClientId();
            const existingIndex = prev.messages.findIndex(
              (message) => message.id === messageId,
            );
            const completedMessage: Message = {
              id: messageId,
              session_id: activeSessionIdRef.current || sessionId,
              role: "assistant",
              content: finalContent,
              status: "completed",
              created_at:
                existingIndex >= 0
                  ? prev.messages[existingIndex].created_at
                  : new Date().toISOString(),
              updated_at:
                existingIndex >= 0
                  ? prev.messages[existingIndex].updated_at
                  : undefined,
            };
            newMessages =
              existingIndex >= 0
                ? prev.messages.map((message, index) =>
                    index === existingIndex ? completedMessage : message,
                  )
                : [...prev.messages, completedMessage];
          }
          return {
            ...prev,
            messages: newMessages,
            streamingContent: "",
            activity: null,
            runId: d.run_id,
            runStartedAt: null,
            runDurationsByMessageId: d.message_id
              ? {
                  ...prev.runDurationsByMessageId,
                  [d.message_id]: d.usage.latency_ms,
                }
              : prev.runDurationsByMessageId,
            release: d.release,
            usage: d.usage,
            executionBudget: d.execution_budget,
            status: "completed",
            isHydratingSession: false,
          };
        });
        break;
      }
      case "state_sync": {
        const d = data as {
          session_id: string;
          run_id?: string | null;
          status: RunStatus | "idle";
          reason?: string;
        };
        if (
          d.session_id &&
          activeSessionIdRef.current &&
          activeSessionIdRef.current !== d.session_id
        ) {
          break;
        }

        sessionSyncRequestedRef.current = true;
        if (d.run_id) activeRunIdRef.current = d.run_id;

        const isActiveStatus =
          d.status === "queued" ||
          d.status === "running" ||
          d.status === "pending";

        if (!isActiveStatus) {
          finalizedRef.current = true;
          activeRunIdRef.current = null;
          activeAssistantMessageIdRef.current = null;
          activeRequestIdRef.current = null;
          streamingContentRef.current = "";
        }

        setState((prev) => ({
          ...prev,
          status:
            d.status === "pending" || d.status === "queued"
              ? "running"
              : d.status === "idle"
                ? "idle"
                : d.status,
          isHydratingSession: false,
          activity:
            isActiveStatus
              ? {
                  stage: d.status === "queued" ? "queued" : "preparing",
                  label:
                    d.status === "queued"
                      ? "분석 대기 중"
                      : "분석 상태 복원 중",
                }
              : null,
          streamingContent: isActiveStatus ? prev.streamingContent : "",
          runId: d.run_id ?? null,
          runStartedAt:
            isActiveStatus
              ? prev.runStartedAt
              : null,
          error: d.status === "failed" ? prev.error : null,
        }));
        break;
      }
      case "error": {
        const d = data as {
          run_id: string;
          error_code: ErrorCode;
          error_message: string;
        };
        finalizedRef.current = true;
        activeRunIdRef.current = d.run_id || null;
        setState((prev) => ({
          ...prev,
          status: "failed",
          isHydratingSession: false,
          error: d.error_message,
          streamingContent: "",
          activity: null,
          runStartedAt: null,
        }));
        break;
      }
      case "cancelled": {
        finalizedRef.current = true;
        activeRunIdRef.current = null;
        activeRequestIdRef.current = null;
        activeAssistantMessageIdRef.current = null;
        streamingContentRef.current = "";
        setState((prev) => ({
          ...prev,
          status: "cancelled",
          isHydratingSession: false,
          activity: null,
          runStartedAt: null,
          streamingContent: "",
        }));
        break;
      }
    }
  }, [onSessionCreated, sessionId]);

  const syncSessionFromServer = useCallback(async (targetSessionId: string) => {
    setState((prev) => ({
      ...prev,
      isHydratingSession: true,
      error: null,
    }));

    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(targetSessionId)}`);
      if (!res.ok) {
        if (activeSessionIdRef.current === targetSessionId) {
          setState((prev) => ({
            ...prev,
            isHydratingSession: false,
          }));
        }
        return false;
      }
      const data: GetChatSessionResponse = await res.json();
      if (activeSessionIdRef.current !== targetSessionId) return false;

      const loaded = deriveLoadedChatState(data.messages || [], data.runs || []);
      finalizedRef.current = loaded.status !== "running";
      activeRunIdRef.current = loaded.activeRunId;
      activeAssistantMessageIdRef.current = loaded.activeAssistantMessageId;
      streamingContentRef.current =
        loaded.status === "running" ? "" : loaded.streamingContent;
      sessionSyncRequestedRef.current = false;
      const evidenceMessageId =
        loaded.status === "completed"
          ? latestCompletedAssistantMessageId(loaded.messages)
          : undefined;

      setState((prev) => ({
        ...prev,
        session: data.session,
        messages: loaded.messages,
        status: loaded.status,
        isHydratingSession: false,
        error: null,
        activity:
          loaded.status === "running"
            ? {
                stage: "preparing",
                label: "분석 상태 복원 중",
              }
            : null,
        streamingContent:
          loaded.status === "running" ? "" : loaded.streamingContent,
        runId: loaded.activeRunId,
        runStartedAt: loaded.activeRunStartedAt,
        toolCalls: [],
        citations: [],
        runDurationsByMessageId: Object.fromEntries(
          (data.runs ?? [])
            .filter(
              (run) =>
                run.assistant_message_id &&
                typeof run.latency_ms === "number" &&
                run.latency_ms > 0,
            )
            .map((run) => [
              run.assistant_message_id as string,
              run.latency_ms as number,
            ]),
        ),
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

      if (evidenceMessageId) {
        void fetch(
          `/api/chat/${encodeURIComponent(targetSessionId)}/evidence?message_id=${encodeURIComponent(evidenceMessageId)}`,
        )
          .then(async (evidenceResponse) => {
            if (!evidenceResponse.ok) return null;
            return (await evidenceResponse.json()) as GetChatEvidenceResponse;
          })
          .then((evidence) => {
            if (
              !evidence ||
              !mountedRef.current ||
              activeSessionIdRef.current !== targetSessionId ||
              evidence.message_id !== evidenceMessageId
            ) {
              return;
            }

            setState((prev) => {
              if (
                prev.status !== "completed" ||
                latestCompletedAssistantMessageId(prev.messages) !==
                  evidenceMessageId
              ) {
                return prev;
              }

              return {
                ...prev,
                toolCalls: evidence.tool_calls.map(mapToolCallState),
                citations: evidence.citations as ChatCitation[],
              };
            });
          })
          .catch(() => {
            // Evidence is supplemental; the session itself has already loaded.
          });
      }

      return true;
    } catch {
      if (activeSessionIdRef.current !== targetSessionId) return false;
      setState((prev) => ({
        ...prev,
        isHydratingSession: false,
        error: "채팅을 불러오지 못했습니다.",
      }));
      return false;
    }
  }, []);

  const readStream = useCallback(
    async (
      response: Response,
      context?: {
        sessionId?: string | null;
        runId?: string | null;
        requestId?: string | null;
        generation?: number;
      },
    ): Promise<boolean> => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("응답 스트림을 열지 못했습니다.");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (
          context?.generation != null &&
          streamGenerationRef.current !== context.generation
        ) {
          await reader.cancel().catch(() => undefined);
          return false;
        }

        if (
          context?.requestId &&
          activeRequestIdRef.current &&
          activeRequestIdRef.current !== context.requestId
        ) {
          await reader.cancel().catch(() => undefined);
          return false;
        }

        if (
          context?.sessionId &&
          activeSessionIdRef.current !== context.sessionId
        ) {
          await reader.cancel().catch(() => undefined);
          return false;
        }

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
              if (
                eventType !== "state_sync" &&
                context?.runId &&
                isPlainObject(data) &&
                typeof data.run_id === "string" &&
                data.run_id !== context.runId
              ) {
                continue;
              }
              handleSSEEvent(eventType, data);
            } catch {
              // Ignore parse errors for incomplete data
            }
          }
        }
      }

      if (sessionSyncRequestedRef.current && context?.sessionId) {
        await syncSessionFromServer(context.sessionId);
      }

      return finalizedRef.current;
    },
    [handleSSEEvent, syncSessionFromServer],
  );

  const reconnectUntilFinalized = useCallback(
    async (
      targetSessionId: string,
      targetRunId: string,
      signal: AbortSignal,
      generation: number,
    ): Promise<boolean> => {
      let attempts = 0;

      while (!finalizedRef.current && !signal.aborted) {
        if (streamGenerationRef.current !== generation) {
          return false;
        }

        if (
          activeSessionIdRef.current !== targetSessionId
        ) {
          return false;
        }

        try {
          const reconnectParams = new URLSearchParams({
            session_id: targetSessionId,
            run_id: targetRunId,
            last_event_id: lastEventIdRef.current,
            content_length: String(streamingContentRef.current.length),
          });
          const response = await fetch(
            `/api/chat/run/reconnect?${reconnectParams}`,
            { signal },
          );

          if (response.ok) {
            const didFinalize = await readStream(response, {
              sessionId: targetSessionId,
              runId: targetRunId,
              generation,
            });
            if (didFinalize) return true;
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return false;
        }

        attempts += 1;
        await delay(Math.min(5000, 1000 + attempts * 500));
      }

      return finalizedRef.current;
    },
    [readStream],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      options: SendMessageOptions = {},
    ): Promise<SendMessageResult> => {
      if (
        !content.trim() ||
        statusRef.current === "running" ||
        sendInFlightRef.current
      ) {
        return {
          ok: false,
          message:
            !content.trim()
              ? "메시지를 입력해야 합니다."
              : "현재 답변 생성 중입니다.",
        };
      }
      const targetSessionId = options.sessionId || sessionId;
      const contentLimit = getChatContentLimit(content);
      if (content.length > contentLimit) {
        setState((prev) => ({
          ...prev,
          error: `메시지가 너무 깁니다. 최대 ${contentLimit.toLocaleString()}자까지 입력할 수 있습니다.`,
        }));
        return {
          ok: false,
          message: `메시지가 너무 깁니다. 최대 ${contentLimit.toLocaleString()}자까지 입력할 수 있습니다.`,
        };
      }

      const requestId = options.requestId || createClientId();
      sendInFlightRef.current = true;
      statusRef.current = "running";
      activeRequestIdRef.current = requestId;
      activeSessionIdRef.current = targetSessionId || null;
      streamGenerationRef.current += 1;
      const generation = streamGenerationRef.current;

      finalizedRef.current = false;
      streamingContentRef.current = "";
      lastEventIdRef.current = "";
      activeRunIdRef.current = null;
      activeAssistantMessageIdRef.current = null;
      sessionSyncRequestedRef.current = false;

      const userMessage: Message = {
        id: createClientId(),
        session_id: targetSessionId || "pending",
        role: "user",
        content: content.trim(),
        status: "completed",
        created_at: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        status: "running",
        isHydratingSession: false,
        streamingContent: "",
        error: null,
        activity: {
          stage: "preparing",
          label: "분석 준비 중",
        },
        toolCalls: [],
        citations: [],
        runId: null,
        runStartedAt: null,
        usage: null,
        release: null,
        executionBudget: null,
      }));

      const abortController = new AbortController();
      abortRef.current = abortController;

      const processRun = async (response: Response) => {
        try {
          const responseSessionId = response.headers.get("x-chat-session-id");
          if (!targetSessionId && responseSessionId) {
            if (
              abortController.signal.aborted ||
              streamGenerationRef.current !== generation ||
              activeRequestIdRef.current !== requestId
            ) {
              return;
            }
            activeSessionIdRef.current = responseSessionId;
            onSessionCreated?.(responseSessionId);
            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((message) => ({
                ...message,
                session_id:
                  message.session_id === "pending"
                    ? responseSessionId
                    : message.session_id,
              })),
            }));
          }

          const wasFinalized = await readStream(response, {
            sessionId: responseSessionId || targetSessionId || null,
            requestId,
            generation,
          });

          // If the transport ends early, keep reconnecting until the server sends
          // an explicit terminal event. A closed SSE connection is not completion.
          if (!wasFinalized && !abortController.signal.aborted) {
            const runId = activeRunIdRef.current;
            const reconnectSessionId = activeSessionIdRef.current || targetSessionId;

            if (runId && reconnectSessionId) {
              setState((prev) => {
                if (prev.status !== "running") return prev;
                return {
                  ...prev,
                  activity: {
                    stage: "preparing",
                    label: "분석 상태 복원 중",
                  },
                };
              });
              await reconnectUntilFinalized(
                reconnectSessionId,
                runId,
                abortController.signal,
                generation,
              );
            } else if (!finalizedRef.current) {
              throw new Error("실행 정보를 확인하지 못했습니다. 다시 시도해주세요.");
            }
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            setState((prev) => ({
              ...prev,
              status: "cancelled",
              isHydratingSession: false,
              activity: null,
              runStartedAt: null,
            }));
          } else {
            const runId = activeRunIdRef.current;
            const reconnectSessionId = activeSessionIdRef.current || targetSessionId;

            if (
              runId &&
              reconnectSessionId &&
              streamGenerationRef.current === generation
            ) {
              setState((prev) => ({
                ...prev,
                activity: {
                  stage: "preparing",
                  label: "분석 상태 복원 중",
                },
              }));

              const recovered = await reconnectUntilFinalized(
                reconnectSessionId,
                runId,
                abortController.signal,
                generation,
              );
              if (recovered) return;

              const synced = await syncSessionFromServer(reconnectSessionId);
              if (synced) return;
            }

            setState((prev) => ({
              ...prev,
              status: "failed",
              isHydratingSession: false,
              error: (err as Error).message,
              activity: null,
              runStartedAt: null,
            }));
          }
        } finally {
          abortRef.current = null;
          if (activeRequestIdRef.current === requestId) {
            activeRequestIdRef.current = null;
          }
          sendInFlightRef.current = false;
        }
      };

      let response: Response;
      try {
        response = await fetch("/api/chat/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            ...(targetSessionId ? { session_id: targetSessionId } : {}),
            content: content.trim(),
            request_id: requestId,
            research_mode: researchMode,
            analysis_mode: analysisMode,
            scope_type: scopeType,
            default_tickers: defaultTickers,
            default_document_types: defaultDocumentTypes,
          }),
          signal: abortController.signal,
        });
      } catch (err) {
        sendInFlightRef.current = false;
        activeRequestIdRef.current = null;
        abortRef.current = null;
        if ((err as Error).name === "AbortError") {
          setState((prev) => ({
            ...prev,
            messages: removeOptimisticUserMessage(prev.messages, userMessage.id),
            status: "cancelled",
            isHydratingSession: false,
            activity: null,
            runStartedAt: null,
          }));
          return {
            ok: false,
            message: "응답 생성을 취소했습니다.",
          };
        }
        const message =
          err instanceof Error
            ? err.message
            : "메시지를 보내지 못했습니다. 네트워크 상태를 확인해주세요.";
        setState((prev) => ({
          ...prev,
          messages: removeOptimisticUserMessage(prev.messages, userMessage.id),
          status: "failed",
          isHydratingSession: false,
          error: message,
          activity: null,
          runStartedAt: null,
        }));
        return {
          ok: false,
          message,
        };
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const message =
          errorData?.error?.message || `요청에 실패했습니다: ${response.status}`;
        sendInFlightRef.current = false;
        if (activeRequestIdRef.current === requestId) {
          activeRequestIdRef.current = null;
        }
        setState((prev) => ({
          ...prev,
          messages: removeOptimisticUserMessage(prev.messages, userMessage.id),
          status: "failed",
          isHydratingSession: false,
          error: message,
          activity: null,
          runStartedAt: null,
        }));
        return { ok: false, message };
      }

      void processRun(response);
      return { ok: true };
    },
    [
      defaultDocumentTypes,
      defaultTickers,
      onSessionCreated,
      reconnectUntilFinalized,
      readStream,
      analysisMode,
      researchMode,
      scopeType,
      sessionId,
      syncSessionFromServer,
    ],
  );

  const cancelRun = useCallback(async () => {
    const runId = activeRunIdRef.current;
    const requestId = activeRequestIdRef.current;
    const targetSessionId = activeSessionIdRef.current || sessionId;

    if (abortRef.current) {
      abortRef.current.abort();
    }

    streamGenerationRef.current += 1;
    finalizedRef.current = true;
    activeRunIdRef.current = null;
    activeRequestIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    streamingContentRef.current = "";
    sessionSyncRequestedRef.current = false;
    setState((prev) => ({
      ...prev,
      status: "cancelled",
      isHydratingSession: false,
      activity: null,
      streamingContent: "",
      runId: null,
      runStartedAt: null,
    }));

    try {
      if (runId || requestId) {
        await fetch("/api/chat/run/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(runId ? { run_id: runId } : {}),
            ...(requestId ? { request_id: requestId } : {}),
          }),
        });
      } else if (targetSessionId) {
        await fetch(`/api/chat/${targetSessionId}/cancel`, { method: "POST" });
      }
    } catch {
      // Ignore cancel errors
    }
  }, [sessionId]);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    await syncSessionFromServer(sessionId);
  }, [sessionId, syncSessionFromServer]);

  useEffect(() => {
    if (!sessionId) return;
    if (state.status !== "running" || !state.runId) return;
    if (abortRef.current) return;

    const abortController = new AbortController();
    abortRef.current = abortController;
    finalizedRef.current = false;
    activeRunIdRef.current = state.runId;
    streamGenerationRef.current += 1;
    const generation = streamGenerationRef.current;

    const reconnect = async () => {
      try {
        await reconnectUntilFinalized(
          sessionId,
          state.runId ?? "",
          abortController.signal,
          generation,
        );
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
  }, [reconnectUntilFinalized, sessionId, state.runId, state.status]);

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
