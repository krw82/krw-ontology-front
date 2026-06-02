import type { NextRequest } from "next/server";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { tryAcquireLease, releaseLease, startLeaseHeartbeat } from "@/lib/concurrency/lease";
import {
  attachExecutionBudgetRun,
  releaseExecutionBudget,
  settleExecutionBudget,
  getExecutionBudgetStatus,
  estimateCost,
  checkExecutionBudget,
} from "@/lib/concurrency/execution-budget";
import { registerRun, cleanupRun } from "@/lib/agent/abort-manager";
import { runAgent } from "@/lib/agent/runner";
import { closeOpenToolCallsForRun } from "@/lib/agent/tool-call-cleanup";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import type { SdkDiagnostics } from "@/lib/agent/runner";
import type {
  AccumulatedRun,
  AccumulatedToolCall,
  StreamWriter,
} from "@/lib/agent/stream-handler";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import type { ExecutionBudgetCheckResult } from "@/lib/concurrency/execution-budget";
import type { ResolvedSession } from "./resolve-session";
import type { HistoryResult } from "./fetch-history";
import type {
  AgentRunRow,
  Json,
  MessageRow,
} from "@/types/database";
import type {
  ReleaseMetadata,
  StreamingCitation,
} from "@/types/api-contracts";
import { toErrorCode } from "@/types/api-contracts";
import { getOntologyEnv, readIntEnv } from "@/lib/env";
import type { ResearchMode } from "@/lib/research-mode";
import {
  publicAgentErrorMessage,
  publicErrorMessage,
} from "@/lib/api/chat/error-messages";
import {
  isSdkDiagnosticsEnabled,
  mergeSdkDiagnosticsForPersistence,
} from "@/lib/agent/sdk-diagnostics";
import { cancelledAssistantContent } from "@/lib/chat/message-status";

const EXISTING_RUN_POLL_INTERVAL_MS = 800;
const EXISTING_RUN_MAX_POLL_MS = 120_000;
const AGENT_RUN_HARD_TIMEOUT_MS =
  readIntEnv("AGENT_RUN_HARD_TIMEOUT_MINUTES", 6, { min: 1 }) * 60_000;
const RUN_TIMEOUT_MESSAGE =
  "분석 시간이 초과되었습니다. 다시 시도해주세요.";

type PublicReleaseInput = Omit<
  ReleaseMetadata,
  "krw_ontology_commit" | "web_commit"
>;

function publicReleaseMetadata(release: PublicReleaseInput): ReleaseMetadata {
  return {
    ...release,
    krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "dev",
    web_commit: process.env.WEB_COMMIT || "dev",
  };
}

export interface RunAgentParams {
  request: NextRequest;
  session: ResolvedSession;
  content: string;
  requestId: string;
  history: HistoryResult;
  budget: ExecutionBudgetCheckResult;
  mcpHealth: McpHealthResult;
  researchMode?: ResearchMode;
}

/**
 * Acquires a lease, creates a ReadableStream, runs the agent,
 * persists results, and returns the stream as a Response.
 *
 * This function owns the full streaming lifecycle.
 */
