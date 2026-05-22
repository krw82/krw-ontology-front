import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GET } from "./route";

vi.mock("@/lib/agent/mcp-client", () => ({
  checkMcpHealth: vi.fn(),
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
  vi.mocked(checkMcpHealth).mockResolvedValue({
    connected: true,
    staticOk: true,
    commandOk: true,
    liveOk: true,
    sqliteOk: true,
    releaseId: "rel-20260521",
    indexGeneratedAt: "2026-05-21T00:00:00.000Z",
    companyCount: 10,
    documentCount: 20,
    objectCount: 30,
    toolCount: 12,
    tools: ["krw_ontology_query"],
    root: "/srv/private-ontology-root",
    indexPath: "/srv/private-ontology-root/indexes/agent_index.sqlite",
    pluginPath: "/app/krw-ontology/plugins/krw-ontology",
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
    expect(checkMcpHealth).not.toHaveBeenCalled();
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
    expect(checkMcpHealth).not.toHaveBeenCalled();
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
    expect(body.checks.mcp.root).toBe("/srv/private-ontology-root");
    expect(body.checks.mcp.release_id).toBe("rel-20260521");
    expect(body.checks.mcp.live_ok).toBe(true);
    expect(body.checks.mcp.sqlite_ok).toBe(true);
    expect(body.checks.mcp.tool_count).toBe(12);
    expect(getSupabaseAdmin).toHaveBeenCalledOnce();
    expect(checkMcpHealth).toHaveBeenCalledOnce();
  });
});
