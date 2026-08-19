import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getReadyRustAgentDaemon } from "@/lib/agent/daemon-heartbeat";
import { APP_VERSION } from "@/lib/app-version";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GET } from "./route";

vi.mock("@/lib/agent/daemon-heartbeat", () => ({
  getReadyRustAgentDaemon: vi.fn(),
}));

vi.mock("@/lib/ontology/catalog", () => ({
  getActiveOntologyCatalogRelease: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

const ORIGINAL_INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function mockSupabaseOk() {
  const now = new Date().toISOString();
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            limit: async () => ({ error: null }),
          }),
        };
      }
      if (table === "filing_notification_worker_heartbeats") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: {
                    worker_id: "filing-worker-1",
                    last_seen_at: now,
                    last_success_at: now,
                    last_error: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "sec_filing_worker_leases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    worker_id: "filing-worker-1",
                    deployment_id: APP_VERSION,
                    heartbeat_at: now,
                    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected Supabase table: ${table}`);
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>);
}

function mockCatalogOk() {
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
}

function mockDaemonNotRequired() {
  vi.mocked(getReadyRustAgentDaemon).mockResolvedValue({
    ok: true,
    required: false,
    daemon: null,
  });
}

describe("GET /api/healthz/deep", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_KEY = "test-internal-key";
    vi.clearAllMocks();
    mockSupabaseOk();
    mockCatalogOk();
    mockDaemonNotRequired();
  });

  afterEach(() => {
    process.env.INTERNAL_API_KEY = ORIGINAL_INTERNAL_API_KEY;
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated requests before running deep checks", async () => {
    const response = await GET(new Request("http://localhost/api/healthz/deep"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Unauthorized" },
    });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(getReadyRustAgentDaemon).not.toHaveBeenCalled();
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
    expect(getReadyRustAgentDaemon).not.toHaveBeenCalled();
    expect(getActiveOntologyCatalogRelease).not.toHaveBeenCalled();
  });

  it("derives the mcp check from the rust daemon heartbeat even when it is not required", async () => {
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
    expect(body.checks.mcp).toEqual({
      ok: true,
      required: false,
      owner: "local_rust_agentd",
    });
    expect(body.checks.agent_v1_daemon).toEqual(
      expect.objectContaining({ ok: true, required: false, daemon_id: null }),
    );
    expect(body.checks.filing_worker.scheduler_leader.deployment_id).toBe(
      APP_VERSION,
    );
    expect(body.checks.trusted_client_ip.ok).toBe(true);
    expect(getSupabaseAdmin).toHaveBeenCalledTimes(2);
    expect(getActiveOntologyCatalogRelease).toHaveBeenCalledOnce();
    expect(getReadyRustAgentDaemon).toHaveBeenCalledOnce();
  });

  it("surfaces a ready required daemon as a healthy mcp check", async () => {
    const now = new Date();
    vi.mocked(getReadyRustAgentDaemon).mockResolvedValue({
      ok: true,
      required: true,
      daemon: {
        daemon_id: "rust-agentd-1",
        provider: "glm",
        descriptor_artifact_hash: `sha256:${"a".repeat(64)}`,
        release_set_hash: `sha256:${"b".repeat(64)}`,
        runtime_version: "krw-agentd 0.9.2",
        mcp_ready: true,
        last_seen_at: now.toISOString(),
        heartbeat_expires_at: new Date(now.getTime() + 60_000).toISOString(),
        created_at: "2026-05-21T00:00:00.000Z",
        updated_at: now.toISOString(),
      },
    });

    const response = await GET(
      new Request("http://localhost/api/healthz/deep", {
        headers: { "x-internal-key": "test-internal-key" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.mcp).toEqual({
      ok: true,
      required: true,
      owner: "local_rust_agentd",
    });
    expect(body.checks.agent_v1_daemon).toEqual(
      expect.objectContaining({
        ok: true,
        required: true,
        daemon_id: "rust-agentd-1",
        provider: "glm",
        mcp_ready: true,
      }),
    );
  });

  it("reports a missing daemon heartbeat as an unhealthy mcp check", async () => {
    vi.mocked(getReadyRustAgentDaemon).mockResolvedValue({
      ok: false,
      reason: "daemon_unavailable",
      message: "Local Rust research daemon is unavailable",
    });

    const response = await GET(
      new Request("http://localhost/api/healthz/deep", {
        headers: { "x-internal-key": "test-internal-key" },
      }),
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.checks.mcp).toEqual({
      ok: false,
      owner: "local_rust_agentd",
      error: "Local Rust research daemon is unavailable",
    });
  });

  it("reports an invalid production trusted client IP configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");

    const response = await GET(
      new Request("http://localhost/api/healthz/deep", {
        headers: { "x-internal-key": "test-internal-key" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.trusted_client_ip).toEqual({
      ok: false,
      error: "Trusted client IP configuration is invalid",
    });
  });
});
