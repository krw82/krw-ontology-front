import { recordAnalyticsEvent } from "@/lib/analytics/server";
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
import {
  budgetUsdToAnalysisCredits,
  getEffectiveDailyBudgetUsd,
  resolvePlanKey,
} from "@/lib/billing/plans";
import { getBillingPlanFromStore } from "@/lib/billing/plan-store";
import { heartbeatAgentRun } from "@/lib/agent/job-queue";
import { closeOpenToolCallsForRun } from "@/lib/agent/tool-call-cleanup";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import { getCurrentBillingPeriod } from "@/lib/billing/period";
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
  toPublicChatArtifact,
} from "@/lib/chat-artifacts/news-event-selection";

const HEARTBEAT_INTERVAL_MS = readIntEnv("LEASE_HEARTBEAT_INTERVAL_MS", 60_000, {
  min: 1_000,
});
const CANCEL_POLL_INTERVAL_MS = readIntEnv("AGENT_CANCEL_POLL_INTERVAL_MS", 1000, {
  min: 250,
});
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
  const stopCancelPolling = startCancelPolling(
    admin,
    runId,
    abortController,
  );

  try {
    await admin
      .from("messages")
      .update({ status: "streaming" })
      .eq("id", job.assistantMessageId);

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

    const persistPartialText = createPartialMessagePersister(
      admin,
      job.assistantMessageId,
    );
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
          userMessage: job.userMessage.content,
          scopeType: job.session.scope_type,
          defaultTickers: job.session.default_tickers ?? [],
          defaultDocumentTypes:
            (job.session.default_document_types ?? []) as DocumentType[],
          history: job.history,
          researchMode: job.researchMode,
          analysisMode: job.analysisMode,
          runKind: job.runKind,
          selectedNewsEventContext: job.selectedNewsEventContext,
          abortSignal: abortController.signal,
          onSdkDiagnostics: recordSdkDiagnostics,
          onTextDelta: async (delta, fullText) => {
            if (!acceptingRunOutput) return;
            await persistPartialText(delta, fullText);
          },
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
    await persistPartialText.flush();
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
    stopCancelPolling();
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
      abortController.abort();
      reject(new AgentRunHardTimeoutError(timeoutMs));
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
    .select("id, session_id, user_message_id, assistant_message_id, request_id, started_at, run_kind, selected_news_event_context")
    .eq("id", runId)
    .maybeSingle<
      AgentJob["run"] &
        Pick<AgentRunRow, "run_kind" | "selected_news_event_context">
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
    runStartedEventResult,
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
        .eq("event_type", "run_started")
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

  if (runStartedEventResult.error) {
    throw new AgentJobLoadError(
      `Agent run started event load failed: ${formatSupabaseError(
        runStartedEventResult.error,
      )}`,
      loadContext,
    );
  }

  const session = sessionResult.data;
  const userMessage = userMessageResult.data;
  const previousMessages = previousMessagesResult.data;
  const runStartedEvent = runStartedEventResult.data;

  if (!session || !userMessage) return null;
  const startedPayload = isRecord(runStartedEvent?.payload)
    ? runStartedEvent.payload
    : {};

  return {
    run,
    session,
    userMessage,
    assistantMessageId: run.assistant_message_id,
    history: [...(previousMessages ?? [])].reverse(),
    researchMode: normalizeResearchMode(startedPayload.research_mode),
    analysisMode: normalizeAnalysisMode(startedPayload.analysis_mode),
    runKind: normalizeRunKind(
      startedPayload.run_kind ??
        run.run_kind ??
        defaultRunKindForAnalysisMode(
          normalizeAnalysisMode(startedPayload.analysis_mode),
        ),
    ),
    selectedNewsEventContext: isRecord(run.selected_news_event_context)
      ? run.selected_news_event_context
      : null,
  };
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

function startCancelPolling(
  admin: SupabaseAdmin,
  runId: string,
  abortController: AbortController,
) {
  const interval = setInterval(async () => {
    const { data } = await admin
      .from("agent_runs")
      .select("cancel_requested_at, status")
      .eq("id", runId)
      .maybeSingle<{ cancel_requested_at: string | null; status: string }>();

    if (data?.cancel_requested_at || data?.status === "cancelled") {
      abortController.abort();
    }
  }, CANCEL_POLL_INTERVAL_MS);
  (interval as { unref?: () => void }).unref?.();

  return () => clearInterval(interval);
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

function createPartialMessagePersister(
  admin: SupabaseAdmin,
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
  const monthlyPeriod = getCurrentBillingPeriod(plan.budgetPeriod);
  const dailyPeriod = getCurrentBillingPeriod("daily");
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
