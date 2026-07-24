import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type {
  AnalysisMode,
  MCPToolName,
  RunKind,
  StockNewsMCPToolName,
  YahooFinanceMCPToolName,
} from "@/types/api-contracts";

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
  createSdkMcpServer: vi.fn((options: { name: string }) => ({
    type: "sdk",
    name: options.name,
    instance: {},
  })),
  tool: vi.fn(
    (
      name: string,
      description: string,
      inputSchema: Record<string, unknown>,
      handler: unknown,
      extras?: Record<string, unknown>,
    ) => ({ name, description, inputSchema, handler, ...extras }),
  ),
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdkMocks);
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompanies: vi.fn().mockResolvedValue([]),
  buildGuruLightCompanyContext: vi.fn(
    (company: { ticker: string; name: string }) => ({
      format: "krw-guru-light-company-context/v1",
      ticker: company.ticker,
      companyName: company.name,
      businessDescription: company.name,
      primaryActivities: [],
      productsOrSegments: [],
      contextAnchors: [
        {
          anchorId: "business_description",
          kind: "business_description",
          text: company.name,
        },
      ],
      filingAvailability: {
        hasCurrentFiling: false,
        hasAnnualBaseline: false,
      },
    }),
  ),
}));
vi.mock("./mcp-client", () => {
  const tools = [
    "krw_ontology_query_context",
    "krw_ontology_query",
    "krw_ontology_trace",
    "krw_ontology_verify_evidence",
    "krw_ontology_chain",
    "krw_ontology_compare",
    "krw_ontology_retrieve",
    "krw_ontology_catalog",
    "krw_ontology_company_context",
    "krw_ontology_index_context",
    "krw_ontology_topic_map",
    "krw_ontology_quality",
    "krw_ontology_plan_query",
  ];
  const stockNewsTools = [
    "route_news_question",
    "resolve_news_entities",
    "search_company_news_events",
    "search_market_news_events",
    "search_news_by_domain",
    "read_news_sources",
    "build_news_timeline",
    "audit_news_sources",
  ];
  const visualizationTools = ["compose_visualization"];
  const yahooFinanceTools = ["get_yahoo_finance_news", "get_stock_info"];
  const filingsTools = [
    "get_filing",
    "get_filing_brief",
    "search_catalog_filings",
    "list_filing_sections",
    "read_filing_section",
    "list_filing_documents",
    "read_filing_document",
    "get_form4_insider_transactions",
  ];
  const personalFilingsTools = [
    "get_coverage_state",
    "list_filing_judgments",
    "get_decision_timeline",
    "list_open_questions",
  ];
  const guruTools = [
    "krw_guru_status",
    "krw_guru_search",
    "krw_guru_query_context",
    "krw_guru_select_lenses",
    "krw_guru_context",
    "krw_guru_trace",
    "krw_guru_chain",
    "krw_guru_evidence",
    "krw_guru_data_needs",
    "krw_guru_eval_questions",
    "krw_guru_company_brief",
    "krw_guru_company_pack",
    "krw_guru_review_company_evidence",
  ];
  return {
    KRW_ONTOLOGY_MCP_TOOLS: tools,
    STOCK_NEWS_MCP_TOOLS: stockNewsTools,
    YAHOO_FINANCE_MCP_TOOLS: yahooFinanceTools,
    VISUALIZATION_MCP_TOOLS: visualizationTools,
    KRW_FILINGS_MCP_TOOLS: filingsTools,
    KRW_PERSONAL_FILINGS_MCP_TOOLS: personalFilingsTools,
    GURU_MCP_TOOLS: guruTools,
    KRW_ONTOLOGY_SDK_ALLOWED_TOOLS: tools.map(
      (toolName) => `mcp__krw-ontology__${toolName}`,
    ),
    KRW_ONTOLOGY_DIRECT_SDK_ALLOWED_TOOLS: tools.map(
      (toolName) => `mcp__krw-ontology__${toolName}`,
    ),
    STOCK_NEWS_SDK_ALLOWED_TOOLS: stockNewsTools.map(
      (toolName) => `mcp__stock-news__${toolName}`,
    ),
    YAHOO_FINANCE_SDK_ALLOWED_TOOLS: yahooFinanceTools.map(
      (toolName) => `mcp__yahoo_finance__${toolName}`,
    ),
    VISUALIZATION_SDK_ALLOWED_TOOLS: visualizationTools.map(
      (toolName) => `mcp__krw_presentation__${toolName}`,
    ),
    KRW_FILINGS_SDK_ALLOWED_TOOLS: filingsTools.map(
      (toolName) => `mcp__krw-filings__${toolName}`,
    ),
    KRW_PERSONAL_FILINGS_SDK_ALLOWED_TOOLS: personalFilingsTools.map(
      (toolName) => `mcp__krw-filings__${toolName}`,
    ),
    GURU_ADVISOR_SDK_ALLOWED_TOOLS: guruTools.map(
      (toolName) =>
        `mcp__plugin_krw-guru-advisor_krw-guru-advisor__${toolName}`,
    ),
    getKrwOntologyPluginPath: () => "/tmp/krw-ontology-plugin",
    resolveGuruAdvisorPluginPath: () => "/tmp/krw-guru-advisor-plugin",
    getStockNewsSdkAllowedTools: () =>
      process.env.STOCK_NEWS_ENABLED === "1" &&
      process.env.STOCK_NEWS_FORCE_DISABLED !== "1"
        ? stockNewsTools.map((toolName) => `mcp__stock-news__${toolName}`)
        : [],
    isKrwOntologySdkTool: (toolName: string) =>
      toolName.startsWith("mcp__krw-ontology__krw_ontology_"),
    isStockNewsEnabled: () =>
      process.env.STOCK_NEWS_ENABLED === "1" &&
      process.env.STOCK_NEWS_FORCE_DISABLED !== "1",
    isStockNewsSdkTool: (toolName: string) =>
      toolName.startsWith("mcp__stock-news__"),
    isGuruAdvisorSdkTool: (toolName: string) =>
      toolName.startsWith("mcp__plugin_krw-guru-advisor_krw-guru-advisor__"),
    isYahooFinanceSdkTool: (toolName: string) =>
      toolName.startsWith("mcp__yahoo_finance__"),
    isVisualizationSdkTool: (toolName: string) =>
      toolName.startsWith("mcp__krw_presentation__"),
    isKrwFilingsMcpEnabled: () =>
      process.env.FILINGS_MCP_ENABLED === "1" &&
      Boolean(process.env.FILINGS_MCP_AUTH_TOKEN),
    isKrwPersonalFilingsMcpEnabled: () =>
      process.env.FILINGS_MCP_ENABLED === "1" &&
      Boolean(process.env.FILINGS_MCP_AUTH_TOKEN) &&
      Boolean(process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET),
    isKrwFilingsSdkTool: (toolName: string) =>
      filingsTools.some(
        (candidate) => toolName === `mcp__krw-filings__${candidate}`,
      ),
    isKrwPersonalFilingsSdkTool: (toolName: string) =>
      personalFilingsTools.some(
        (candidate) => toolName === `mcp__krw-filings__${candidate}`,
      ),
    filingsMcpToken: () => process.env.FILINGS_MCP_AUTH_TOKEN ?? null,
  };
});

import {
  buildResearchModePrompt,
  getAllowedMcpToolsForResearchMode,
  getResearchModeToolBudget,
  type ResearchMode,
} from "@/lib/research-mode";
import { getIndexedCompanies } from "@/lib/ontology/catalog";
import { canUseTool, runAgent } from "./runner";

function makeSdkQuery(messages: unknown[]) {
  const sdkQuery = {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
    },
    initializationResult: vi.fn().mockResolvedValue({
      slashCommands: [],
      mcpServerStatus: [],
      settingSources: ["project"],
      tools: [],
    }),
    supportedModels: vi.fn().mockResolvedValue(["claude-sonnet-4-6"]),
    supportedCommands: vi.fn().mockResolvedValue([]),
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    getContextUsage: vi.fn().mockResolvedValue({
      categories: [],
      totalTokens: 0,
      maxTokens: 0,
      rawMaxTokens: 0,
      percentage: 0,
      gridRows: [],
      model: "test-model",
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: null,
    }),
  };
  return sdkQuery;
}

function makeSdkQueryFromGenerator(generator: () => AsyncGenerator<unknown>) {
  const sdkQuery = {
    [Symbol.asyncIterator]: generator,
    initializationResult: vi.fn().mockResolvedValue({
      slashCommands: [],
      mcpServerStatus: [],
      settingSources: ["project"],
      tools: [],
    }),
    supportedModels: vi.fn().mockResolvedValue(["claude-sonnet-4-6"]),
    supportedCommands: vi.fn().mockResolvedValue([]),
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    getContextUsage: vi.fn().mockResolvedValue({
      categories: [],
      totalTokens: 0,
      maxTokens: 0,
      rawMaxTokens: 0,
      percentage: 0,
      gridRows: [],
      model: "test-model",
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: null,
    }),
  };
  return sdkQuery;
}

function sdkToolName(toolName: MCPToolName): string {
  if (isStockNewsToolName(toolName)) return stockNewsSdkToolName(toolName);
  if (isYahooFinanceToolName(toolName))
    return yahooFinanceSdkToolName(toolName);
  if (isPublicFilingsToolName(toolName)) {
    return `mcp__krw-filings__${toolName}`;
  }
  return `mcp__krw-ontology__${toolName}`;
}

function toolsForSystemInit(): string[] {
  return getAllowedMcpToolsForResearchMode("deep").map((toolName) =>
    sdkToolName(toolName),
  );
}

function stockNewsSdkToolName(toolName: StockNewsMCPToolName): string {
  return `mcp__stock-news__${toolName}`;
}

function yahooFinanceSdkToolName(toolName: YahooFinanceMCPToolName): string {
  return `mcp__yahoo_finance__${toolName}`;
}

function guruSdkToolName(toolName: string): string {
  return `mcp__plugin_krw-guru-advisor_krw-guru-advisor__${toolName}`;
}

function directOntologySdkToolName(toolName: string): string {
  return `mcp__krw-ontology__${toolName}`;
}

function ontologySearchPlanInput(options: {
  question: string;
  ticker?: string;
}): Record<string, unknown> {
  const ticker = options.ticker?.toUpperCase();
  return {
    search_plan: {
      question: options.question,
      intent: "filing_research",
      clauses: [
        {
          clause_id: "filing_evidence",
          retrieval_query: ticker
            ? `${ticker} filing evidence`
            : "covered company filing evidence",
          required_concepts: ["filing evidence"],
        },
      ],
      tickers: ticker ? [ticker] : [],
      universe: ticker ? null : "covered",
      limit_results: 12,
      limit_tickers: 20,
    },
  };
}

function hookDecision(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const output = value as {
    continue?: boolean;
    hookSpecificOutput?: { permissionDecision?: string };
  };
  return output.hookSpecificOutput?.permissionDecision;
}

function hookUpdatedInput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const output = value as {
    hookSpecificOutput?: { updatedInput?: Record<string, unknown> };
  };
  return output.hookSpecificOutput?.updatedInput;
}

function isStockNewsToolName(
  toolName: MCPToolName,
): toolName is StockNewsMCPToolName {
  return [
    "route_news_question",
    "resolve_news_entities",
    "search_company_news_events",
    "search_market_news_events",
    "search_news_by_domain",
    "read_news_sources",
    "build_news_timeline",
    "audit_news_sources",
  ].includes(toolName);
}

function isYahooFinanceToolName(
  toolName: MCPToolName,
): toolName is YahooFinanceMCPToolName {
  return ["get_yahoo_finance_news", "get_stock_info"].includes(toolName);
}

function isPublicFilingsToolName(toolName: MCPToolName): boolean {
  return [
    "get_filing",
    "get_filing_brief",
    "search_catalog_filings",
    "list_filing_sections",
    "read_filing_section",
    "list_filing_documents",
    "read_filing_document",
    "get_form4_insider_transactions",
  ].includes(toolName);
}

function toolUseMessage(toolName: MCPToolName, index: number) {
  return toolUseMessageWithInput(toolName, index, {});
}

function toolUseMessageWithInput(
  toolName: MCPToolName,
  index: number,
  input: Record<string, unknown>,
) {
  return sdkToolUseMessage(sdkToolName(toolName), index, input);
}

function sdkToolUseMessage(
  toolName: string,
  index: number,
  input: Record<string, unknown> = {},
) {
  return {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: `tool-${index}`,
          name: toolName,
          input,
        },
      ],
    },
  };
}

function toolResultMessage(index: number) {
  return sdkToolResultMessage(index);
}

function sdkToolResultMessage(
  index: number,
  content: unknown = { ok: true, index },
) {
  return {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: `tool-${index}`,
          content: JSON.stringify(content),
        },
      ],
    },
  };
}

function verifiedCompanyEvidencePack(params: {
  ticker: string;
  questionIds?: string[];
  excerpt?: string;
  briefHash?: string;
}) {
  const questionIds = params.questionIds ?? ["q_business_quality"];
  const payload: Record<string, unknown> = {
    format: "krw-verified-company-evidence/v1",
    release_id: "test-release",
    ticker: params.ticker,
    ...(params.briefHash ? { brief_hash: params.briefHash } : {}),
    current_driver: {
      ticker: params.ticker,
      period: "CY2026Q1",
      document_type: "10-Q",
      role: "current_driver",
    },
    annual_baseline: {
      ticker: params.ticker,
      period: "CY2025",
      document_type: "10-K",
      role: "annual_baseline",
    },
    evidence_by_question: questionIds.map((questionId) => ({
      question_id: questionId,
      evidence: [
        {
          source_object_id: `claim:${params.ticker}:${questionId}`,
          object_type: "ResearchClaim",
          trace_status: "traceable_direct",
          evidence_grade: "direct",
          usable_for_strong_claim: true,
          usable_for_interpretation: true,
          document: {
            ticker: params.ticker,
            document_type: "10-Q",
            period: "CY2026Q1",
            section: "MD&A",
            anchor_roles: ["current_driver"],
          },
          claim_ids: [`claim:${params.ticker}:${questionId}`],
          quote_ids: [`quote:${params.ticker}:${questionId}`],
          span_ids: [`span:${params.ticker}:${questionId}`],
          verified_excerpt:
            params.excerpt ?? "Services improve recurring economics.",
          metric_lineage: null,
        },
      ],
      verified_count: 1,
      answerability: "verified",
    })),
    rejected_refs: [],
    verification_summary: {
      question_count: questionIds.length,
      requested_object_count: questionIds.length,
      verified_object_count: questionIds.length,
      strong_claim_evidence_count: questionIds.length,
      interpretation_evidence_count: questionIds.length,
      all_questions_have_verified_evidence: true,
    },
    usage_policy: {
      strong_company_claims: "Use only verified entries.",
    },
  };
  payload.pack_hash = createHash("sha256")
    .update(canonicalTestJson(payload))
    .digest("hex");
  return payload;
}

