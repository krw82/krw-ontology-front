import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOntologyEnv, readIntEnv } from "@/lib/env";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import {
  fallbackQueueState,
  loadAgentRunQueueState,
  toQueueStatus,
} from "@/lib/agent/queue-state";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import type { ResolvedSession } from "@/lib/api/chat/resolve-session";
import type { HistoryResult } from "@/lib/api/chat/fetch-history";
import type { AgentRunRow, Json, MessageRow } from "@/types/database";
import type { AgentRunExecutorType, RunStatus } from "@/types/api-contracts";
import {
  DEFAULT_RESEARCH_MODE,
  normalizeResearchMode,
  type ResearchMode,
} from "@/lib/research-mode";
import {
  DEFAULT_ANALYSIS_MODE,
  normalizeAnalysisMode,
  type AnalysisMode,
} from "@/lib/analysis-mode";
import {
  defaultRunKindForAnalysisMode,
  normalizeRunKind,
  type RunKind,
} from "@/lib/run-kind";

const GLOBAL_CONCURRENT_LIMIT = readIntEnv("GLOBAL_CONCURRENT_RUN_LIMIT", 5, {
  min: 1,
});
const LEASE_TIMEOUT_SECONDS =
  readIntEnv("LEASE_TIMEOUT_MINUTES", 10, { min: 1 }) * 60;

export type EnqueueAgentRunResult =
  | {
      ok: true;
      runId: string;
      assistantMessageId: string;
      queuedAt: string;
    }
  | {
      ok: false;
      reason: "active_run_exists" | "duplicate_request" | "internal_error";
      runId?: string;
    };

export async function enqueueAgentRun(params: {
  session: ResolvedSession;
  history: HistoryResult;
  requestId: string;
  model: string;
  mcpHealth: McpHealthResult;
  researchMode?: ResearchMode;
  analysisMode?: AnalysisMode;
  runKind?: RunKind;
  executorType?: AgentRunExecutorType;
  selectedNewsEventContext?: Record<string, unknown> | null;
  sourceArtifactId?: string | null;
  sourceEventId?: string | null;
}): Promise<EnqueueAgentRunResult> {
  const { session, history, requestId, model, mcpHealth } = params;
  const ontologyEnv = getOntologyEnv();
  const researchMode = normalizeResearchMode(
    params.researchMode ?? DEFAULT_RESEARCH_MODE,
  );
  const analysisMode = normalizeAnalysisMode(
    params.analysisMode ?? DEFAULT_ANALYSIS_MODE,
  );
  const runKind = normalizeRunKind(
    params.runKind ?? defaultRunKindForAnalysisMode(analysisMode),
  );
  const executorType = params.executorType ?? "claude_agent";
  const admin = getSupabaseAdmin();

  const existingRun = await findRunByRequestId(requestId, session.id);
  if (existingRun) {
    return {
      ok: false,
      reason: "duplicate_request",
      runId: existingRun.id,
    };
  }

  const { data: assistantMessage, error: messageError } = await admin
    .from("messages")
    .insert({
      session_id: session.id,
      role: "assistant",
      content: "",
      status: "pending",
    })
    .select("id, created_at")
    .single<Pick<MessageRow, "id" | "created_at">>();

  if (messageError || !assistantMessage) {
    return { ok: false, reason: "internal_error" };
  }

  const queuedAt = new Date().toISOString();
  const { data: run, error: runError } = await admin
    .from("agent_runs")
    .insert({
      session_id: session.id,
      user_message_id: history.userMessageId,
      assistant_message_id: assistantMessage.id,
      request_id: requestId,
      model,
      status: "queued",
      queued_at: queuedAt,
      web_commit: process.env.WEB_COMMIT || "dev",
      krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "dev",
      ontology_env: ontologyEnv,
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
      run_kind: runKind,
      executor_type: executorType,
      selected_news_event_context:
        params.selectedNewsEventContext ?? null,
      source_artifact_id: params.sourceArtifactId ?? null,
      source_event_id: params.sourceEventId ?? null,
    })
    .select("id")
    .single<Pick<AgentRunRow, "id">>();

  if (runError || !run) {
    await admin.from("messages").delete().eq("id", assistantMessage.id);

    if (runError?.code === "23505") {
      const duplicate = await findRunByRequestId(requestId, session.id);
      if (duplicate) {
        return {
          ok: false,
          reason: "duplicate_request",
          runId: duplicate.id,
        };
      }
      return { ok: false, reason: "active_run_exists" };
    }

    return { ok: false, reason: "internal_error" };
  }

  const queueState =
    (await loadAgentRunQueueState(admin, run.id)) ??
    fallbackQueueState({ status: "queued", queued_at: queuedAt });
  const queue = toQueueStatus(queueState);

  await appendAgentRunEvent(admin, run.id, "run_queued", {
    run_id: run.id,
    message_id: assistantMessage.id,
    session_id: session.id,
    request_id: requestId,
    queued_at: queuedAt,
    research_mode: researchMode,
    analysis_mode: analysisMode,
    run_kind: runKind,
    executor_type: executorType,
    queue,
  });
  await appendAgentRunEvent(admin, run.id, "activity_update", {
    stage: "queued",
    label: "대기열에 추가됨",
    queue,
  });

  return {
    ok: true,
    runId: run.id,
    assistantMessageId: assistantMessage.id,
    queuedAt,
  };
}

export async function claimNextAgentRun(workerId: string): Promise<string | null> {
  const ontologyEnv = getOntologyEnv();
  const { data, error } = await getSupabaseAdmin().rpc("claim_agent_run", {
    p_worker_id: workerId,
    p_worker_env: ontologyEnv,
    p_ontology_env: ontologyEnv,
    p_lease_seconds: LEASE_TIMEOUT_SECONDS,
    p_global_limit: GLOBAL_CONCURRENT_LIMIT,
  });

  if (error) {
    console.warn("[agent-worker] claim failed", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return typeof row?.id === "string" ? row.id : null;
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

export async function heartbeatAgentRun(
  runId: string,
  workerId: string,
): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("heartbeat_agent_run", {
    p_run_id: runId,
    p_worker_id: workerId,
    p_lease_seconds: LEASE_TIMEOUT_SECONDS,
  });

  if (error) {
    console.warn("[agent-worker] heartbeat failed", {
      runId,
      code: error.code,
      message: error.message,
    });
    return false;
  }

  return Boolean(data);
}

export async function requestAgentRunCancel(
  runId: string,
): Promise<{
  status: RunStatus | null;
  assistantMessageId: string | null;
  requestId: string | null;
}> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data } = await admin
    .from("agent_runs")
    .update({ cancel_requested_at: now })
    .eq("id", runId)
    .in("status", ["queued", "running", "pending"])
    .select("status, assistant_message_id, request_id")
    .maybeSingle<{
      status: RunStatus;
      assistant_message_id: string | null;
      request_id: string | null;
    }>();

  return {
    status: data?.status ?? null,
    assistantMessageId: data?.assistant_message_id ?? null,
    requestId: data?.request_id ?? null,
  };
}

export async function findRunByRequestId(
  requestId: string,
  sessionId?: string,
): Promise<Pick<AgentRunRow, "id" | "session_id"> | null> {
  let query = getSupabaseAdmin()
    .from("agent_runs")
    .select("id, session_id")
    .eq("request_id", requestId)
    .limit(1);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }

  const { data } = await query.maybeSingle<Pick<AgentRunRow, "id" | "session_id">>();

  return data ?? null;
}