export function executeRun(params: RunAgentParams): Response {
  const {
    session,
    content,
    requestId,
    history,
    budget,
    mcpHealth,
  } = params;

  const admin = getSupabaseAdmin();
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const encoder = new TextEncoder();

  let streamAbortController: AbortController | null = null;
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      const writer: StreamWriter = {
        write: async (chunk: Uint8Array) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(chunk);
          } catch {
            clientConnected = false;
          }
        },
      };

      const sendEvent = async (event: string, data: unknown) => {
        await writer.write(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Acquire lease inside the stream so we can report errors via SSE
      const leaseResult = await tryAcquireLease(
        session.id,
        history.userMessageId,
        requestId,
        model,
        process.env.WEB_COMMIT || "dev",
        process.env.KRW_ONTOLOGY_COMMIT || "dev"
      );

      if (!leaseResult.acquired) {
        if (leaseResult.reason === "duplicate_request" && leaseResult.runId) {
          await streamPersistedRunEvents({
            admin,
            writer,
            encoder,
            runId: leaseResult.runId,
            sessionId: session.id,
            userId: session.userId,
            requestId,
            initialContentLength: 0,
          });
          controller.close();
          return;
        }

        // Clean up user message since run won't proceed
        await admin.from("messages").delete().eq("id", history.userMessageId);
        await releaseExecutionBudget(
          session.userId,
          requestId,
          null,
          leaseResult.reason ?? "lease_not_acquired",
        );

        await sendEvent("error", {
          run_id: "",
          error_code: toErrorCode(leaseResult.reason ?? "internal_error"),
          error_message: publicErrorMessage(leaseResult.reason ?? "internal_error"),
        });
        controller.close();
        return;
      }

      const runId = leaseResult.runId;
      await attachExecutionBudgetRun(session.userId, requestId, runId);
      const { data: runStart } = await admin
        .from("agent_runs")
        .select("started_at")
        .eq("id", runId)
        .single<{ started_at: string }>();
      const runStartedAt = runStart?.started_at ?? new Date().toISOString();

      streamAbortController = registerRun(runId);
      let hardTimedOut = false;
      let hardTimeout: ReturnType<typeof setTimeout> | null = null;

      const { data: assistantMsg, error: assistantMsgError } = await admin
        .from("messages")
        .insert({
          session_id: session.id,
          role: "assistant",
          content: "",
          status: "streaming",
        })
        .select("id")
        .single();

      if (assistantMsgError || !assistantMsg) {
        await markAgentRunTerminal(admin, runId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          errorCode: "internal_error",
          errorMessage: "응답 메시지를 만들지 못했습니다.",
          openToolErrorMessage:
            "Run failed before tool result was received: 응답 메시지를 만들지 못했습니다.",
        });
        await recordAnalyticsEvent({
          eventName: "answer_failed",
          userId: session.userId,
          sessionId: session.id,
          runId,
          properties: {
            scope_type: session.scopeType,
            ticker: session.defaultTickers[0] ?? null,
            tickers: session.defaultTickers,
            error_code: "internal_error",
            failure_stage: "assistant_message_create",
            research_mode: params.researchMode ?? null,
            tool_call_count: 0,
          },
        });
        await sendEvent("error", {
          run_id: runId,
          error_code: "internal_error",
          error_message: "응답 메시지를 만들지 못했습니다.",
        });
        await releaseExecutionBudget(
          session.userId,
          requestId,
          runId,
          "assistant_message_create_failed",
        );
        await releaseLease(runId);
        cleanupRun(runId);
        controller.close();
        return;
      }

      const assistantMessageId = assistantMsg.id as string;
      let stopLeaseHeartbeat: (() => void) | null = null;

      // Update agent_run with release metadata
      await admin
        .from("agent_runs")
        .update({
          assistant_message_id: assistantMessageId,
          ontology_env: mcpHealth.env ?? getOntologyEnv(),
          ontology_release_id: mcpHealth.releaseId,
          index_generated_at: mcpHealth.indexGeneratedAt,
          company_count: mcpHealth.companyCount,
          document_count: mcpHealth.documentCount,
          object_count: mcpHealth.objectCount,
          ontology_root: mcpHealth.root,
          index_path: mcpHealth.indexPath,
          manifest_path: mcpHealth.manifestPath,
          manifest_valid: mcpHealth.manifestValid,
          agent_index_schema_version: mcpHealth.agentIndexSchemaVersion,
          ontology_manifest: releaseSnapshot(mcpHealth),
        })
        .eq("id", runId);

      try {
        hardTimeout = setTimeout(() => {
          hardTimedOut = true;
          streamAbortController?.abort();
        }, AGENT_RUN_HARD_TIMEOUT_MS);
        (hardTimeout as { unref?: () => void }).unref?.();

        stopLeaseHeartbeat = startLeaseHeartbeat(runId);
        await sendEvent("run_started", {
          run_id: runId,
          message_id: assistantMessageId,
          session_id: session.id,
          request_id: requestId,
          started_at: runStartedAt,
        });
        await sendEvent("activity_update", {
          stage: "preparing",
          label: "분석 준비 중",
        });
        const recordSdkDiagnostics = createDevSdkDiagnosticsRecorder(admin, runId);
        const persistPartialText = createPartialMessagePersister(
          admin,
          assistantMessageId,
        );
        const persistRunEvents = createRunEventPersister(
          admin,
          runId,
          assistantMessageId,
        );
        const result = await runAgent(
          {
            sessionId: session.id,
            userMessage: content,
            scopeType: session.scopeType,
            defaultTickers: session.defaultTickers,
            defaultDocumentTypes: session.defaultDocumentTypes,
            researchMode: params.researchMode,
            history: history.history,
            abortSignal: streamAbortController!.signal,
            onSdkDiagnostics: recordSdkDiagnostics,
            onTextDelta: persistPartialText,
            onToolCallStart: persistRunEvents.persistToolCallStart,
            onToolCallEnd: persistRunEvents.persistToolCallEnd,
            onCitation: persistRunEvents.persistCitation,
          },
          writer
        );

        await persistPartialText.flush();
        await persistRunEvents.backfill(result.acc);
        await persistRunEvents.flush();

        const finishedAt = new Date().toISOString();

        if (result.status === "completed") {
          await handleCompletedRun({
            admin,
            runId,
            assistantMessageId,
            finishedAt,
            runStartedAt,
            result,
            mcpHealth,
            budget,
            requestId,
            researchMode: params.researchMode,
            session,
            userId: session.userId,
            sendEvent,
          });
        } else if (result.status === "cancelled" && hardTimedOut) {
          await handleFailedRun({
            admin,
            runId,
            assistantMessageId,
            finishedAt,
            result: {
              acc: result.acc,
              errorCode: "lease_expired",
              errorMessage: RUN_TIMEOUT_MESSAGE,
            },
            session,
            researchMode: params.researchMode,
            userId: session.userId,
            requestId,
            sendEvent,
          });
        } else if (result.status === "cancelled") {
          await handleCancelledRun({
            admin,
            runId,
            assistantMessageId,
            finishedAt,
            result,
            userId: session.userId,
            requestId,
            sendEvent,
          });
        } else {
          await handleFailedRun({
            admin,
            runId,
            assistantMessageId,
            finishedAt,
            result,
            session,
            researchMode: params.researchMode,
            userId: session.userId,
            requestId,
            sendEvent,
          });
        }
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const rawErrorMessage =
          err instanceof Error ? err.message : "Internal error";
        const publicMessage = publicErrorMessage("internal_error");

        await markAgentRunTerminal(admin, runId, {
          status: "failed",
          finishedAt,
          errorCode: "internal_error",
          errorMessage: rawErrorMessage,
          openToolErrorMessage: `Run failed before tool result was received: ${rawErrorMessage}`,
        });
        await admin
          .from("messages")
          .update({
            status: "failed",
            content: publicMessage,
          })
          .eq("id", assistantMessageId);

        await recordAnalyticsEvent({
          eventName: "answer_failed",
          userId: session.userId,
          sessionId: session.id,
          messageId: assistantMessageId,
          runId,
          properties: {
            scope_type: session.scopeType,
            ticker: session.defaultTickers[0] ?? null,
            tickers: session.defaultTickers,
            error_code: "internal_error",
            research_mode: params.researchMode ?? null,
            tool_call_count: 0,
          },
        });

        await releaseExecutionBudget(
          session.userId,
          requestId,
          runId,
          "internal_error",
        );

        try {
          await sendEvent("error", {
            run_id: runId,
            error_code: "internal_error",
            error_message: publicMessage,
          });
        } catch {
          // Stream may already be closed
        }
      } finally {
        if (hardTimeout) clearTimeout(hardTimeout);
        stopLeaseHeartbeat?.();
        await releaseLease(runId);
        cleanupRun(runId);
        try {
          controller.close();
        } catch {
          // Controller may already be closed on cancel
        }
      }
    },
    cancel() {
      clientConnected = false;
      // The agent keeps running after a transport disconnect so refresh/reconnect
      // can recover from persisted partial content. Explicit cancel uses the
      // cancel route, which aborts the registered run controller.
    },
  });

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
  response.headers.set("X-Chat-Session-Id", session.id);
  return response;
}