function canonicalTestJson(value: unknown): string {
  return JSON.stringify(sortTestJsonValue(value));
}

function sortTestJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortTestJsonValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => key !== "pack_hash")
      .sort()
      .map((key) => [key, sortTestJsonValue(record[key])]),
  );
}

async function probeToolPermission(params: {
  existingTools: MCPToolName[];
  attemptedTool: MCPToolName;
  input?: Record<string, unknown>;
  researchMode?: ResearchMode;
  analysisMode?: AnalysisMode;
  runKind?: RunKind;
  userMessage?: string;
  selectedNewsEventContext?: Record<string, unknown> | null;
}): Promise<{
  permission: Awaited<ReturnType<typeof canUseTool>>;
  result: Awaited<ReturnType<typeof runAgent>>;
}> {
  let permission: Awaited<ReturnType<typeof canUseTool>> | null = null;
  sdkMocks.query.mockImplementationOnce(
    (call: {
      options: {
        canUseTool?: typeof canUseTool;
      };
    }) =>
      makeSdkQueryFromGenerator(async function* () {
        for (const [index, toolName] of params.existingTools.entries()) {
          yield toolUseMessage(toolName, index);
          yield toolResultMessage(index);
        }

        permission = (await call.options.canUseTool?.(
          sdkToolName(params.attemptedTool),
          params.input ?? {},
        )) ?? {
          behavior: "deny",
          message: "Permission guard was not installed.",
        };

        yield {
          type: "result",
          subtype: "success",
          result: "테스트 답변입니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        };
      }),
  );

  const result = await runAgent(
    {
      sessionId: "11111111-1111-4111-8111-111111111111",
      userMessage: params.userMessage ?? "Apple 매출 구조를 정리해줘",
      scopeType: "company",
      defaultTickers: ["AAPL"],
      defaultDocumentTypes: [],
      researchMode: params.researchMode ?? "deep",
      analysisMode: params.analysisMode ?? "company",
      runKind: params.runKind,
      selectedNewsEventContext: params.selectedNewsEventContext,
    },
    {
      write: vi.fn().mockResolvedValue(undefined),
    },
  );

  expect(result.status).toBe("completed");
  expect(permission).not.toBeNull();
  return { permission: permission!, result };
}

describe("agent runner research budget recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A research request now owns exactly one SDK execution. Clear any
    // intentionally unused legacy mock responses so they cannot leak into a
    // subsequent one-run test.
    sdkMocks.query.mockReset();
    sdkMocks.getSessionInfo.mockReset();
    rmSync("/tmp/krw-ontology-plugin", { recursive: true, force: true });
    mkdirSync("/tmp/krw-ontology-plugin", { recursive: true });
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );
    sdkMocks.getSessionInfo.mockResolvedValue(undefined);
    delete process.env.STOCK_NEWS_FORCE_DISABLED;
    delete process.env.STOCK_NEWS_ENABLED;
    delete process.env.STOCK_NEWS_MAX_CALLS;
    delete process.env.YAHOO_FINANCE_MAX_CALLS;
    delete process.env.KRW_CHARTS_ENABLED;
    delete process.env.ZAI_API_KEY;
    delete process.env.CLAUDE_SDK_CONTEXT_USAGE_SAMPLE_RATE;
    delete process.env.CLAUDE_SDK_DIAGNOSTIC_TIMEOUT_MS;
    delete process.env.GURU_AGENT_GENERATED_BRIEF_ENABLED;
    delete process.env.RESEARCH_ANSWER_ENVELOPE_ENABLED;
    delete process.env.AGENT_MAX_TOOL_CALLS;
    delete process.env.FILINGS_MCP_ENABLED;
    delete process.env.FILINGS_MCP_AUTH_TOKEN;
    delete process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET;
    delete process.env.FILINGS_MCP_MAX_CALLS;
    delete process.env.KRW_VISUALIZATIONS_MODE;
  });

  it("keeps the deep mode total tool budget unchanged", () => {
    expect(getResearchModeToolBudget("deep")).toEqual({
      maxToolCalls: 32,
    });
  });

  it("exposes only the authenticated user's personal filing memory to web chat", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET =
      "test-personal-signing-secret";
    process.env.AGENT_MAX_TOOL_CALLS = "1";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );
    let firstPermission: Awaited<ReturnType<typeof canUseTool>> | null = null;
    let secondPermission: Awaited<ReturnType<typeof canUseTool>> | null = null;
    sdkMocks.query.mockImplementationOnce(
      (call: { options: { canUseTool?: typeof canUseTool } }) =>
        makeSdkQueryFromGenerator(async function* () {
          const guard = call.options.canUseTool;
          if (!guard) throw new Error("missing personal-memory permission guard");
          firstPermission = await guard(
            "mcp__krw-filings__get_coverage_state",
            { ticker: "AAPL" },
          );
          yield sdkToolUseMessage(
            "mcp__krw-filings__get_coverage_state",
            1,
            { ticker: "AAPL" },
          );
          yield sdkToolResultMessage(1, {
            scope: "personal",
            ticker: "AAPL",
          });
          secondPermission = await guard(
            "mcp__krw-filings__list_open_questions",
            { ticker: "AAPL" },
          );
          yield {
            type: "result",
            subtype: "success",
            result: "이전 판단을 반영한 답변입니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111126",
        userId: "123e4567-e89b-42d3-a456-426614174000",
        userMessage: "내가 이 회사를 왜 보고 있었지?",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(firstPermission).toEqual({ behavior: "allow" });
    expect(secondPermission).toMatchObject({ behavior: "deny" });
    expect(result.acc.toolCalls).toHaveLength(1);
    expect(result.acc.toolCalls[0]).toMatchObject({
      toolName: "get_coverage_state",
      finishedAt: expect.any(String),
    });
    const options = sdkMocks.query.mock.calls[0]?.[0].options;
    expect(options.allowedTools).toEqual(
      expect.arrayContaining([
        "mcp__krw-filings__get_coverage_state",
        "mcp__krw-filings__list_filing_judgments",
        "mcp__krw-filings__get_decision_timeline",
        "mcp__krw-filings__list_open_questions",
      ]),
    );
    expect(options.allowedTools).not.toContain("mcp__krw-filings__get_filing");
    expect(options.mcpServers["krw-filings"].headers).toMatchObject({
      Authorization: "Bearer test-filings-service-secret",
      "x-krw-user-authorization": expect.stringMatching(/^Internal /),
    });
    await expect(
      options.canUseTool("mcp__krw-filings__get_filing", {}),
    ).resolves.toMatchObject({ behavior: "deny" });
  });

  it("uses the source-filing skill with only source-bound public filing tools", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET =
      "test-personal-signing-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );
    const sourceFilingEventId = "123e4567-e89b-42d3-a456-426614174000";
    let sourceDecision: Awaited<ReturnType<typeof canUseTool>> | null = null;
    let documentDecision: Awaited<ReturnType<typeof canUseTool>> | null = null;
    let searchDecision: Awaited<ReturnType<typeof canUseTool>> | null = null;
    let ontologyDecision: Awaited<ReturnType<typeof canUseTool>> | null = null;
    let personalDecision: Awaited<ReturnType<typeof canUseTool>> | null = null;
    sdkMocks.query.mockImplementationOnce(
      (call: { options: { canUseTool?: typeof canUseTool } }) =>
        makeSdkQueryFromGenerator(async function* () {
          const guard = call.options.canUseTool;
          if (!guard) throw new Error("missing source-filing permission guard");
          sourceDecision = await guard(
            "mcp__krw-filings__list_filing_sections",
            { filing_event_id: "00000000-0000-4000-8000-000000000001" },
          );
          documentDecision = await guard(
            "mcp__krw-filings__read_filing_document",
            {
              filing_event_id: "00000000-0000-4000-8000-000000000001",
              document_key: "document:exhibit",
            },
          );
          searchDecision = await guard(
            "mcp__krw-filings__search_catalog_filings",
            { ticker: "MSFT" },
          );
          ontologyDecision = await guard(
            sdkToolName("krw_ontology_query"),
            { query: "AAPL latest filing" },
          );
          personalDecision = await guard(
            "mcp__krw-filings__get_coverage_state",
            { ticker: "AAPL" },
          );
          yield {
            type: "result",
            subtype: "success",
            result: "공시 원문 기반 답변입니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111129",
        userId: "123e4567-e89b-42d3-a456-426614174000",
        userMessage: "이 공시가 투자 가설에 어떤 의미가 있어?",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        sourceFilingEventId,
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(sourceDecision).toEqual({
      behavior: "allow",
      updatedInput: { filing_event_id: sourceFilingEventId },
    });
    expect(documentDecision).toEqual({
      behavior: "allow",
      updatedInput: {
        filing_event_id: sourceFilingEventId,
        document_key: "document:exhibit",
      },
    });
    expect(searchDecision).toMatchObject({ behavior: "deny" });
    expect(ontologyDecision).toMatchObject({ behavior: "deny" });
    expect(personalDecision).toMatchObject({ behavior: "deny" });

    const queryCall = sdkMocks.query.mock.calls[0]?.[0];
    const options = queryCall.options;
    expect(queryCall.prompt).toContain(
      "/krw-ontology:krw-ontology-filing-follow-up 이 공시가 투자 가설에 어떤 의미가 있어?",
    );
    expect(queryCall.prompt).not.toContain("Research mode: deep.");
    expect(options.allowedTools).toEqual([
      "mcp__krw-filings__get_filing",
      "mcp__krw-filings__get_filing_brief",
      "mcp__krw-filings__list_filing_sections",
      "mcp__krw-filings__read_filing_section",
      "mcp__krw-filings__list_filing_documents",
      "mcp__krw-filings__read_filing_document",
      "mcp__krw-filings__get_form4_insider_transactions",
    ]);
    expect(options.mcpServers["krw-filings"].headers).toEqual({
      Authorization: "Bearer test-filings-service-secret",
    });
  });

  it("does not put an on-demand filing body from an SDK tool summary into run events", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );
    const rawBody = "EXHIBIT_SENTINEL raw attachment text";
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        sdkToolUseMessage(
          "mcp__krw-filings__read_filing_document",
          1,
          { document_key: "document:exhibit" },
        ),
        {
          type: "tool_use_summary",
          preceding_tool_use_ids: ["tool-1"],
          summary: rawBody,
        },
        {
          type: "result",
          subtype: "success",
          result: "첨부문서 기반 답변입니다.",
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );
    const writes: string[] = [];

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111129",
        userMessage: "첨부 보도자료를 읽어줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        sourceFilingEventId: "123e4567-e89b-42d3-a456-426614174000",
      },
      {
        write: vi.fn(async (chunk: Uint8Array) => {
          writes.push(Buffer.from(chunk).toString("utf8"));
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.toolCalls[0]?.resultSummary).toBe(
      "SEC filing source body read (0 characters; body omitted from persistence).",
    );
    expect(writes.join("")).not.toContain("EXHIBIT_SENTINEL");
    expect(writes.join("")).toContain("body omitted from persistence");
  });

  it("atomically reserves the last personal tool slot across parallel permission requests", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET =
      "test-personal-signing-secret";
    process.env.AGENT_MAX_TOOL_CALLS = "1";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );

    let decisions: Array<Awaited<ReturnType<typeof canUseTool>>> = [];
    let retryDecision: Awaited<ReturnType<typeof canUseTool>> | null = null;
    sdkMocks.query.mockImplementationOnce(
      (call: { options: { canUseTool?: typeof canUseTool } }) =>
        makeSdkQueryFromGenerator(async function* () {
          const guard = call.options.canUseTool;
          if (!guard) throw new Error("missing personal-memory permission guard");
          const guarded = guard as unknown as (
            toolName: string,
            input: Record<string, unknown>,
            context: {
              signal: AbortSignal;
              toolUseID: string;
              requestId: string;
            },
          ) => Promise<Awaited<ReturnType<typeof canUseTool>>>;
          const permissionContext = (toolUseID: string) => ({
            signal: new AbortController().signal,
            toolUseID,
            requestId: `request-${toolUseID}`,
          });
          decisions = await Promise.all([
            guarded(
              "mcp__krw-filings__get_coverage_state",
              { ticker: "AAPL" },
              permissionContext("parallel-personal-1"),
            ),
            guarded(
              "mcp__krw-filings__list_open_questions",
              { ticker: "AAPL" },
              permissionContext("parallel-personal-2"),
            ),
          ]) as Array<Awaited<ReturnType<typeof canUseTool>>>;
          retryDecision = await guarded(
            "mcp__krw-filings__get_coverage_state",
            { ticker: "AAPL" },
            permissionContext("parallel-personal-1"),
          ) as Awaited<ReturnType<typeof canUseTool>>;
          yield {
            type: "result",
            subtype: "success",
            result: "병렬 권한 예약을 검증했습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111127",
        userId: "123e4567-e89b-42d3-a456-426614174000",
        userMessage: "내 개인 메모를 확인해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(decisions[0]).toEqual({ behavior: "allow" });
    expect(decisions[1]).toMatchObject({ behavior: "deny" });
    expect(retryDecision).toEqual({ behavior: "allow" });
  });

  it("atomically shares the total tool budget across personal and Yahoo tools", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET =
      "test-personal-signing-secret";
    process.env.AGENT_MAX_TOOL_CALLS = "1";
    process.env.YAHOO_FINANCE_MAX_CALLS = "4";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );

    let decisions: Array<Awaited<ReturnType<typeof canUseTool>>> = [];
    sdkMocks.query.mockImplementationOnce(
      (call: { options: { canUseTool?: typeof canUseTool } }) =>
        makeSdkQueryFromGenerator(async function* () {
          const guard = call.options.canUseTool;
          if (!guard) throw new Error("missing cross-tool permission guard");
          const guarded = guard as unknown as (
            toolName: string,
            input: Record<string, unknown>,
            context: {
              signal: AbortSignal;
              toolUseID: string;
              requestId: string;
            },
          ) => Promise<Awaited<ReturnType<typeof canUseTool>>>;
          const permissionContext = (toolUseID: string) => ({
            signal: new AbortController().signal,
            toolUseID,
            requestId: `request-${toolUseID}`,
          });
          decisions = await Promise.all([
            guarded(
              "mcp__krw-filings__get_coverage_state",
              { ticker: "AAPL" },
              permissionContext("parallel-cross-personal"),
            ),
            guarded(
              yahooFinanceSdkToolName("get_yahoo_finance_news"),
              { ticker: "AAPL" },
              permissionContext("parallel-cross-yahoo"),
            ),
          ]);
          yield {
            type: "result",
            subtype: "success",
            result: "교차 도구 총예산 예약을 검증했습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111128",
        userId: "123e4567-e89b-42d3-a456-426614174000",
        userMessage: "내 메모와 최신 뉴스를 함께 확인해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        analysisMode: "news",
        runKind: "news_discovery",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(decisions[0]).toEqual({ behavior: "allow" });
    expect(decisions[1]).toMatchObject({ behavior: "deny" });
  });

  it("atomically enforces the Yahoo category budget across parallel requests", async () => {
    process.env.AGENT_MAX_TOOL_CALLS = "3";
    process.env.YAHOO_FINANCE_MAX_CALLS = "1";
    let decisions: Array<Awaited<ReturnType<typeof canUseTool>>> = [];
    sdkMocks.query.mockImplementationOnce(
      (call: { options: { canUseTool?: typeof canUseTool } }) =>
        makeSdkQueryFromGenerator(async function* () {
          const guard = call.options.canUseTool;
          if (!guard) throw new Error("missing Yahoo permission guard");
          const guarded = guard as unknown as (
            toolName: string,
            input: Record<string, unknown>,
            context: {
              signal: AbortSignal;
              toolUseID: string;
              requestId: string;
            },
          ) => Promise<Awaited<ReturnType<typeof canUseTool>>>;
          const permissionContext = (toolUseID: string) => ({
            signal: new AbortController().signal,
            toolUseID,
            requestId: `request-${toolUseID}`,
          });
          decisions = await Promise.all([
            guarded(
              yahooFinanceSdkToolName("get_yahoo_finance_news"),
              { ticker: "AAPL" },
              permissionContext("parallel-yahoo-1"),
            ),
            guarded(
              yahooFinanceSdkToolName("get_stock_info"),
              { ticker: "AAPL" },
              permissionContext("parallel-yahoo-2"),
            ),
          ]);
          yield {
            type: "result",
            subtype: "success",
            result: "Yahoo 종류별 예산 예약을 검증했습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111129",
        userMessage: "AAPL 최신 뉴스를 확인해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        analysisMode: "news",
        runKind: "news_discovery",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(decisions[0]).toEqual({ behavior: "allow" });
    expect(decisions[1]).toMatchObject({ behavior: "deny" });
  });

  it("captures system init and samples context only after the SDK result", async () => {
    vi.stubEnv("CLAUDE_SDK_CONTEXT_USAGE_SAMPLE_RATE", "1");
    const sdkQuery = makeSdkQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "sdk-session-1",
        uuid: "init-1",
        model: "deepseek-flash-v4",
        claude_code_version: "2.1.0",
        cwd: "/tmp",
        tools: toolsForSystemInit(),
        mcp_servers: [{ name: "krw-ontology", status: "connected" }],
        permissionMode: "dontAsk",
        slash_commands: ["krw-ontology:krw-ontology-research"],
        apiKeySource: "none",
        output_style: "default",
        skills: ["krw-ontology:krw-ontology-research"],
        plugins: [{ name: "krw-ontology", path: "/private/plugin" }],
      },
      {
        type: "result",
        subtype: "success",
        result: "진단과 무관하게 완료된 답변입니다.",
        usage: { input_tokens: 10, output_tokens: 12 },
      },
    ]);
    sdkMocks.query.mockReturnValueOnce(sdkQuery);
    const diagnostics: Array<Record<string, unknown>> = [];

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111121",
        userMessage: "AAPL을 분석해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        onSdkDiagnostics: async (value) => {
          diagnostics.push(value as unknown as Record<string, unknown>);
        },
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    await vi.waitFor(() => {
      expect(diagnostics).toHaveLength(1);
    });
    expect(sdkQuery.initializationResult).not.toHaveBeenCalled();
    expect(sdkQuery.mcpServerStatus).toHaveBeenCalledOnce();
    expect(sdkQuery.getContextUsage).toHaveBeenCalledOnce();
    expect(diagnostics[0]).toMatchObject({
      observedModels: ["deepseek-flash-v4"],
      contextUsageSampled: true,
      systemInit: {
        sessionId: "sdk-session-1",
        model: "deepseek-flash-v4",
        claudeCodeVersion: "2.1.0",
        mcpServers: [{ name: "krw-ontology", status: "connected" }],
        plugins: ["krw-ontology"],
      },
      contextUsage: {
        totalTokens: 0,
        model: "test-model",
      },
    });
  });

  it("bounds post-result SDK diagnostics without delaying the final result", async () => {
    vi.stubEnv("CLAUDE_SDK_CONTEXT_USAGE_SAMPLE_RATE", "1");
    vi.stubEnv("CLAUDE_SDK_DIAGNOSTIC_TIMEOUT_MS", "10");
    const sdkQuery = makeSdkQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "sdk-session-timeout",
        uuid: "init-timeout",
        model: "deepseek-flash-v4",
        claude_code_version: "2.1.0",
        cwd: "/tmp",
        tools: toolsForSystemInit(),
        mcp_servers: [{ name: "krw-ontology", status: "connected" }],
        permissionMode: "dontAsk",
        slash_commands: [],
        apiKeySource: "none",
        output_style: "default",
        skills: [],
        plugins: [{ name: "krw-ontology", path: "/private/plugin" }],
      },
      {
        type: "result",
        subtype: "success",
        result: "진단 대기 없이 완료되는 답변입니다.",
        usage: { input_tokens: 10, output_tokens: 12 },
      },
    ]);
    sdkQuery.mcpServerStatus.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    sdkQuery.getContextUsage.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    sdkMocks.query.mockReturnValueOnce(sdkQuery);
    let resolveDiagnostics: ((value: Record<string, unknown>) => void) | null =
      null;
    let diagnosticsDelivered = false;
    const diagnosticsResult = new Promise<Record<string, unknown>>(
      (resolve) => {
        resolveDiagnostics = resolve;
      },
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111124",
        userMessage: "AAPL을 분석해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        onSdkDiagnostics: async (value) => {
          diagnosticsDelivered = true;
          resolveDiagnostics?.(value as unknown as Record<string, unknown>);
        },
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(diagnosticsDelivered).toBe(false);
    await expect(diagnosticsResult).resolves.toMatchObject({
      contextUsageSampled: true,
      mcpStatusError: "mcpServerStatus timed out after 10ms",
      contextUsageError: "getContextUsage timed out after 10ms",
    });
  });

  it("bounds a stalled diagnostics persistence callback", async () => {
    vi.stubEnv("CLAUDE_SDK_CONTEXT_USAGE_SAMPLE_RATE", "0");
    vi.stubEnv("CLAUDE_SDK_DIAGNOSTIC_TIMEOUT_MS", "10");
    const sdkQuery = makeSdkQuery([
      {
        type: "result",
        subtype: "success",
        result: "진단 저장과 무관하게 완료되는 답변입니다.",
        usage: { input_tokens: 10, output_tokens: 12 },
      },
    ]);
    sdkMocks.query.mockReturnValueOnce(sdkQuery);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await runAgent(
        {
          sessionId: "11111111-1111-4111-8111-111111111125",
          userMessage: "AAPL을 분석해줘",
          scopeType: "company",
          defaultTickers: ["AAPL"],
          defaultDocumentTypes: [],
          researchMode: "deep",
          onSdkDiagnostics: () => new Promise<never>(() => undefined),
        },
        { write: vi.fn().mockResolvedValue(undefined) },
      );

      expect(result.status).toBe("completed");
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          "[claude-agent-sdk:diagnostics-write-failed]",
          { error: "onSdkDiagnostics timed out after 10ms" },
        );
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("fails closed when system init does not expose the exact 13-tool set", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "system",
          subtype: "init",
          session_id: "sdk-session-stale",
          uuid: "init-stale",
          model: "deepseek-flash-v4",
          claude_code_version: "2.1.0",
          cwd: "/tmp",
          tools: [sdkToolName("krw_ontology_query_context")],
          mcp_servers: [{ name: "krw-ontology", status: "connected" }],
          permissionMode: "dontAsk",
          slash_commands: [],
          apiKeySource: "none",
          output_style: "default",
          skills: [],
          plugins: [{ name: "krw-ontology", path: "/private/plugin" }],
        },
        {
          type: "result",
          subtype: "success",
          result: "이 답변은 사용되면 안 됩니다.",
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111123",
        userMessage: "AAPL을 분석해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("failed");
    expect(result.internalErrorMessage).toContain(
      "MCP tool parity mismatch in system/init",
    );
  });

  it("uses the English KRW ontology research skill when responseLocale is English", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "English answer.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "Analyze Apple",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "standard",
        responseLocale: "en",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.prompt).toContain(
      "/krw-ontology:krw-ontology-research-en Analyze Apple",
    );
    expect(call.options.systemPrompt.append).toContain("English Markdown only");
    expect(call.options.systemPrompt.append).toContain(
      "do not answer in Korean",
    );
    expect(call.prompt).toContain("Research mode: deep.");
    expect(call.options.allowedTools).toContain(
      sdkToolName("krw_ontology_retrieve"),
    );
  });

  it("keeps retrieve and an evidence-first response-detail policy in the deep tool set", () => {
    expect(getAllowedMcpToolsForResearchMode("deep")).toContain(
      "krw_ontology_retrieve",
    );
    expect(buildResearchModePrompt("deep")).toContain(
      "Request response_detail: full only when",
    );
  });

  it("keeps the same response-detail guidance in every research mode prompt", () => {
    const modes: ResearchMode[] = ["fast", "standard", "deep"];
    for (const mode of modes) {
      expect(buildResearchModePrompt(mode)).toContain(
        "Request response_detail: full only when",
      );
    }
  });

  it("runs the SDK without global permission bypass or filesystem settings", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "Apple은 iPhone과 Services를 중심으로 매출을 창출합니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "Apple 매출 구조를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.permissionMode).toBe("dontAsk");
    expect(call.options.allowDangerouslySkipPermissions).toBe(false);
    expect(call.options.settingSources).toEqual([]);
    expect(call.options.tools).toEqual([]);
    expect(call.options.allowedTools).toEqual(
      expect.arrayContaining([
        sdkToolName("krw_ontology_query_context"),
        sdkToolName("krw_ontology_query"),
      ]),
    );
    expect(call.options.disallowedTools).toEqual(
      expect.arrayContaining([
        "Bash",
        "Read",
        "Write",
        "Edit",
        "WebFetch",
        "WebSearch",
      ]),
    );
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
    expect(call.options.allowedTools).not.toContain(
      "mcp__krw_presentation__compose_visualization",
    );
    expect(call.options.strictMcpConfig).toBe(true);
    expect(call.options.mcpServers).toEqual({
      "krw-ontology": {
        type: "http",
        url: "http://127.0.0.1:8765/mcp",
        alwaysLoad: true,
      },
    });
    expect(call.options.systemPrompt.append).toContain(
      "Do not perform web searches",
    );
    expect(call.options.systemPrompt.append).not.toContain(
      "Structured visualization policy",
    );
  });

  it("continues with ticker scope when the web catalog lookup times out", async () => {
    vi.mocked(getIndexedCompanies).mockRejectedValueOnce(
      new Error("canceling statement due to statement timeout"),
    );
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "티커 범위를 유지한 답변입니다.",
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111119",
        userMessage: "AAPL 사업의 질을 봐줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.fullText).toContain("티커 범위를 유지한 답변");
    expect(
      sdkMocks.query.mock.calls[0]?.[0].options.systemPrompt.append,
    ).toContain("The user is researching specific companies: AAPL");
  });

  it("runs Guru Advisor with the guru plugin plus a scoped Agent company evidence subagent", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        sdkToolUseMessage(
          guruSdkToolName("krw_guru_review_company_evidence"),
          1,
          { ticker: "AAPL", company_payload_json: "{}" },
        ),
        sdkToolResultMessage(1, { ok: true, reviewed: true }),
        {
          type: "result",
          subtype: "success",
          result: "자, 이 질문은 먼저 사업의 질을 봐야 합니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "이 기업을 오래 보유해도 될까?",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
        guruLensKey: "buffett",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.plugins).toEqual([
      { type: "local", path: "/tmp/krw-guru-advisor-plugin" },
    ]);
    expect(call.options.allowedTools).toEqual(call.options.tools);
    expect(call.options.tools).not.toContain(guruSdkToolName("krw_guru_trace"));
    expect(call.options.tools).toEqual(
      expect.arrayContaining([
        "Agent",
        "Read",
        guruSdkToolName("krw_guru_query_context"),
        guruSdkToolName("krw_guru_company_brief"),
        guruSdkToolName("krw_guru_review_company_evidence"),
      ]),
    );
    expect(call.options.tools).not.toContain(
      guruSdkToolName("krw_guru_company_pack"),
    );
    expect(call.options.tools).not.toContain(guruSdkToolName("krw_guru_trace"));
    expect(call.options.tools).not.toContain(guruSdkToolName("krw_guru_chain"));
    expect(call.options.tools).not.toContain(
      guruSdkToolName("krw_guru_evidence"),
    );
    expect(call.options.tools).not.toContain("Task");
    expect(call.options.disallowedTools).toEqual(
      expect.arrayContaining([
        guruSdkToolName("krw_guru_company_pack"),
        guruSdkToolName("krw_guru_trace"),
        guruSdkToolName("krw_guru_chain"),
        guruSdkToolName("krw_guru_evidence"),
      ]),
    );
    expect(call.options.tools).not.toContain(
      sdkToolName("krw_ontology_query_context"),
    );
    expect(call.options.tools).not.toContain(
      directOntologySdkToolName("krw_ontology_query_context"),
    );
    expect(call.options.mcpServers).toBeUndefined();
    expect(call.options.strictMcpConfig).toBeUndefined();
    expect(call.options.hooks?.PreToolUse?.[0]?.hooks?.[0]).toEqual(
      expect.any(Function),
    );
    expect(call.options.skills).toEqual(
      expect.arrayContaining(["krw-guru-advisor:krw-guru-buffett-advisor"]),
    );
    expect(call.options.skills).not.toContain(
      "krw-ontology:krw-ontology-research",
    );
    expect(call.options.agents).toHaveProperty("company_evidence_researcher");
    expect(
      call.options.agents.company_evidence_researcher.skills,
    ).toBeUndefined();
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "sealed krw-guru-investigation-brief/v1",
    );
    expect(
      call.options.agents.company_evidence_researcher.prompt,
    ).not.toContain("dynamic_question_plan");
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "complete SearchPlan v2",
    );
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "only {search_plan}",
    );
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "ResearchState v2 answerability",
    );
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "Never call verify_evidence, company_context, catalog, topic_map",
    );
    expect(call.options.agents.company_evidence_researcher.maxTurns).toBe(18);
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "Do not create, verify, or return an evidence pack",
    );
    expect(call.options.agents.company_evidence_researcher.mcpServers).toEqual([
      expect.objectContaining({
        "krw-ontology": expect.objectContaining({
          type: "http",
          url: "http://127.0.0.1:8765/mcp",
          alwaysLoad: true,
        }),
      }),
    ]);
    expect(call.options.agents.company_evidence_researcher.tools).toEqual(
      expect.arrayContaining([
        "mcp__krw-ontology__krw_ontology_query_context",
        "mcp__krw-ontology__krw_ontology_query",
        "mcp__krw-ontology__krw_ontology_trace",
      ]),
    );
    expect(call.options.agents.company_evidence_researcher.tools).not.toContain(
      "mcp__krw-ontology__krw_ontology_verify_evidence",
    );
    expect(
      call.options.agents.company_evidence_researcher.disallowedTools,
    ).toBeUndefined();
    expect(call.options.agentProgressSummaries).toBe(false);
    expect(call.options.forwardSubagentText).toBe(false);
    expect(call.options.systemPrompt.append).toContain(
      "company_evidence_researcher subagent",
    );
    expect(call.prompt).toContain("/krw-guru-advisor:krw-guru-buffett-advisor");
    expect(call.prompt).not.toContain("[구루 렌즈:");
    expect(call.prompt).toContain("company_evidence_researcher");
  });

  it("uses the default sealed brief workflow and validates matching evidence analysis", async () => {
    const decisions: Record<
      string,
      Awaited<ReturnType<typeof canUseTool>>
    > = {};
    const briefHash = "a".repeat(64);
    const brief = {
      format: "krw-guru-investigation-brief/v1",
      brief_hash: briefHash,
      research_pack_id: "guru-pack-aapl",
      author_key: "buffett",
      ticker: "AAPL",
      company_context_hash: "b".repeat(64),
      questions: [
        {
          question_id: "q_services_durability",
          decision_role: "main_tension",
          question:
            "Does Services stand independently from device replacement demand?",
        },
      ],
    };
    const researchState = {
      contract_version: "research-state/v2",
      evidence_units: [
        {
          evidence_id: "ev-services",
          object_id: "claim:AAPL:q_services_durability",
          object_type: "ResearchClaim",
          ticker: "AAPL",
          period: "CY2026Q1",
          document_type: "10-Q",
          title: "Services demand",
          summary: "Services activity remains linked to the installed device base.",
          directness: "direct",
          evidence_grade: "strong",
          source: {
            object_ids: ["claim:AAPL:q_services_durability"],
          },
        },
      ],
    };
    const analysis = {
      assessments: [
        {
          question_id: "q_services_durability",
          evidence_object_ids: ["claim:AAPL:q_services_durability"],
          verdict: "mixed",
          reasoning:
            "The cited evidence supports recurring activity but does not establish independence.",
        },
      ],
      overall_judgment: "Services independence remains only partly verified.",
    };
    const guruQueryContext = {
      research_pack: {
        format: "krw-guru-research-pack/v1",
        selected_lenses: [{ reviewed_id: "guru:buffett:services" }],
      },
    };
    const investigationDraft = {
      question:
        "Does Services stand independently from device replacement demand?",
      guru_principle_ids: ["guru:buffett:services"],
      company_context_anchor_ids: ["segment_services"],
      hypothesis: "Services becomes more independent.",
      counter_hypothesis: "Services remains device-dependent.",
      evidence_needed: ["segment disclosure"],
      strengthens_if: "Filings show standalone demand.",
      weakens_if: "Filings tie demand to devices.",
      why_material: "The durable earnings judgment depends on it.",
    };

    sdkMocks.query.mockImplementationOnce(
      (call: { options: { canUseTool?: typeof canUseTool } }) =>
        makeSdkQueryFromGenerator(async function* () {
          const guard = call.options.canUseTool;
          if (!guard) throw new Error("missing Guru permission guard");
          yield sdkToolUseMessage(
            guruSdkToolName("krw_guru_query_context"),
            0,
            { author_keys: ["buffett"], ticker: "AAPL" },
          );
          yield sdkToolResultMessage(0, guruQueryContext);
          decisions.companyBrief = await guard(
            guruSdkToolName("krw_guru_company_brief"),
            {
              ticker: "AAPL",
              investigation_questions: [investigationDraft],
            },
          );
          decisions.invalidCompanyBrief = await guard(
            guruSdkToolName("krw_guru_company_brief"),
            {
              ticker: "AAPL",
              investigation_questions: [investigationDraft, investigationDraft],
            },
          );
          yield sdkToolUseMessage(
            guruSdkToolName("krw_guru_company_brief"),
            1,
            {
              ticker: "AAPL",
              investigation_questions: [investigationDraft],
            },
          );
          yield sdkToolResultMessage(1, { investigation_brief: brief });

          decisions.agent = await guard("Agent", {
            description: "Retrieve sealed filing evidence",
            subagent_type: "company_evidence_researcher",
            prompt: `Use this exact sealed brief: ${JSON.stringify(brief)}`,
          });
          const subagentGuard = guard as unknown as (
            toolName: string,
            input: Record<string, unknown>,
            permissionContext: {
              agentID: string;
              agentType: string;
            },
          ) => Promise<Awaited<ReturnType<typeof canUseTool>>>;
          decisions.verify = await subagentGuard(
            directOntologySdkToolName("krw_ontology_verify_evidence"),
            {
              ticker: "AAPL",
              brief_hash: briefHash,
              questions: [
                {
                  question_id: "q_services_durability",
                  object_ids: ["claim:AAPL:q_services_durability"],
                },
              ],
            },
            {
              agentID: "company_evidence_researcher:run",
              agentType: "company_evidence_researcher",
            },
          );
          decisions.filingContext = await subagentGuard(
            directOntologySdkToolName("krw_ontology_query_context"),
            ontologySearchPlanInput({
              question: "AAPL Services durability",
              ticker: "AAPL",
            }),
            {
              agentID: "company_evidence_researcher:run",
              agentType: "company_evidence_researcher",
            },
          );
          yield sdkToolUseMessage(
            directOntologySdkToolName("krw_ontology_query_context"),
            2,
            ontologySearchPlanInput({
              question: "AAPL Services durability",
              ticker: "AAPL",
            }),
          );
          yield sdkToolResultMessage(2, researchState);

          decisions.review = await guard(
            guruSdkToolName("krw_guru_review_company_evidence"),
            {
              question: "Assess AAPL Services durability.",
              agent_analysis: analysis,
            },
          );
          yield sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            3,
            {
              question: "Assess AAPL Services durability.",
              agent_analysis: analysis,
            },
          );
          yield sdkToolResultMessage(3, {
            validated_evidence_analysis: {
              format: "krw-guru-validated-evidence-analysis/v1",
              ticker: "AAPL",
              brief_hash: briefHash,
              agent_analysis: analysis,
            },
          });
          yield {
            type: "result",
            subtype: "success",
            result:
              "서비스의 내구성은 개선 신호가 있지만 기기 생태계 의존은 더 확인해야 합니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111120",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
        guruLensKey: "buffett",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.fullText).toBe(
      "서비스의 내구성은 개선 신호가 있지만 기기 생태계 의존은 더 확인해야 합니다.",
    );
    expect(decisions.companyBrief.behavior).toBe("allow");
    if (decisions.companyBrief.behavior !== "allow") {
      throw new Error("company brief permission was unexpectedly denied");
    }
    expect(decisions.companyBrief.updatedInput).toMatchObject({
      guru_query_context: guruQueryContext,
    });
    expect(decisions.invalidCompanyBrief.behavior).toBe("allow");
    expect(decisions.agent.behavior).toBe("allow");
    expect(decisions.verify.behavior).toBe("deny");
    expect(decisions.filingContext.behavior).toBe("allow");
    expect(decisions.review.behavior).toBe("allow");
    if (decisions.review.behavior === "allow") {
      expect(decisions.review.updatedInput).toMatchObject({
        ticker: "AAPL",
        author_keys: ["buffett"],
        company_research_context: {
          format: "krw-guru-company-research-context/v1",
          ticker: "AAPL",
          brief_hash: briefHash,
          question_ids: ["q_services_durability"],
          source_object_ids: ["claim:AAPL:q_services_durability"],
        },
        investigation_brief: brief,
        agent_analysis: analysis,
      });
    }
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "one philosophy-shaped key question",
    );
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "one to three complementary atomic filing tests",
    );
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "exact plural field metrics",
    );
    expect(call.options.agents.company_evidence_researcher.prompt).toContain(
      "at most eight unique object ids",
    );
    expect(
      call.options.agents.company_evidence_researcher.prompt,
    ).not.toContain("dynamic_question_plan");
    expect(call.options.systemPrompt.append).toContain(
      "investigation_questions",
    );
    expect(call.options.systemPrompt.append).not.toContain("0-3 exact figures");
  });

  it("renders a bounded company answer when a company-scoped Guru run skips research", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "회사 리서치 내용을 바탕으로 바로 이어간 상담 답변입니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("AAPL");
    expect(result.acc.fullText).toContain("일반 시장 분위기");
    expect(result.acc.fullText).not.toContain(
      "회사 리서치 내용을 바탕으로 바로 이어간 상담 답변입니다.",
    );
    expect(result.acc.inputTokens).toBe(10);
    expect(result.acc.outputTokens).toBe(12);
  });

  it("renders an evidence-limited company answer when a sealed question has no verified pack", async () => {
    const brief = {
      format: "krw-guru-investigation-brief/v1",
      brief_hash: "a".repeat(64),
      ticker: "AAPL",
      questions: [
        {
          question_id: "q_durability",
          question: "Can Services stand independently from device demand?",
        },
      ],
    };
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        sdkToolUseMessage(guruSdkToolName("krw_guru_company_brief"), 1, {
          ticker: "AAPL",
        }),
        sdkToolResultMessage(1, { investigation_brief: brief }),
        {
          type: "result",
          subtype: "success",
          result: "일반론을 AAPL의 결론처럼 말한 답변입니다.",
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111118",
        userMessage: "AAPL은 지금 공격할 때인가요?",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.fullText).toContain("AAPL의 핵심 쟁점은 분명하지만");
    expect(result.acc.fullText).not.toContain(
      "일반론을 AAPL의 결론처럼 말한 답변입니다.",
    );
  });

  it("returns material Guru Advisor figures from the single SDK run", async () => {
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            1,
            { ticker: "AAPL", company_payload_json: '{"ticker":"AAPL"}' },
          ),
          sdkToolResultMessage(1, { ok: true, reviewed: true }),
          {
            type: "result",
            subtype: "success",
            result:
              "서비스 15.4%, 22.3%, 23.3%, 마진 75.8%, 제품 37.1%, ROIC 58.6%, 영업이익률 32.4%, 아이폰 52%입니다.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result:
              "애플 서비스는 좋아지고 있지만, 버핏식으로 보면 아이폰이라는 관문에 아직 많이 기대고 있습니다. 서비스는 더 반복적이고 높은 마진의 장사로 회사를 좋게 만들지만, 이 장사가 독립적인 해자인지는 아이폰 사용자 기반이 흔들릴 때 드러납니다.\n\n이 판단이 바뀌려면 서비스 성장이 아이폰 교체 주기와 덜 묶여도 계속 강해야 합니다.",
            usage: {
              input_tokens: 20,
              output_tokens: 24,
            },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("15.4%");
    expect(result.acc.inputTokens).toBe(10);
    expect(result.acc.outputTokens).toBe(12);
  });

  it("keeps a material Guru Advisor number without a second SDK run", async () => {
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result:
              "현금창출력은 15% 개선됐지만 내구성은 아직 더 확인해야 합니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result:
              "현금창출력은 개선됐지만 그 흐름만으로 사업의 내구성이 입증되지는 않습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111121",
        userMessage: "AAPL 현금창출력을 봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("15%");
  });

  it("does not fail or restart when a Guru Advisor answer includes a quantity", async () => {
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result: "마진은 15% 개선됐습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result: "마진은 두 배로 좋아졌습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111122",
        userMessage: "AAPL 마진을 봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("15%");
  });

  it("does not start a second Guru Advisor run for stylistic deviations", async () => {
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            1,
            { ticker: "AAPL", company_payload_json: '{"ticker":"AAPL"}' },
          ),
          sdkToolResultMessage(1, { ok: true, reviewed: true }),
          {
            type: "result",
            subtype: "success",
            result:
              "Now I have all the materials. Let me compose the final answer.\n\n**내가 좋아하는 점**\n애플 서비스는 좋아지고 있습니다.\n\n**내가 불편한 점**\n아이폰 의존은 남아 있습니다.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result:
              "애플 서비스는 좋아지고 있지만 아이폰이라는 관문에 아직 기대고 있습니다.\n\n### 이어서 볼 질문\n- 서비스가 아이폰 의존 없이 커지는지 확인해줘.\n- 규제 리스크가 서비스 마진을 흔드는 조건을 봐줘.\n- 판단이 바뀌는 조건을 정리해줘.",
            usage: {
              input_tokens: 20,
              output_tokens: 24,
            },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("Now I have");
    expect(result.acc.fullText).toContain("**내가 좋아하는 점**\n");
  });

  it("does not start a second Guru Advisor run for first-person wording", async () => {
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            1,
            { ticker: "AAPL", company_payload_json: '{"ticker":"AAPL"}' },
          ),
          sdkToolResultMessage(1, { ok: true, reviewed: true }),
          {
            type: "result",
            subtype: "success",
            result:
              "서비스 반복매출은 강해지고 있습니다. 이건 내가 좋아하는 장사의 핵심 특성입니다.\n\n### 이어서 볼 질문\n1. 서비스 의존도를 봐줘.\n2. 아이폰 의존을 봐줘.\n3. 판단 조건을 봐줘.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result:
              "서비스 반복매출은 애플의 사업을 더 견고하게 만들지만, 아직 아이폰 생태계라는 관문 위에서 움직입니다.\n\n### 이어서 볼 질문\n- 서비스가 아이폰 의존 없이 커지는지 확인해줘.\n- 규제 리스크가 서비스 마진을 흔드는 조건을 봐줘.\n- 판단이 바뀌는 조건을 정리해줘.",
            usage: {
              input_tokens: 20,
              output_tokens: 24,
            },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111112",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("내가 좋아하는");
    expect(result.acc.fullText).toContain("### 이어서 볼 질문");
  });

  it("does not start a second Guru Advisor run for Markdown emphasis", async () => {
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            1,
            { ticker: "AAPL", company_payload_json: '{"ticker":"AAPL"}' },
          ),
          sdkToolResultMessage(1, { ok: true, reviewed: true }),
          {
            type: "result",
            subtype: "success",
            result:
              "**서비스 매출은 사업 구조를 바꾸고 있습니다.** 다만 아이폰 의존은 남아 있습니다.\n\n### 이어서 볼 질문\n1. 서비스 의존도를 봐줘.\n2. 아이폰 의존을 봐줘.\n3. 판단 조건을 봐줘.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result:
              "서비스 매출은 애플의 사업 구조를 바꾸고 있지만, 아이폰 의존은 아직 남아 있습니다.\n\n### 이어서 볼 질문\n- 서비스가 아이폰 의존 없이 커지는지 확인해줘.\n- 규제 리스크가 서비스 마진을 흔드는 조건을 봐줘.\n- 판단이 바뀌는 조건을 정리해줘.",
            usage: {
              input_tokens: 20,
              output_tokens: 24,
            },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111113",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("**서비스 매출은");
    expect(result.acc.fullText).toContain("### 이어서 볼 질문");
  });

  it("separates Guru main and company evidence subagent tool permissions", async () => {
    process.env.GURU_AGENT_GENERATED_BRIEF_ENABLED = "0";
    const decisions: Record<string, unknown> = {};
    const verifiedPack = verifiedCompanyEvidencePack({ ticker: "AAPL" });

    sdkMocks.query.mockImplementationOnce(
      (call: {
        options: {
          hooks?: {
            PreToolUse?: Array<{
              hooks: Array<
                (
                  input: Record<string, unknown>,
                  toolUseID: string,
                  options: { signal: AbortSignal },
                ) => Promise<unknown>
              >;
            }>;
          };
        };
      }) =>
        makeSdkQueryFromGenerator(async function* () {
          const hook = call.options.hooks?.PreToolUse?.[0]?.hooks?.[0];
          if (!hook) throw new Error("missing Guru Advisor PreToolUse hook");
          const invokeHook = (
            toolName: string,
            toolInput: Record<string, unknown>,
            extra: Record<string, unknown> = {},
          ) =>
            hook(
              {
                hook_event_name: "PreToolUse",
                session_id: "11111111-1111-4111-8111-111111111111",
                transcript_path: "/tmp/transcript.jsonl",
                cwd: "/tmp",
                tool_use_id: "permission-tool",
                tool_name: toolName,
                tool_input: toolInput,
                ...extra,
              },
              "permission-tool",
              { signal: new AbortController().signal },
            );

          decisions.mainAgentBeforeBrief = await invokeHook("Agent", {
            description: "Fetch company filing evidence",
            prompt:
              "Fetch AAPL company evidence with dynamic_question_plan and return evidence_by_question.",
            subagent_type: "company_evidence_researcher",
          });
          decisions.mainBackgroundAgent = await invokeHook("Agent", {
            description: "Fetch company filing evidence",
            prompt:
              "Fetch AAPL company evidence with dynamic_question_plan and return evidence_by_question.",
            subagent_type: "company_evidence_researcher",
            run_in_background: true,
          });
          decisions.wrongAgent = await invokeHook("Agent", {
            description: "Fetch other evidence",
            prompt: "Fetch other evidence.",
            subagent_type: "other_agent",
          });
          decisions.mainDirectCompanyTool = await invokeHook(
            directOntologySdkToolName("krw_ontology_query_context"),
            { question: "AAPL filing evidence" },
          );
          decisions.mainLensSelection = await invokeHook(
            guruSdkToolName("krw_guru_select_lenses"),
            { question: "AAPL business quality" },
          );
          decisions.mainGuruTool = await invokeHook(
            guruSdkToolName("krw_guru_query_context"),
            { question: "AAPL business quality" },
          );
          decisions.mainCompanyBrief = await invokeHook(
            guruSdkToolName("krw_guru_company_brief"),
            { ticker: "AAPL", question: "AAPL business quality" },
          );
          decisions.mainDuplicateCompanyBrief = await invokeHook(
            guruSdkToolName("krw_guru_company_brief"),
            { ticker: "AAPL", question: "AAPL business quality" },
          );
          decisions.mainTraceBeforeReview = await invokeHook(
            guruSdkToolName("krw_guru_trace"),
            { reviewed_id: "buffett:test" },
          );
          decisions.mainAgent = await invokeHook("Agent", {
            description: "Fetch company filing evidence",
            prompt:
              "Fetch AAPL company evidence with dynamic_question_plan and return evidence_by_question.",
            subagent_type: "company_evidence_researcher",
          });
          yield sdkToolUseMessage(
            directOntologySdkToolName("krw_ontology_verify_evidence"),
            90,
            {
              ticker: "AAPL",
              questions: [
                {
                  question_id: "q_business_quality",
                  object_ids: ["claim:AAPL:q_business_quality"],
                },
              ],
            },
          );
          yield sdkToolResultMessage(90, {
            result: JSON.stringify(verifiedPack),
          });
          decisions.mainGuruAfterEvidence = await invokeHook(
            guruSdkToolName("krw_guru_query_context"),
            { question: "AAPL business quality" },
          );
          decisions.mainReviewAfterEvidence = await invokeHook(
            guruSdkToolName("krw_guru_review_company_evidence"),
            {
              ticker: "AAPL",
              question: "AAPL business quality",
              company_payload: verifiedPack,
            },
          );
          decisions.mainTraceAfterReview = await invokeHook(
            guruSdkToolName("krw_guru_trace"),
            { reviewed_id: "buffett:test" },
          );
          decisions.mainCompanyPack = await invokeHook(
            guruSdkToolName("krw_guru_company_pack"),
            { ticker: "AAPL", question: "AAPL business quality" },
          );
          decisions.mainSafeRead = await invokeHook("Read", {
            file_path:
              "/tmp/krw-guru-advisor-plugin/references/answer-style-adapters.md",
          });
          decisions.mainUnsafeRead = await invokeHook("Read", {
            file_path: "~/krw-ontology-front/.env",
          });
          decisions.mainBash = await invokeHook("Bash", {
            command: "env",
          });
          decisions.subagentCompanyTool = await invokeHook(
            directOntologySdkToolName("krw_ontology_query_context"),
            ontologySearchPlanInput({
              question: "AAPL filing evidence",
              ticker: "AAPL",
            }),
            {
              agent_id: "agent-run-123",
              agent_type: "company_evidence_researcher",
            },
          );
          for (let attempt = 2; attempt <= 4; attempt += 1) {
            decisions[`subagentCompanyTool${attempt}`] = await invokeHook(
              directOntologySdkToolName("krw_ontology_query_context"),
              ontologySearchPlanInput({
                question: `AAPL filing evidence attempt ${attempt}`,
                ticker: "AAPL",
              }),
              {
                agent_id: "agent-run-123",
                agent_type: "company_evidence_researcher",
              },
            );
          }
          decisions.subagentVerifyLarge = await invokeHook(
            directOntologySdkToolName("krw_ontology_verify_evidence"),
            {
              ticker: "AAPL",
              questions: [
                {
                  question_id: "q_business_quality",
                  object_ids: ["a", "b", "b", "c", "d", "e"],
                },
              ],
            },
            {
              agent_id: "agent-run-123",
              agent_type: "company_evidence_researcher",
            },
          );
          decisions.subagentGuruTool = await invokeHook(
            guruSdkToolName("krw_guru_query_context"),
            { question: "AAPL business quality" },
            {
              agent_id: "agent-run-123",
              agent_type: "company_evidence_researcher",
            },
          );
          decisions.subagentRecursiveAgent = await invokeHook(
            "Agent",
            {
              description: "Spawn",
              prompt: "Spawn again",
              subagent_type: "company_evidence_researcher",
            },
            {
              agent_id: "agent-run-123",
              agent_type: "company_evidence_researcher",
            },
          );
          yield sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            1,
            { ticker: "AAPL", company_payload: verifiedPack },
          );
          yield sdkToolResultMessage(1, { ok: true, reviewed: true });
          yield {
            type: "result",
            subtype: "success",
            result: "구루 답변입니다.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(hookDecision(decisions.mainAgentBeforeBrief)).toBe("deny");
    expect(hookDecision(decisions.mainBackgroundAgent)).toBe("deny");
    expect(hookDecision(decisions.mainLensSelection)).toBe("allow");
    expect(hookDecision(decisions.mainGuruTool)).toBe("allow");
    expect(hookDecision(decisions.mainCompanyBrief)).toBe("allow");
    expect(hookDecision(decisions.mainDuplicateCompanyBrief)).toBe("allow");
    expect(hookDecision(decisions.mainTraceBeforeReview)).toBe("deny");
    expect(hookDecision(decisions.mainAgent)).toBe("allow");
    expect(hookUpdatedInput(decisions.mainAgent)).toMatchObject({
      run_in_background: false,
    });
    expect(hookDecision(decisions.mainGuruAfterEvidence)).toBe("allow");
    expect(hookDecision(decisions.mainReviewAfterEvidence)).toBe("deny");
    expect(hookDecision(decisions.mainTraceAfterReview)).toBe("deny");
    expect(hookDecision(decisions.mainCompanyPack)).toBe("deny");
    expect(hookDecision(decisions.mainSafeRead)).toBe("allow");
    expect(hookDecision(decisions.wrongAgent)).toBe("deny");
    expect(hookDecision(decisions.mainDirectCompanyTool)).toBe("deny");
    expect(hookDecision(decisions.mainUnsafeRead)).toBe("deny");
    expect(hookDecision(decisions.mainBash)).toBe("deny");
    expect(hookDecision(decisions.subagentCompanyTool)).toBe("allow");
    expect(hookDecision(decisions.subagentCompanyTool2)).toBe("allow");
    expect(hookDecision(decisions.subagentCompanyTool3)).toBe("deny");
    expect(hookDecision(decisions.subagentCompanyTool4)).toBe("deny");
    expect(hookDecision(decisions.subagentVerifyLarge)).toBe("deny");
    expect(hookUpdatedInput(decisions.subagentVerifyLarge)).toBeUndefined();
    expect(hookDecision(decisions.subagentGuruTool)).toBe("deny");
    expect(hookDecision(decisions.subagentRecursiveAgent)).toBe("deny");
  });

  it("atomically enforces the total budget in the authoritative Guru hook", async () => {
    process.env.AGENT_MAX_TOOL_CALLS = "1";
    let decisions: unknown[] = [];
    sdkMocks.query.mockImplementationOnce(
      (call: {
        options: {
          hooks?: {
            PreToolUse?: Array<{
              hooks: Array<
                (
                  input: Record<string, unknown>,
                  toolUseID: string,
                  options: { signal: AbortSignal },
                ) => Promise<unknown>
              >;
            }>;
          };
        };
      }) =>
        makeSdkQueryFromGenerator(async function* () {
          const hook = call.options.hooks?.PreToolUse?.[0]?.hooks?.[0];
          if (!hook) throw new Error("missing Guru Advisor PreToolUse hook");
          const invokeHook = (
            toolUseID: string,
            toolName: string,
            toolInput: Record<string, unknown>,
          ) =>
            hook(
              {
                hook_event_name: "PreToolUse",
                session_id: "11111111-1111-4111-8111-111111111111",
                transcript_path: "/tmp/transcript.jsonl",
                cwd: "/tmp",
                tool_use_id: toolUseID,
                tool_name: toolName,
                tool_input: toolInput,
              },
              toolUseID,
              { signal: new AbortController().signal },
            );

          // This exercises only the PreToolUse hook. Guru MCP tools can be
          // auto-approved through allowedTools, so canUseTool is deliberately
          // not called here.
          decisions = await Promise.all([
            invokeHook(
              "guru-budget-1",
              guruSdkToolName("krw_guru_select_lenses"),
              { question: "AAPL business quality" },
            ),
            invokeHook(
              "guru-budget-2",
              guruSdkToolName("krw_guru_query_context"),
              { question: "AAPL business quality" },
            ),
          ]);
          yield {
            type: "result",
            subtype: "success",
            result: "구루 실행 경계 예산을 검증했습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111130",
        userMessage: "버핏 관점에서 AAPL을 봐줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(hookDecision(decisions[0])).toBe("allow");
    expect(hookDecision(decisions[1])).toBe("deny");
  });

  it("attaches the verified runtime evidence pack and caps Guru review corrections in canUseTool", async () => {
    process.env.GURU_AGENT_GENERATED_BRIEF_ENABLED = "0";
    const decisions: Record<
      string,
      Awaited<ReturnType<typeof canUseTool>>
    > = {};
    const verifiedPack = verifiedCompanyEvidencePack({
      ticker: "SLB",
      excerpt:
        "Data Center Solutions diversifies directionally but does not remove upstream cycle exposure.",
    });
    const analysis = {
      assessments: [
        {
          question_id: "q_business_quality",
          evidence_object_ids: ["claim:SLB:q_business_quality"],
        },
      ],
      overall_judgment:
        "Data Center Solutions is directionally useful but does not establish cycle independence.",
    };

    sdkMocks.query.mockImplementationOnce(
      (call: {
        options: {
          canUseTool?: typeof canUseTool;
        };
      }) =>
        makeSdkQueryFromGenerator(async function* () {
          const guard = call.options.canUseTool;
          if (!guard) throw new Error("missing canUseTool guard");

          decisions.companyBrief = await guard(
            guruSdkToolName("krw_guru_company_brief"),
            { ticker: "SLB", question: "SLB durable business quality" },
          );
          decisions.reviewBeforeAgent = await guard(
            guruSdkToolName("krw_guru_review_company_evidence"),
            {
              ticker: "SLB",
              question: "SLB durable business quality",
              company_payload: {
                evidence_by_question: [{ finding: "DCS remains mixed." }],
                current_driver: { document_type: "10-Q" },
              },
            },
          );
          decisions.agent = await guard("Agent", {
            description: "Fetch question-driven company filing evidence",
            prompt: "Answer dynamic_question_plan for SLB.",
            subagent_type: "company_evidence_researcher",
          });
          yield sdkToolUseMessage(
            directOntologySdkToolName("krw_ontology_verify_evidence"),
            90,
            {
              ticker: "SLB",
              questions: [
                {
                  question_id: "q_business_quality",
                  object_ids: ["claim:SLB:q_business_quality"],
                },
              ],
            },
          );
          yield sdkToolResultMessage(90, verifiedPack);
          decisions.reviewWithoutQuestionEvidence = await guard(
            guruSdkToolName("krw_guru_review_company_evidence"),
            {
              ticker: "SLB",
              question: "SLB durable business quality",
              company_payload: {
                filing_supported_facts: ["SLB has global oilfield exposure."],
                current_driver: { document_type: "10-Q" },
              },
            },
          );
          decisions.reviewCoverageGuess = await guard(
            guruSdkToolName("krw_guru_review_company_evidence"),
            {
              ticker: "SLB",
              question: "SLB durable business quality",
              company_payload: {
                evidence_status: "no_filing_data_available",
                reason:
                  "KRW Ontology covers Korean-listed (KRX) securities only.",
                filing_supported_facts: [],
              },
            },
          );
          decisions.reviewGoodQuestionEvidence = await guard(
            guruSdkToolName("krw_guru_review_company_evidence"),
            {
              question: "SLB durable business quality",
              agent_analysis: analysis,
            },
          );
          decisions.reviewWithUntrustedPayload = await guard(
            guruSdkToolName("krw_guru_review_company_evidence"),
            {
              question: "SLB durable business quality",
              agent_analysis: analysis,
              company_payload: {
                ...verifiedPack,
                ticker: "AAPL",
              },
            },
          );

          yield {
            type: "result",
            subtype: "success",
            result: "구루 답변입니다.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "버핏 관점에서 SLB를 봐줘",
        scopeType: "company",
        defaultTickers: ["SLB"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
        guruLensKey: "buffett",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(decisions.companyBrief.behavior).toBe("allow");
    expect(decisions.reviewBeforeAgent.behavior).toBe("deny");
    expect(decisions.agent.behavior).toBe("allow");
    expect(decisions.reviewWithoutQuestionEvidence.behavior).toBe("deny");
    expect(decisions.reviewCoverageGuess.behavior).toBe("deny");
    expect(decisions.reviewGoodQuestionEvidence.behavior).toBe("deny");
    expect(decisions.reviewWithUntrustedPayload.behavior).toBe("deny");
  });

  it("continues the same Guru Advisor run when an evidence review is skipped", async () => {
    const verifiedPack = verifiedCompanyEvidencePack({
      ticker: "SLB",
      questionIds: ["q_cyclicality"],
      excerpt:
        "The filings support diversification direction but not proof that SLB is non-cyclical.",
    });
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          sdkToolUseMessage(guruSdkToolName("krw_guru_company_brief"), 1, {
            ticker: "SLB",
            question: "SLB durable business quality",
          }),
          sdkToolResultMessage(1, {
            company_filing_brief: {
              dynamic_question_plan: {
                questions: [
                  {
                    question_id: "q_cyclicality",
                    question_en:
                      "Does Data Center Solutions reduce SLB cyclicality?",
                  },
                ],
              },
            },
          }),
          sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            2,
            {
              ticker: "SLB",
              question: "SLB durable business quality",
              company_payload: {
                note: "Company evidence subagent did not return usable filing excerpts.",
                evidence_status: "limited_subagent_return",
                structural_context: {
                  core_business: "Oilfield services",
                },
              },
            },
          ),
          sdkToolResultMessage(2, {
            message:
              "The review payload must include evidence_by_question answered from the dynamic_question_plan.",
          }),
          {
            type: "result",
            subtype: "success",
            result: "첫 번째 일반 구루 답변입니다.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          sdkToolUseMessage(guruSdkToolName("krw_guru_company_brief"), 1, {
            ticker: "SLB",
            question: "SLB durable business quality",
          }),
          sdkToolResultMessage(1, {
            company_filing_brief: {
              dynamic_question_plan: {
                questions: [
                  {
                    question_id: "q_cyclicality",
                    question_en:
                      "Does Data Center Solutions reduce SLB cyclicality?",
                  },
                ],
              },
            },
          }),
          sdkToolUseMessage("Agent", 2, {
            description: "Fetch question-driven company filing evidence",
            subagent_type: "company_evidence_researcher",
            prompt:
              "Use dynamic_question_plan and return evidence_by_question.",
          }),
          sdkToolResultMessage(2, verifiedPack),
          sdkToolUseMessage(
            directOntologySdkToolName("krw_ontology_verify_evidence"),
            20,
            {
              ticker: "SLB",
              questions: [
                {
                  question_id: "q_cyclicality",
                  object_ids: ["claim:SLB:q_cyclicality"],
                },
              ],
            },
          ),
          sdkToolResultMessage(20, verifiedPack),
          sdkToolUseMessage(
            guruSdkToolName("krw_guru_review_company_evidence"),
            3,
            {
              ticker: "SLB",
              question: "SLB durable business quality",
              company_payload: verifiedPack,
            },
          ),
          sdkToolResultMessage(3, {
            what_to_emphasize: ["DCS is promising but not yet cycle-breaking."],
          }),
          {
            type: "result",
            subtype: "success",
            result: "질문별 근거를 반영한 구루 답변입니다.",
            usage: {
              input_tokens: 10,
              output_tokens: 12,
            },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "SLB를 버핏 관점에서 봐줘",
        scopeType: "company",
        defaultTickers: ["SLB"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
        guruLensKey: "buffett",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(result.acc.fullText).toContain("SLB");
    expect(result.acc.fullText).toContain("일반 시장 분위기");
    expect(result.acc.fullText).not.toContain("첫 번째 일반 구루 답변입니다.");
    expect(
      result.acc.toolCalls.some((toolCall) =>
        toolCall.argumentsJson.includes("limited_subagent_return"),
      ),
    ).toBe(true);
  });

  it("does not fail or restart a Guru Advisor run when evidence review is skipped", async () => {
    const badMessages = [
      sdkToolUseMessage(guruSdkToolName("krw_guru_company_brief"), 1, {
        ticker: "SLB",
        question: "SLB durable business quality",
      }),
      sdkToolResultMessage(1, {
        company_filing_brief: {
          dynamic_question_plan: {
            questions: [
              {
                question_en: "Does Data Center Solutions reduce cyclicality?",
              },
            ],
          },
        },
      }),
      sdkToolUseMessage(
        guruSdkToolName("krw_guru_review_company_evidence"),
        2,
        {
          ticker: "SLB",
          question: "SLB durable business quality",
          company_payload: {
            note: "No usable subagent evidence.",
            evidence_status: "limited_subagent_return",
          },
        },
      ),
      sdkToolResultMessage(2, {
        message:
          "The review payload must include evidence_by_question answered from the dynamic_question_plan.",
      }),
      {
        type: "result",
        subtype: "success",
        result: "근거 없이 완성된 답변입니다.",
        usage: {
          input_tokens: 10,
          output_tokens: 12,
        },
      },
    ];
    sdkMocks.query
      .mockReturnValueOnce(makeSdkQuery(badMessages))
      .mockReturnValueOnce(makeSdkQuery(badMessages));

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "SLB를 버핏 관점에서 봐줘",
        scopeType: "company",
        defaultTickers: ["SLB"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
        guruLensKey: "buffett",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.fullText).toContain("SLB");
    expect(result.acc.fullText).toContain("일반 시장 분위기");
    expect(result.acc.fullText).not.toContain("근거 없이 완성된 답변입니다.");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
  });

  it("enables compiler-owned visualization tools only when the feature flag is on", async () => {
    await expect(
      canUseTool("mcp__krw_presentation__compose_visualization"),
    ).resolves.toMatchObject({
      behavior: "deny",
    });

    process.env.KRW_CHARTS_ENABLED = "1";
    await expect(
      canUseTool("mcp__krw_presentation__compose_visualization"),
    ).resolves.toEqual({
      behavior: "allow",
    });

    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "Apple 매출 추이를 요약했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "Apple 매출 추이를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.allowedTools).toContain(
      "mcp__krw_presentation__compose_visualization",
    );
    expect(call.options.mcpServers).toHaveProperty("krw_presentation");
    expect(call.options.systemPrompt.append).toContain("Structured visualization policy");
  });

  it("makes the same visualization tool available to a Guru run without weakening its evidence boundary", async () => {
    process.env.KRW_VISUALIZATIONS_MODE = "on";
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "구루 관점의 최종 답변입니다.",
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "AAPL을 버핏 관점으로 봐줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        runKind: "guru_advisor",
        guruLensKey: "buffett",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.allowedTools).toContain(
      "mcp__krw_presentation__compose_visualization",
    );
    expect(call.options.mcpServers).toHaveProperty("krw_presentation");
    expect(call.options.systemPrompt.append).toContain(
      "sealed company-evidence workflow",
    );
  });

  it("denies Stock News MCP by default and allows it only when explicitly enabled", async () => {
    await expect(
      canUseTool(stockNewsSdkToolName("search_company_news_events"), {
        ticker: "AVGO",
        question: "AVGO recent AI networking news",
      }),
    ).resolves.toMatchObject({
      behavior: "deny",
    });

    process.env.STOCK_NEWS_ENABLED = "1";
    await expect(
      canUseTool(stockNewsSdkToolName("search_company_news_events"), {
        ticker: "AVGO",
        question: "AVGO recent AI networking news",
      }),
    ).resolves.toEqual({ behavior: "allow" });

    process.env.STOCK_NEWS_FORCE_DISABLED = "1";
    await expect(
      canUseTool(stockNewsSdkToolName("search_company_news_events"), {
        ticker: "AVGO",
        question: "AVGO recent AI networking news",
      }),
    ).resolves.toMatchObject({
      behavior: "deny",
    });
  });

  it("keeps Stock News MCP out of company mode", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "공시 근거만으로 답변했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "AVGO를 공시 기준으로 정리해줘",
        scopeType: "company",
        defaultTickers: ["AVGO"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        analysisMode: "company",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
    expect(call.options.systemPrompt.append).toContain(
      "Do not perform web searches",
    );
    expect(call.options.systemPrompt.append).not.toContain(
      "current news/event discovery",
    );
  });

  it("passes company filing anchors from the catalog into the runtime prompt", async () => {
    vi.mocked(getIndexedCompanies).mockResolvedValueOnce([
      {
        ticker: "MU",
        name: "Micron Technology, Inc.",
        sector: "반도체",
        description: "Memory semiconductor company.",
        latest_period: "CY2026Q1",
        coverage: "3개 공시 인덱싱 · 10-K, 10-Q · 최신 CY2026Q1",
        icon: "memory",
        document_count: 3,
        document_types: ["10-K", "10-Q"],
        periods: ["CY2026Q1", "CY2025", "CY2024"],
        documents: [
          {
            period: "CY2026Q1",
            document_type: "10-Q",
            doc_type_key: "10Q",
            generated_at: "2026-05-23T00:35:58.500Z",
          },
          {
            period: "CY2025",
            document_type: "10-K",
            doc_type_key: "10K",
            generated_at: "2026-05-23T00:25:03.839Z",
          },
          {
            period: "CY2024",
            document_type: "10-K",
            doc_type_key: "10K",
            generated_at: "2026-05-23T00:08:51.723Z",
          },
        ],
        generated_at: "2026-05-23T00:35:58.500Z",
      },
    ]);
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "MU는 최신 분기 공시 기준으로 분석했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "MU 지금 손절할까?",
        scopeType: "company",
        defaultTickers: ["MU"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        analysisMode: "company",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.systemPrompt.append).toContain("Company filing anchor");
    expect(call.options.systemPrompt.append).toContain(
      "latest available filing: CY2026Q1 10-Q",
    );
    expect(call.options.systemPrompt.append).toContain(
      "current driver: CY2026Q1 10-Q",
    );
    expect(call.options.systemPrompt.append).toContain(
      "annual baseline: CY2025 10-K",
    );
    expect(call.options.systemPrompt.append).toContain(
      "historical context: CY2024 10-K",
    );
  });

  it("uses Yahoo Finance MCP tools for first-pass news answers", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "공시와 최신 웹 정보를 분리해 답변했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "AVGO 최근 뉴스까지 반영해서 정리해줘",
        scopeType: "company",
        defaultTickers: ["AVGO"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        analysisMode: "news",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.allowedTools).toEqual(
      expect.arrayContaining([
        yahooFinanceSdkToolName("get_yahoo_finance_news"),
        yahooFinanceSdkToolName("get_stock_info"),
      ]),
    );
    expect(call.options.allowedTools).not.toContain(
      sdkToolName("krw_ontology_query_context"),
    );
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
    expect(call.options.mcpServers).toHaveProperty("yahoo_finance");
    expect(call.options.disallowedTools).toEqual(
      expect.arrayContaining(["WebFetch", "WebSearch"]),
    );
    expect(call.options.systemPrompt.append).toContain(
      "current market-news MCP",
    );
    expect(call.options.systemPrompt.append).toContain(
      "Never mention provider names such as Yahoo Finance",
    );
    expect(call.options.systemPrompt.append).toContain(
      "current ticker market/news context",
    );
    expect(call.prompt).toContain("웹앱 뉴스 discovery 실행");
    expect(call.prompt).toContain(
      "현재 시장/뉴스 MCP 도구를 런타임에서 직접 호출",
    );
    expect(call.prompt).toContain(
      "최종 답변에는 Yahoo Finance 같은 provider 이름을 절대 쓰지 말고",
    );
    expect(call.prompt).toContain("/krw-ontology:krw-ontology-news-discovery");
  });

  it("passes user URL context into idea generation without switching to news mode", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "URL 기반으로 후보를 발굴했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "이 URL을 바탕으로 관련 종목을 발굴해줘.",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        analysisMode: "company",
        runKind: "idea_generation",
        selectedNewsEventContext: {
          version: "idea-generation-user-url-context/v1",
          source_pack: {
            ontology_search_brief_en:
              "Find covered companies related to this URL.",
            original_text_for_ontology: "Mechanically extracted page text.",
          },
        },
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.prompt).toContain("/krw-ontology:krw-ontology-idea-generation");
    expect(call.prompt).toContain("<idea_generation_url_context>");
    expect(call.prompt).toContain("Do not switch to news mode");
    expect(call.prompt).toContain(
      "Follow the idea-generation skill's URL workflow",
    );
    expect(call.prompt).not.toContain(
      "at most 3 tickerless query_context calls",
    );
    expect(call.prompt).not.toContain("<selected_news_event_context>");
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
  });

  it("uses selected news context with bounded on-demand filing correlation", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );

    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "선택된 뉴스와 공시 baseline을 연결했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "선택한 이벤트를 공시 기준으로 분석해줘",
        scopeType: "company",
        defaultTickers: ["AVGO"],
        defaultDocumentTypes: [],
        researchMode: "deep",
        analysisMode: "company",
        runKind: "company_research",
        selectedNewsEventContext: {
          id: "event-1",
          event_title: "Broadcom AI networking order update",
          source_previews: [{ title: "source", url: "https://example.test" }],
        },
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.allowedTools).not.toContain(
      sdkToolName("krw_ontology_query_context"),
    );
    expect(call.options.disallowedTools).toEqual(
      expect.arrayContaining([
        sdkToolName("krw_ontology_query_context"),
        sdkToolName("krw_ontology_query"),
      ]),
    );
    expect(call.options.allowedTools).toEqual(
      expect.arrayContaining([
        "mcp__krw-filings__search_catalog_filings",
        "mcp__krw-filings__list_filing_sections",
        "mcp__krw-filings__read_filing_section",
      ]),
    );
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
    expect(call.prompt).toContain(
      "/krw-ontology:krw-ontology-news-filing-correlation",
    );
    expect(call.prompt).toContain("같은 ticker의 시점과 주제가 가까운 8-K 또는 6-K");
    expect(call.prompt).toContain("do not request KRW Ontology retrieval");
    expect(call.prompt).not.toContain("Start KRW ontology retrieval");
    expect(call.prompt).toContain("<selected_news_event_context>");
    expect(call.options.mcpServers).toEqual(
      expect.objectContaining({
        "krw-filings": expect.objectContaining({
          url: "http://127.0.0.1:8785/mcp",
        }),
      }),
    );
  });

  it("uses news-filing correlation with runtime Yahoo Finance tools and no Stock News tools", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );

    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "success",
          result: "주가 변동과 공시 baseline을 연결했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "GOOGL 주가가 왜 6% 빠졌어?",
        scopeType: "company",
        defaultTickers: ["GOOGL"],
        defaultDocumentTypes: [],
        researchMode: "standard",
        runKind: "market_move_research",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.options.allowedTools).not.toContain(
      sdkToolName("krw_ontology_query_context"),
    );
    expect(call.options.allowedTools).toEqual(
      expect.arrayContaining([
        yahooFinanceSdkToolName("get_stock_info"),
        yahooFinanceSdkToolName("get_yahoo_finance_news"),
        "mcp__krw-filings__search_catalog_filings",
        "mcp__krw-filings__get_filing_brief",
        "mcp__krw-filings__read_filing_section",
      ]),
    );
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("read_news_sources"),
    );
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
    expect(call.options.systemPrompt.append).not.toContain("Stock News MCP");
    expect(call.prompt).toContain(
      "/krw-ontology:krw-ontology-news-filing-correlation",
    );
    expect(call.prompt).toContain(
      "웹앱 뉴스·공시 상관관계 research 실행",
    );
    expect(call.prompt).toContain(
      "시장 보도, 회사가 공시로 직접 확인한 사실",
    );
    expect(call.prompt).not.toContain("<selected_news_event_context>");
    expect(call.options.mcpServers).toEqual(
      expect.objectContaining({
        yahoo_finance: expect.objectContaining({
          name: "yahoo_finance",
        }),
        "krw-filings": expect.objectContaining({
          url: "http://127.0.0.1:8785/mcp",
        }),
      }),
    );
  });

  it("passes Yahoo Finance MCP inputs unchanged before execution", async () => {
    const permission = await canUseTool(
      yahooFinanceSdkToolName("get_yahoo_finance_news"),
      {
        ticker: "AAPL",
      },
    );

    expect(permission).toEqual({ behavior: "allow" });
  });

  it("allows Yahoo Finance news during first-pass news discovery", async () => {
    const { permission } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "get_yahoo_finance_news",
      analysisMode: "news",
      runKind: "news_discovery",
      input: {
        ticker: "AAPL",
      },
    });

    expect(permission.behavior).toBe("allow");
  });

  it("allows Yahoo Finance tools during market move research", async () => {
    const { permission } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "get_stock_info",
      analysisMode: "news",
      runKind: "market_move_research",
      input: {
        ticker: "JNJ",
      },
    });

    expect(permission.behavior).toBe("allow");
  });

  it("allows bounded on-demand filing reads during market-move correlation", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );

    const { permission } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "search_catalog_filings",
      analysisMode: "news",
      runKind: "market_move_research",
      input: { ticker: "AAPL", limit: 5 },
    });

    expect(permission).toEqual({ behavior: "allow" });
  });

  it("enforces the correlation-only tool boundary in the authoritative PreToolUse hook", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );
    let decision: unknown;
    sdkMocks.query.mockImplementationOnce(
      (call: {
        options: {
          hooks?: {
            PreToolUse?: Array<{
              hooks: Array<
                (
                  input: Record<string, unknown>,
                  toolUseID: string,
                  options: { signal: AbortSignal },
                ) => Promise<unknown>
              >;
            }>;
          };
        };
      }) =>
        makeSdkQueryFromGenerator(async function* () {
          const hook = call.options.hooks?.PreToolUse?.[0]?.hooks?.[0];
          if (!hook) throw new Error("missing correlation PreToolUse hook");
          decision = await hook(
            {
              hook_event_name: "PreToolUse",
              session_id: "11111111-1111-4111-8111-111111111111",
              transcript_path: "/tmp/transcript.jsonl",
              cwd: "/tmp",
              tool_use_id: "correlation-ontology-tool",
              // The actual SDK PreToolUse event uses a bare MCP name, even
              // though allowedTools uses mcp__server__tool names.
              tool_name: "krw_ontology_query",
              tool_input: { ticker: "MTB", topic: "earnings" },
            },
            "correlation-ontology-tool",
            { signal: new AbortController().signal },
          );
          yield {
            type: "result",
            subtype: "success",
            result: "상관관계 경계를 확인했습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "MTB 주가가 왜 움직였는지 뉴스와 8-K를 함께 봐줘",
        scopeType: "company",
        defaultTickers: ["MTB"],
        defaultDocumentTypes: [],
        researchMode: "standard",
        runKind: "market_move_research",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(hookDecision(decision)).toBe("deny");
  });

  it("allows only one catalog search during a news-filing correlation run", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );
    const decisions: unknown[] = [];
    sdkMocks.query.mockImplementationOnce(
      (call: {
        options: {
          hooks?: {
            PreToolUse?: Array<{
              hooks: Array<
                (
                  input: Record<string, unknown>,
                  toolUseID: string,
                  options: { signal: AbortSignal },
                ) => Promise<unknown>
              >;
            }>;
          };
        };
      }) =>
        makeSdkQueryFromGenerator(async function* () {
          const hook = call.options.hooks?.PreToolUse?.[0]?.hooks?.[0];
          if (!hook) throw new Error("missing correlation PreToolUse hook");
          for (const toolUseId of ["correlation-search-1", "correlation-search-2"]) {
            decisions.push(
              await hook(
                {
                  hook_event_name: "PreToolUse",
                  session_id: "11111111-1111-4111-8111-111111111111",
                  transcript_path: "/tmp/transcript.jsonl",
                  cwd: "/tmp",
                  tool_use_id: toolUseId,
                  tool_name: "search_catalog_filings",
                  tool_input: { ticker: "MTB", limit: 5 },
                },
                toolUseId,
                { signal: new AbortController().signal },
              ),
            );
          }
          yield {
            type: "result",
            subtype: "success",
            result: "공시 카탈로그 검색 횟수를 확인했습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "MTB 주가가 왜 움직였는지 뉴스와 8-K를 함께 봐줘",
        scopeType: "company",
        defaultTickers: ["MTB"],
        defaultDocumentTypes: [],
        researchMode: "standard",
        runKind: "market_move_research",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(hookDecision(decisions[0])).toBe("allow");
    expect(hookDecision(decisions[1])).toBe("deny");
  });

  it("keeps on-demand filing reads unavailable to ordinary company research", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";

    const { permission } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "search_catalog_filings",
      analysisMode: "company",
      runKind: "company_research",
      input: { ticker: "AAPL", limit: 5 },
    });

    expect(permission.behavior).toBe("deny");
    if (permission.behavior === "deny") {
      expect(permission.message).toContain("bounded news-filing correlation");
    }
  });

  it("enables on-demand filing correlation for an explicit recent 8-K request", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );

    const { permission, result } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "search_catalog_filings",
      analysisMode: "company",
      runKind: "company_research",
      userMessage: "AAPL 최근 8-K 원문을 뉴스와 함께 확인해줘",
      input: { ticker: "AAPL", limit: 5 },
    });

    expect(permission).toEqual({ behavior: "allow" });
    const call = sdkMocks.query.mock.calls[0]?.[0];
    expect(call.prompt).toContain(
      "/krw-ontology:krw-ontology-news-filing-correlation",
    );
    expect(result.status).toBe("completed");
  });

  it("limits on-demand filing calls separately during market-move correlation", async () => {
    process.env.FILINGS_MCP_ENABLED = "1";
    process.env.FILINGS_MCP_AUTH_TOKEN = "test-filings-service-secret";
    process.env.FILINGS_MCP_MAX_CALLS = "2";
    writeFileSync(
      "/tmp/krw-ontology-plugin/.mcp.json",
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
            alwaysLoad: true,
          },
          "krw-filings": {
            type: "http",
            url: "http://127.0.0.1:8785/mcp",
            alwaysLoad: true,
          },
        },
      }),
    );

    const { permission } = await probeToolPermission({
      existingTools: ["search_catalog_filings", "get_filing"],
      attemptedTool: "get_filing_brief",
      analysisMode: "news",
      runKind: "market_move_research",
      input: {
        filing_event_id: "123e4567-e89b-42d3-a456-426614174000",
      },
    });

    expect(permission.behavior).toBe("deny");
    if (permission.behavior === "deny") {
      expect(permission.message).toContain("No more on-demand SEC filing tools");
    }
  });

  it("denies Yahoo Finance tools outside news and market-move workflows", async () => {
    const { permission } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "get_yahoo_finance_news",
      analysisMode: "company",
      runKind: "company_research",
      input: {
        ticker: "AAPL",
      },
    });

    expect(permission.behavior).toBe("deny");
    if (permission.behavior === "deny") {
      expect(permission.message).toContain("first-pass news and market-move");
    }
  });

  it("limits Yahoo Finance MCP calls separately from ontology calls", async () => {
    process.env.YAHOO_FINANCE_MAX_CALLS = "2";

    const { permission, result } = await probeToolPermission({
      existingTools: ["get_yahoo_finance_news", "get_stock_info"],
      attemptedTool: "get_yahoo_finance_news",
      analysisMode: "news",
      runKind: "news_discovery",
      input: {
        ticker: "AAPL",
      },
    });

    expect(result.status).toBe("completed");
    expect(permission.behavior).toBe("deny");
    if (permission.behavior === "deny") {
      expect(permission.message).toContain("No more current market-news tools");
      expect(permission.message).toContain("news results");
    }
  });

  it("bounds full response detail before KRW ontology tool execution", async () => {
    const permission = await canUseTool(sdkToolName("krw_ontology_query"), {
      topic: "AAPL revenue breakdown",
      response_detail: "full",
    });

    expect(permission.behavior).toBe("allow");
    if (permission.behavior === "allow") {
      expect(permission.updatedInput).toEqual({
        topic: "AAPL revenue breakdown",
        response_detail: "compact",
      });
    }
  });

  it("forwards legacy query_context arguments to the MCP contract boundary", async () => {
    const permission = await canUseTool(
      sdkToolName("krw_ontology_query_context"),
      {
        question: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
      },
    );

    expect(permission).toEqual({ behavior: "allow" });
  });

  it("allows Korean questions carried by SearchPlan v2", async () => {
    const permission = await canUseTool(
      sdkToolName("krw_ontology_query_context"),
      ontologySearchPlanInput({
        question: "Apple 매출 구조를 정리해줘",
        ticker: "AAPL",
      }),
    );

    expect(permission.behavior).toBe("allow");
  });

  it("records original Korean tool arguments in the accumulated run", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        toolUseMessageWithInput(
          "krw_ontology_query_context",
          1,
          ontologySearchPlanInput({
            question: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
          }),
        ),
        toolResultMessage(1),
        {
          type: "result",
          subtype: "success",
          result: "소비재 기업 공시 신호를 요약했습니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const args = JSON.parse(result.acc.toolCalls[0]?.argumentsJson ?? "{}");
    expect(args).toEqual(
      ontologySearchPlanInput({
        question: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
      }),
    );
  });

  it("fails instead of completing when the SDK result arrives with an open tool call", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        toolUseMessage("krw_ontology_retrieve", 1),
        {
          type: "result",
          subtype: "success",
          result: "불완전한 답변입니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const onToolCallEnd = vi.fn();
    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
        researchMode: "deep",
        onToolCallEnd,
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("tool_result_missing");
    expect(onToolCallEnd).not.toHaveBeenCalled();
    expect(result.acc.toolCalls[0]?.finishedAt).toBeNull();
  });

  it("prefers query_context ResearchState v2 structuredContent over duplicate text", async () => {
    const researchState = {
      contract_version: "research-state/v2",
      release_id: "release-1",
      answerability: { status: "answerable" },
      evidence_units: [
        {
          evidence_id: "ev-direct",
          object_id: null,
          object_type: "ResearchClaim",
          ticker: "AAPL",
          period: "CY2026Q1",
          document_type: "10-Q",
          title: "Services are growing",
          summary: "Services revenue continued to grow in the latest quarter.",
          directness: "direct",
          evidence_grade: "strong",
          source: {
            object_ids: ["claim:AAPL:services"],
            quote_ids: ["quote:AAPL:services"],
            span_ids: ["span:AAPL:services"],
          },
        },
        {
          evidence_id: "ev-metric",
          object_id: "metric:AAPL:margin",
          object_type: "MetricObservation",
          ticker: "AAPL",
          period: "CY2026Q1",
          document_type: "10-Q",
          title: "Margin observation",
          summary: "The metric lineage supports the reported margin direction.",
          directness: "metric_lineage",
          evidence_grade: "medium",
          source: {
            object_ids: ["metric:AAPL:margin"],
            quote_ids: [],
            span_ids: ["span:AAPL:margin"],
          },
        },
        {
          evidence_id: "ev-related",
          object_id: "factor:AAPL:risk",
          object_type: "BusinessFactor",
          ticker: "AAPL",
          period: "CY2025",
          document_type: "10-K",
          title: "Related risk",
          summary: "A related risk factor remains relevant to interpretation.",
          directness: "related",
          evidence_grade: "weak",
          source: {
            object_ids: ["factor:AAPL:risk"],
            quote_ids: [],
            span_ids: [],
          },
        },
      ],
    };
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        toolUseMessage("krw_ontology_query_context", 1),
        {
          type: "user",
          tool_use_result: {
            content: [{ type: "text", text: "duplicate serialized content" }],
            structuredContent: researchState,
          },
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "fallback text JSON",
              },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "구조화 근거를 사용한 최종 답변입니다.",
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111122",
        userMessage: "AAPL 사업 구조를 설명해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.toolCalls[0]?.resultJson).toEqual(researchState);
    expect(result.acc.toolCalls[0]?.resultText).toBe(
      JSON.stringify(researchState),
    );
    expect(result.acc.toolCalls[0]?.resultText).not.toContain(
      "duplicate serialized content",
    );
    expect(result.acc.citations).toEqual([
      expect.objectContaining({
        object_id: "claim:AAPL:services",
        ticker: "AAPL",
        document_type: "10-Q",
        period: "CY2026Q1",
        claim_text: "Services revenue continued to grow in the latest quarter.",
        quote_text: null,
        evidence_grade: "high",
        source_quality: "filing_direct",
      }),
      expect.objectContaining({
        object_id: "metric:AAPL:margin",
        evidence_grade: "medium",
        source_quality: "derived",
      }),
      expect.objectContaining({
        object_id: "factor:AAPL:risk",
        evidence_grade: "low",
        source_quality: "derived",
      }),
    ]);
  });

  it("does not run a compose-only pass when the SDK errors before answer text", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "result",
          subtype: "error_during_execution",
          errors: ["tool_budget_exceeded: query calls"],
        },
      ]),
    );

    const streamWriter = {
      write: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "Apple 매출 구조를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "standard",
      },
      streamWriter,
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("tool_budget_exceeded");
    expect(result.acc.fullText).toBe("");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);

    const researchCall = sdkMocks.query.mock.calls[0]?.[0];
    expect(researchCall.prompt).toContain(
      "/krw-ontology:krw-ontology-research",
    );
    expect(researchCall.options.allowedTools).toEqual(
      expect.arrayContaining([
        sdkToolName("krw_ontology_query_context"),
        sdkToolName("krw_ontology_query"),
      ]),
    );
  });

  it("does not expose interim assistant text when the SDK ends with tool budget exhaustion", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "이미 수집된 근거 기준 최종 답변입니다.",
              },
            ],
          },
        },
        {
          type: "result",
          subtype: "error_during_execution",
          errors: ["tool_budget_exceeded: max tool calls"],
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "Apple 매출 구조를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("tool_budget_exceeded");
    expect(result.acc.fullText).toBe("");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
  });

  it("renders only the terminal SDK result, never interim assistant narration", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "Now let me correct the SearchPlan before answering.",
              },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "최종 사용자 답변입니다.",
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "Apple 매출 구조를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.fullText).toBe("최종 사용자 답변입니다.");
    expect(result.acc.fullText).not.toContain("SearchPlan");
  });

  it("allows deep retrieve calls beyond the previous per-tool retrieve limit", async () => {
    const { permission } = await probeToolPermission({
      existingTools: [
        "krw_ontology_query_context",
        "krw_ontology_retrieve",
        "krw_ontology_retrieve",
      ],
      attemptedTool: "krw_ontology_retrieve",
    });

    expect(permission.behavior).toBe("allow");
    if (permission.behavior === "allow") {
      expect(permission.updatedInput).toEqual({
        agent_context: {
          tool_usage: {
            total: 3,
            krw_ontology_retrieve: 2,
          },
        },
      });
    }
  });

  it("records retrieve tool usage metadata on repeated retrieve tool calls", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        toolUseMessage("krw_ontology_retrieve", 1),
        toolResultMessage(1),
        toolUseMessage("krw_ontology_retrieve", 2),
        toolResultMessage(2),
        toolUseMessage("krw_ontology_retrieve", 3),
        toolResultMessage(3),
        {
          type: "result",
          subtype: "success",
          result: "반복 retrieve 메타데이터 테스트 답변입니다.",
          usage: {
            input_tokens: 10,
            output_tokens: 12,
          },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        userMessage: "Apple 매출 구조를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      {
        write: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.status).toBe("completed");
    const thirdArgs = JSON.parse(
      result.acc.toolCalls[2]?.argumentsJson ?? "{}",
    );
    expect(thirdArgs.agent_context).toEqual({
      tool_usage: {
        total: 2,
        krw_ontology_retrieve: 2,
      },
    });
  });

  it("forwards SearchPlan semantics to the MCP contract boundary", async () => {
    const decisions: Record<string, unknown> = {};
    sdkMocks.query.mockImplementationOnce(
      (call: {
        options: {
          hooks?: {
            PreToolUse?: Array<{
              hooks: Array<
                (
                  input: Record<string, unknown>,
                  toolUseID: string,
                  options: { signal: AbortSignal },
                ) => Promise<unknown>
              >;
            }>;
          };
        };
      }) =>
        makeSdkQueryFromGenerator(async function* () {
          const hook = call.options.hooks?.PreToolUse?.[0]?.hooks?.[0];
          if (!hook) throw new Error("missing normal research PreToolUse hook");
          const invoke = (toolInput: Record<string, unknown>) =>
            hook(
              {
                hook_event_name: "PreToolUse",
                session_id: "11111111-1111-4111-8111-111111111111",
                transcript_path: "/tmp/transcript.jsonl",
                cwd: "/tmp",
                tool_use_id: "normal-hook-tool",
                tool_name: sdkToolName("krw_ontology_query_context"),
                tool_input: toolInput,
              },
              "normal-hook-tool",
              { signal: new AbortController().signal },
            );

          decisions.legacy = await invoke({ question: "AAPL revenue" });
          decisions.invalidPlan = await invoke({ search_plan: {} });
          decisions.validPlan = await invoke(
            ontologySearchPlanInput({
              question: "AAPL revenue structure",
              ticker: "AAPL",
            }),
          );
          decisions.normalizedPlan = await invoke({
            ...ontologySearchPlanInput({
              question: " AAPL revenue structure ",
              ticker: "AAPL",
            }),
            question: "legacy root field",
          });
          yield {
            type: "result",
            subtype: "success",
            result: "공시 근거로 매출 구조를 정리했습니다.",
            usage: { input_tokens: 10, output_tokens: 12 },
          };
        }),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111128",
        userMessage: "AAPL 매출 구조를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(hookDecision(decisions.legacy)).toBe("allow");
    expect(hookDecision(decisions.invalidPlan)).toBe("allow");
    expect(hookDecision(decisions.validPlan)).toBe("allow");
    expect(hookDecision(decisions.normalizedPlan)).toBe("allow");
    expect(hookUpdatedInput(decisions.normalizedPlan)).toBeUndefined();
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
  });

  it("does not request an answer envelope or a second SDK pass", async () => {
    process.env.RESEARCH_ANSWER_ENVELOPE_ENABLED = "1";
    const researchState = {
      contract_version: "research-state/v2",
      answerability: { status: "answerable", strong_claim_allowed: true },
      evidence_units: [
        {
          directness: "direct",
          evidence_grade: "strong",
          source: { object_ids: ["claim:AAPL:services"] },
        },
      ],
    };
    const envelope = {
      format: "krw-research-answer-envelope/v1",
      final_answer: "서비스 관련 근거가 최신 공시에서 직접 확인됩니다.",
      claims: [
        {
          claim_id: "services-fact",
          kind: "fact",
          statement: "서비스 관련 근거가 최신 공시에서 직접 확인됩니다.",
          premise_object_ids: ["claim:AAPL:services"],
          assumptions: [],
          counter_signals: [],
        },
      ],
      gaps: [],
    };
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        toolUseMessageWithInput(
          "krw_ontology_query_context",
          1,
          ontologySearchPlanInput({
            question: "AAPL 서비스 구조",
            ticker: "AAPL",
          }),
        ),
        {
          type: "user",
          tool_use_result: { structuredContent: researchState },
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: JSON.stringify(researchState),
              },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: JSON.stringify(envelope),
          structured_output: envelope,
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      ]),
    );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111129",
        userMessage: "AAPL 서비스 구조를 정리해줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.fullText).toBe(JSON.stringify(envelope));
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(
      sdkMocks.query.mock.calls[0]?.[0]?.options.outputFormat,
    ).toBeUndefined();
  });

  it("does not start a rewrite run for a partial answer result", async () => {
    process.env.RESEARCH_ANSWER_ENVELOPE_ENABLED = "1";
    process.env.KRW_CHARTS_ENABLED = "1";
    const researchState = {
      contract_version: "research-state/v2",
      answerability: { status: "partial", strong_claim_allowed: false },
      evidence_units: [
        {
          directness: "direct",
          evidence_grade: "strong",
          source: { object_ids: ["claim:AAPL:services"] },
        },
      ],
      missing_parts: ["지역별 수요"],
      continuation: { omitted_evidence_count: 2, has_more: true },
      warnings: ["planned evidence truncated"],
    };
    const unsafeEnvelope = {
      format: "krw-research-answer-envelope/v1",
      final_answer: "서비스가 성장했으니 수익성 개선은 확정입니다.",
      claims: [
        {
          claim_id: "unsupported-certainty",
          kind: "inference",
          statement: "서비스가 성장했으니 수익성 개선은 확정입니다.",
          premise_object_ids: ["claim:AAPL:services"],
          assumptions: [],
          counter_signals: [],
        },
      ],
      gaps: [],
    };
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          toolUseMessage("krw_ontology_query_context", 1),
          {
            type: "user",
            tool_use_result: { structuredContent: researchState },
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "tool-1",
                  content: JSON.stringify(researchState),
                },
              ],
            },
          },
          {
            type: "result",
            subtype: "success",
            result: JSON.stringify(unsafeEnvelope),
            structured_output: unsafeEnvelope,
            usage: { input_tokens: 10, output_tokens: 12 },
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "success",
            result:
              "서비스 관련 근거는 수익성 방어 가능성을 시사합니다. 다만 지역별 수요는 다음 실적의 제품 믹스와 지역 매출을 함께 확인해야 합니다.",
            usage: { input_tokens: 4, output_tokens: 8 },
          },
        ]),
      );

    const result = await runAgent(
      {
        sessionId: "11111111-1111-4111-8111-111111111130",
        userMessage: "AAPL 수익성 전망을 봐줘",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
        researchMode: "deep",
      },
      { write: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result.status).toBe("completed");
    expect(result.acc.fullText).toBe(JSON.stringify(unsafeEnvelope));
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(
      sdkMocks.query.mock.calls[0]?.[0]?.options.outputFormat,
    ).toBeUndefined();
  });

  it("allows repeated deep query, trace, and compare calls while total cap remains", async () => {
    const scenarios: Array<{
      existingTools: MCPToolName[];
      attemptedTool: MCPToolName;
    }> = [
      {
        existingTools: [
          "krw_ontology_query_context",
          ...Array.from<MCPToolName>({ length: 12 }).fill("krw_ontology_query"),
        ],
        attemptedTool: "krw_ontology_query",
      },
      {
        existingTools: [
          "krw_ontology_query_context",
          ...Array.from<MCPToolName>({ length: 16 }).fill("krw_ontology_trace"),
        ],
        attemptedTool: "krw_ontology_chain",
      },
      {
        existingTools: [
          "krw_ontology_query_context",
          ...Array.from<MCPToolName>({ length: 6 }).fill(
            "krw_ontology_compare",
          ),
        ],
        attemptedTool: "krw_ontology_compare",
      },
    ];

    for (const scenario of scenarios) {
      const { permission } = await probeToolPermission(scenario);
      expect(permission).toEqual({ behavior: "allow" });
    }
  });

  it("denies only projected total tool-call overflow and still completes when the research pass answers", async () => {
    const budget = getResearchModeToolBudget("deep");
    const { permission, result } = await probeToolPermission({
      existingTools: Array.from<MCPToolName>({
        length: budget.maxToolCalls,
      }).fill("krw_ontology_query"),
      attemptedTool: "krw_ontology_chain",
    });

    expect(result.status).toBe("completed");
    expect(permission.behavior).toBe("deny");
    if (permission.behavior === "deny") {
      expect(permission.message).toContain("No more KRW Ontology MCP tools");
      expect(permission.message).toContain("Do not call another tool");
      expect(permission.message).toContain("final Korean Markdown answer");
      expect(permission.message).not.toContain("krw_ontology_retrieve");
      expect(permission.message).not.toContain(
        "one targeted krw_ontology_query",
      );
    }
  });

  it("honors AGENT_MAX_TOOL_CALLS as a lower total cap without failing when the research pass answers", async () => {
    const previousValue = process.env.AGENT_MAX_TOOL_CALLS;
    process.env.AGENT_MAX_TOOL_CALLS = "3";

    try {
      const { permission, result } = await probeToolPermission({
        existingTools: [
          "krw_ontology_query_context",
          "krw_ontology_query",
          "krw_ontology_trace",
        ],
        attemptedTool: "krw_ontology_chain",
      });

      expect(result.status).toBe("completed");
      expect(permission.behavior).toBe("deny");
      if (permission.behavior === "deny") {
        expect(permission.message).toContain("No more KRW Ontology MCP tools");
      }
    } finally {
      if (previousValue === undefined) {
        delete process.env.AGENT_MAX_TOOL_CALLS;
      } else {
        process.env.AGENT_MAX_TOOL_CALLS = previousValue;
      }
    }
  });
});
