import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompanies: vi.fn(),
}));

import { canUseTool } from "./runner";
import {
  isKrwOntologySdkTool,
  isKrwFeedSdkTool,
  KRW_FEED_MCP_TOOLS,
  KRW_FEED_SDK_ALLOWED_TOOLS,
  isStockNewsSdkTool,
  KRW_ONTOLOGY_DIRECT_SDK_ALLOWED_TOOLS,
  KRW_ONTOLOGY_MCP_TOOLS,
  KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
  STOCK_NEWS_MCP_TOOLS,
  STOCK_NEWS_SDK_ALLOWED_TOOLS,
} from "./mcp-client";

describe("agent permission boundary", () => {
  beforeEach(() => {
    delete process.env.STOCK_NEWS_RELEASE_ENABLED;
    delete process.env.STOCK_NEWS_ENABLED;
    delete process.env.STOCK_NEWS_FORCE_DISABLED;
    delete process.env.FINNHUB_API_KEY;
    delete process.env.ZAI_API_KEY;
    delete process.env.KRW_FEED_MCP_ENABLED;
    delete process.env.KRW_FEED_MCP_TOKEN;
    delete process.env.FEED_MCP_AUTH_TOKEN;
  });

  it("allows Stock News MCP when explicitly enabled at the global MCP boundary", async () => {
    process.env.FINNHUB_API_KEY = "test-finnhub-key";
    process.env.STOCK_NEWS_RELEASE_ENABLED = "1";
    process.env.STOCK_NEWS_ENABLED = "1";

    for (const toolName of STOCK_NEWS_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toEqual({
        behavior: "allow",
      });
      expect(isStockNewsSdkTool(toolName)).toBe(true);
    }
  });

  it("denies Stock News MCP when Finnhub is missing", async () => {
    process.env.STOCK_NEWS_RELEASE_ENABLED = "1";
    process.env.STOCK_NEWS_ENABLED = "1";

    for (const toolName of STOCK_NEWS_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toMatchObject({
        behavior: "deny",
      });
    }
  });

  it("denies Stock News MCP unless explicitly enabled", async () => {
    process.env.FINNHUB_API_KEY = "test-finnhub-key";
    process.env.STOCK_NEWS_RELEASE_ENABLED = "1";

    for (const toolName of STOCK_NEWS_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toMatchObject({
        behavior: "deny",
      });
    }
  });

  it("denies Stock News MCP when explicitly disabled", async () => {
    process.env.FINNHUB_API_KEY = "test-finnhub-key";
    process.env.STOCK_NEWS_RELEASE_ENABLED = "1";
    process.env.STOCK_NEWS_ENABLED = "1";
    process.env.STOCK_NEWS_FORCE_DISABLED = "1";

    for (const toolName of STOCK_NEWS_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toMatchObject({
        behavior: "deny",
      });
    }
  });

  it("allows KRW Feed MCP only with explicit internal enablement", async () => {
    process.env.KRW_FEED_MCP_ENABLED = "1";
    process.env.KRW_FEED_MCP_TOKEN = "feed-secret";

    for (const toolName of KRW_FEED_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toEqual({ behavior: "allow" });
      expect(isKrwFeedSdkTool(toolName)).toBe(true);
    }
  });

  it("denies KRW Feed MCP when its internal token is missing", async () => {
    process.env.KRW_FEED_MCP_ENABLED = "1";

    for (const toolName of KRW_FEED_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toMatchObject({ behavior: "deny" });
    }
  });

  it("allows configured KRW Ontology tools", async () => {
    for (const toolName of [
      ...KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
      ...KRW_ONTOLOGY_DIRECT_SDK_ALLOWED_TOOLS,
    ]) {
      const input = toolName.endsWith("krw_ontology_query_context")
        ? {
            search_plan: {
              question: "How is customer demand supporting revenue growth?",
              intent: "demand_support",
              clauses: [
                {
                  clause_id: "demand_support",
                  retrieval_query: "customer demand supports revenue growth",
                  required_concepts: ["customer demand", "revenue growth"],
                  required_predicates: ["supports"],
                },
              ],
              tickers: ["AAPL"],
            },
          }
        : {};
      await expect(canUseTool(toolName, input)).resolves.toEqual({
        behavior: "allow",
      });
      expect(isKrwOntologySdkTool(toolName)).toBe(true);
    }
  });

  it("denies arbitrary KRW Ontology and unsafe tool names", async () => {
    const deniedToolNames = [
      "mcp__plugin_krw-ontology_krw-ontology__krw_ontology_delete",
      "mcp__plugin_krw-ontology_other__krw_ontology_query",
      "Bash",
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
      "TodoWrite",
      "mcp__plugin_krw-ontology_other__search_company_news_events",
    ];

    for (const toolName of deniedToolNames) {
      await expect(canUseTool(toolName)).resolves.toMatchObject({
        behavior: "deny",
      });
      expect(isKrwOntologySdkTool(toolName)).toBe(false);
    }
  });

  it("keeps the explicit SDK allowedTools list in sync with the bare MCP tools", () => {
    expect(KRW_ONTOLOGY_SDK_ALLOWED_TOOLS).toHaveLength(
      KRW_ONTOLOGY_MCP_TOOLS.length,
    );
    expect(KRW_ONTOLOGY_SDK_ALLOWED_TOOLS).toEqual(
      KRW_ONTOLOGY_MCP_TOOLS.map(
        (toolName) => `mcp__krw-ontology__${toolName}`,
      ),
    );
    expect(STOCK_NEWS_SDK_ALLOWED_TOOLS).toEqual(
      STOCK_NEWS_MCP_TOOLS.map((toolName) => `mcp__stock-news__${toolName}`),
    );
    expect(KRW_FEED_SDK_ALLOWED_TOOLS).toEqual(
      KRW_FEED_MCP_TOOLS.map((toolName) => `mcp__krw-feed__${toolName}`),
    );
  });
});
