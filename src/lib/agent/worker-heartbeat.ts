import "server-only";

import { execFile } from "node:child_process";
import { checkMcpHealth, type McpHealthResult } from "@/lib/agent/mcp-client";
import { getOntologyEnv, readIntEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentWorkerHeartbeatRow, Json } from "@/types/database";

const WORKER_HEARTBEAT_INTERVAL_MS = readIntEnv(
  "AGENT_WORKER_HEARTBEAT_INTERVAL_MS",
  30_000,
  { min: 1_000 },
);
const WORKER_HEARTBEAT_TTL_SECONDS = readIntEnv(
  "AGENT_WORKER_HEARTBEAT_TTL_SECONDS",
  120,
  { min: 5 },
);

export type AgentWorkerStatus = AgentWorkerHeartbeatRow["status"];

export type WorkerAdmissionResult =
  | {
      ok: true;
      worker: AgentWorkerHeartbeatRow;
      mcpHealth: McpHealthResult;
    }
  | {
      ok: false;
      reason: "worker_unavailable";
      message: string;
    };

export async function heartbeatAgentWorker(params: {
  workerId: string;
  status: AgentWorkerStatus;
  mcpHealth: McpHealthResult;
  error?: string | null;
}): Promise<void> {
  const now = new Date();
  const ontologyEnv = getOntologyEnv();
  const heartbeatExpiresAt = new Date(
    now.getTime() + WORKER_HEARTBEAT_TTL_SECONDS * 1000,
  );
  const payload = {
    worker_id: params.workerId,
    status: params.status,
    last_seen_at: now.toISOString(),
    heartbeat_expires_at: heartbeatExpiresAt.toISOString(),
    claude_code_version: await readClaudeCodeVersion(),
    web_commit: process.env.WEB_COMMIT || "dev",
    krw_ontology_commit: process.env.KRW_ONTOLOGY_COMMIT || "dev",
    worker_env: ontologyEnv,
    ontology_env: params.mcpHealth.env ?? ontologyEnv,
    ontology_release_id: params.mcpHealth.releaseId,
    index_generated_at: params.mcpHealth.indexGeneratedAt,
    company_count: params.mcpHealth.companyCount,
    document_count: params.mcpHealth.documentCount,
    object_count: params.mcpHealth.objectCount,
    tool_count: params.mcpHealth.toolCount,
    root: params.mcpHealth.root,
    index_path: params.mcpHealth.indexPath,
    manifest_path: params.mcpHealth.manifestPath,
    manifest_valid: params.mcpHealth.manifestValid,
    agent_index_schema_version: params.mcpHealth.agentIndexSchemaVersion,
    plugin_path: params.mcpHealth.pluginPath,
    error: params.error ?? params.mcpHealth.error ?? null,
    metadata: {
      connected: params.mcpHealth.connected,
      staticOk: params.mcpHealth.staticOk,
      commandOk: params.mcpHealth.commandOk,
      liveOk: params.mcpHealth.liveOk,
      sqliteOk: params.mcpHealth.sqliteOk,
      env: params.mcpHealth.env,
      manifestPath: params.mcpHealth.manifestPath,
      manifestValid: params.mcpHealth.manifestValid,
      agentIndexSchemaVersion: params.mcpHealth.agentIndexSchemaVersion,
      tools: params.mcpHealth.tools,
      release: params.mcpHealth.releaseMetadata,
    } satisfies Json,
  };

  const { error } = await getSupabaseAdmin()
    .from("agent_worker_heartbeats")
    .upsert(payload, { onConflict: "worker_id" });

  if (error) {
    console.warn("[agent-worker] worker heartbeat failed", {
      workerId: params.workerId,
      code: error.code,
      message: error.message,
    });
  }
}

