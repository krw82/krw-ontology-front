import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkMcpHealth, type McpHealthResult } from "@/lib/agent/mcp-client";
import { runAgent, type SdkDiagnostics } from "@/lib/agent/runner";
import type {
  AccumulatedRun,
  AccumulatedToolCall,
  StreamWriter,
} from "@/lib/agent/stream-handler";
import {
  appendAgentRunEvent,
  createAgentRunEventWriter,
} from "@/lib/agent/run-events";
import { getAgentRunCancelWaiter } from "@/lib/agent/run-cancel-listener";
import {
  budgetUsdToAnalysisCredits,
  getEffectiveDailyBudgetUsd,
  resolvePlanKey,
} from "@/lib/billing/plans";
import { getBillingPlanFromStore } from "@/lib/billing/plan-store";
import { heartbeatAgentRun } from "@/lib/agent/job-queue";
import { closeOpenToolCallsForRun } from "@/lib/agent/tool-call-cleanup";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import {
  getCurrentDailyBillingPeriod,
  getCurrentMonthlyBillingPeriod,
} from "@/lib/billing/period";
import { getOntologyEnv, readIntEnv } from "@/lib/env";
import { isAdminEntitlementEmail } from "@/lib/billing/admin-emails";
import {
  publicAgentErrorMessage,
  publicErrorMessage,
} from "@/lib/api/chat/error-messages";
import { cancelledAssistantContent } from "@/lib/chat/message-status";
import {
  isSdkDiagnosticsEnabled,
  mergeSdkDiagnosticsForPersistence,
} from "@/lib/agent/sdk-diagnostics";
import { MAX_PROMPT_HISTORY_MESSAGES } from "@/lib/agent/system-prompt";
import type {
  AgentRunRow,
  ChatMessageArtifactRow,
  ChatSessionRow,
  Json,
  MessageRow,
  UsageBudgetBalanceRow,
  UserEntitlementRow,
} from "@/types/database";
import type {
  AgentRunExecutorType,
  AtomicNewsEventCard,
  ChatArtifact,
  DocumentType,
  ReleaseMetadata,
  StreamingCitation,
} from "@/types/api-contracts";
import { toErrorCode } from "@/types/api-contracts";
import {
  normalizeResearchMode,
  type ResearchMode,
} from "@/lib/research-mode";
import {
  normalizeAnalysisMode,
  type AnalysisMode,
} from "@/lib/analysis-mode";
import {
  defaultRunKindForAnalysisMode,
  normalizeRunKind,
  type RunKind,
} from "@/lib/run-kind";
import {
  buildNewsEventSelectionArtifact,
  buildNewsEventSelectionArtifactFromDiscoveryResult,
  toPublicChatArtifact,
} from "@/lib/chat-artifacts/news-event-selection";
import { discoverNewsCards } from "@/lib/news-discovery/discovery";
import { buildSelectedNewsSourcePack } from "@/lib/news-discovery/source-pack";
import { appendDocumentContextToUserMessage } from "@/lib/document-ingestion/prompt-context";
import type { ResolvedSession } from "@/lib/api/chat/resolve-session";

const HEARTBEAT_INTERVAL_MS = readIntEnv("LEASE_HEARTBEAT_INTERVAL_MS", 60_000, {
  min: 1_000,
});
const CANCEL_RECONCILE_INTERVAL_MS = readIntEnv(
  "AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS",
  10_000,
  { min: 1_000 },
);
const AGENT_RUN_HARD_TIMEOUT_MS =
  readIntEnv("AGENT_RUN_HARD_TIMEOUT_MINUTES", 6, { min: 1 }) * 60_000;
const RUN_TIMEOUT_MESSAGE =
  "분석 시간이 초과되었습니다. 다시 시도해주세요.";
const INPUT_COST_PER_1M = Number.parseFloat(
  process.env.INPUT_COST_PER_MILLION ?? "3.0",
);
const OUTPUT_COST_PER_1M = Number.parseFloat(
  process.env.OUTPUT_COST_PER_MILLION ?? "15.0",
);

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
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

class AgentRunHardTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent run exceeded hard timeout (${timeoutMs}ms)`);
    this.name = "AgentRunHardTimeoutError";
  }
}

function isHardTimeoutAbort(signal: AbortSignal) {
  return signal.reason instanceof AgentRunHardTimeoutError;
}

class AgentJobLoadError extends Error {
  readonly runId?: string;
  readonly assistantMessageId?: string;

  constructor(
    message: string,
    context: { runId?: string; assistantMessageId?: string } = {},
  ) {
    super(message);
    this.name = "AgentJobLoadError";
    this.runId = context.runId;
    this.assistantMessageId = context.assistantMessageId;
  }
}

interface AgentJob {
  run: Pick<
    AgentRunRow,
    | "id"
    | "session_id"
    | "user_message_id"
    | "assistant_message_id"
    | "request_id"
    | "started_at"
  >;
  session: Pick<
    ChatSessionRow,
    "id" | "user_id" | "scope_type" | "default_tickers" | "default_document_types"
  >;
  userMessage: Pick<MessageRow, "id" | "content">;
  assistantMessageId: string;
  history: Array<{ role: string; content: string }>;
  researchMode: ResearchMode;
  analysisMode: AnalysisMode;
  runKind: RunKind;
  responseLocale: Locale;
  executorType: AgentRunExecutorType;
  selectedNewsEventContext: Record<string, unknown> | null;
}

export async function runAgentJob(runId: string, workerId: string) {
  const admin = getSupabaseAdmin();
  let job: AgentJob | null;

  try {
    job = await loadAgentJob(admin, runId);
  } catch (err) {
    const loadError =
      err instanceof AgentJobLoadError
        ? err
        : new AgentJobLoadError(
            err instanceof Error ? err.message : "Agent job load failed",
            { runId },
          );
    console.warn("[agent-worker] job load failed", {
      runId,
      error: loadError.message,
    });
    await failUnloadedAgentJob(admin, runId, loadError);
    return;
  }

  if (!job) {
    console.warn("[agent-worker] job not found", { runId });
    return;
  }

  const runStartedAt = job.run.started_at ?? new Date().toISOString();
  const abortController = new AbortController();
  let acceptingRunOutput = true;
  const eventWriter = createAgentRunEventWriter(admin, runId);
  const guardedEventWriter: StreamWriter = {
    write: async (event) => {
      if (!acceptingRunOutput) return;
      await eventWriter.write(event);
    },
  };
  const sendEvent = async (
    event: Parameters<typeof appendAgentRunEvent>[2],
    payload: unknown,
  ) => {
    await appendAgentRunEvent(admin, runId, event, payload);
  };

  const stopHeartbeat = startHeartbeat(runId, workerId, abortController);
  const stopCancelWatcher = startCancelWatcher(
    admin,
    runId,
    abortController,
  );

  try {
    await admin
      .from("messages")
      .update({ status: "streaming" })
      .eq("id", job.assistantMessageId);

    await sendEvent("run_started", {
      run_id: runId,
      message_id: job.assistantMessageId,
      session_id: job.session.id,
      request_id: job.run.request_id,
      started_at: runStartedAt,
    });
    await sendEvent("activity_update", {
      stage: "preparing",
      label: "분석 준비 중",
    });

    const mcpHealth = await checkMcpHealth();
    const mcpReadinessError = mcpHealthReadinessError(mcpHealth);
    if (mcpReadinessError) {
      await handleFailedJob({
        admin,
        job,
        runStartedAt,
        result: {
          acc: emptyAccumulatedRun(),
          errorCode: "mcp_unavailable",
          errorMessage: mcpReadinessError,
        },
        sendEvent,
      });
      return;
    }

    await admin
      .from("agent_runs")
      .update({
        ontology_release_id: mcpHealth.releaseId,
        ontology_env: mcpHealth.env ?? getOntologyEnv(),
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

    if (job.executorType === "server_pipeline") {
      if (job.runKind === "news_discovery") {
        await runWithHardTimeout(
          handleServerPipelineNewsDiscoveryJob({
            admin,
            job,
            runStartedAt,
            mcpHealth,
            abortSignal: abortController.signal,
            sendEvent,
          }),
          abortController,
          AGENT_RUN_HARD_TIMEOUT_MS,
        );
        return;
      }

      await handleFailedJob({
        admin,
        job,
        runStartedAt,
        result: {
          acc: emptyAccumulatedRun(),
          errorCode: "internal_error",
          errorMessage: `Unsupported server pipeline run kind: ${job.runKind}`,
        },
        sendEvent,
      });
      return;
    }

    const selectedNewsEventContext = await prepareSelectedNewsEventContext({
      admin,
      job,
      sendEvent,
    });
    const userMessageWithDocumentContext =
      await appendDocumentContextToUserMessage(admin, {
        messageId: job.userMessage.id,
        userMessage: job.userMessage.content,
      });

    const persistRunRecords = createRunRecordPersister(
      admin,
      runId,
      job.assistantMessageId,
    );
    const recordSdkDiagnostics = createSdkDiagnosticsRecorder(admin, runId);

    const result = await runWithHardTimeout(
      runAgent(
        {
          sessionId: job.session.id,
          userMessage: userMessageWithDocumentContext,
          scopeType: job.session.scope_type,
          defaultTickers: job.session.default_tickers ?? [],
          defaultDocumentTypes:
            (job.session.default_document_types ?? []) as DocumentType[],
          history: job.history,
          researchMode: job.researchMode,
          analysisMode: job.analysisMode,
          runKind: job.runKind,
          responseLocale: job.responseLocale,
          selectedNewsEventContext,
          abortSignal: abortController.signal,
          onSdkDiagnostics: recordSdkDiagnostics,
          onToolCallStart: async (toolCall) => {
            if (!acceptingRunOutput) return;
            await persistRunRecords.persistToolCallStart(toolCall);
          },
          onToolCallEnd: async (toolCall) => {
            if (!acceptingRunOutput) return;
            await persistRunRecords.persistToolCallEnd(toolCall);
          },
          onCitation: async (citation) => {
            if (!acceptingRunOutput) return;
            await persistRunRecords.persistCitation(citation);
          },
        },
        guardedEventWriter,
      ),
      abortController,
      AGENT_RUN_HARD_TIMEOUT_MS,
    );

    await eventWriter.flush();
    await persistRunRecords.backfill(result.acc);
    await persistRunRecords.flush();

    if (result.status === "completed") {
      await handleCompletedJob({
        admin,
        job,
        runStartedAt,
        result,
        release: {
          ontology_release_id: mcpHealth.releaseId ?? "",
          ontology_env: mcpHealth.env ?? getOntologyEnv(),
          index_generated_at: mcpHealth.indexGeneratedAt ?? "",
          company_count: mcpHealth.companyCount ?? 0,
          document_count: mcpHealth.documentCount ?? 0,
          object_count: mcpHealth.objectCount ?? 0,
          manifest_valid: mcpHealth.manifestValid,
          agent_index_schema_version: mcpHealth.agentIndexSchemaVersion ?? "",
        },
        sendEvent,
      });
      return;
    }

    if (result.status === "cancelled") {
      await handleCancelledJob({
        admin,
        job,
        result,
        sendEvent,
      });
      return;
    }

    await handleFailedJob({
      admin,
      job,
      runStartedAt,
      result,
      sendEvent,
    });
  } catch (err) {
    acceptingRunOutput = false;
    if (err instanceof AgentRunHardTimeoutError) {
      abortController.abort();
      await eventWriter.flush();
      await handleFailedJob({
        admin,
        job,
        runStartedAt,
        result: {
          acc: emptyAccumulatedRun(),
          errorCode: "lease_expired",
          errorMessage: RUN_TIMEOUT_MESSAGE,
        },
        sendEvent,
      });
      return;
    }

    const rawErrorMessage =
      err instanceof Error ? err.message : "Internal worker error";
    await handleFailedJob({
      admin,
      job,
      runStartedAt,
      result: {
        acc: emptyAccumulatedRun(),
        errorCode: "internal_error",
        errorMessage: rawErrorMessage,
      },
      sendEvent,
    });
  } finally {
    stopHeartbeat();
    stopCancelWatcher();
  }
}

function runWithHardTimeout<T>(
  promise: Promise<T>,
  abortController: AbortController,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const timeoutError = new AgentRunHardTimeoutError(timeoutMs);
      reject(timeoutError);
      abortController.abort(timeoutError);
    }, timeoutMs);
    (timeout as { unref?: () => void }).unref?.();
  });

  promise.catch(() => undefined);

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function loadAgentJob(
  admin: SupabaseAdmin,
  runId: string,
): Promise<AgentJob | null> {
  const { data: run, error: runError } = await admin
    .from("agent_runs")
    .select("id, session_id, user_message_id, assistant_message_id, request_id, started_at, run_kind, executor_type, selected_news_event_context")
    .eq("id", runId)
    .maybeSingle<
      AgentJob["run"] &
        Pick<
          AgentRunRow,
          "run_kind" | "executor_type" | "selected_news_event_context"
        >
    >();

  if (runError) {
    throw new AgentJobLoadError(
      `Agent run load failed: ${formatSupabaseError(runError)}`,
      { runId },
    );
  }

  if (!run?.assistant_message_id) return null;

  const [
    sessionResult,
    userMessageResult,
    previousMessagesResult,
    runQueuedEventResult,
  ] =
    await Promise.all([
      admin
        .from("chat_sessions")
        .select("id, user_id, scope_type, default_tickers, default_document_types")
        .eq("id", run.session_id)
        .is("deleted_at", null)
        .maybeSingle<AgentJob["session"]>(),
      admin
        .from("messages")
        .select("id, content")
        .eq("id", run.user_message_id)
        .maybeSingle<AgentJob["userMessage"]>(),
      admin
        .from("messages")
        .select("role, content")
        .eq("session_id", run.session_id)
        .eq("status", "completed")
        .neq("id", run.user_message_id)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: false })
        .limit(MAX_PROMPT_HISTORY_MESSAGES)
        .returns<Array<{ role: string; content: string }>>(),
      admin
        .from("agent_run_events")
        .select("payload")
        .eq("run_id", runId)
        .eq("event_type", "run_queued")
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle<{ payload: Json }>(),
    ]);

  const loadContext = {
    runId: run.id,
    assistantMessageId: run.assistant_message_id,
  };

  if (sessionResult.error) {
    throw new AgentJobLoadError(
      `Agent session load failed: ${formatSupabaseError(sessionResult.error)}`,
      loadContext,
    );
  }

  if (userMessageResult.error) {
    throw new AgentJobLoadError(
      `Agent user message load failed: ${formatSupabaseError(
        userMessageResult.error,
      )}`,
      loadContext,
    );
  }

  if (previousMessagesResult.error) {
    throw new AgentJobLoadError(
      `Agent history load failed: ${formatSupabaseError(
        previousMessagesResult.error,
      )}`,
      loadContext,
    );
  }

  if (runQueuedEventResult.error) {
    throw new AgentJobLoadError(
      `Agent run queued event load failed: ${formatSupabaseError(
        runQueuedEventResult.error,
      )}`,
      loadContext,
    );
  }

  const session = sessionResult.data;
  const userMessage = userMessageResult.data;
  const previousMessages = previousMessagesResult.data;
  const runQueuedEvent = runQueuedEventResult.data;

  if (!session || !userMessage) return null;
  const queuedPayload = isRecord(runQueuedEvent?.payload)
    ? runQueuedEvent.payload
    : {};

  return {
    run,
    session,
    userMessage,
    assistantMessageId: run.assistant_message_id,
    history: [...(previousMessages ?? [])].reverse(),
    researchMode: normalizeResearchMode(queuedPayload.research_mode),
    analysisMode: normalizeAnalysisMode(queuedPayload.analysis_mode),
    runKind: normalizeRunKind(
      queuedPayload.run_kind ??
        run.run_kind ??
        defaultRunKindForAnalysisMode(
          normalizeAnalysisMode(queuedPayload.analysis_mode),
        ),
    ),
    responseLocale: normalizeResponseLocale(queuedPayload.response_locale),
    executorType: normalizeExecutorType(
      queuedPayload.executor_type ?? run.executor_type,
    ),
    selectedNewsEventContext: isRecord(run.selected_news_event_context)
      ? run.selected_news_event_context
      : null,
  };
}

function normalizeExecutorType(value: unknown): AgentRunExecutorType {
  return value === "server_pipeline" ? "server_pipeline" : "claude_agent";
}

function normalizeResponseLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

function formatSupabaseError(error: { code?: string; message?: string }) {
  const message = error.message ?? "Unknown database error";
  return error.code ? `${error.code}: ${message}` : message;
}

async function failUnloadedAgentJob(
  admin: SupabaseAdmin,
  requestedRunId: string,
  error: AgentJobLoadError,
) {
  const failedRunId = error.runId ?? requestedRunId;
  const finishedAt = new Date().toISOString();
  const publicMessage = publicErrorMessage("internal_error");

  if (error.assistantMessageId) {
    await admin
      .from("messages")
      .update({
        content: "",
        status: "failed",
      })
      .eq("id", error.assistantMessageId);
  }

  await markAgentRunTerminal(admin, failedRunId, {
    status: "failed",
    finishedAt,
    errorCode: "internal_error",
    errorMessage: error.message,
    openToolErrorMessage: error.message,
  });

  await closeOpenToolCallsForRun({
    admin,
    runId: failedRunId,
    finishedAt,
    errorMessage: error.message,
  });

  await appendAgentRunEvent(admin, failedRunId, "error", {
    run_id: failedRunId,
    error_code: "internal_error",
    error_message: publicMessage,
  });
}

function startHeartbeat(
  runId: string,
  workerId: string,
  abortController: AbortController,
) {
  const interval = setInterval(async () => {
    const ok = await heartbeatAgentRun(runId, workerId);
    if (!ok) abortController.abort();
  }, HEARTBEAT_INTERVAL_MS);
  (interval as { unref?: () => void }).unref?.();

  return () => clearInterval(interval);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function startCancelWatcher(
  admin: SupabaseAdmin,
  runId: string,
  abortController: AbortController,
) {
  const stopController = new AbortController();
  const cancelWaiter = getAgentRunCancelWaiter();
  const stop = () => stopController.abort();
  abortController.signal.addEventListener("abort", stop, { once: true });

  void (async () => {
    while (!stopController.signal.aborted && !abortController.signal.aborted) {
      if (await isRunCancelRequested(admin, runId)) {
        abortController.abort();
        break;
      }

      await cancelWaiter.waitForRunCancel(
        runId,
        CANCEL_RECONCILE_INTERVAL_MS,
        stopController.signal,
      );
    }
  })().catch((error) => {
    if (!stopController.signal.aborted) {
      console.warn("[agent-worker] cancel watcher failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return () => {
    abortController.signal.removeEventListener("abort", stop);
    stopController.abort();
  };
}

async function isRunCancelRequested(
  admin: SupabaseAdmin,
  runId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("agent_runs")
    .select("cancel_requested_at, status")
    .eq("id", runId)
    .maybeSingle<{ cancel_requested_at: string | null; status: string }>();

  return Boolean(data?.cancel_requested_at || data?.status === "cancelled");
}

function createSdkDiagnosticsRecorder(
  admin: SupabaseAdmin,
  runId: string,
): ((diagnostics: SdkDiagnostics) => Promise<void>) | undefined {
  if (!isSdkDiagnosticsEnabled()) return undefined;

  let mergedDiagnostics: Record<string, unknown> = {};

  return async (diagnostics: SdkDiagnostics) => {
    mergedDiagnostics = mergeSdkDiagnosticsForPersistence(
      mergedDiagnostics,
      diagnostics,
    );

    await admin
      .from("agent_runs")
      .update({ sdk_diagnostics: mergedDiagnostics })
      .eq("id", runId);
  };
}

function createRunRecordPersister(
  admin: SupabaseAdmin,
  runId: string,
  assistantMessageId: string,
) {
  let pending: Promise<void> = Promise.resolve();

  const enqueue = (label: string, task: () => Promise<void>) => {
    pending = pending
      .then(task)
      .catch((error) => {
        console.warn(`[agent-worker] failed to persist ${label}`, {
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

async function handleServerPipelineNewsDiscoveryJob(params: {
  admin: SupabaseAdmin;
  job: AgentJob;
  runStartedAt: string;
  mcpHealth: McpHealthResult;
  abortSignal: AbortSignal;
  sendEvent: (event: Parameters<typeof appendAgentRunEvent>[2], payload: unknown) => Promise<void>;
}) {
  const { admin, job, runStartedAt, mcpHealth, abortSignal, sendEvent } = params;
  let terminalHandled = false;
  let inputTokens = 0;
  let outputTokens = 0;
  const cancelIfRequested = async () => {
    if (!abortSignal.aborted) return false;
    if (isHardTimeoutAbort(abortSignal)) return true;
    terminalHandled = true;
    await handleServerPipelineCancelledJob({
      admin,
      job,
      inputTokens,
      outputTokens,
      sendEvent,
    });
    return true;
  };

  try {
    await sendEvent("activity_update", {
      stage: "researching",
      label: "시장 뉴스 후보를 찾는 중",
    });
    if (await cancelIfRequested()) return;

    const { discovery, composition } = await discoverNewsCards({
      question: job.userMessage.content,
      session: toResolvedSession(job.session),
    });
    inputTokens = composition.usage?.input_tokens ?? 0;
    outputTokens = composition.usage?.output_tokens ?? 0;
    if (await cancelIfRequested()) return;
    const artifact = buildNewsEventSelectionArtifactFromDiscoveryResult({
      result: {
        cards: composition.cards,
        events: composition.cards,
        resolved_entities: discovery.intent.resolvedEntities,
        lookback: {
          hours: discovery.intent.lookbackHours,
        },
        discovery_policy: {
          market_news_only: true,
          english_question: discovery.intent.englishQuestion,
          price_move_direction: discovery.intent.direction,
          allowed_domains: discovery.selectedSourcePolicy.allowed_domains,
          excluded_domains: discovery.selectedSourcePolicy.excluded_domains,
        },
        empty_state:
          composition.cards.length === 0
            ? composition.empty_state ?? {
                reason: "no_preferred_market_news_found",
                english_question: discovery.intent.englishQuestion,
              }
            : undefined,
        raw_search_result: discovery.rawSearchResult,
        raw_model_output: composition.raw_model_output,
      },
      originalQuestion: job.userMessage.content,
    });
    if (await cancelIfRequested()) return;
    const chatArtifacts = artifact
      ? await persistBuiltNewsDiscoveryArtifact({
          admin,
          artifact,
          sessionId: job.session.id,
          messageId: job.assistantMessageId,
          runId: job.run.id,
        })
      : [];
    if (await cancelIfRequested()) return;
    const estimatedCost =
      composition.usage?.estimated_cost_usd ??
      estimateCost(inputTokens, outputTokens);
    const finishedAt = new Date().toISOString();
    const latencyMs = Date.now() - new Date(runStartedAt).getTime();
    const content = buildDiscoveryAssistantContent({
      cardCount: composition.cards.length,
      englishQuestion: discovery.intent.englishQuestion,
    });

    await admin
      .from("messages")
      .update({
        content,
        status: "completed",
      })
      .eq("id", job.assistantMessageId);

    await markAgentRunTerminal(admin, job.run.id, {
      status: "completed",
      finishedAt,
      assistantMessageId: job.assistantMessageId,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimatedCost,
      latencyMs,
    });

    await settleExecutionBudgetForWorker(
      job.session.user_id,
      job.run.request_id,
      job.run.id,
      estimatedCost,
      "completed",
      {
        executor_type: "server_pipeline",
        run_kind: "news_discovery",
        card_count: composition.cards.length,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    );

    for (const chatArtifact of chatArtifacts) {
      await sendEvent("artifact", chatArtifact);
    }

    await sendEvent("done", {
      run_id: job.run.id,
      message_id: job.assistantMessageId,
      content,
      rich_answers: [],
      artifacts: [],
      chat_artifacts: chatArtifacts,
      release: publicReleaseMetadata(publicReleaseInputFromMcpHealth(mcpHealth)),
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimatedCost,
        latency_ms: latencyMs,
      },
      execution_budget: await loadExecutionBudgetStatus(job.session.user_id),
    });
  } catch (error) {
    if (abortSignal.aborted) {
      if (!isHardTimeoutAbort(abortSignal) && !terminalHandled) {
        await handleServerPipelineCancelledJob({
          admin,
          job,
          inputTokens,
          outputTokens,
          sendEvent,
        });
      }
      return;
    }
    const rawErrorMessage =
      error instanceof Error ? error.message : "News discovery pipeline failed";
    const publicMessage = "뉴스 후보를 찾는 중 오류가 발생했습니다.";
    const finishedAt = new Date().toISOString();

    await markAgentRunTerminal(admin, job.run.id, {
      status: "failed",
      finishedAt,
      assistantMessageId: job.assistantMessageId,
      errorCode: "internal_error",
      errorMessage: rawErrorMessage,
    });
    await admin
      .from("messages")
      .update({
        content: publicMessage,
        status: "failed",
      })
      .eq("id", job.assistantMessageId);
    await releaseExecutionBudgetForWorker(
      job.session.user_id,
      job.run.request_id,
      job.run.id,
      "news_discovery_failed",
    );
    await sendEvent("error", {
      run_id: job.run.id,
      error_code: "internal_error",
      error_message: publicMessage,
    });
  }
}

async function handleServerPipelineCancelledJob(params: {
  admin: SupabaseAdmin;
  job: AgentJob;
  inputTokens: number;
  outputTokens: number;
  sendEvent: (event: Parameters<typeof appendAgentRunEvent>[2], payload: unknown) => Promise<void>;
}) {
  const { admin, job, inputTokens, outputTokens, sendEvent } = params;

  await handleCancelledJob({
    admin,
    job,
    result: {
      acc: {
        ...emptyAccumulatedRun(),
        inputTokens,
        outputTokens,
      },
    },
    sendEvent,
  });
}

async function prepareSelectedNewsEventContext(params: {
  admin: SupabaseAdmin;
  job: AgentJob;
  sendEvent: (event: Parameters<typeof appendAgentRunEvent>[2], payload: unknown) => Promise<void>;
}): Promise<Record<string, unknown> | null> {
  const { admin, job, sendEvent } = params;
  const context = job.selectedNewsEventContext;
  if (job.runKind !== "news_research" || !context) return context;
  if (isRecord(context.source_pack)) return context;

  await sendEvent("activity_update", {
    stage: "researching",
    label: "뉴스 원문을 읽는 중",
  });

  const enriched = {
    ...context,
    source_pack: await buildSelectedNewsSourcePack(
      context as AtomicNewsEventCard,
    ),
  };
  const payload = jsonForDb(enriched) ?? {};

  await admin
    .from("agent_runs")
    .update({
      selected_news_event_context: payload,
    })
    .eq("id", job.run.id);
  await admin
    .from("chat_message_artifact_selections")
    .update({
      selected_payload_json: payload,
      updated_at: new Date().toISOString(),
    })
    .eq("research_run_id", job.run.id);

  return enriched;
}

async function persistBuiltNewsDiscoveryArtifact(params: {
  admin: SupabaseAdmin;
  artifact: {
    type: "news_event_selection";
    payload: unknown;
  };
  sessionId: string;
  messageId: string;
  runId: string;
}): Promise<ChatArtifact[]> {
  const { data, error } = await params.admin
    .from("chat_message_artifacts")
    .insert({
      session_id: params.sessionId,
      message_id: params.messageId,
      run_id: params.runId,
      type: params.artifact.type,
      payload_json: jsonForDb(params.artifact.payload) ?? {},
    })
    .select("id, session_id, message_id, run_id, type, payload_json, created_at")
    .single<ChatMessageArtifactRow>();

  if (error || !data) {
    console.warn("[agent-worker] failed to persist server pipeline artifact", {
      runId: params.runId,
      error: error?.message,
    });
    return [];
  }

  return [toPublicChatArtifact(data)];
}

function buildDiscoveryAssistantContent(params: {
  cardCount: number;
  englishQuestion: string;
}): string {
  if (params.cardCount > 0) {
    return "분석할 시장 뉴스 후보를 찾았습니다. 아래 카드 중 하나를 선택하면 해당 뉴스 원문과 공시 데이터를 연결해 분석합니다.";
  }

  return [
    "우선 소스에서 선택할 만한 시장 뉴스 후보를 찾지 못했습니다.",
    "",
    `검색 기준: ${params.englishQuestion}`,
  ].join("\n");
}

function toResolvedSession(session: AgentJob["session"]): ResolvedSession {
  return {
    id: session.id,
    userId: session.user_id,
    scopeType: session.scope_type,
    defaultTickers: session.default_tickers ?? [],
    defaultDocumentTypes: session.default_document_types ?? [],
  };
}

function publicReleaseInputFromMcpHealth(
  mcpHealth: McpHealthResult,
): PublicReleaseInput {
  return {
    ontology_release_id: mcpHealth.releaseId ?? "",
    ontology_env: mcpHealth.env ?? getOntologyEnv(),
    index_generated_at: mcpHealth.indexGeneratedAt ?? "",
    company_count: mcpHealth.companyCount ?? 0,
    document_count: mcpHealth.documentCount ?? 0,
    object_count: mcpHealth.objectCount ?? 0,
    manifest_valid: mcpHealth.manifestValid,
    agent_index_schema_version: mcpHealth.agentIndexSchemaVersion ?? "",
  };
}

async function handleCompletedJob(params: {
  admin: SupabaseAdmin;
  job: AgentJob;
  runStartedAt: string;
  result: { acc: AccumulatedRun };
  release: PublicReleaseInput;
  sendEvent: (event: Parameters<typeof appendAgentRunEvent>[2], payload: unknown) => Promise<void>;
}) {
  const { admin, job, runStartedAt, result, release, sendEvent } = params;
  const { acc } = result;
  const visibleAnswer = acc.fullText.trim();
  const estimatedCost = estimateCost(acc.inputTokens, acc.outputTokens);
  const finishedAt = new Date().toISOString();
  const latencyMs = Date.now() - new Date(runStartedAt).getTime();
  const chatArtifacts =
    job.runKind === "news_discovery"
      ? await persistNewsDiscoveryArtifacts({
          admin,
          job,
          acc,
        })
      : [];

  await admin
    .from("messages")
    .update({
      content: visibleAnswer,
      status: "completed",
    })
    .eq("id", job.assistantMessageId);

  await markAgentRunTerminal(admin, job.run.id, {
    status: "completed",
    finishedAt,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    estimatedCostUsd: estimatedCost,
    latencyMs,
    openToolErrorMessage: "Run completed before tool result was received",
  });

  await closeOpenToolCallsForRun({
    admin,
    runId: job.run.id,
    finishedAt,
    errorMessage: "Run completed before tool result was received",
  });

  await settleExecutionBudgetForWorker(
    job.session.user_id,
    job.run.request_id,
    job.run.id,
    estimatedCost,
    "completed",
    {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      tool_call_count: acc.toolCalls.length,
    },
  );

  await recordAnalyticsEvent({
    eventName: "answer_completed",
    userId: job.session.user_id,
    sessionId: job.session.id,
    messageId: job.assistantMessageId,
    runId: job.run.id,
    properties: {
      scope_type: job.session.scope_type,
      ticker: job.session.default_tickers?.[0] ?? null,
      tickers: job.session.default_tickers ?? [],
      duration_ms: latencyMs,
      citation_count: acc.citations.length,
      artifact_count: chatArtifacts.length,
      artifact_created: chatArtifacts.length > 0,
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      tool_call_count: acc.toolCalls.length,
      estimated_cost_usd: estimatedCost,
      research_mode: job.researchMode,
      analysis_mode: job.analysisMode,
      run_kind: job.runKind,
      response_locale: job.responseLocale,
    },
  });

  for (const artifact of chatArtifacts) {
    await sendEvent("artifact", artifact);
  }

  await sendEvent("done", {
    run_id: job.run.id,
    message_id: job.assistantMessageId,
    content: visibleAnswer,
    rich_answers: [],
    artifacts: [],
    chat_artifacts: chatArtifacts,
    release: publicReleaseMetadata(release),
    usage: {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      estimated_cost_usd: estimatedCost,
      latency_ms: latencyMs,
    },
    execution_budget: await loadExecutionBudgetStatus(job.session.user_id),
  });
}

async function persistNewsDiscoveryArtifacts(params: {
  admin: SupabaseAdmin;
  job: AgentJob;
  acc: AccumulatedRun;
}) {
  const { admin, job, acc } = params;
  const artifact = buildNewsEventSelectionArtifact({
    acc,
    originalQuestion: job.userMessage.content,
  });
  if (!artifact) return [];

  const { data, error } = await admin
    .from("chat_message_artifacts")
    .insert({
      session_id: job.session.id,
      message_id: job.assistantMessageId,
      run_id: job.run.id,
      type: artifact.type,
      payload_json: jsonForDb(artifact.payload) ?? {},
    })
    .select("id, session_id, message_id, run_id, type, payload_json, created_at")
    .single<ChatMessageArtifactRow>();

  if (error || !data) {
    console.warn("[agent-worker] failed to persist chat artifact", {
      runId: job.run.id,
      error: error?.message,
    });
    return [];
  }

  return [toPublicChatArtifact(data)];
}

function mcpHealthReadinessError(mcpHealth: McpHealthResult): string | null {
  const ontologyEnv = getOntologyEnv();
  if (!mcpHealth.connected) return "MCP unavailable";
  if (mcpHealth.env !== ontologyEnv) {
    return `Ontology env mismatch: worker=${ontologyEnv} mcp=${mcpHealth.env ?? "missing"}`;
  }
  if (!mcpHealth.manifestValid) return "Ontology release manifest is invalid or missing";
  if (!mcpHealth.releaseId) return "Ontology release id is missing";
  return null;
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

async function handleCancelledJob(params: {
  admin: SupabaseAdmin;
  job: AgentJob;
  result: { acc: AccumulatedRun };
  sendEvent: (event: Parameters<typeof appendAgentRunEvent>[2], payload: unknown) => Promise<void>;
}) {
  const { admin, job, result, sendEvent } = params;
  const finishedAt = new Date().toISOString();
  const estimatedCost = estimateCost(result.acc.inputTokens, result.acc.outputTokens);

  await admin
    .from("messages")
    .update({
      content: cancelledAssistantContent(result.acc.fullText),
      status: "cancelled",
    })
    .eq("id", job.assistantMessageId);

  await markAgentRunTerminal(admin, job.run.id, {
    status: "cancelled",
    finishedAt,
    errorCode: "cancelled",
    openToolErrorMessage: "Run was cancelled before tool result was received",
  });

  await closeOpenToolCallsForRun({
    admin,
    runId: job.run.id,
    finishedAt,
    errorMessage: "Run was cancelled before tool result was received",
  });

  await settleExecutionBudgetForWorker(
    job.session.user_id,
    job.run.request_id,
    job.run.id,
    estimatedCost,
    "cancelled",
    {
      input_tokens: result.acc.inputTokens,
      output_tokens: result.acc.outputTokens,
      tool_call_count: result.acc.toolCalls.length,
    },
  );

  await sendEvent("cancelled", {
    run_id: job.run.id,
    message_id: job.assistantMessageId,
  });
}

async function handleFailedJob(params: {
  admin: SupabaseAdmin;
  job: AgentJob;
  runStartedAt: string;
  result: { acc: AccumulatedRun; errorCode?: string; errorMessage?: string };
  sendEvent: (event: Parameters<typeof appendAgentRunEvent>[2], payload: unknown) => Promise<void>;
}) {
  const { admin, job, result, sendEvent } = params;
  const errorCode = toErrorCode(result.errorCode || "claude_api_error");
  const rawErrorMessage = result.errorMessage || publicErrorMessage(errorCode);
  const publicMessage = publicAgentErrorMessage({ code: errorCode });
  const finishedAt = new Date().toISOString();
  const estimatedCost = estimateCost(result.acc.inputTokens, result.acc.outputTokens);

  await markAgentRunTerminal(admin, job.run.id, {
    status: errorCode === "lease_expired" ? "expired" : "failed",
    finishedAt,
    errorCode,
    errorMessage: rawErrorMessage,
    inputTokens: result.acc.inputTokens,
    outputTokens: result.acc.outputTokens,
    estimatedCostUsd: estimatedCost,
    openToolErrorMessage:
      errorCode === "lease_expired"
        ? "Agent hard timeout or worker lease expired before tool result was received"
        : `Run failed before tool result was received: ${rawErrorMessage}`,
  });

  await admin
    .from("messages")
    .update({
      content: publicMessage,
      status: "failed",
    })
    .eq("id", job.assistantMessageId);

  await closeOpenToolCallsForRun({
    admin,
    runId: job.run.id,
    finishedAt,
    errorMessage:
      errorCode === "lease_expired"
        ? "Agent hard timeout or worker lease expired before tool result was received"
        : `Run failed before tool result was received: ${rawErrorMessage}`,
  });

  await recordAnalyticsEvent({
    eventName: "answer_failed",
    userId: job.session.user_id,
    sessionId: job.session.id,
    messageId: job.assistantMessageId,
    runId: job.run.id,
    properties: {
      scope_type: job.session.scope_type,
      ticker: job.session.default_tickers?.[0] ?? null,
      tickers: job.session.default_tickers ?? [],
      error_code: errorCode,
      output_length: result.acc.fullText.length,
      tool_call_count: result.acc.toolCalls.length,
    },
  });

  if (estimatedCost > 0) {
    await settleExecutionBudgetForWorker(
      job.session.user_id,
      job.run.request_id,
      job.run.id,
      estimatedCost,
      errorCode,
      {
        input_tokens: result.acc.inputTokens,
        output_tokens: result.acc.outputTokens,
        tool_call_count: result.acc.toolCalls.length,
        output_length: result.acc.fullText.length,
      },
    );
  } else {
    await releaseExecutionBudgetForWorker(
      job.session.user_id,
      job.run.request_id,
      job.run.id,
      errorCode,
    );
  }

  await sendEvent("error", {
    run_id: job.run.id,
    error_code: errorCode,
    error_message: publicMessage,
  });
}

async function loadExecutionBudgetStatus(userId: string) {
  const admin = getSupabaseAdmin();
  const planKey = await loadPlanKey(admin, userId);
  const plan = await getBillingPlanFromStore(planKey);
  const monthlyPeriod = getCurrentMonthlyBillingPeriod();
  const dailyPeriod = getCurrentDailyBillingPeriod();
  const [monthly, daily] = await Promise.all([
    loadBudgetBalance(admin, userId, "monthly", monthlyPeriod.start, monthlyPeriod.end),
    loadBudgetBalance(admin, userId, "daily", dailyPeriod.start, dailyPeriod.end),
  ]);

  const budgetLimitUsd = plan.monthlyBudgetUsd;
  const dailyBudgetLimitUsd = getEffectiveDailyBudgetUsd(plan);
  const remainingBudgetUsd = Math.max(
    0,
    budgetLimitUsd - monthly.settledCostUsd - monthly.reservedCostUsd,
  );
  const remainingDailyBudgetUsd = Math.max(
    0,
    dailyBudgetLimitUsd - daily.settledCostUsd - daily.reservedCostUsd,
  );
  const percentUsed =
    budgetLimitUsd > 0
      ? Math.min(
          100,
          Math.round(
            ((monthly.settledCostUsd + monthly.reservedCostUsd) /
              budgetLimitUsd) *
              100,
          ),
        )
      : 100;

  return {
    budget_used_usd: roundUsd(monthly.settledCostUsd),
    budget_reserved_usd: roundUsd(monthly.reservedCostUsd),
    budget_limit_usd: budgetLimitUsd,
    remaining_budget_usd: roundUsd(remainingBudgetUsd),
    daily_budget_used_usd: roundUsd(daily.settledCostUsd),
    daily_budget_reserved_usd: roundUsd(daily.reservedCostUsd),
    daily_budget_limit_usd: dailyBudgetLimitUsd,
    per_run_reserve_usd: 0,
    analysis_credits_used: budgetUsdToAnalysisCredits(monthly.settledCostUsd, "ceil"),
    analysis_credits_reserved: budgetUsdToAnalysisCredits(monthly.reservedCostUsd, "ceil"),
    analysis_credits_limit: budgetUsdToAnalysisCredits(budgetLimitUsd, "floor"),
    remaining_analysis_credits: budgetUsdToAnalysisCredits(remainingBudgetUsd, "floor"),
    daily_analysis_credits_used: budgetUsdToAnalysisCredits(daily.settledCostUsd, "ceil"),
    daily_analysis_credits_reserved: budgetUsdToAnalysisCredits(daily.reservedCostUsd, "ceil"),
    daily_analysis_credits_limit: budgetUsdToAnalysisCredits(dailyBudgetLimitUsd, "floor"),
    per_run_analysis_credits: 0,
    run_count: monthly.runCount,
    percent_used: percentUsed,
    can_run:
      budgetUsdToAnalysisCredits(remainingBudgetUsd, "floor") > 0 &&
      budgetUsdToAnalysisCredits(remainingDailyBudgetUsd, "floor") > 0,
  };
}

async function settleExecutionBudgetForWorker(
  userId: string,
  requestId: string,
  runId: string | null,
  actualCostUsd: number,
  terminalStatus: string,
  metadata: Json = {},
) {
  const { error } = await getSupabaseAdmin().rpc("settle_execution_budget", {
    p_user_id: userId,
    p_request_id: requestId,
    p_run_id: runId,
    p_actual_cost_usd: roundUsd(actualCostUsd),
    p_terminal_status: terminalStatus,
    p_metadata: metadata,
  });
  if (error) {
    console.warn("[agent-worker] failed to settle execution budget", {
      code: error.code,
      message: error.message,
    });
  }
}

async function releaseExecutionBudgetForWorker(
  userId: string,
  requestId: string,
  runId: string | null,
  reason: string,
) {
  const { error } = await getSupabaseAdmin().rpc("release_execution_budget", {
    p_user_id: userId,
    p_request_id: requestId,
    p_run_id: runId,
    p_reason: reason,
  });
  if (error) {
    console.warn("[agent-worker] failed to release execution budget", {
      code: error.code,
      message: error.message,
    });
  }
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = Number.isFinite(INPUT_COST_PER_1M)
    ? INPUT_COST_PER_1M
    : 3.0;
  const outputCost = Number.isFinite(OUTPUT_COST_PER_1M)
    ? OUTPUT_COST_PER_1M
    : 15.0;
  return (inputTokens / 1_000_000) * inputCost + (outputTokens / 1_000_000) * outputCost;
}

function roundUsd(value: number): number {
  return Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000;
}

async function loadPlanKey(admin: SupabaseAdmin, userId: string) {
  const { data } = await admin
    .from("user_entitlements")
    .select("plan_key, status")
    .eq("user_id", userId)
    .maybeSingle<Pick<UserEntitlementRow, "plan_key" | "status">>();

  if (!data || data.status !== "active") {
    const email = await loadUserEmailForAdminCheck(admin, userId);
    return isAdminEntitlementEmail(email) ? "internal" : resolvePlanKey(null);
  }
  return resolvePlanKey(data.plan_key);
}

async function loadUserEmailForAdminCheck(
  admin: SupabaseAdmin,
  userId: string,
): Promise<string | null> {
  const authAdmin = (
    admin as SupabaseAdmin & {
      auth?: {
        admin?: {
          getUserById?: (
            id: string,
          ) => Promise<{
            data?: { user?: { email?: string | null } | null } | null;
            error?: unknown;
          }>;
        };
      };
    }
  ).auth?.admin;

  if (!authAdmin?.getUserById) return null;

  try {
    const { data, error } = await authAdmin.getUserById(userId);
    if (error) return null;
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

async function loadBudgetBalance(
  admin: SupabaseAdmin,
  userId: string,
  periodKind: "daily" | "monthly",
  periodStart: string,
  periodEnd: string,
) {
  const { data } = await admin
    .from("usage_budget_balances")
    .select("settled_cost_usd, reserved_cost_usd, run_count")
    .eq("user_id", userId)
    .eq("period_kind", periodKind)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle<
      Pick<
        UsageBudgetBalanceRow,
        "settled_cost_usd" | "reserved_cost_usd" | "run_count"
      >
    >();

  return {
    settledCostUsd: Number(data?.settled_cost_usd ?? 0),
    reservedCostUsd: Number(data?.reserved_cost_usd ?? 0),
    runCount: Number(data?.run_count ?? 0),
  };
}

function emptyAccumulatedRun(): AccumulatedRun {
  return {
    fullText: "",
    structuredOutput: null,
    researchSynthesisOutput: null,
    researchSynthesisText: null,
    displayPlanOutput: null,
    toolCalls: [],
    citations: [],
    inputTokens: 0,
    outputTokens: 0,
  };
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
