import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisMode,
  MCPToolName,
  RunKind,
  StockNewsMCPToolName,
} from "@/types/api-contracts";

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdkMocks);
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompanies: vi.fn().mockResolvedValue([]),
}));
vi.mock("./mcp-client", () => {
  const tools = [
    "krw_ontology_query_context",
    "krw_ontology_query",
    "krw_ontology_trace",
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
  return {
    KRW_ONTOLOGY_MCP_TOOLS: tools,
    STOCK_NEWS_MCP_TOOLS: stockNewsTools,
    KRW_ONTOLOGY_SDK_ALLOWED_TOOLS: tools.map(
      (toolName) => `mcp__plugin_krw-ontology_krw-ontology__${toolName}`,
    ),
    STOCK_NEWS_SDK_ALLOWED_TOOLS: stockNewsTools.map(
      (toolName) => `mcp__plugin_krw-ontology_stock-news__${toolName}`,
    ),
    getKrwOntologyPluginPath: () => "/tmp/krw-ontology-plugin",
    getStockNewsSdkAllowedTools: () =>
      process.env.STOCK_NEWS_ENABLED === "1" &&
      process.env.STOCK_NEWS_FORCE_DISABLED !== "1"
        ? stockNewsTools.map(
            (toolName) => `mcp__plugin_krw-ontology_stock-news__${toolName}`,
          )
        : [],
    isKrwOntologySdkTool: (toolName: string) =>
      toolName.startsWith("mcp__plugin_krw-ontology_krw-ontology__krw_ontology_"),
    isStockNewsEnabled: () =>
      process.env.STOCK_NEWS_ENABLED === "1" &&
      process.env.STOCK_NEWS_FORCE_DISABLED !== "1",
    isStockNewsSdkTool: (toolName: string) =>
      toolName.startsWith("mcp__plugin_krw-ontology_stock-news__"),
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
  };
  return sdkQuery;
}

function sdkToolName(toolName: MCPToolName): string {
  if (isStockNewsToolName(toolName)) return stockNewsSdkToolName(toolName);
  return `mcp__plugin_krw-ontology_krw-ontology__${toolName}`;
}

function stockNewsSdkToolName(toolName: StockNewsMCPToolName): string {
  return `mcp__plugin_krw-ontology_stock-news__${toolName}`;
}

function isStockNewsToolName(toolName: MCPToolName): toolName is StockNewsMCPToolName {
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

function toolUseMessage(toolName: MCPToolName, index: number) {
  return toolUseMessageWithInput(toolName, index, {});
}

function toolUseMessageWithInput(
  toolName: MCPToolName,
  index: number,
  input: Record<string, unknown>,
) {
  return {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: `tool-${index}`,
          name: sdkToolName(toolName),
          input,
        },
      ],
    },
  };
}

function toolResultMessage(index: number) {
  return {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: `tool-${index}`,
          content: JSON.stringify({ ok: true, index }),
        },
      ],
    },
  };
}