export function startAgentWorkerHeartbeat(
  workerId: string,
  getStatus: () => AgentWorkerStatus,
): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const beat = async () => {
    if (stopped || inFlight) return;
    inFlight = writeCurrentWorkerHeartbeat(workerId, getStatus()).finally(() => {
      inFlight = null;
    });
    await inFlight;
  };

  void beat();
  const interval = setInterval(() => {
    void beat();
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  (interval as { unref?: () => void }).unref?.();

  return async () => {
    stopped = true;
    clearInterval(interval);
    if (inFlight) await inFlight.catch(() => undefined);
    await markAgentWorkerStopped(workerId);
  };
}

export async function writeCurrentWorkerHeartbeat(
  workerId: string,
  status: AgentWorkerStatus,
): Promise<void> {
  try {
    const mcpHealth = await checkMcpHealth();
    await heartbeatAgentWorker({
      workerId,
      status: isReadyMcpHealth(mcpHealth) ? status : "unhealthy",
      mcpHealth,
      error: isReadyMcpHealth(mcpHealth)
        ? null
        : readinessErrorMessage(mcpHealth),
    });
  } catch (error) {
    await heartbeatAgentWorker({
      workerId,
      status: "unhealthy",
      mcpHealth: fallbackMcpHealth(error),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function markAgentWorkerStopped(workerId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("agent_worker_heartbeats")
    .update({
      status: "stopped",
      last_seen_at: now,
      heartbeat_expires_at: now,
      updated_at: now,
    })
    .eq("worker_id", workerId);

  if (error) {
    console.warn("[agent-worker] failed to mark worker stopped", {
      workerId,
      code: error.code,
      message: error.message,
    });
  }
}

export async function getReadyAgentWorker(
  now = new Date(),
  expectedReleaseId?: string | null,
): Promise<WorkerAdmissionResult> {
  const ontologyEnv = getOntologyEnv();
  let query = getSupabaseAdmin()
    .from("agent_worker_heartbeats")
    .select(
      "worker_id, status, last_seen_at, heartbeat_expires_at, claude_code_version, web_commit, krw_ontology_commit, worker_env, ontology_env, ontology_release_id, index_generated_at, company_count, document_count, object_count, tool_count, root, index_path, manifest_path, manifest_valid, agent_index_schema_version, plugin_path, error, metadata, created_at, updated_at",
    )
    .in("status", ["idle", "running"])
    .eq("worker_env", ontologyEnv)
    .eq("ontology_env", ontologyEnv)
    .eq("manifest_valid", true)
    .not("ontology_release_id", "is", null);

  if (expectedReleaseId) {
    query = query.eq("ontology_release_id", expectedReleaseId);
  }

  const { data, error } = await query
    .gt("heartbeat_expires_at", now.toISOString())
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle<AgentWorkerHeartbeatRow>();

  if (error || !data) {
    return {
      ok: false,
      reason: "worker_unavailable",
      message:
        error?.message ??
        (expectedReleaseId
          ? `No ready agent worker heartbeat found for release ${expectedReleaseId}`
          : "No ready agent worker heartbeat found"),
    };
  }

  return {
    ok: true,
    worker: data,
    mcpHealth: mcpHealthFromWorkerHeartbeat(data),
  };
}

function mcpHealthFromWorkerHeartbeat(row: AgentWorkerHeartbeatRow): McpHealthResult {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const tools = Array.isArray(metadata.tools)
    ? metadata.tools.filter((tool): tool is string => typeof tool === "string")
    : [];

  return {
    connected: true,
    staticOk: asBoolean(metadata.staticOk, true),
    commandOk: asBoolean(metadata.commandOk, true),
    liveOk: asBoolean(metadata.liveOk, true),
    sqliteOk: asBoolean(metadata.sqliteOk, true),
    env: row.ontology_env,
    releaseId: row.ontology_release_id,
    manifestPath: row.manifest_path,
    manifestValid: row.manifest_valid,
    agentIndexSchemaVersion: row.agent_index_schema_version,
    indexGeneratedAt: row.index_generated_at,
    companyCount: row.company_count,
    documentCount: row.document_count,
    objectCount: row.object_count,
    toolCount: row.tool_count,
    tools,
    root: row.root,
    indexPath: row.index_path,
    pluginPath: row.plugin_path ?? "",
    releaseMetadata: isRecord(metadata.release) ? metadata.release : null,
    error: row.error ?? undefined,
  };
}

function fallbackMcpHealth(error: unknown): McpHealthResult {
  return {
    connected: false,
    staticOk: false,
    commandOk: false,
    liveOk: false,
    sqliteOk: false,
    env: getOntologyEnv(),
    releaseId: null,
    manifestPath: process.env.KRW_ONTOLOGY_MANIFEST_PATH ?? null,
    manifestValid: false,
    agentIndexSchemaVersion: null,
    indexGeneratedAt: null,
    companyCount: null,
    documentCount: null,
    objectCount: null,
    toolCount: null,
    tools: [],
    root:
      process.env.KRW_ONTOLOGY_RELEASE_ROOT ??
      process.env.KRW_ONTOLOGY_ROOT ??
      null,
    indexPath:
      process.env.KRW_ONTOLOGY_INDEX_PATH ??
      (process.env.KRW_ONTOLOGY_RELEASE_ROOT
        ? `${process.env.KRW_ONTOLOGY_RELEASE_ROOT}/indexes/agent_index.sqlite`
        : process.env.KRW_ONTOLOGY_ROOT
          ? `${process.env.KRW_ONTOLOGY_ROOT}/indexes/agent_index.sqlite`
          : null),
    pluginPath: process.env.KRW_ONTOLOGY_PLUGIN_PATH ?? "",
    releaseMetadata: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function isReadyMcpHealth(mcpHealth: McpHealthResult): boolean {
  const ontologyEnv = getOntologyEnv();
  return (
    mcpHealth.connected &&
    mcpHealth.env === ontologyEnv &&
    mcpHealth.manifestValid &&
    Boolean(mcpHealth.releaseId)
  );
}

function readinessErrorMessage(mcpHealth: McpHealthResult): string | null {
  const ontologyEnv = getOntologyEnv();
  if (!mcpHealth.connected) return mcpHealth.error ?? "MCP unavailable";
  if (mcpHealth.env !== ontologyEnv) {
    return `Ontology env mismatch: worker=${ontologyEnv} mcp=${mcpHealth.env ?? "missing"}`;
  }
  if (!mcpHealth.manifestValid) return "Ontology release manifest is invalid or missing";
  if (!mcpHealth.releaseId) return "Ontology release id is missing";
  return null;
}

async function readClaudeCodeVersion(): Promise<string | null> {
  const executable = process.env.CLAUDE_CODE_EXECUTABLE;
  if (!executable) return null;

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(executable, ["--version"], {
        timeout: 5_000,
        maxBuffer: 256 * 1024,
        env: process.env,
      }, (error, output) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(output);
      });
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
