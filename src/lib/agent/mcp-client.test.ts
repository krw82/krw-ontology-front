import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpSdk = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  close: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mcpSdk.connect;
    listTools = mcpSdk.listTools;
    close = mcpSdk.close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@/lib/agent/plugin-contract", () => ({
  verifyMaterializedOntologyPluginContract: vi.fn(async () => ({
    ok: true,
    contract: null,
    contentSha256: "b".repeat(64),
    mcpConfigSha256: "c".repeat(64),
    errors: [],
  })),
}));

import { access, readFile } from "node:fs/promises";
import { verifyMaterializedOntologyPluginContract } from "@/lib/agent/plugin-contract";
import {
  KRW_ONTOLOGY_MCP_CONTRACT_VERSION,
  KRW_ONTOLOGY_MCP_TOOLS,
  checkMcpHealth,
  checkMcpReady,
  isKrwFilingsMcpEnabled,
  isKrwFeedMcpEnabled,
  isKrwPersonalFilingsMcpEnabled,
  isKrwOntologySdkTool,
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
  const sha256 = "a".repeat(64);
  return {
    ok: true,
    env: "prod",
    release_id: "release-1",
    manifest_path: "/data/current/manifest.json",
    manifest_valid: true,
    global_spine_path: "/data/current/indexes/global_spine.sqlite",
    documents: 10,
    objects: 20,
    mcp_contract_version: KRW_ONTOLOGY_MCP_CONTRACT_VERSION,
    tool_count: Number(KRW_ONTOLOGY_MCP_TOOLS.length),
    tool_names: [...KRW_ONTOLOGY_MCP_TOOLS],
    tool_names_match: true,
    tool_schema_sha256: sha256,
    build_id: "build-1",
    backend_git_sha: "backend-sha-1",
    build_fingerprint_sha256: sha256,
    release_manifest_sha256: sha256,
    service_fingerprint_sha256: sha256,
  };
}