type PersistedRun = Pick<
  AgentRunRow,
  | "id"
  | "session_id"
  | "assistant_message_id"
  | "request_id"
  | "status"
  | "lease_expires_at"
  | "started_at"
  | "input_tokens"
  | "output_tokens"
  | "estimated_cost_usd"
  | "latency_ms"
  | "ontology_env"
  | "ontology_release_id"
  | "index_generated_at"
  | "company_count"
  | "document_count"
  | "object_count"
  | "manifest_valid"
  | "agent_index_schema_version"
  | "error_code"
  | "error_message"
>;

type PersistedAssistantMessage = Pick<
  MessageRow,
  "id" | "content" | "status"
>;

export function streamPersistedRunResponse(params: {
  userId: string;
  sessionId: string;
  runId?: string | null;
  requestId?: string;
  initialContentLength?: number;
}): Response {
  const { userId, sessionId, runId, requestId, initialContentLength = 0 } = params;
  const encoder = new TextEncoder();
  const admin = getSupabaseAdmin();
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      const writer: StreamWriter = {
        write: async (chunk: Uint8Array) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(chunk);
          } catch {
            clientConnected = false;
          }
        },
      };

      await streamPersistedRunEvents({
        admin,
        writer,
        encoder,
        runId,
        sessionId,
        userId,
        requestId,
        initialContentLength,
      });

      try {
        controller.close();
      } catch {
        // Client may have disconnected.
      }
    },
    cancel() {
      clientConnected = false;
    },
  });

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
  response.headers.set("X-Chat-Session-Id", sessionId);
  return response;
}

