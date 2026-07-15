import "server-only";

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const ONTOLOGY_PLUGIN_CONTRACT_VERSION =
  "krw-ontology-plugin-contract/v1";
export const ONTOLOGY_PLUGIN_CONTRACT_FILENAME =
  ".krw-ontology-contract.json";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_HASH_EXCLUDES = new Set([
  ".DS_Store",
  ".mcp.json",
  ONTOLOGY_PLUGIN_CONTRACT_FILENAME,
]);

export interface OntologyPluginContract {
  contract_version: typeof ONTOLOGY_PLUGIN_CONTRACT_VERSION;
  environment: "dev" | "prod";
  mcp_contract_version: string;
  source_content_sha256: string;
  materialized_content_sha256: string;
  mcp_config_sha256: string;
  mcp_tool_schema_sha256: string;
  mcp_build_fingerprint_sha256: string;
}

export interface OntologyPluginContractVerification {
  ok: boolean;
  contract: OntologyPluginContract | null;
  contentSha256: string | null;
  mcpConfigSha256: string | null;
  errors: string[];
}

export async function computeOntologyPluginContentSha256(
  pluginPath: string,
): Promise<string> {
  const entries = await listPluginFiles(pluginPath);
  const hash = createHash("sha256");
  for (const relativePath of entries) {
    const content = await readFile(path.join(pluginPath, relativePath));
    hash.update(relativePath.replaceAll(path.sep, "/"));
    hash.update("\0");
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function verifyMaterializedOntologyPluginContract(params: {
  pluginPath: string;
  expectedEnvironment: "dev" | "prod";
  expectedMcpContractVersion: string;
  runtimeToolSchemaSha256: string | null;
  runtimeBuildFingerprintSha256: string | null;
}): Promise<OntologyPluginContractVerification> {
  const errors: string[] = [];
  const contractPath = path.join(
    params.pluginPath,
    ONTOLOGY_PLUGIN_CONTRACT_FILENAME,
  );
  let contract: OntologyPluginContract | null = null;
  let contentSha256: string | null = null;
  let mcpConfigSha256: string | null = null;

  try {
    contract = parseOntologyPluginContract(
      JSON.parse(await readFile(contractPath, "utf8")),
    );
  } catch (error) {
    errors.push(
      `plugin contract is missing or invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { ok: false, contract, contentSha256, mcpConfigSha256, errors };
  }

  if (contract.environment !== params.expectedEnvironment) {
    errors.push(
      `plugin environment mismatch: ${contract.environment} !== ${params.expectedEnvironment}`,
    );
  }
  if (contract.mcp_contract_version !== params.expectedMcpContractVersion) {
    errors.push(
      `plugin MCP contract mismatch: ${contract.mcp_contract_version} !== ${params.expectedMcpContractVersion}`,
    );
  }
  if (
    !params.runtimeToolSchemaSha256 ||
    contract.mcp_tool_schema_sha256 !== params.runtimeToolSchemaSha256
  ) {
    errors.push(
      `plugin/runtime tool schema mismatch: ${contract.mcp_tool_schema_sha256} !== ${params.runtimeToolSchemaSha256 ?? "missing"}`,
    );
  }
  if (
    !params.runtimeBuildFingerprintSha256 ||
    contract.mcp_build_fingerprint_sha256 !==
      params.runtimeBuildFingerprintSha256
  ) {
    errors.push(
      `plugin/runtime build fingerprint mismatch: ${contract.mcp_build_fingerprint_sha256} !== ${params.runtimeBuildFingerprintSha256 ?? "missing"}`,
    );
  }

  try {
    [contentSha256, mcpConfigSha256] = await Promise.all([
      computeOntologyPluginContentSha256(params.pluginPath),
      sha256File(path.join(params.pluginPath, ".mcp.json")),
    ]);
    if (contract.source_content_sha256 !== contract.materialized_content_sha256) {
      errors.push("source and materialized plugin content hashes differ");
    }
    if (contentSha256 !== contract.materialized_content_sha256) {
      errors.push(
        `materialized plugin content mismatch: ${contentSha256} !== ${contract.materialized_content_sha256}`,
      );
    }
    if (mcpConfigSha256 !== contract.mcp_config_sha256) {
      errors.push(
        `materialized plugin MCP config mismatch: ${mcpConfigSha256} !== ${contract.mcp_config_sha256}`,
      );
    }
  } catch (error) {
    errors.push(
      `plugin content verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    ok: errors.length === 0,
    contract,
    contentSha256,
    mcpConfigSha256,
    errors,
  };
}

function parseOntologyPluginContract(value: unknown): OntologyPluginContract {
  if (!isRecord(value)) throw new Error("contract must be an object");
  const expectedKeys = new Set([
    "contract_version",
    "environment",
    "mcp_contract_version",
    "source_content_sha256",
    "materialized_content_sha256",
    "mcp_config_sha256",
    "mcp_tool_schema_sha256",
    "mcp_build_fingerprint_sha256",
  ]);
  const unexpected = Object.keys(value).filter((key) => !expectedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`unexpected fields: ${unexpected.join(", ")}`);
  }
  if (value.contract_version !== ONTOLOGY_PLUGIN_CONTRACT_VERSION) {
    throw new Error(`contract_version must be ${ONTOLOGY_PLUGIN_CONTRACT_VERSION}`);
  }
  if (value.environment !== "dev" && value.environment !== "prod") {
    throw new Error("environment must be dev or prod");
  }
  if (
    typeof value.mcp_contract_version !== "string" ||
    !value.mcp_contract_version
  ) {
    throw new Error("mcp_contract_version is required");
  }
  for (const field of [
    "source_content_sha256",
    "materialized_content_sha256",
    "mcp_config_sha256",
    "mcp_tool_schema_sha256",
    "mcp_build_fingerprint_sha256",
  ] as const) {
    if (typeof value[field] !== "string" || !SHA256_PATTERN.test(value[field])) {
      throw new Error(`${field} must be a SHA-256 digest`);
    }
  }
  return value as unknown as OntologyPluginContract;
}

async function listPluginFiles(
  pluginPath: string,
  relativeDirectory = "",
): Promise<string[]> {
  const directory = path.join(pluginPath, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (CONTENT_HASH_EXCLUDES.has(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPluginFiles(pluginPath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`unsupported plugin entry: ${relativePath}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