async function probeToolPermission(params: {
  existingTools: MCPToolName[];
  attemptedTool: MCPToolName;
  input?: Record<string, unknown>;
  researchMode?: ResearchMode;
  analysisMode?: AnalysisMode;
  runKind?: RunKind;
  selectedNewsEventContext?: Record<string, unknown> | null;
}): Promise<{
  permission: Awaited<ReturnType<typeof canUseTool>>;
  result: Awaited<ReturnType<typeof runAgent>>;
}> {
  let permission: Awaited<ReturnType<typeof canUseTool>> | null = null;
  sdkMocks.query.mockImplementationOnce((call: {
    options: {
      canUseTool?: typeof canUseTool;
    };
  }) =>
    makeSdkQueryFromGenerator(async function* () {
      for (const [index, toolName] of params.existingTools.entries()) {
        yield toolUseMessage(toolName, index);
        yield toolResultMessage(index);
      }

      permission = await call.options.canUseTool?.(
        sdkToolName(params.attemptedTool),
        params.input ?? {},
      ) ?? {
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
      userMessage: "Apple 매출 구조를 정리해줘",
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
    sdkMocks.getSessionInfo.mockResolvedValue(undefined);
    delete process.env.STOCK_NEWS_FORCE_DISABLED;
    delete process.env.STOCK_NEWS_ENABLED;
    delete process.env.STOCK_NEWS_MAX_CALLS;
    delete process.env.ZAI_API_KEY;
  });

  it("keeps the deep mode total tool budget unchanged", () => {
    expect(getResearchModeToolBudget("deep")).toEqual({
      maxToolCalls: 32,
    });
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
  });

  it("keeps retrieve available in the current deep web-chat tool set", () => {
    expect(getAllowedMcpToolsForResearchMode("deep")).toContain(
      "krw_ontology_retrieve",
    );
    expect(buildResearchModePrompt("deep")).toContain(
      "Never request response_detail: full",
    );
  });

  it("forbids full response detail in every research mode prompt", () => {
    const modes: ResearchMode[] = ["fast", "standard", "deep"];
    for (const mode of modes) {
      expect(buildResearchModePrompt(mode)).toContain(
        "Never request response_detail: full",
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
    expect(call.options.systemPrompt.append).toContain(
      "Do not perform web searches",
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

  it("uses discovery-only Stock News tools for the first news pass", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";

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
        stockNewsSdkToolName("search_company_news_events"),
        stockNewsSdkToolName("build_news_timeline"),
      ]),
    );
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("read_news_sources"),
    );
    expect(call.options.allowedTools).not.toContain(
      sdkToolName("krw_ontology_query_context"),
    );
    expect(call.options.disallowedTools).toEqual(
      expect.arrayContaining(["WebFetch", "WebSearch"]),
    );
    expect(call.options.systemPrompt.append).toContain("Stock News MCP");
    expect(call.options.systemPrompt.append).toContain(
      "current news/event discovery",
    );
    expect(call.prompt).toContain("웹앱 뉴스 discovery 실행");
    expect(call.prompt).toContain("read_news_sources와 KRW Ontology 도구는 호출하지 않습니다");
    expect(call.prompt).toContain(
      "/krw-ontology:krw-ontology-news-discovery",
    );
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
            ontology_search_brief_en: "Find covered companies related to this URL.",
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
    expect(call.prompt).not.toContain("<selected_news_event_context>");
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
  });

  it("uses selected-source news tools and ontology tools for the news research pass", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";

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
        analysisMode: "news",
        runKind: "news_research",
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
    expect(call.options.allowedTools).toEqual(
      expect.arrayContaining([
        stockNewsSdkToolName("read_news_sources"),
        sdkToolName("krw_ontology_query_context"),
      ]),
    );
    expect(call.options.allowedTools).not.toContain(
      stockNewsSdkToolName("search_company_news_events"),
    );
    expect(call.prompt).toContain("웹앱 뉴스 research 실행");
    expect(call.prompt).toContain(
      "/krw-ontology:krw-ontology-news-research",
    );
    expect(call.prompt).not.toContain(
      "/krw-ontology:krw-ontology-research 선택한 이벤트를 공시 기준으로 분석해줘",
    );
    expect(call.prompt).toContain("<selected_news_event_context>");
  });

  it("passes Stock News MCP inputs unchanged before execution", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";

    const permission = await canUseTool(stockNewsSdkToolName("search_company_news_events"), {
      ticker: "AAPL",
      question: "AAPL latest services news",
      max_events: 5,
    });

    expect(permission).toEqual({ behavior: "allow" });
  });

  it("binds read_news_sources to selected preferred source URLs", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";

    const selectedUrl =
      "https://www.reuters.com/markets/technology/broadcom-ai-networking-orders-2026-06-01/";
    const { permission } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "read_news_sources",
      analysisMode: "news",
      runKind: "news_research",
      input: {
        urls: [
          "https://malicious.example/internal",
          selectedUrl,
        ],
      },
      selectedNewsEventContext: {
        source_pack: {
          source_urls: [selectedUrl],
        },
        source_previews: [{ title: "Reuters", url: selectedUrl }],
      },
    });

    expect(permission.behavior).toBe("allow");
    if (permission.behavior === "allow") {
      expect(permission.updatedInput).toEqual({ urls: [selectedUrl] });
    }
  });

  it("denies read_news_sources when the selected event has no eligible source URL", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";

    const { permission } = await probeToolPermission({
      existingTools: [],
      attemptedTool: "read_news_sources",
      analysisMode: "news",
      runKind: "news_research",
      input: {
        urls: ["https://www.reuters.com/markets/technology/broadcom-ai/"],
      },
      selectedNewsEventContext: {
        source_previews: [{ title: "user URL", url: "https://example.test/a" }],
      },
    });

    expect(permission.behavior).toBe("deny");
    if (permission.behavior === "deny") {
      expect(permission.message).toContain("selected preferred market-news URLs");
    }
  });

  it("limits Stock News MCP calls separately from ontology calls", async () => {
    process.env.STOCK_NEWS_ENABLED = "1";
    process.env.STOCK_NEWS_MAX_CALLS = "2";

    const { permission, result } = await probeToolPermission({
      existingTools: ["search_company_news_events", "read_news_sources"],
      attemptedTool: "audit_news_sources",
      analysisMode: "news",
      runKind: "news_research",
    });

    expect(result.status).toBe("completed");
    expect(permission.behavior).toBe("deny");
    if (permission.behavior === "deny") {
      expect(permission.message).toContain("No more Stock News MCP tools");
      expect(permission.message).toContain("filing evidence");
    }
  });

  it("downgrades full response detail before KRW ontology tool execution", async () => {
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

  it("passes Korean research inputs unchanged before execution", async () => {
    const permission = await canUseTool(sdkToolName("krw_ontology_query_context"), {
      question: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
    });

    expect(permission).toEqual({ behavior: "allow" });
  });

  it("allows Korean company questions", async () => {
    const permission = await canUseTool(sdkToolName("krw_ontology_query_context"), {
      question: "Apple 매출 구조를 정리해줘",
      ticker: "AAPL",
    });

    expect(permission.behavior).toBe("allow");
  });

  it("records original Korean tool arguments in the accumulated run", async () => {
    sdkMocks.query.mockReturnValueOnce(
      makeSdkQuery([
        toolUseMessageWithInput("krw_ontology_query_context", 1, {
          question: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
          limit_results: 10,
          limit_tickers: 20,
        }),
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
    expect(args).toEqual({
      question: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
      limit_results: 10,
      limit_tickers: 20,
    });
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

  it("keeps the research pass answer when the SDK reports tool budget exhaustion after text", async () => {
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

    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(result.acc.fullText).toContain("최종 답변");
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
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
    const thirdArgs = JSON.parse(result.acc.toolCalls[2]?.argumentsJson ?? "{}");
    expect(thirdArgs.agent_context).toEqual({
      tool_usage: {
        total: 2,
        krw_ontology_retrieve: 2,
      },
    });
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
          ...Array.from<MCPToolName>({ length: 6 }).fill("krw_ontology_compare"),
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
      expect(permission.message).not.toContain("one targeted krw_ontology_query");
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
