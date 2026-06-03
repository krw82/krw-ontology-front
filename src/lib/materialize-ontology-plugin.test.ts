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

  it("adds Stock News Z.ai MCP by default", () => {
    const { stdout, mcpConfig } = runMaterialize({
      ZAI_API_KEY: undefined,
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual([
      "krw-ontology",
      "stock-news-zai",
    ]);
    expect(mcpConfig.mcpServers["stock-news-zai"]).toEqual({
      type: "http",
      url: "http://127.0.0.1:8775/mcp",
    });
    expect(stdout).toContain("Stock News Z.ai MCP: enabled");
  });

  it("keeps Stock News Z.ai MCP absent when explicitly disabled", () => {
    const { stdout, mcpConfig } = runMaterialize({
      STOCK_NEWS_ZAI_FORCE_DISABLED: "1",
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["krw-ontology"]);
    expect(stdout).toContain("Stock News Z.ai MCP: disabled");
  });
});