export async function streamPersistedRunEvents(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  writer: StreamWriter;
  encoder: TextEncoder;
  runId?: string | null;
  sessionId: string;
  userId: string;
  requestId?: string;
  initialContentLength?: number;
}) {
  const {
    admin,
    writer,
    encoder,
    runId,
    sessionId,
    userId,
    requestId,
    initialContentLength = 0,
  } = params;
  let currentRunId = runId?.trim() || null;
  let sentLength = initialContentLength;
  let sentRunStarted = false;
  const startedAt = Date.now();

  const sendEvent = async (event: string, data: unknown) => {
    await writer.write(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  };

  while (Date.now() - startedAt < EXISTING_RUN_MAX_POLL_MS) {
    let run = currentRunId
      ? await loadPersistedRun(admin, currentRunId, sessionId)
      : null;

    if (!run) {
      const activeRun = await loadLatestActivePersistedRun(admin, sessionId);
      if (!activeRun) {
        await sendEvent("state_sync", {
          session_id: sessionId,
          run_id: currentRunId,
          status: "idle",
          reason: "stale_run",
        });
        return;
      }

      currentRunId = activeRun.id;
      sentLength = 0;
      sentRunStarted = false;
      run = activeRun;
      await sendEvent("state_sync", {
        session_id: sessionId,
        run_id: run.id,
        status: run.status,
        reason: "session_synced",
      });
    }

    run = await expirePersistedRunIfNeeded(admin, run, userId);

    const message = run.assistant_message_id
      ? await loadPersistedAssistantMessage(admin, run.assistant_message_id)
      : null;

    if (!sentRunStarted) {
      await sendEvent("run_started", {
        run_id: run.id,
        message_id: message?.id ?? run.assistant_message_id ?? "",
        session_id: run.session_id,
        request_id: requestId ?? run.request_id,
        started_at: run.started_at ?? new Date().toISOString(),
      });
      await sendEvent("activity_update", {
        stage: "preparing",
        label: run.status === "running" ? "분석 상태 복원 중" : "결과 불러오는 중",
      });
      sentRunStarted = true;
    }

    if (message && message.content.length > sentLength) {
      await sendEvent("token", {
        text: message.content.slice(sentLength),
      });
      sentLength = message.content.length;
    }

    if (run.status === "completed") {
      await sendPersistedDoneEvent({
        sendEvent,
        userId,
        run,
        message,
      });
      return;
    }

    if (run.status === "failed") {
      const errorCode = toErrorCode(run.error_code ?? "claude_api_error");
      await sendEvent("error", {
        run_id: run.id,
        error_code: errorCode,
        error_message: publicErrorMessage(errorCode),
      });
      return;
    }

    if (run.status === "cancelled") {
      await sendEvent("cancelled", {
        run_id: run.id,
        message_id: run.assistant_message_id,
      });
      return;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, EXISTING_RUN_POLL_INTERVAL_MS),
    );
  }

  await sendEvent("state_sync", {
    session_id: sessionId,
    run_id: currentRunId,
    status: "running",
    reason: "poll_timeout",
  });
}

