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
  isZaiWebSearchSdkTool,
  KRW_ONTOLOGY_MCP_TOOLS,
  KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
  ZAI_WEB_SEARCH_SDK_ALLOWED_TOOLS,
} from "./mcp-client";

describe("agent permission boundary", () => {
  beforeEach(() => {
    delete process.env.KRW_WEB_SEARCH_ENABLED;
    delete process.env.KRW_WEB_SEARCH_FORCE_DISABLED;
    delete process.env.KRW_WEB_SEARCH_PROVIDER;
    delete process.env.KRW_WEB_SEARCH_RESULT_COUNT;
    delete process.env.ZAI_API_KEY;
  });

  it("denies raw Z.AI Web Search MCP by default", async () => {
    for (const toolName of ZAI_WEB_SEARCH_SDK_ALLOWED_TOOLS) {
      await expect(canUseTool(toolName)).resolves.toMatchObject({
        behavior: "deny",
      });
      expect(isZaiWebSearchSdkTool(toolName)).toBe(true);
    }
  });

  it("allows raw Z.AI Web Search MCP only behind the runtime feature flag", async () => {
    process.env.KRW_WEB_SEARCH_ENABLED = "1";
    process.env.KRW_WEB_SEARCH_PROVIDER = "zai_mcp";
    process.env.ZAI_API_KEY = "zai-test-key";

    try {
      for (const toolName of ZAI_WEB_SEARCH_SDK_ALLOWED_TOOLS) {
        await expect(canUseTool(toolName)).resolves.toEqual({
          behavior: "allow",
        });
      }
    } finally {
      delete process.env.KRW_WEB_SEARCH_ENABLED;
      delete process.env.KRW_WEB_SEARCH_PROVIDER;
      delete process.env.ZAI_API_KEY;
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
      "mcp__plugin_krw-ontology_other__web_search_prime",
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
    expect(ZAI_WEB_SEARCH_SDK_ALLOWED_TOOLS).toEqual([
      "mcp__plugin_krw-ontology_web-search-prime__web_search_prime",
    ]);
  });
});
