import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getReadyAgentWorker } from "@/lib/agent/worker-heartbeat";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GET } from "./route";

vi.mock("@/lib/agent/worker-heartbeat", () => ({
  getReadyAgentWorker: vi.fn(),
}));

vi.mock("@/lib/ontology/catalog", () => ({
  getActiveOntologyCatalogRelease: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

const ORIGINAL_INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function mockSupabaseOk() {
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: () => ({
      select: () => ({
        limit: async () => ({ error: null }),
      }),
    }),
  } as unknown as ReturnType<typeof getSupabaseAdmin>);
}

function mockMcpOk() {
  vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue({
    env: "dev",
    release_id: "rel-20260521",
    active: true,
    format: "krw-ontology-web-catalog/v1",
    generated_at: "2026-05-21T00:00:00.000Z",
    release_created_at: "2026-05-21T00:00:00.000Z",
    index_generated_at: "2026-05-21T00:00:00.000Z",
    company_count: 10,
    document_count: 20,
    index_document_count: 20,
    object_count: 30,
    manifest_json: null,
    summary_json: {},
    source_json: null,
    catalog_json: {},
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
  });
  vi.mocked(getReadyAgentWorker).mockResolvedValue({
    ok: true,
    worker: {
      worker_id: "mac-worker-1",
      status: "idle",
      last_seen_at: "2026-05-21T00:00:10.000Z",
      heartbeat_expires_at: "2026-05-21T00:02:10.000Z",
      claude_code_version: "2.1.141",
      web_commit: "web-commit",
      krw_ontology_commit: "ontology-commit",
      worker_env: "dev",
      ontology_env: "dev",
      ontology_release_id: "rel-20260521",
      index_generated_at: "2026-05-21T00:00:00.000Z",
      company_count: 10,
      document_count: 20,
      object_count: 30,
      tool_count: 12,
      root: "/srv/private-ontology-root",
      index_path: "/srv/private-ontology-root/indexes/global_spine.sqlite",
      manifest_path: "/srv/private-ontology-root/manifest.json",
      manifest_valid: true,
      agent_index_schema_version: "agent_index_v1",
      plugin_path: "/app/krw-ontology/plugins/krw-ontology",
      error: null,
      metadata: {},
      created_at: "2026-05-21T00:00:00.000Z",
      updated_at: "2026-05-21T00:00:10.000Z",
    },
    mcpHealth: {
      connected: true,
      staticOk: true,
      commandOk: true,
      liveOk: true,
      sqliteOk: true,
      env: "dev",
      releaseId: "rel-20260521",
      manifestPath: "/srv/private-ontology-root/manifest.json",
      manifestValid: true,
      agentIndexSchemaVersion: "agent_index_v1",
      indexGeneratedAt: "2026-05-21T00:00:00.000Z",
      companyCount: 10,
      documentCount: 20,
      objectCount: 30,
      toolCount: 12,
      tools: ["krw_ontology_query"],
      root: "/srv/private-ontology-root",
      indexPath: "/srv/private-ontology-root/indexes/global_spine.sqlite",
      pluginPath: "/app/krw-ontology/plugins/krw-ontology",
      releaseMetadata: {
        env: "dev",
        release_id: "rel-20260521",
        manifest_valid: true,
      },
    },
  });
}

describe("GET /api/healthz/deep", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_KEY = "test-internal-key";
    vi.clearAllMocks();
    mockSupabaseOk();
    mockMcpOk();
  });

  afterEach(() => {
    process.env.INTERNAL_API_KEY = ORIGINAL_INTERNAL_API_KEY;
  });

  it("rejects unauthenticated requests before running deep checks", async () => {
    const response = await GET(new Request("http://localhost/api/healthz/deep"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Unauthorized" },
    });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(getReadyAgentWorker).not.toHaveBeenCalled();
    expect(getActiveOntologyCatalogRelease).not.toHaveBeenCalled();
  });

  it("rejects requests when the internal API key is not configured", async () => {
    delete process.env.INTERNAL_API_KEY;

    const response = await GET(
      new Request("http://localhost/api/healthz/deep", {
        headers: { "x-internal-key": "test-internal-key" },
      }),
    );

    expect(response.status).toBe(403);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(getReadyAgentWorker).not.toHaveBeenCalled();
    expect(getActiveOntologyCatalogRelease).not.toHaveBeenCalled();
  });

  it("returns deep diagnostics only with the internal key", async () => {
    const response = await GET(
      new Request("http://localhost/api/healthz/deep", {
        headers: { "x-internal-key": "test-internal-key" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.catalog.release_id).toBe("rel-20260521");
    expect(body.checks.catalog.company_count).toBe(10);
    expect(body.checks.mcp.root).toBe("/srv/private-ontology-root");
    expect(body.checks.mcp.env).toBe("dev");
    expect(body.checks.mcp.release_id).toBe("rel-20260521");
    expect(body.checks.mcp.manifest_valid).toBe(true);
    expect(body.checks.mcp.live_ok).toBe(true);
    expect(body.checks.mcp.sqlite_ok).toBe(true);
    expect(body.checks.mcp.tool_count).toBe(12);
    expect(body.checks.mcp.worker_id).toBe("mac-worker-1");
    expect(getSupabaseAdmin).toHaveBeenCalledOnce();
    expect(getActiveOntologyCatalogRelease).toHaveBeenCalledOnce();
    expect(getReadyAgentWorker).toHaveBeenCalledOnce();
  });
});
