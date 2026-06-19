import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ontology/catalog", () => ({
  getActiveOntologyCatalogRelease: vi.fn(),
  getIndexedCompanies: vi.fn(),
  getIndexedCompany: vi.fn(),
  searchIndexedCompanies: vi.fn(),
}));
vi.mock("./ontology-mcp-client", () => ({
  callKrwOntologyMcpTool: vi.fn(),
  checkKrwOntologyMcpHealth: vi.fn(),
  shouldUseDesktopOntologyMcp: vi.fn(),
}));

import {
  getActiveOntologyCatalogRelease,
  getIndexedCompanies,
  searchIndexedCompanies,
} from "@/lib/ontology/catalog";
import {
  callKrwOntologyMcpTool,
  checkKrwOntologyMcpHealth,
  shouldUseDesktopOntologyMcp,
} from "./ontology-mcp-client";
import {
  executeDesktopOntologyTool,
} from "./ontology-service";
import type { IndexedCompany } from "@/lib/ontology/catalog";
import type { DesktopOntologyServiceError } from "./ontology-service";

const company: IndexedCompany = {
  ticker: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  description: "Consumer technology company.",
  latest_period: "FY2025",
  coverage: "2개 공시 인덱싱 · 10-K, 10-Q · 최신 FY2025",
  core_strength: "Services",
  critical_risk: "China demand",
  icon: "hub",
  document_count: 2,
  document_types: ["10-K", "10-Q"],
  periods: ["FY2025", "CY2025Q3"],
  documents: [
    {
      period: "FY2025",
      document_type: "10-K",
      doc_type_key: "10K",
      generated_at: "2026-06-10T00:00:00.000Z",
    },
  ],
  generated_at: "2026-06-10T00:00:00.000Z",
};

const auth = {
  userId: "user-1",
  userEmail: "user@example.test",
  deviceId: "device-1",
  authMethod: "desktop_access_token" as const,
};

