import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

function makePluginSource() {
  const root = mkdtempSync(path.join(tmpdir(), "krw-plugin-source-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(path.join(root, "skills", "krw-ontology-research"), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "krw-ontology" }),
  );
  writeFileSync(
    path.join(root, "skills", "krw-ontology-research", "SKILL.md"),
    "# KRW Ontology Research\n",
  );
  return root;
}

function runMaterialize(env: Record<string, string | undefined> = {}) {
  const source = makePluginSource();
  const out = mkdtempSync(path.join(tmpdir(), "krw-plugin-out-"));
  tempRoots.push(out);

  const stdout = execFileSync(
    process.execPath,
    [
      "scripts/materialize-ontology-plugin.mjs",
      "--env",
      "prod",
      "--source",
      source,
      "--out",
      out,
      "--mcp-url",
      "http://127.0.0.1:8765/mcp",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
    },
  );

  const mcpConfig = JSON.parse(
    readFileSync(path.join(out, ".mcp.json"), "utf8"),
  ) as {
    mcpServers: Record<string, unknown>;
  };

  return { stdout, mcpConfig };
}

describe("materialize-ontology-plugin", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps Z.AI Web Search MCP absent by default", () => {
    const { stdout, mcpConfig } = runMaterialize({
      KRW_WEB_SEARCH_ENABLED: undefined,
      ZAI_API_KEY: undefined,
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["krw-ontology"]);
    expect(stdout).toContain("Z.AI Web Search MCP: disabled");
  });

  it("adds raw Z.AI Web Search MCP with env-expanded authorization when enabled", () => {
    const { stdout, mcpConfig } = runMaterialize({
      KRW_WEB_SEARCH_ENABLED: "1",
      KRW_WEB_SEARCH_PROVIDER: "zai_mcp",
      ZAI_API_KEY: "zai-secret-test-key",
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual([
      "krw-ontology",
      "web-search-prime",
    ]);
    expect(mcpConfig.mcpServers["web-search-prime"]).toEqual({
      type: "http",
      url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
      headers: {
        Authorization: "Bearer ${ZAI_API_KEY}",
      },
    });
    expect(JSON.stringify(mcpConfig)).not.toContain("zai-secret-test-key");
    expect(stdout).not.toContain("zai-secret-test-key");
    expect(stdout).toContain("Z.AI Web Search MCP: enabled");
  });
});
