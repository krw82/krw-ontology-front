import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_command, _args, _options, callback) => {
    callback(null, "2.1.204 (Claude Code)\n", "");
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/agent/mcp-client", () => ({
  checkMcpReady: vi.fn(),
  KRW_ONTOLOGY_MCP_TOOLS: [
    "krw_ontology_catalog",
    "krw_ontology_company_context",
    "krw_ontology_index_context",
    "krw_ontology_topic_map",
    "krw_ontology_query",
    "krw_ontology_query_context",
    "krw_ontology_retrieve",
    "krw_ontology_trace",
    "krw_ontology_verify_evidence",
    "krw_ontology_quality",
    "krw_ontology_compare",
    "krw_ontology_plan_query",
    "krw_ontology_chain",
  ],
}));

import { checkMcpReady, type McpHealthResult } from "@/lib/agent/mcp-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getReadyAgentWorker,
  markAgentWorkerStopped,
  writeCurrentWorkerHeartbeat,
} from "./worker-heartbeat";

const sha256 = "a".repeat(64);
const ontologyTools = [
  "krw_ontology_catalog",
  "krw_ontology_company_context",
  "krw_ontology_index_context",
  "krw_ontology_topic_map",
  "krw_ontology_query",
  "krw_ontology_query_context",
  "krw_ontology_retrieve",
  "krw_ontology_trace",
  "krw_ontology_verify_evidence",
  "krw_ontology_quality",
  "krw_ontology_compare",
  "krw_ontology_plan_query",
  "krw_ontology_chain",
] as const;
const mcpHealth = {
  connected: true,
  staticOk: true,
  commandOk: true,
  liveOk: true,
  sqliteOk: true,
  contractOk: true,
  toolParityOk: true,
  fingerprintOk: true,
  fingerprintErrors: [],
  pluginContractOk: true,
  pluginContractErrors: [],
  pluginContentSha256: sha256,
  pluginMcpConfigSha256: sha256,
  mcpContractVersion: "krw-ontology-mcp/v2",
  buildId: "build-1",
  backendGitSha: "backend-sha-1",
  toolSchemaSha256: sha256,
  buildFingerprintSha256: sha256,
  releaseManifestSha256: sha256,
  serviceFingerprintSha256: sha256,
  env: "dev",
  releaseId: "release-1",
  manifestPath: "~/krw-ontology-data/manifest.json",
  manifestValid: true,
  agentIndexSchemaVersion: "agent_index_v1",
  indexGeneratedAt: "2026-05-27T00:00:00.000Z",
  companyCount: 10,
  documentCount: 20,
  objectCount: 30,
  toolCount: 13,
  tools: [...ontologyTools],
  root: "~/krw-ontology-data",
  indexPath:
    "~/krw-ontology-data/indexes/global_spine.sqlite",
  pluginPath: "~/krw-ontology/plugins/krw-ontology",
  releaseMetadata: {
    env: "dev",
    release_id: "release-1",
    manifest_valid: true,
  },
} satisfies McpHealthResult;

function createHeartbeatAdmin(params: {
  readyWorker?: Record<string, unknown> | null;
  selectError?: { message: string } | null;
} = {}) {
  const upserts: Array<Record<string, unknown>> = [];
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];
  const queries: Array<{
    table: string;
    inFilters: Record<string, unknown[]>;
    eqFilters: Record<string, unknown>;
    notFilters: Record<string, { operator: string; value: unknown }>;
    gtFilters: Record<string, unknown>;
  }> = [];

  const admin = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>) {
          upserts.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          return {
            eq(key: string, value: unknown) {
              filters[key] = value;
              updates.push({ table, payload, filters: { ...filters } });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        select() {
          const inFilters: Record<string, unknown[]> = {};
          const eqFilters: Record<string, unknown> = {};
          const notFilters: Record<string, { operator: string; value: unknown }> = {};
          const gtFilters: Record<string, unknown> = {};
          const query = {
            in(key: string, values: unknown[]) {
              inFilters[key] = values;
              return query;
            },
            eq(key: string, value: unknown) {
              eqFilters[key] = value;
              return query;
            },
            not(key: string, operator: string, value: unknown) {
              notFilters[key] = { operator, value };
              return query;
            },
            gt(key: string, value: unknown) {
              gtFilters[key] = value;
              return query;
            },
            order() {
              return query;
            },
            limit() {
              return query;
            },
            maybeSingle() {
              queries.push({ table, inFilters, eqFilters, notFilters, gtFilters });
              return Promise.resolve({
                data: params.readyWorker ?? null,
                error: params.selectError ?? null,
              });
            },
          };
          return query;
        },
      };
    },
  };

  return {
    admin: admin as never,
    upserts,
    updates,
    queries,
  };
}

