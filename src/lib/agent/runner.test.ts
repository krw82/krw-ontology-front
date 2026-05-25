import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPToolName } from "@/types/api-contracts";

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdkMocks);
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompany: vi.fn().mockResolvedValue(null),
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
  return {
    KRW_ONTOLOGY_MCP_TOOLS: tools,
    KRW_ONTOLOGY_SDK_ALLOWED_TOOLS: tools.map(
      (toolName) => `mcp__plugin_krw-ontology_krw-ontology__${toolName}`,
    ),
    getKrwOntologyPluginPath: () => "/tmp/krw-ontology-plugin",
    isKrwOntologySdkTool: (toolName: string) =>
      toolName.startsWith("mcp__plugin_krw-ontology_krw-ontology__krw_ontology_"),
  };
});

import {
  buildResearchModePrompt,
  getAllowedMcpToolsForResearchMode,
  getResearchModeToolBudget,
  type ResearchMode,
} from "@/lib/research-mode";
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
  return `mcp__plugin_krw-ontology_krw-ontology__${toolName}`;
}

function toolUseMessage(toolName: MCPToolName, index: number) {
  return {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: `tool-${index}`,
          name: sdkToolName(toolName),
          input: {},
        },
      ],
    },
  };
}

async function probeBudgetDenyMessage(params: {
  existingTools: MCPToolName[];
  attemptedTool: MCPToolName;
}): Promise<string> {
  let denyMessage = "";
  sdkMocks.query.mockImplementationOnce((call: {
    options: {
      canUseTool?: (toolName: string) => Promise<{
        behavior: "allow" | "deny";
        message?: string;
      }>;
    };
  }) =>
    makeSdkQueryFromGenerator(async function* () {
      for (const [index, toolName] of params.existingTools.entries()) {
        yield toolUseMessage(toolName, index);
      }

      const permission = await call.options.canUseTool?.(
        sdkToolName(params.attemptedTool),
      );
      denyMessage = permission?.message ?? "";

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
      researchMode: "deep",
    },
    {
      write: vi.fn().mockResolvedValue(undefined),
    },
  );

  expect(result.status).toBe("completed");
  expect(denyMessage).toBeTruthy();
  return denyMessage;
}

describe("agent runner research budget recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.getSessionInfo.mockResolvedValue(undefined);
  });

  it("keeps the deep mode tool budget unchanged", () => {
    expect(getResearchModeToolBudget("deep")).toEqual({
      maxToolCalls: 32,
      queryContext: 4,
      query: 12,
      retrieve: 2,
      traceChain: 16,
      compare: 6,
    });
  });

  it("keeps retrieve available in the current deep web-chat tool set", () => {
    expect(getAllowedMcpToolsForResearchMode("deep")).toContain(
      "krw_ontology_retrieve",
    );
    expect(buildResearchModePrompt("deep")).toContain(
      "avoid unscoped retrieve",
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

  it("recovers tool budget exhaustion by running a compose-only pass", async () => {
    sdkMocks.query
      .mockReturnValueOnce(
        makeSdkQuery([
          {
            type: "result",
            subtype: "error_during_execution",
            errors: ["tool_budget_exceeded: query calls"],
          },
        ]),
      )
      .mockReturnValueOnce(
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

    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(result.acc.fullText).toContain("iPhone과 Services");
    expect(sdkMocks.query).toHaveBeenCalledTimes(2);

    const composeCall = sdkMocks.query.mock.calls[1]?.[0];
    expect(composeCall.options.allowedTools).toEqual([]);
    expect(composeCall.options.resume).toBeUndefined();
    expect(composeCall.options.sessionId).not.toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(composeCall.options.disallowedTools).toBeUndefined();
    expect(composeCall.prompt).toContain("Do not call any tools.");
  });

  it("guides compare overflow toward existing evidence and one targeted query when query remains", async () => {
    const budget = getResearchModeToolBudget("deep");
    const message = await probeBudgetDenyMessage({
      existingTools: [
        "krw_ontology_query_context",
        ...Array.from<MCPToolName>({ length: budget.compare }).fill("krw_ontology_compare"),
      ],
      attemptedTool: "krw_ontology_compare",
    });

    expect(message).toContain("Do not call krw_ontology_compare again");
    expect(message).toContain("Use existing comparison evidence");
    expect(message).toContain("one targeted krw_ontology_query");
    expect(message).toContain("final Korean Markdown answer");
  });

  it("does not suggest query after compare overflow when query is already exhausted", async () => {
    const budget = getResearchModeToolBudget("deep");
    const message = await probeBudgetDenyMessage({
      existingTools: [
        "krw_ontology_query_context",
        ...Array.from<MCPToolName>({ length: budget.query }).fill("krw_ontology_query"),
        ...Array.from<MCPToolName>({ length: budget.compare }).fill("krw_ontology_compare"),
      ],
      attemptedTool: "krw_ontology_compare",
    });

    expect(message).toContain("Do not call krw_ontology_compare again");
    expect(message).not.toContain("one targeted krw_ontology_query");
    expect(message).toContain("final Korean Markdown answer");
  });

  it("guides query overflow toward trace or chain only when trace/chain remains", async () => {
    const budget = getResearchModeToolBudget("deep");
    const message = await probeBudgetDenyMessage({
      existingTools: [
        "krw_ontology_query_context",
        ...Array.from<MCPToolName>({ length: budget.query }).fill("krw_ontology_query"),
      ],
      attemptedTool: "krw_ontology_query",
    });

    expect(message).toContain("Do not call krw_ontology_query again");
    expect(message).toContain("krw_ontology_trace or krw_ontology_chain");
    expect(message).toContain("final Korean Markdown answer");
  });

  it("does not suggest trace or chain after query overflow when trace/chain is exhausted", async () => {
    const budget = getResearchModeToolBudget("deep");
    const message = await probeBudgetDenyMessage({
      existingTools: [
        "krw_ontology_query_context",
        ...Array.from<MCPToolName>({ length: budget.query }).fill("krw_ontology_query"),
        ...Array.from<MCPToolName>({ length: budget.traceChain }).fill("krw_ontology_trace"),
      ],
      attemptedTool: "krw_ontology_query",
    });

    expect(message).toContain("Do not call krw_ontology_query again");
    expect(message).not.toContain("krw_ontology_trace or krw_ontology_chain");
    expect(message).toContain("final Korean Markdown answer");
  });

  it("guides trace or chain overflow directly to the final answer", async () => {
    const budget = getResearchModeToolBudget("deep");
    const message = await probeBudgetDenyMessage({
      existingTools: [
        "krw_ontology_query_context",
        ...Array.from<MCPToolName>({ length: budget.traceChain }).fill("krw_ontology_trace"),
      ],
      attemptedTool: "krw_ontology_chain",
    });

    expect(message).toContain(
      "Do not call krw_ontology_trace or krw_ontology_chain again",
    );
    expect(message).toContain("write the final Korean Markdown answer");
  });

  it("guides retrieve overflow away from retrieve and toward existing evidence", async () => {
    const budget = getResearchModeToolBudget("deep");
    const message = await probeBudgetDenyMessage({
      existingTools: [
        "krw_ontology_query_context",
        ...Array.from<MCPToolName>({ length: budget.retrieve }).fill("krw_ontology_retrieve"),
      ],
      attemptedTool: "krw_ontology_retrieve",
    });

    expect(message).toContain("Do not call krw_ontology_retrieve again");
    expect(message).toContain("evidence already collected");
    expect(message).toContain("one targeted krw_ontology_query");
  });

  it("guides query_context overflow away from another context pass", async () => {
    const budget = getResearchModeToolBudget("deep");
    const message = await probeBudgetDenyMessage({
      existingTools: Array.from<MCPToolName>({
        length: budget.queryContext,
      }).fill("krw_ontology_query_context"),
      attemptedTool: "krw_ontology_query_context",
    });

    expect(message).toContain("Do not call krw_ontology_query_context again");
    expect(message).toContain("Use the existing research state");
    expect(message).toContain("one targeted krw_ontology_query");
  });

  it("guides max tool call overflow to stop all tools and answer", async () => {
    const budget = getResearchModeToolBudget("deep");
    const traceCallsForTotalLimit =
      budget.maxToolCalls -
      budget.queryContext -
      budget.query -
      budget.retrieve -
      budget.compare;
    const message = await probeBudgetDenyMessage({
      existingTools: [
        ...Array.from<MCPToolName>({ length: budget.queryContext }).fill("krw_ontology_query_context"),
        ...Array.from<MCPToolName>({ length: budget.query }).fill("krw_ontology_query"),
        ...Array.from<MCPToolName>({ length: budget.retrieve }).fill("krw_ontology_retrieve"),
        ...Array.from<MCPToolName>({ length: budget.compare }).fill("krw_ontology_compare"),
        ...Array.from<MCPToolName>({ length: traceCallsForTotalLimit }).fill("krw_ontology_trace"),
      ],
      attemptedTool: "krw_ontology_chain",
    });

    expect(message).toContain("No more KRW Ontology MCP tools");
    expect(message).toContain("Do not call another tool");
    expect(message).toContain("final Korean Markdown answer");
  });
});