const PERSISTED_RUN_SELECT =
  "id, session_id, assistant_message_id, request_id, status, lease_expires_at, started_at, input_tokens, output_tokens, estimated_cost_usd, latency_ms, ontology_env, ontology_release_id, index_generated_at, company_count, document_count, object_count, manifest_valid, agent_index_schema_version, error_code, error_message";

async function expirePersistedRunIfNeeded(
  admin: ReturnType<typeof getSupabaseAdmin>,
  run: PersistedRun,
  userId: string,
): Promise<PersistedRun> {
  if (
    run.status !== "pending" &&
    run.status !== "running"
  ) {
    return run;
  }

  const expiresAt = run.lease_expires_at
    ? Date.parse(run.lease_expires_at)
    : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt >= Date.now()) return run;

  const now = new Date().toISOString();
  await markAgentRunTerminal(admin, run.id, {
    status: "failed",
    finishedAt: now,
    errorCode: "lease_expired",
    errorMessage: "Lease expired",
    openToolErrorMessage: "Lease expired before tool result was received",
  });

  if (run.assistant_message_id) {
    await admin
      .from("messages")
      .update({
        status: "failed",
        content: RUN_TIMEOUT_MESSAGE,
      })
      .eq("id", run.assistant_message_id)
      .in("status", ["pending", "streaming"]);
  }

  await closeOpenToolCallsForRun({
    admin,
    runId: run.id,
    finishedAt: now,
    errorMessage: "Lease expired before tool result was received",
  });

  await releaseExecutionBudget(userId, run.request_id, run.id, "lease_expired");

  return {
    ...run,
    status: "failed",
    error_code: "lease_expired",
    error_message: RUN_TIMEOUT_MESSAGE,
  };
}

async function loadPersistedRun(
  admin: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
  sessionId: string,
): Promise<PersistedRun | null> {
  const { data } = await admin
    .from("agent_runs")
    .select(PERSISTED_RUN_SELECT)
    .eq("id", runId)
    .eq("session_id", sessionId)
    .maybeSingle<PersistedRun>();

  return data ?? null;
}

async function loadLatestActivePersistedRun(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
): Promise<PersistedRun | null> {
  const { data } = await admin
    .from("agent_runs")
    .select(PERSISTED_RUN_SELECT)
    .eq("session_id", sessionId)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<PersistedRun>();

  return data ?? null;
}

async function loadPersistedAssistantMessage(
  admin: ReturnType<typeof getSupabaseAdmin>,
  messageId: string,
): Promise<PersistedAssistantMessage | null> {
  const { data } = await admin
    .from("messages")
    .select("id, content, status")
    .eq("id", messageId)
    .maybeSingle<PersistedAssistantMessage>();

  return data ?? null;
}

async function sendPersistedDoneEvent(params: {
  sendEvent: (event: string, data: unknown) => Promise<void>;
  userId: string;
  run: PersistedRun;
  message: PersistedAssistantMessage | null;
}) {
  const { sendEvent, userId, run, message } = params;
  const estimatedCost = Number(run.estimated_cost_usd ?? 0);
  const executionBudget = await getExecutionBudgetStatusForPersistedRun(userId);

  await sendEvent("done", {
    run_id: run.id,
    message_id: message?.id ?? run.assistant_message_id ?? "",
    content: message?.content ?? "",
    rich_answers: [],
    artifacts: [],
    release: publicReleaseMetadata({
      ontology_env: run.ontology_env ?? getOntologyEnv(),
      ontology_release_id: run.ontology_release_id ?? "",
      index_generated_at: run.index_generated_at ?? "",
      company_count: run.company_count ?? 0,
      document_count: run.document_count ?? 0,
      object_count: run.object_count ?? 0,
      manifest_valid: run.manifest_valid ?? false,
      agent_index_schema_version: run.agent_index_schema_version ?? "",
    }),
    usage: {
      input_tokens: run.input_tokens ?? 0,
      output_tokens: run.output_tokens ?? 0,
      estimated_cost_usd: estimatedCost,
      latency_ms: run.latency_ms ?? 0,
    },
    execution_budget: executionBudget,
  });
}

async function getExecutionBudgetStatusForPersistedRun(userId: string) {
  const budget = await checkExecutionBudget(userId);
  return getExecutionBudgetStatus(budget);
}

