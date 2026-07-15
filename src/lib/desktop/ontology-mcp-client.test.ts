import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  transportUrls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = sdk.connect;
    callTool = sdk.callTool;
    close = sdk.close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL) {
      sdk.transportUrls.push(url.toString());
    }
  },
}));

import {
  callKrwOntologyMcpTool,
  checkKrwOntologyMcpHealth,
  getDesktopOntologyExecutorMode,
  getKrwOntologyMcpUrl,
  parseDesktopOntologyMcpResult,
  shouldUseDesktopOntologyMcp,
} from "./ontology-mcp-client";
import {
  KRW_ONTOLOGY_MCP_CONTRACT_VERSION,
  KRW_ONTOLOGY_MCP_TOOLS,
} from "@/lib/agent/mcp-client";

function searchPlan() {
  return {
    question: "AAPL demand",
    intent: "company_demand",
    clauses: [
      {
        clause_id: "demand",
        retrieval_query: "AAPL demand",
        required_concepts: ["demand"],
        required: true,
        directness: "direct_preferred",
        object_types: [],
        metrics: [],
        metric_dimensions: [],
        metric_scope: "company_total",
      },
    ],
    tickers: ["AAPL"],
    document_types: [],
    periods: [],
    universe: null,
    comparison_axes: [],
    answer_scope: "direct",
    uncertainty: "low",
    limit_results: 12,
    limit_tickers: 20,
  };
}

function researchState() {
  return {
    contract_version: "research-state/v2",
    release_id: "release-1",
    plan: searchPlan(),
    resolved_scope: {
      requested_tickers: ["AAPL"],
      resolved_tickers: ["AAPL"],
    },
    source_anchors: [],
    answerability: {
      status: "answerable",
      strong_claim_allowed: true,
    },
    clause_coverage: [],
    evidence_units: [],
    computed_values: [],
    calculation_coverage: [],
    missing_parts: [],
    recommended_actions: [],
    continuation: null,
    warnings: [],
  };
}

