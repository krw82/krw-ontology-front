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
  isStockNewsSdkTool,
  KRW_ONTOLOGY_MCP_TOOLS,
  KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
  STOCK_NEWS_MCP_TOOLS,
  STOCK_NEWS_SDK_ALLOWED_TOOLS,
} from "./mcp-client";

describe("agent permission boundary", () => {
  beforeEach(() => {
    delete process.env.STOCK_NEWS_ENABLED;
    delete process.env.STOCK_NEWS_FORCE_DISABLED;
    delete process.env.ZAI_API_KEY;
  });

  it("allows Stock News MCP by default at the global MCP boundary", async () => {
    for (const toolName of STOCK_NEWS_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toEqual({
        behavior: "allow",
      });
      expect(isStockNewsSdkTool(toolName)).toBe(true);
    }
  });

  it("denies Stock News MCP when explicitly disabled", async () => {
    process.env.STOCK_NEWS_FORCE_DISABLED = "1";

    for (const toolName of STOCK_NEWS_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toMatchObject({
        behavior: "deny",
      });
    }
  });

  it("allows only plugin-namespaced KRW Ontology tools", async () => {
    for (const toolName of KRW_ONTOLOGY_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toEqual({ behavior: "allow" });
      expect(isKrwOntologySdkTool(toolName)).toBe(true);
    }
  });

  it("denies legacy direct MCP and arbitrary tool names", async () => {
    const deniedToolNames = [
      "mcp__krw-ontology__krw_ontology_query",
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

    expect(isKrwOntologySdkTool("mcp__krw-ontology__krw_ontology_query")).toBe(
      false,
    );
  });

  it("keeps the explicit SDK allowedTools list in sync with the bare MCP tools", () => {
    expect(KRW_ONTOLOGY_SDK_ALLOWED_TOOLS).toHaveLength(
      KRW_ONTOLOGY_MCP_TOOLS.length,
    );
    expect(KRW_ONTOLOGY_SDK_ALLOWED_TOOLS).toEqual(
      KRW_ONTOLOGY_MCP_TOOLS.map(
        (toolName) => `mcp__plugin_krw-ontology_krw-ontology__${toolName}`,
      ),
    );
    expect(STOCK_NEWS_SDK_ALLOWED_TOOLS).toEqual(
      STOCK_NEWS_MCP_TOOLS.map(
        (toolName) => `mcp__plugin_krw-ontology_stock-news__${toolName}`,
      ),
    );
  });
});