describe("mcp-client readiness probes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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
    mcpSdk.connect.mockResolvedValue(undefined);
    mcpSdk.listTools.mockResolvedValue({
      tools: KRW_ONTOLOGY_MCP_TOOLS.map((name) => ({ name })),
    });
    mcpSdk.close.mockResolvedValue(undefined);
    vi.mocked(verifyMaterializedOntologyPluginContract).mockResolvedValue({
      ok: true,
      contract: null,
      contentSha256: "b".repeat(64),
      mcpConfigSha256: "c".repeat(64),
      errors: [],
    });
  });

  it.each(["1", "true", "yes", "on"])(
    "keeps public and personal filings enablement in parity for %s",
    (enabled) => {
      const env = {
        FILINGS_MCP_ENABLED: enabled,
        FILINGS_MCP_AUTH_TOKEN: "service-secret",
        FILINGS_MCP_PERSONAL_SIGNING_SECRET: "personal-secret",
      };
      expect(isKrwFilingsMcpEnabled(env)).toBe(true);
      expect(isKrwPersonalFilingsMcpEnabled(env)).toBe(true);
    },
  );

  it("does not grant personal-memory delegation with only the public service token", () => {
    const env = {
      FILINGS_MCP_ENABLED: "1",
      FILINGS_MCP_AUTH_TOKEN: "service-secret",
    };
    expect(isKrwFilingsMcpEnabled(env)).toBe(true);
    expect(isKrwPersonalFilingsMcpEnabled(env)).toBe(false);
  });

  it.each(["1", "true", "yes", "on"])(
    "enables KRW Feed MCP with internal credentials for %s",
    (enabled) => {
      expect(isKrwFeedMcpEnabled({
        KRW_FEED_MCP_ENABLED: enabled,
        KRW_FEED_MCP_TOKEN: "feed-secret",
      })).toBe(true);
    },
  );

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

  it("fails readiness when the server tool set is not the exact v2 set", async () => {
    const payload = readyPayload();
    payload.tool_names = payload.tool_names.slice(0, -1);
    payload.tool_count = payload.tool_names.length;
    payload.tool_names_match = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const health = await checkMcpReady();

    expect(health.connected).toBe(false);
    expect(health.toolParityOk).toBe(false);
    expect(health.error).toContain("tool parity mismatch");
  });

  it("fails readiness when /readyz is healthy but /mcp cannot list the exact tools", async () => {
    mcpSdk.listTools.mockResolvedValue({
      tools: KRW_ONTOLOGY_MCP_TOOLS.slice(0, -1).map((name) => ({ name })),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(readyPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const health = await checkMcpReady();

    expect(health.connected).toBe(false);
    expect(health.error).toContain("/mcp tool parity mismatch");
    expect(mcpSdk.close).toHaveBeenCalledOnce();
  });

  it("rejects a duplicate tool name even when count and server parity flag match", async () => {
    const payload = readyPayload();
    payload.tool_names = [...payload.tool_names];
    payload.tool_names[payload.tool_names.length - 1] = payload.tool_names[0]!;
    payload.tool_count = payload.tool_names.length;
    payload.tool_names_match = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const health = await checkMcpReady();

    expect(health.connected).toBe(false);
    expect(health.toolParityOk).toBe(false);
    expect(health.error).toContain("tool parity mismatch");
  });

  it("fails readiness when an expected deployment fingerprint differs", async () => {
    vi.stubEnv("KRW_MCP_EXPECTED_BUILD_ID", "expected-build");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(readyPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const health = await checkMcpReady();

    expect(health.connected).toBe(false);
    expect(health.fingerprintOk).toBe(false);
    expect(health.error).toContain("KRW_MCP_EXPECTED_BUILD_ID");
  });

  it("fails readiness when materialized plugin content does not match its source binding", async () => {
    vi.mocked(verifyMaterializedOntologyPluginContract).mockResolvedValue({
      ok: false,
      contract: null,
      contentSha256: "b".repeat(64),
      mcpConfigSha256: "c".repeat(64),
      errors: ["source and materialized plugin content hashes differ"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(readyPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const health = await checkMcpReady();

    expect(health.connected).toBe(false);
    expect(health.pluginContractOk).toBe(false);
    expect(health.error).toContain("plugin contract mismatch");
  });

  it("accepts a missing backend git SHA when the build fingerprint is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ...readyPayload(),
            backend_git_sha: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const health = await checkMcpReady();

    expect(health.connected).toBe(true);
    expect(health.fingerprintOk).toBe(true);
    expect(health.backendGitSha).toBeNull();
  });

  it("rejects a missing backend git SHA when an expected SHA is pinned", async () => {
    vi.stubEnv("KRW_MCP_EXPECTED_BACKEND_GIT_SHA", "expected-backend-sha");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ...readyPayload(),
            backend_git_sha: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const health = await checkMcpReady();

    expect(health.connected).toBe(false);
    expect(health.fingerprintOk).toBe(false);
    expect(health.error).toContain("KRW_MCP_EXPECTED_BACKEND_GIT_SHA");
  });

  it("resolves the guru plugin from the materialized ontology plugin sibling", async () => {
    vi.stubEnv("KRW_GURU_ADVISOR_PLUGIN_PATH", undefined);
    vi.stubEnv("KRW_ONTOLOGY_PLUGIN_PATH", "/plugins/prod/krw-ontology");

    await expect(resolveGuruAdvisorPluginPath()).resolves.toBe(
      "/plugins/prod/krw-guru-advisor",
    );
  });

  it("recognizes only the strict direct ontology MCP prefix", () => {
    expect(
      isKrwOntologySdkTool(
        "mcp__plugin_krw-ontology_krw-ontology__krw_ontology_query_context",
      ),
    ).toBe(false);
    expect(
      isKrwOntologySdkTool(
        "mcp__krw-ontology__krw_ontology_query_context",
      ),
    ).toBe(true);
    expect(
      isKrwOntologySdkTool(
        "mcp__plugin_krw-guru-advisor_krw-ontology-company__krw_ontology_query_context",
      ),
    ).toBe(false);
    expect(
      isKrwOntologySdkTool(
        "mcp__plugin_krw-guru-advisor_krw-guru-advisor__krw_guru_query_context",
      ),
    ).toBe(false);
  });
});