describe("Desktop ontology MCP client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.transportUrls.length = 0;
    sdk.connect.mockResolvedValue(undefined);
    sdk.close.mockResolvedValue(undefined);
    delete process.env.KRW_ONTOLOGY_MCP_URL;
    delete process.env.KRW_ONTOLOGY_MCP_READY_URL;
    delete process.env.DESKTOP_ONTOLOGY_EXECUTOR;
    delete process.env.DESKTOP_ONTOLOGY_MCP_CONNECT_TIMEOUT_MS;
    delete process.env.DESKTOP_ONTOLOGY_MCP_TOOL_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses catalog fallback in auto mode unless an MCP URL is configured", () => {
    expect(getDesktopOntologyExecutorMode()).toBe("auto");
    expect(getKrwOntologyMcpUrl()).toBeNull();
    expect(shouldUseDesktopOntologyMcp()).toBe(false);

    process.env.KRW_ONTOLOGY_MCP_URL = "http://127.0.0.1:8765/mcp";

    expect(getKrwOntologyMcpUrl()).toBe("http://127.0.0.1:8765/mcp");
    expect(shouldUseDesktopOntologyMcp()).toBe(true);
  });

  it("honors explicit MCP and catalog executor modes", () => {
    process.env.DESKTOP_ONTOLOGY_EXECUTOR = "mcp";
    expect(shouldUseDesktopOntologyMcp()).toBe(true);

    process.env.KRW_ONTOLOGY_MCP_URL = "http://127.0.0.1:8765/mcp";
    process.env.DESKTOP_ONTOLOGY_EXECUTOR = "catalog";
    expect(shouldUseDesktopOntologyMcp()).toBe(false);
  });

  it("checks the configured MCP health endpoint and returns release metadata", async () => {
    process.env.KRW_ONTOLOGY_MCP_URL =
      "http://127.0.0.1:8765/custom/mcp?ignored=1";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        release_id: "release-1",
        index_generated_at: "2026-06-10T00:00:00.000Z",
        mcp_contract_version: KRW_ONTOLOGY_MCP_CONTRACT_VERSION,
        tool_names: KRW_ONTOLOGY_MCP_TOOLS,
        tool_count: KRW_ONTOLOGY_MCP_TOOLS.length,
        tool_names_match: true,
        tool_schema_sha256: "a".repeat(64),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkKrwOntologyMcpHealth()).resolves.toEqual({
      ok: true,
      releaseId: "release-1",
      indexGeneratedAt: "2026-06-10T00:00:00.000Z",
      toolNames: [...KRW_ONTOLOGY_MCP_TOOLS],
      mcpContractVersion: KRW_ONTOLOGY_MCP_CONTRACT_VERSION,
      toolSchemaSha256: "a".repeat(64),
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/readyz", {
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    });
  });

  it("returns a safe not-ready health result when no MCP URL is configured", async () => {
    await expect(checkKrwOntologyMcpHealth()).resolves.toMatchObject({
      ok: false,
      releaseId: null,
      toolNames: [],
      mcpContractVersion: null,
      toolSchemaSha256: null,
      error: "KRW_ONTOLOGY_MCP_URL is not configured",
    });
  });

  it("calls non-v2 tools with JSON response format and closes the client", async () => {
    process.env.KRW_ONTOLOGY_MCP_URL = "http://127.0.0.1:8765/mcp";
    sdk.callTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "Evidence summary",
            results: [{ ticker: "AAPL" }],
          }),
        },
      ],
    });

    const result = await callKrwOntologyMcpTool("krw_ontology_query", {
      topic: "AAPL demand",
      limit: 3,
    });

    expect(sdk.transportUrls).toEqual(["http://127.0.0.1:8765/mcp"]);
    expect(sdk.connect).toHaveBeenCalledOnce();
    expect(sdk.callTool).toHaveBeenCalledWith(
      {
        name: "krw_ontology_query",
        arguments: {
          topic: "AAPL demand",
          limit: 3,
          response_format: "json",
        },
      },
      undefined,
      {
        timeout: 30_000,
        maxTotalTimeout: 30_000,
      },
    );
    expect(result).toEqual({
      resultJson: {
        summary: "Evidence summary",
        results: [{ ticker: "AAPL" }],
      },
      resultText: "Evidence summary",
    });
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("passes query_context SearchPlan v2 without an unsupported response_format", async () => {
    process.env.KRW_ONTOLOGY_MCP_URL = "http://127.0.0.1:8765/mcp";
    sdk.callTool.mockResolvedValue({
      structuredContent: researchState(),
      content: [{ type: "text", text: JSON.stringify(researchState()) }],
    });
    const plan = searchPlan();

    const result = await callKrwOntologyMcpTool(
      "krw_ontology_query_context",
      { search_plan: plan },
    );

    expect(sdk.callTool).toHaveBeenCalledWith(
      {
        name: "krw_ontology_query_context",
        arguments: { search_plan: plan },
      },
      undefined,
      expect.any(Object),
    );
    expect(result.resultJson).toMatchObject({
      contract_version: "research-state/v2",
      plan: { intent: "company_demand" },
    });
    expect(result.resultText).toContain("answerability: answerable");
  });

  it("closes the MCP client when a tool call fails", async () => {
    process.env.KRW_ONTOLOGY_MCP_URL = "http://127.0.0.1:8765/mcp";
    sdk.callTool.mockRejectedValue(new Error("MCP failed"));

    await expect(
      callKrwOntologyMcpTool("krw_ontology_query_context", {
        question: "AAPL demand",
      }),
    ).rejects.toThrow("MCP failed");
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("parses structured MCP content and plain text fallbacks", () => {
    expect(
      parseDesktopOntologyMcpResult({
        structuredContent: {
          result: {
            summary: "Structured evidence",
          },
        },
        content: [{ type: "text", text: "Tool-facing summary" }],
      }),
    ).toEqual({
      resultJson: {
        summary: "Structured evidence",
      },
      resultText: "Tool-facing summary",
    });

    expect(
      parseDesktopOntologyMcpResult({
        content: [{ type: "text", text: "Plain response" }],
      }),
    ).toEqual({
      resultJson: {
        text: "Plain response",
      },
      resultText: "Plain response",
    });
  });

  it("builds useful compact text from ResearchState v2", () => {
    const parsed = parseDesktopOntologyMcpResult({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...researchState(),
            missing_parts: [
              { code: "missing_direct_evidence", detail: "channel inventory" },
            ],
          }),
        },
      ],
    });

    expect(parsed.resultJson).toMatchObject({
      contract_version: "research-state/v2",
      answerability: { status: "answerable" },
    });
  });
});