describe("Desktop ontology service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DESKTOP_ONTOLOGY_MAX_RESULT_BYTES;
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(false);
    vi.mocked(checkKrwOntologyMcpHealth).mockResolvedValue({
      ok: true,
      releaseId: "release-2026-06-10",
      indexGeneratedAt: "2026-06-10T00:00:00.000Z",
      toolNames: ["krw_ontology_query_context"],
    });
    vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue({
      env: "prod",
      release_id: "release-2026-06-10",
      active: true,
      format: "krw-ontology-web-catalog/v1",
      generated_at: "2026-06-10T00:00:00.000Z",
      release_created_at: "2026-06-10T00:00:00.000Z",
      index_generated_at: "2026-06-10T00:00:00.000Z",
      company_count: 1,
      document_count: 2,
      index_document_count: 2,
      object_count: 10,
      manifest_json: {},
      summary_json: {},
      source_json: {},
      catalog_json: {},
      created_at: "2026-06-10T00:00:00.000Z",
      updated_at: "2026-06-10T00:00:00.000Z",
    });
  });

  it("executes query_context through bounded catalog-backed evidence", async () => {
    vi.mocked(getIndexedCompanies).mockResolvedValue([company]);

    const response = await executeDesktopOntologyTool(
      {
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query_context",
        arguments: {
          question: "AAPL demand",
          tickers: ["AAPL"],
          limit_results: 3,
          response_detail: "compact",
        },
        desktop_context: {
          analysis_mode: "company",
        },
      },
      auth,
    );

    expect(getIndexedCompanies).toHaveBeenCalledWith(["AAPL"]);
    expect(searchIndexedCompanies).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: true,
      tool_call_id: "tool-1",
      tool_name: "krw_ontology_query_context",
      ontology_release: {
        release_id: "release-2026-06-10",
        api_version: "ontology-search/v1",
      },
      result_json: {
        local_session_id: "session-1",
        local_run_id: "run-1",
      },
    });
    expect(response.result_text).toContain("AAPL");
    expect(response.result_json.citations).toEqual([
      expect.objectContaining({
        ticker: "AAPL",
        document_type: "10-K",
        period: "FY2025",
      }),
    ]);
    expect(response.result_json.executor).toBe("catalog");
  });

  it("keeps searchable catalog calls on the catalog service when MCP is enabled", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(searchIndexedCompanies).mockResolvedValue([company]);

    const response = await executeDesktopOntologyTool(
      {
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "catalog-1",
        tool_name: "krw_ontology_catalog",
        arguments: {
          query: "Apple",
          limit: 10,
        },
        desktop_context: {},
      },
      auth,
    );

    expect(searchIndexedCompanies).toHaveBeenCalledWith({
      query: "Apple",
      limit: 10,
    });
    expect(callKrwOntologyMcpTool).not.toHaveBeenCalled();
    expect(checkKrwOntologyMcpHealth).not.toHaveBeenCalled();
    expect(response.result_json.executor).toBe("catalog");
  });

  it("executes query_context through the configured ontology MCP service", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(callKrwOntologyMcpTool).mockResolvedValue({
      resultText: "MCP evidence summary",
      resultJson: {
        research_status: "sufficient_for_default_answer",
        ticker_candidates: [
          {
            ticker: "AAPL",
            document_type: "10-K",
            period: "FY2025",
            id: "claim:AAPL:FY2025:10K:demand",
            summary: "Demand evidence",
          },
        ],
      },
    });

    const response = await executeDesktopOntologyTool(
      {
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query_context",
        arguments: {
          question: "AAPL demand",
          tickers: ["AAPL"],
          limit_results: 3,
          response_detail: "compact",
        },
        desktop_context: {},
      },
      auth,
    );

    expect(callKrwOntologyMcpTool).toHaveBeenCalledWith(
      "krw_ontology_query_context",
      {
        question: "AAPL demand",
        tickers: ["AAPL"],
        limit_results: 3,
      },
    );
    expect(getIndexedCompanies).not.toHaveBeenCalled();
    expect(response.result_text).toBe("MCP evidence summary");
    expect(response.result_json).toMatchObject({
      executor: "mcp",
      research_status: "sufficient_for_default_answer",
      citations: [
        {
          ticker: "AAPL",
          document_type: "10-K",
          period: "FY2025",
          trace_json: {
            object_id: "claim:AAPL:FY2025:10K:demand",
          },
        },
      ],
    });
    expect(checkKrwOntologyMcpHealth).toHaveBeenCalledOnce();
  });

  it("maps Desktop trace and compare arguments to the actual MCP schema", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(callKrwOntologyMcpTool).mockResolvedValue({
      resultText: "result",
      resultJson: { summary: "result" },
    });

    await executeDesktopOntologyTool(
      {
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "trace-1",
        tool_name: "krw_ontology_trace",
        arguments: {
          root_id: "claim:AAPL:FY2025:10K:demand",
          depth: 2,
        },
        desktop_context: {},
      },
      auth,
    );
    await executeDesktopOntologyTool(
      {
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "compare-1",
        tool_name: "krw_ontology_compare",
        arguments: {
          tickers: ["AAPL", "MSFT"],
          question: "AI capex",
          limit_per_ticker: 2,
        },
        desktop_context: {},
      },
      auth,
    );

    expect(callKrwOntologyMcpTool).toHaveBeenNthCalledWith(
      1,
      "krw_ontology_trace",
      {
        object_id: "claim:AAPL:FY2025:10K:demand",
      },
    );
    expect(callKrwOntologyMcpTool).toHaveBeenNthCalledWith(
      2,
      "krw_ontology_compare",
      {
        tickers: ["AAPL", "MSFT"],
        topic: "AI capex",
        limit_per_ticker: 2,
        response_detail: "compact",
      },
    );
  });

  it("fails retryably when the configured MCP service is unavailable", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(checkKrwOntologyMcpHealth).mockResolvedValue({
      ok: false,
      releaseId: null,
      indexGeneratedAt: null,
      toolNames: [],
      error: "connection refused",
    });

    await expect(
      executeDesktopOntologyTool(
        {
          local_session_id: "session-1",
          local_run_id: "run-1",
          tool_call_id: "tool-1",
          tool_name: "krw_ontology_query_context",
          arguments: {
            question: "AAPL demand",
            limit_results: 3,
            response_detail: "compact",
          },
          desktop_context: {},
        },
        auth,
      ),
    ).rejects.toMatchObject({
      code: "ontology_unavailable",
      status: 503,
      retryable: true,
    });
    expect(searchIndexedCompanies).not.toHaveBeenCalled();
    expect(callKrwOntologyMcpTool).not.toHaveBeenCalled();
  });

  it("rejects MCP execution when the active releases disagree", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(checkKrwOntologyMcpHealth).mockResolvedValue({
      ok: true,
      releaseId: "different-release",
      indexGeneratedAt: "2026-06-09T00:00:00.000Z",
      toolNames: ["krw_ontology_query_context"],
    });

    await expect(
      executeDesktopOntologyTool(
        {
          local_session_id: "session-1",
          local_run_id: "run-1",
          tool_call_id: "tool-1",
          tool_name: "krw_ontology_query_context",
          arguments: {
            question: "AAPL demand",
            limit_results: 3,
            response_detail: "compact",
          },
          desktop_context: {},
        },
        auth,
      ),
    ).rejects.toMatchObject({
      code: "ontology_unavailable",
      status: 503,
      retryable: true,
    });
    expect(callKrwOntologyMcpTool).not.toHaveBeenCalled();
  });

  it("maps MCP tool-call failures to retryable service errors", async () => {
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(callKrwOntologyMcpTool).mockRejectedValue(
      new Error("tool connection closed"),
    );

    await expect(
      executeDesktopOntologyTool(
        {
          local_session_id: "session-1",
          local_run_id: "run-1",
          tool_call_id: "tool-1",
          tool_name: "krw_ontology_query",
          arguments: {
            topic: "AAPL demand",
            limit: 3,
            response_detail: "compact",
          },
          desktop_context: {},
        },
        auth,
      ),
    ).rejects.toMatchObject({
      code: "ontology_unavailable",
      status: 503,
      retryable: true,
    });
  });

  it("rejects oversized MCP results instead of forwarding bulk data", async () => {
    process.env.DESKTOP_ONTOLOGY_MAX_RESULT_BYTES = "1000";
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(callKrwOntologyMcpTool).mockResolvedValue({
      resultText: "large result",
      resultJson: {
        results: [{ text: "x".repeat(2_000) }],
      },
    });

    await expect(
      executeDesktopOntologyTool(
        {
          local_session_id: "session-1",
          local_run_id: "run-1",
          tool_call_id: "tool-1",
          tool_name: "krw_ontology_query",
          arguments: {
            topic: "AAPL demand",
            limit: 3,
            response_detail: "compact",
          },
          desktop_context: {},
        },
        auth,
      ),
    ).rejects.toMatchObject({
      code: "result_too_large",
      status: 413,
      retryable: false,
    });
  });

  it("applies the result-size limit after citations and Desktop metadata are added", async () => {
    process.env.DESKTOP_ONTOLOGY_MAX_RESULT_BYTES = "1000";
    vi.mocked(shouldUseDesktopOntologyMcp).mockReturnValue(true);
    vi.mocked(callKrwOntologyMcpTool).mockResolvedValue({
      resultText: "bounded result",
      resultJson: {
        summary: "x".repeat(850),
        results: [
          {
            ticker: "AAPL",
            document_type: "10-K",
            period: "FY2025",
            id: "claim:AAPL:FY2025:10K:demand",
          },
        ],
      },
    });

    await expect(
      executeDesktopOntologyTool(
        {
          local_session_id: "session-with-long-identifier",
          local_run_id: "run-with-long-identifier",
          tool_call_id: "tool-1",
          tool_name: "krw_ontology_query",
          arguments: {
            topic: "AAPL demand",
            limit: 3,
            response_detail: "compact",
          },
          desktop_context: {},
        },
        auth,
      ),
    ).rejects.toMatchObject({
      code: "result_too_large",
      status: 413,
    });
  });

  it("fails retryably when no active ontology release exists", async () => {
    vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue(null);

    await expect(
      executeDesktopOntologyTool(
        {
          local_session_id: "session-1",
          local_run_id: "run-1",
          tool_call_id: "tool-1",
          tool_name: "krw_ontology_catalog",
          arguments: {
            limit: 10,
          },
          desktop_context: {},
        },
        auth,
      ),
    ).rejects.toMatchObject({
      name: "DesktopOntologyServiceError",
      code: "ontology_unavailable",
      retryable: true,
    } satisfies Partial<DesktopOntologyServiceError>);
  });
});
