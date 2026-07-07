import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

import { access, readFile } from "node:fs/promises";
import {
  checkMcpHealth,
  checkMcpReady,
  resolveGuruAdvisorPluginPath,
} from "@/lib/agent/mcp-client";

const MCP_CONFIG = {
  mcpServers: {
    "krw-ontology": {
      type: "http",
      url: "http://127.0.0.1:8765/mcp",
    },
  },
};

function readyPayload() {
  return {
    ok: true,
    env: "prod",
    release_id: "release-1",
    manifest_path: "/data/current/manifest.json",
    manifest_valid: true,
    global_spine_path: "/data/current/indexes/global_spine.sqlite",
    documents: 10,
    objects: 20,
    tools: ["krw_ontology_query_context"],
  };
}

describe("mcp-client readiness probes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KRW_ONTOLOGY_PLUGIN_PATH", "/plugins/krw-ontology");
    vi.stubEnv("KRW_ONTOLOGY_ROOT", "/data/current");
    vi.stubEnv("KRW_ONTOLOGY_MCP_URL", "http://127.0.0.1:8765/mcp");
    vi.stubEnv("KRW_ONTOLOGY_GLOBAL_SPINE_PATH", "/data/current/indexes/global_spine.sqlite");
    vi.stubEnv("MCP_HEALTH_TIMEOUT_MS", "30000");
    vi.stubEnv("KRW_ONTOLOGY_MCP_HEALTH_URL", undefined);
    vi.stubEnv("KRW_ONTOLOGY_MCP_READY_URL", undefined);
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(MCP_CONFIG));
  });

  it("checks /readyz for worker readiness", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(readyPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const health = await checkMcpReady();

    expect(health.connected).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/readyz", {
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    });
  });

  it("keeps /health for explicit health checks", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(readyPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const health = await checkMcpHealth();

    expect(health.connected).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/health", {
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    });
  });

  it("resolves the guru plugin from the materialized ontology plugin sibling", async () => {
    vi.stubEnv("KRW_GURU_ADVISOR_PLUGIN_PATH", undefined);
    vi.stubEnv("KRW_ONTOLOGY_PLUGIN_PATH", "/plugins/prod/krw-ontology");

    await expect(resolveGuruAdvisorPluginPath()).resolves.toBe(
      "/plugins/prod/krw-guru-advisor",
    );
  });
});