describe("agent worker heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CLAUDE_CODE_EXECUTABLE", "~/.local/bin/claude-krw");
  });

  it("writes worker heartbeat metadata from local MCP health", async () => {
    const fake = createHeartbeatAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockResolvedValue(mcpHealth);

    await writeCurrentWorkerHeartbeat("mac-worker-jwc-1", "idle");

    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0]).toMatchObject({
      worker_id: "mac-worker-jwc-1",
      status: "idle",
      claude_code_version: "2.1.204 (Claude Code)",
      ontology_release_id: "release-1",
      worker_env: "dev",
      ontology_env: "dev",
      document_count: 20,
      tool_count: 13,
      root: "~/krw-ontology-data",
      manifest_valid: true,
      metadata: expect.objectContaining({
        pluginContractOk: true,
        pluginContentSha256: sha256,
        pluginMcpConfigSha256: sha256,
      }),
    });
  });

  it("falls back to unhealthy heartbeat when MCP health throws", async () => {
    const fake = createHeartbeatAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockRejectedValue(new Error("mcp failed"));

    await writeCurrentWorkerHeartbeat("mac-worker-jwc-1", "idle");

    expect(fake.upserts[0]).toMatchObject({
      worker_id: "mac-worker-jwc-1",
      status: "unhealthy",
      error: "mcp failed",
    });
  });

  it("resolves ready worker heartbeat into enqueue metadata", async () => {
    const fake = createHeartbeatAdmin({
      readyWorker: {
        worker_id: "mac-worker-jwc-1",
        status: "idle",
        last_seen_at: "2026-05-27T00:00:00.000Z",
        heartbeat_expires_at: "2026-05-27T00:02:00.000Z",
        claude_code_version: "2.1.204 (Claude Code)",
        web_commit: "dev",
        krw_ontology_commit: "dev",
        worker_env: "dev",
        ontology_env: "dev",
        ontology_release_id: "release-1",
        index_generated_at: "2026-05-27T00:00:00.000Z",
        company_count: 10,
        document_count: 20,
        object_count: 30,
        tool_count: 13,
        root: "/data",
        index_path: "/data/indexes/global_spine.sqlite",
        manifest_path: "/data/manifest.json",
        manifest_valid: true,
        agent_index_schema_version: "agent_index_v1",
        plugin_path: "/plugin",
        error: null,
        metadata: {
          connected: true,
          staticOk: true,
          commandOk: true,
          liveOk: true,
          sqliteOk: true,
          contractOk: true,
          toolParityOk: true,
          fingerprintOk: true,
          fingerprintErrors: [],
          pluginContractOk: true,
          pluginContractErrors: [],
          pluginContentSha256: sha256,
          pluginMcpConfigSha256: sha256,
          mcpContractVersion: "krw-ontology-mcp/v2",
          buildId: "build-1",
          backendGitSha: "backend-sha-1",
          toolSchemaSha256: sha256,
          buildFingerprintSha256: sha256,
          releaseManifestSha256: sha256,
          serviceFingerprintSha256: sha256,
          tools: [...ontologyTools],
        },
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const result = await getReadyAgentWorker(
      new Date("2026-05-27T00:01:00.000Z"),
    );

    expect(result).toMatchObject({
      ok: true,
      worker: { worker_id: "mac-worker-jwc-1" },
      mcpHealth: {
        connected: true,
        releaseId: "release-1",
        env: "dev",
        manifestValid: true,
        documentCount: 20,
        toolCount: 13,
        pluginPath: "/plugin",
      },
    });
    expect(fake.queries[0]).toMatchObject({
      table: "agent_worker_heartbeats",
      inFilters: { status: ["idle", "running"] },
      eqFilters: {
        worker_env: "dev",
        ontology_env: "dev",
        manifest_valid: true,
      },
      notFilters: {
        ontology_release_id: { operator: "is", value: null },
      },
    });
  });

  it("can restrict ready worker admission to a specific release id", async () => {
    const fake = createHeartbeatAdmin({
      readyWorker: {
        worker_id: "mac-worker-jwc-1",
        status: "idle",
        last_seen_at: "2026-05-27T00:00:00.000Z",
        heartbeat_expires_at: "2026-05-27T00:02:00.000Z",
        claude_code_version: "2.1.204 (Claude Code)",
        web_commit: "dev",
        krw_ontology_commit: "dev",
        worker_env: "dev",
        ontology_env: "dev",
        ontology_release_id: "release-1",
        index_generated_at: "2026-05-27T00:00:00.000Z",
        company_count: 10,
        document_count: 20,
        object_count: 30,
        tool_count: 13,
        root: "/data",
        index_path: "/data/indexes/global_spine.sqlite",
        manifest_path: "/data/manifest.json",
        manifest_valid: true,
        agent_index_schema_version: "agent_index_v1",
        plugin_path: "/plugin",
        error: null,
        metadata: {},
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await getReadyAgentWorker(
      new Date("2026-05-27T00:01:00.000Z"),
      "release-1",
    );

    expect(fake.queries[0].eqFilters).toMatchObject({
      worker_env: "dev",
      ontology_env: "dev",
      manifest_valid: true,
      ontology_release_id: "release-1",
    });
  });

  it("marks worker stopped with an expired heartbeat", async () => {
    const fake = createHeartbeatAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await markAgentWorkerStopped("mac-worker-jwc-1");

    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: "agent_worker_heartbeats",
        payload: expect.objectContaining({ status: "stopped" }),
        filters: { worker_id: "mac-worker-jwc-1" },
      }),
    ]);
  });
});
