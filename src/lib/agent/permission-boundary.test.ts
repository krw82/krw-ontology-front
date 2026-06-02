import { describe, expect, it, vi } from "vitest";

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
  KRW_ONTOLOGY_MCP_TOOLS,
  KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
} from "./mcp-client";

describe("agent permission boundary", () => {
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
  });
});
