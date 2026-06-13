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

describe("Desktop ontology MCP client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.transportUrls.length = 0;
    sdk.connect.mockResolvedValue(undefined);
    sdk.close.mockResolvedValue(undefined);
    delete process.env.KRW_ONTOLOGY_MCP_URL;
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
        tools: ["krw_ontology_query_context", "krw_ontology_query"],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkKrwOntologyMcpHealth()).resolves.toEqual({
      ok: true,
      releaseId: "release-1",
      indexGeneratedAt: "2026-06-10T00:00:00.000Z",
      toolNames: ["krw_ontology_query_context", "krw_ontology_query"],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/health", {
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    });
  });

  it("returns a safe not-ready health result when no MCP URL is configured", async () => {
    await expect(checkKrwOntologyMcpHealth()).resolves.toMatchObject({
      ok: false,
      releaseId: null,
      toolNames: [],
      error: "KRW_ONTOLOGY_MCP_URL is not configured",
    });
  });

  it("calls the configured MCP tool with JSON response format and closes the client", async () => {
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

  it("builds useful compact text from the real query_context response shape", () => {
    const parsed = parseDesktopOntologyMcpResult({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            research_status: "sufficient_but_trace_recommended",
            answerability: {
              recommended_answer_mode: "bounded_answer_with_caveats",
            },
            research_pack: {
              company_topic_pack: {
                top_candidates: [
                  {
                    ticker: "AAPL",
                    claim: "Greater China revenue declined year over year.",
                  },
                ],
              },
            },
            missing_parts: ["channel_inventory_confirmation"],
            recommended_tools: [
              {
                tool_name: "krw_ontology_trace",
                object_id: "claim:AAPL:china",
              },
            ],
          }),
        },
      ],
    });

    expect(parsed.resultText).toContain(
      "research_status: sufficient_but_trace_recommended",
    );
    expect(parsed.resultText).toContain(
      "answer_mode: bounded_answer_with_caveats",
    );
    expect(parsed.resultText).toContain(
      "Greater China revenue declined year over year.",
    );
    expect(parsed.resultText).toContain("channel_inventory_confirmation");
    expect(parsed.resultText).not.toBe("ticker candidates: 0");
  });
});