// --- Helper functions for each terminal state ---

function isDevSdkDiagnosticsEnabled(): boolean {
  return isSdkDiagnosticsEnabled();
}

function createDevSdkDiagnosticsRecorder(
  admin: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
): ((diagnostics: SdkDiagnostics) => Promise<void>) | undefined {
  if (!isDevSdkDiagnosticsEnabled()) return undefined;

  let mergedDiagnostics: Record<string, unknown> = {};

  return async (diagnostics: SdkDiagnostics) => {
    mergedDiagnostics = mergeSdkDiagnosticsForPersistence(
      mergedDiagnostics,
      diagnostics,
    );

    console.info("[claude-sdk-diagnostics]", {
      runId,
      ...mergedDiagnostics,
    });

    const { error } = await admin
      .from("agent_runs")
      .update({ sdk_diagnostics: mergedDiagnostics })
      .eq("id", runId);

    if (error) {
      console.warn("[claude-sdk-diagnostics] failed to persist", {
        runId,
        error: error.message,
      });
    }
  };
}

function createPartialMessagePersister(
  admin: ReturnType<typeof getSupabaseAdmin>,
  messageId: string,
) {
  const MIN_INTERVAL_MS = 750;
  let latestText = "";
  let lastPersistedText = "";
  let lastPersistAt = 0;
  let pending: Promise<void> = Promise.resolve();

  const persist = async (force = false) => {
    if (!force && Date.now() - lastPersistAt < MIN_INTERVAL_MS) return;
    if (latestText === lastPersistedText) return;

    const textToPersist = latestText;
    lastPersistedText = textToPersist;
    lastPersistAt = Date.now();

    pending = pending.then(async () => {
      await admin
        .from("messages")
        .update({
          content: textToPersist,
          status: "streaming",
        })
        .eq("id", messageId);
    });

    await pending;
  };

  const callback = async (_delta: string, fullText: string) => {
    latestText = fullText;
    await persist(false);
  };

  callback.flush = async () => {
    await persist(true);
    await pending;
  };

  return callback;
}

