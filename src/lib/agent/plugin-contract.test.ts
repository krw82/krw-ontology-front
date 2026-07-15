import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  computeOntologyPluginContentSha256,
  ONTOLOGY_PLUGIN_CONTRACT_FILENAME,
  sha256File,
  verifyMaterializedOntologyPluginContract,
} from "./plugin-contract";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("materialized ontology plugin contract", () => {
  it("binds copied content, HTTP MCP config, and runtime tool schema", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ontology-plugin-contract-"));
    roots.push(root);
    mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(root, "skills", "research"), { recursive: true });
    writeFileSync(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "krw-ontology" }),
    );
    writeFileSync(path.join(root, "skills", "research", "SKILL.md"), "skill\n");
    writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "krw-ontology": {
            type: "http",
            url: "http://127.0.0.1:8765/mcp",
          },
        },
      }),
    );
    const [contentSha256, mcpConfigSha256] = await Promise.all([
      computeOntologyPluginContentSha256(root),
      sha256File(path.join(root, ".mcp.json")),
    ]);
    const toolSchemaSha256 = "a".repeat(64);
    const buildFingerprintSha256 = "b".repeat(64);
    writeFileSync(
      path.join(root, ONTOLOGY_PLUGIN_CONTRACT_FILENAME),
      JSON.stringify({
        contract_version: "krw-ontology-plugin-contract/v1",
        environment: "prod",
        mcp_contract_version: "krw-ontology-mcp/v2",
        source_content_sha256: contentSha256,
        materialized_content_sha256: contentSha256,
        mcp_config_sha256: mcpConfigSha256,
        mcp_tool_schema_sha256: toolSchemaSha256,
        mcp_build_fingerprint_sha256: buildFingerprintSha256,
      }),
    );

    await expect(
      verifyMaterializedOntologyPluginContract({
        pluginPath: root,
        expectedEnvironment: "prod",
        expectedMcpContractVersion: "krw-ontology-mcp/v2",
        runtimeToolSchemaSha256: toolSchemaSha256,
        runtimeBuildFingerprintSha256: buildFingerprintSha256,
      }),
    ).resolves.toMatchObject({ ok: true, errors: [] });

    writeFileSync(path.join(root, "skills", "research", "SKILL.md"), "tampered\n");
    const tampered = await verifyMaterializedOntologyPluginContract({
      pluginPath: root,
      expectedEnvironment: "prod",
      expectedMcpContractVersion: "krw-ontology-mcp/v2",
      runtimeToolSchemaSha256: toolSchemaSha256,
      runtimeBuildFingerprintSha256: buildFingerprintSha256,
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.errors.join(" ")).toContain(
      "materialized plugin content mismatch",
    );
  });
});
