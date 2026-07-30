import { execFileSync } from "node:child_process";
import {
  chmodSync,
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

function runMaterialize(
  env: Record<string, string | undefined> = {},
  mcpUrl = "http://127.0.0.1:8765/mcp",
) {
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
      mcpUrl,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256: "a".repeat(64),
        KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256: "b".repeat(64),
        ...env,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const mcpConfig = JSON.parse(
    readFileSync(path.join(out, ".mcp.json"), "utf8"),
  ) as {
    mcpServers: Record<string, unknown>;
  };
  const pluginContract = JSON.parse(
    readFileSync(path.join(out, ".krw-ontology-contract.json"), "utf8"),
  ) as Record<string, unknown>;

  return { stdout, mcpConfig, pluginContract };
}

function makeFingerprintProbe() {
  const backend = mkdtempSync(path.join(tmpdir(), "krw-backend-probe-"));
  tempRoots.push(backend);
  writeFileSync(
    path.join(backend, "pyproject.toml"),
    "[project]\nname='probe'\n",
  );
  const executable = path.join(backend, "fake-uv.sh");
  writeFileSync(
    executable,
    [
      "#!/bin/sh",
      'case "$*" in',
      `  *\"_runtime_fingerprints\"*) echo "${"c".repeat(64)}" ;;`,
      `  *\"runtime_fingerprint_payload\"*) echo "${"d".repeat(64)}" ;;`,
      `  *\"_source_build_sha256\"*) echo "${"e".repeat(64)}" ;;`,
      "  *) exit 2 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);
  return { backend, executable };
}

describe("materialize-ontology-plugin", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps Stock News MCP absent unless explicitly enabled", () => {
    const { stdout, mcpConfig, pluginContract } = runMaterialize({
      FINNHUB_API_KEY: "test-finnhub-key",
      STOCK_NEWS_ENABLED: undefined,
      STOCK_NEWS_FORCE_DISABLED: undefined,
      ZAI_API_KEY: undefined,
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["krw-ontology"]);
    expect(stdout).toContain("Stock News MCP: disabled");
    expect(pluginContract).toMatchObject({
      contract_version: "krw-ontology-plugin-contract/v1",
      environment: "prod",
      mcp_contract_version: "krw-ontology-mcp/v2",
      mcp_tool_schema_sha256: "a".repeat(64),
      mcp_build_fingerprint_sha256: "b".repeat(64),
    });
    expect(pluginContract.source_content_sha256).toBe(
      pluginContract.materialized_content_sha256,
    );
  });

  it("adds Stock News MCP when explicitly enabled and Finnhub is configured", () => {
    const { stdout, mcpConfig } = runMaterialize({
      FINNHUB_API_KEY: "test-finnhub-key",
      STOCK_NEWS_RELEASE_ENABLED: "1",
      STOCK_NEWS_ENABLED: "1",
      ZAI_API_KEY: undefined,
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual([
      "krw-ontology",
      "stock-news",
    ]);
    expect(mcpConfig.mcpServers["stock-news"]).toEqual({
      type: "http",
      url: "http://127.0.0.1:8775/mcp",
    });
    expect(stdout).toContain("Stock News MCP: enabled");
  }, 20_000);

  it("keeps Stock News MCP absent when Finnhub is missing", () => {
    const { stdout, mcpConfig } = runMaterialize({
      FINNHUB_API_KEY: undefined,
      STOCK_NEWS_ENABLED: undefined,
      STOCK_NEWS_FORCE_DISABLED: undefined,
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["krw-ontology"]);
    expect(stdout).toContain("Stock News MCP: disabled");
  });

  it("keeps Stock News MCP absent when explicitly disabled", () => {
    const { stdout, mcpConfig } = runMaterialize({
      FINNHUB_API_KEY: "test-finnhub-key",
      STOCK_NEWS_FORCE_DISABLED: "1",
    });

    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["krw-ontology"]);
    expect(stdout).toContain("Stock News MCP: disabled");
  });

  it("rejects non-HTTP or non-/mcp runtime endpoints", () => {
    expect(() => runMaterialize({}, "stdio://127.0.0.1/mcp")).toThrow(
      "KRW Ontology MCP URL must use http or https",
    );
    expect(() => runMaterialize({}, "http://127.0.0.1:8765/health")).toThrow(
      "KRW Ontology MCP URL must end at /mcp",
    );
  });

  it("materializes the runtime build fingerprint rather than the source hash", () => {
    const { backend, executable } = makeFingerprintProbe();
    const { pluginContract } = runMaterialize({
      KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256: undefined,
      KRW_ONTOLOGY_SOURCE_DIR: backend,
      KRW_ONTOLOGY_RELEASE_ROOT: undefined,
      KRW_ONTOLOGY_ROOT: undefined,
      UV_COMMAND: executable,
    });

    expect(pluginContract.mcp_build_fingerprint_sha256).toBe("c".repeat(64));
    expect(pluginContract.mcp_build_fingerprint_sha256).not.toBe(
      "e".repeat(64),
    );
  });
});