function createRunEventPersister(
  admin: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
  assistantMessageId: string,
) {
  let pending: Promise<void> = Promise.resolve();

  const enqueue = (label: string, task: () => Promise<void>) => {
    pending = pending
      .then(task)
      .catch((error) => {
        console.warn(`[run-event-persister] failed to persist ${label}`, {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return pending;
  };

  const persistToolCall = async (toolCall: AccumulatedToolCall) => {
    const payload = {
      run_id: runId,
      tool_use_id: toolCall.id,
      tool_name: toolCall.toolName,
      arguments_json: parseJsonStringForDb(toolCall.argumentsJson) ?? {},
      result_summary: toolCall.resultSummary,
      result_json: jsonForDb(toolCall.resultJson),
      result_text: toolCall.resultText,
      started_at: toolCall.startedAt,
      finished_at: toolCall.finishedAt,
      error_message: toolCall.errorMessage,
    };

    const { data: existing } = await admin
      .from("tool_calls")
      .select("id")
      .eq("run_id", runId)
      .eq("tool_use_id", toolCall.id)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (existing?.id) {
      await admin.from("tool_calls").update(payload).eq("id", existing.id);
      return;
    }

    await admin.from("tool_calls").insert(payload);
  };

  const persistCitation = async (citation: StreamingCitation) => {
    await admin.from("citations").insert({
      message_id: assistantMessageId,
      run_id: runId,
      object_id: citation.object_id,
      ticker: citation.ticker,
      document_type: citation.document_type,
      period: citation.period,
      section: citation.section,
      quote_text: citation.quote_text,
      claim_text: citation.claim_text,
      evidence_grade: citation.evidence_grade,
      source_quality: citation.source_quality,
      trace_json: jsonForDb(citation.trace_json),
    });
  };

  return {
    persistToolCallStart: (toolCall: AccumulatedToolCall) =>
      enqueue("tool_call_start", () => persistToolCall(toolCall)),
    persistToolCallEnd: (toolCall: AccumulatedToolCall) =>
      enqueue("tool_call_end", () => persistToolCall(toolCall)),
    persistCitation: (citation: StreamingCitation) =>
      enqueue("citation", () => persistCitation(citation)),
    backfill: (acc: AccumulatedRun) =>
      enqueue("snapshot", async () => {
        for (const toolCall of acc.toolCalls) {
          await persistToolCall(toolCall);
        }

        if (acc.citations.length === 0) return;

        const { count, error } = await admin
          .from("citations")
          .select("id", { count: "exact", head: true })
          .eq("run_id", runId);

        if (error || (count ?? 0) > 0) return;

        for (const citation of acc.citations) {
          await persistCitation(citation);
        }
      }),
    flush: async () => {
      await pending;
    },
  };
}

interface CompletedRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  assistantMessageId: string;
  finishedAt: string;
  runStartedAt: string;
  result: { acc: AccumulatedRun };
  mcpHealth: McpHealthResult;
  budget: ExecutionBudgetCheckResult;
  requestId: string;
  researchMode?: ResearchMode;
  session: ResolvedSession;
  userId: string;
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleCompletedRun(params: CompletedRunParams) {
  const { admin, runId, assistantMessageId, finishedAt, runStartedAt, result, mcpHealth, budget, requestId, researchMode, session, userId, sendEvent } = params;
  const { acc } = result;
  const visibleAnswer = acc.fullText.trim();

  await admin
    .from("messages")
    .update({
      content: visibleAnswer,
      status: "completed",
    })
    .eq("id", assistantMessageId);

  // Update agent_run
  const estimatedCost = estimateCost(acc.inputTokens, acc.outputTokens);
  const latencyMs = Date.now() - new Date(runStartedAt).getTime();

  await markAgentRunTerminal(admin, runId, {
    status: "completed",
    assistantMessageId,
    finishedAt,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    estimatedCostUsd: estimatedCost,
    latencyMs,
    openToolErrorMessage: "Run completed before tool result was received",
  });

  await closeOpenToolCallsForRun({
    admin,
    runId,
    finishedAt,
    errorMessage: "Run completed before tool result was received",
  });

  await settleExecutionBudget(userId, requestId, runId, estimatedCost, "completed", {
    input_tokens: acc.inputTokens,
    output_tokens: acc.outputTokens,
    tool_call_count: acc.toolCalls.length,
  });

  await recordAnalyticsEvent({
    eventName: "answer_completed",
    userId,
    sessionId: session.id,
    messageId: assistantMessageId,
    runId,
    properties: {
      scope_type: session.scopeType,
      ticker: session.defaultTickers[0] ?? null,
      tickers: session.defaultTickers,
      duration_ms: latencyMs,
      citation_count: acc.citations.length,
      artifact_count: 0,
      artifact_created: false,
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      tool_call_count: acc.toolCalls.length,
      estimated_cost_usd: estimatedCost,
      research_mode: researchMode ?? null,
    },
  });

  // Send done event
  await sendEvent("done", {
    run_id: runId,
    message_id: assistantMessageId,
    content: visibleAnswer,
    rich_answers: [],
    artifacts: [],
    release: publicReleaseMetadata({
      ontology_env: mcpHealth.env ?? getOntologyEnv(),
      ontology_release_id: mcpHealth.releaseId ?? "",
      index_generated_at: mcpHealth.indexGeneratedAt ?? "",
      company_count: mcpHealth.companyCount ?? 0,
      document_count: mcpHealth.documentCount ?? 0,
      object_count: mcpHealth.objectCount ?? 0,
      manifest_valid: mcpHealth.manifestValid,
      agent_index_schema_version: mcpHealth.agentIndexSchemaVersion ?? "",
    }),
    usage: {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      estimated_cost_usd: estimatedCost,
      latency_ms: latencyMs,
    },
    execution_budget: getExecutionBudgetStatus(budget, estimatedCost),
  });
}

function releaseSnapshot(mcpHealth: McpHealthResult): Json {
  return (
    mcpHealth.releaseMetadata ?? {
      env: mcpHealth.env,
      release_id: mcpHealth.releaseId,
      manifest_path: mcpHealth.manifestPath,
      manifest_valid: mcpHealth.manifestValid,
      agent_index_schema_version: mcpHealth.agentIndexSchemaVersion,
      index_generated_at: mcpHealth.indexGeneratedAt,
      root: mcpHealth.root,
      index_path: mcpHealth.indexPath,
      company_count: mcpHealth.companyCount,
      document_count: mcpHealth.documentCount,
      object_count: mcpHealth.objectCount,
    }
  );
}

function jsonForDb(value: unknown): Json | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseJsonStringForDb(value: string): Json {
  try {
    return jsonForDb(JSON.parse(value)) ?? {};
  } catch {
    return value;
  }
}

interface CancelledRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  assistantMessageId: string;
  finishedAt: string;
  result: { acc: AccumulatedRun };
  userId: string;
  requestId: string;
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleCancelledRun(params: CancelledRunParams) {
  const { admin, runId, assistantMessageId, finishedAt, result, userId, requestId, sendEvent } = params;

  await admin
    .from("messages")
    .update({
      content: cancelledAssistantContent(result.acc.fullText),
      status: "cancelled",
    })
    .eq("id", assistantMessageId);

  await markAgentRunTerminal(admin, runId, {
    status: "cancelled",
    assistantMessageId,
    finishedAt,
    errorCode: "cancelled",
    openToolErrorMessage: "Run was cancelled before tool result was received",
  });

  await closeOpenToolCallsForRun({
    admin,
    runId,
    finishedAt,
    errorMessage: "Run was cancelled before tool result was received",
  });

  const estimatedCost = estimateCost(result.acc.inputTokens, result.acc.outputTokens);
  await settleExecutionBudget(userId, requestId, runId, estimatedCost, "cancelled", {
    input_tokens: result.acc.inputTokens,
    output_tokens: result.acc.outputTokens,
    tool_call_count: result.acc.toolCalls.length,
  });

  await sendEvent("cancelled", {
    run_id: runId,
    message_id: assistantMessageId,
  });
}

interface FailedRunParams {
  admin: ReturnType<typeof getSupabaseAdmin>;
  runId: string;
  assistantMessageId: string;
  finishedAt: string;
  result: { acc: AccumulatedRun; errorCode?: string; errorMessage?: string };
  session: ResolvedSession;
  researchMode?: ResearchMode;
  userId: string;
  requestId: string;
  sendEvent: (event: string, data: unknown) => Promise<void>;
}

async function handleFailedRun(params: FailedRunParams) {
  const { admin, runId, assistantMessageId, finishedAt, result, session, researchMode, userId, requestId, sendEvent } = params;
  const errorCode = toErrorCode(result.errorCode || "claude_api_error");
  const rawErrorMessage = result.errorMessage || publicErrorMessage(errorCode);
  const publicMessage = publicAgentErrorMessage({ code: errorCode });

  await markAgentRunTerminal(admin, runId, {
    status: "failed",
    finishedAt,
    errorCode,
    errorMessage: rawErrorMessage,
    openToolErrorMessage:
      errorCode === "lease_expired"
        ? "Agent hard timeout or lease expired before tool result was received"
        : `Run failed before tool result was received: ${rawErrorMessage}`,
  });

  await admin
    .from("messages")
    .update({
      content: publicMessage,
      status: "failed",
    })
    .eq("id", assistantMessageId);

  await closeOpenToolCallsForRun({
    admin,
    runId,
    finishedAt,
    errorMessage:
      errorCode === "lease_expired"
        ? "Agent hard timeout or lease expired before tool result was received"
        : `Run failed before tool result was received: ${rawErrorMessage}`,
  });

  await recordAnalyticsEvent({
    eventName: "answer_failed",
    userId,
    sessionId: session.id,
    messageId: assistantMessageId,
    runId,
    properties: {
      scope_type: session.scopeType,
      ticker: session.defaultTickers[0] ?? null,
      tickers: session.defaultTickers,
      error_code: errorCode,
      output_length: result.acc.fullText.length,
      tool_call_count: result.acc.toolCalls.length,
      research_mode: researchMode ?? null,
    },
  });

  const estimatedCost = estimateCost(result.acc.inputTokens, result.acc.outputTokens);
  await settleExecutionBudget(userId, requestId, runId, estimatedCost, errorCode, {
    input_tokens: result.acc.inputTokens,
    output_tokens: result.acc.outputTokens,
    tool_call_count: result.acc.toolCalls.length,
    output_length: result.acc.fullText.length,
  });

  await sendEvent("error", {
    run_id: runId,
    error_code: errorCode,
    error_message: publicMessage,
  });
}
