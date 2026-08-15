#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const EXPECTED_CONTRACT_VERSION = "krw-ontology-mcp/v2";
const EXPECTED_PLUGIN_CONTRACT_VERSION = "krw-ontology-plugin-contract/v1";
const PLUGIN_CONTRACT_FILENAME = ".krw-ontology-contract.json";
const PLUGIN_HASH_EXCLUDES = new Set([
  ".DS_Store",
  ".mcp.json",
  PLUGIN_CONTRACT_FILENAME,
]);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONT_DIR = path.resolve(SCRIPT_DIR, "..");
const EXPECTED_TOOLS = [
  "krw_ontology_catalog",
  "krw_ontology_company_context",
  "krw_ontology_index_context",
  "krw_ontology_topic_map",
  "krw_ontology_query",
  "krw_ontology_query_context",
  "krw_ontology_retrieve",
  "krw_ontology_trace",
  "krw_ontology_verify_evidence",
  "krw_ontology_quality",
  "krw_ontology_compare",
  "krw_ontology_plan_query",
  "krw_ontology_chain",
];

function readyUrlFromMcpUrl(mcpUrl) {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/readyz";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function samePath(left, right) {
  if (!left || !right) return false;
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return left === right;
  }
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === right.length && right.every((value) => leftSet.has(value));
}

function requireSha256(payload, field) {
  const value = payload[field];
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`MCP readiness ${field} is missing or is not a SHA-256 digest`);
  }
}

function requireExpectedValue(payload, envName, field) {
  const expected = process.env[envName]?.trim();
  if (expected && payload[field] !== expected) {
    throw new Error(`MCP ${field} mismatch: ${payload[field]} !== ${expected}`);
  }
}

const mcpUrl =
  process.env.KRW_ONTOLOGY_MCP_URL || "http://127.0.0.1:8765/mcp";
const mcpRequestHeaders = requestHeadersForMcpUrl(mcpUrl);
const readyUrl =
  process.env.KRW_ONTOLOGY_MCP_READY_URL || readyUrlFromMcpUrl(mcpUrl);
const expectedEnv = process.env.KRW_ONTOLOGY_EXPECTED_ENV;
const expectedRoot = process.env.KRW_ONTOLOGY_RELEASE_ROOT;
const expectedReleaseId = process.env.EXPECTED_RELEASE_ID;
const controller = new AbortController();
const timeout = setTimeout(
  () => controller.abort(),
  Number(process.env.MCP_HEALTH_TIMEOUT_MS || 30_000),
);

try {
  const response = await fetch(readyUrl, {
    headers: { accept: "application/json", ...mcpRequestHeaders },
    signal: controller.signal,
  });
  const payload = await response.json();

  console.log(
    JSON.stringify({
      status: response.status,
      ok: payload.ok,
      env: payload.env,
      release_id: payload.release_id,
      manifest_valid: payload.manifest_valid,
      index_layout: payload.index_layout,
      global_spine_present: payload.global_spine_present,
      company_shard_count: payload.company_shard_count,
      mcp_contract_version: payload.mcp_contract_version,
      tool_count: payload.tool_count,
      tool_names_match: payload.tool_names_match,
      tool_schema_sha256: payload.tool_schema_sha256,
      build_id: payload.build_id,
      backend_git_sha: payload.backend_git_sha,
      build_fingerprint_sha256: payload.build_fingerprint_sha256,
      release_manifest_sha256: payload.release_manifest_sha256,
      service_fingerprint_sha256: payload.service_fingerprint_sha256,
      root: payload.root,
      global_spine_path: payload.global_spine_path,
      documents: payload.documents,
      objects: payload.objects,
    }),
  );

  if (response.status !== 200 || payload.ok !== true) {
    throw new Error("MCP readiness is not ok");
  }
  if (expectedEnv && payload.env !== expectedEnv) {
    throw new Error(`MCP readiness env mismatch: ${payload.env} !== ${expectedEnv}`);
  }
  if (!payload.release_id) throw new Error("MCP readiness is missing release_id");
  if (expectedReleaseId && payload.release_id !== expectedReleaseId) {
    throw new Error(
      `MCP release mismatch: ${payload.release_id} !== ${expectedReleaseId}`,
    );
  }
  if (payload.manifest_valid !== true) {
    throw new Error("MCP readiness manifest_valid is not true");
  }
  if (payload.index_layout !== "global-spine-and-company-shards") {
    throw new Error(`MCP readiness index_layout is not v3: ${payload.index_layout}`);
  }
  if (payload.global_spine_present !== true) {
    throw new Error("MCP readiness global_spine_present is not true");
  }
  if (expectedRoot && !samePath(payload.root, expectedRoot)) {
    throw new Error(`MCP root mismatch: ${payload.root} !== ${expectedRoot}`);
  }

  if (payload.mcp_contract_version !== EXPECTED_CONTRACT_VERSION) {
    throw new Error(
      `MCP contract mismatch: ${payload.mcp_contract_version} !== ${EXPECTED_CONTRACT_VERSION}`,
    );
  }
  if (
    payload.tool_names_match !== true ||
    payload.tool_count !== EXPECTED_TOOLS.length ||
    !sameStringSet(payload.tool_names, EXPECTED_TOOLS)
  ) {
    throw new Error(
      `MCP tool parity mismatch: expected the exact ${EXPECTED_TOOLS.length}-tool v2 set`,
    );
  }
  if (typeof payload.build_id !== "string" || !payload.build_id.trim()) {
    throw new Error("MCP readiness build_id is missing");
  }
  if (
    (typeof payload.backend_git_sha !== "string" ||
      !payload.backend_git_sha.trim()) &&
    (typeof payload.build_fingerprint_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.build_fingerprint_sha256))
  ) {
    throw new Error(
      "MCP readiness backend_git_sha is missing and build_fingerprint_sha256 is unavailable",
    );
  }
  for (const field of [
    "tool_schema_sha256",
    "build_fingerprint_sha256",
    "release_manifest_sha256",
    "service_fingerprint_sha256",
  ]) {
    requireSha256(payload, field);
  }
  for (const [envName, field] of [
    ["KRW_MCP_EXPECTED_CONTRACT_VERSION", "mcp_contract_version"],
    ["KRW_MCP_EXPECTED_BUILD_ID", "build_id"],
    ["KRW_MCP_EXPECTED_BACKEND_GIT_SHA", "backend_git_sha"],
    ["KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256", "tool_schema_sha256"],
    ["KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256", "build_fingerprint_sha256"],
    ["KRW_MCP_EXPECTED_RELEASE_MANIFEST_SHA256", "release_manifest_sha256"],
    ["KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256", "service_fingerprint_sha256"],
  ]) {
    requireExpectedValue(payload, envName, field);
  }

  await verifyMcpEndpoint(mcpUrl, mcpRequestHeaders);
  verifyPluginContract(payload);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}

function requestHeadersForMcpUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return {};
  const origin = process.env.KRW_AGENT_MCP_ORIGIN?.trim();
  if (!origin) throw new Error("KRW_AGENT_MCP_ORIGIN is required for HTTPS MCP verification");
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    parsedOrigin.username ||
    parsedOrigin.password
  ) {
    throw new Error("KRW_AGENT_MCP_ORIGIN must be a bare HTTPS origin");
  }
  return { origin };
}

async function verifyMcpEndpoint(url, headers) {
  const client = new Client({
    name: "krw-ontology-runtime-preflight",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  const timeoutMs = Number(process.env.MCP_HEALTH_TIMEOUT_MS || 30_000);
  try {
    await client.connect(transport, { timeout: timeoutMs });
    const result = await client.listTools(undefined, {
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    });
    const names = result.tools.map((tool) => tool.name);
    if (!sameStringSet(names, EXPECTED_TOOLS)) {
      throw new Error(
        `MCP /mcp tool parity mismatch: expected the exact ${EXPECTED_TOOLS.length}-tool v2 set`,
      );
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

function verifyPluginContract(runtimePayload) {
  const sourcePath = path.resolve(
    process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH ||
      path.join(
        process.env.KRW_ONTOLOGY_SOURCE_DIR ||
          path.join(process.env.HOME || FRONT_DIR, "krw-ontology"),
        "plugins",
        "krw-ontology",
      ),
  );
  const materializedPath = path.resolve(
    process.env.KRW_ONTOLOGY_PLUGIN_PATH ||
      path.join(FRONT_DIR, "ref", "plugins", runtimePayload.env, "krw-ontology"),
  );
  const contractPath = path.join(materializedPath, PLUGIN_CONTRACT_FILENAME);
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const expectedFields = new Set([
    "contract_version",
    "environment",
    "mcp_contract_version",
    "source_content_sha256",
    "materialized_content_sha256",
    "mcp_config_sha256",
    "mcp_tool_schema_sha256",
    "mcp_build_fingerprint_sha256",
  ]);
  const unexpected = Object.keys(contract).filter((key) => !expectedFields.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Plugin contract has unexpected fields: ${unexpected.join(", ")}`);
  }
  if (contract.contract_version !== EXPECTED_PLUGIN_CONTRACT_VERSION) {
    throw new Error(`Plugin contract version mismatch: ${contract.contract_version}`);
  }
  if (contract.environment !== runtimePayload.env) {
    throw new Error(
      `Plugin environment mismatch: ${contract.environment} !== ${runtimePayload.env}`,
    );
  }
  if (contract.mcp_contract_version !== runtimePayload.mcp_contract_version) {
    throw new Error("Plugin/runtime MCP contract version mismatch");
  }
  if (contract.mcp_tool_schema_sha256 !== runtimePayload.tool_schema_sha256) {
    throw new Error("Plugin/runtime MCP tool schema mismatch");
  }
  if (
    contract.mcp_build_fingerprint_sha256 !==
    runtimePayload.build_fingerprint_sha256
  ) {
    throw new Error("Plugin/runtime MCP build fingerprint mismatch");
  }
  for (const field of [
    "source_content_sha256",
    "materialized_content_sha256",
    "mcp_config_sha256",
    "mcp_tool_schema_sha256",
    "mcp_build_fingerprint_sha256",
  ]) {
    requireSha256(contract, field);
  }

  const sourceContentSha256 = computePluginContentSha256(sourcePath);
  const materializedContentSha256 = computePluginContentSha256(materializedPath);
  const mcpConfigSha256 = createHash("sha256")
    .update(fs.readFileSync(path.join(materializedPath, ".mcp.json")))
    .digest("hex");
  if (
    sourceContentSha256 !== contract.source_content_sha256 ||
    materializedContentSha256 !== contract.materialized_content_sha256 ||
    sourceContentSha256 !== materializedContentSha256
  ) {
    throw new Error("Source/materialized plugin content hash mismatch");
  }
  if (mcpConfigSha256 !== contract.mcp_config_sha256) {
    throw new Error("Materialized plugin MCP config hash mismatch");
  }

  console.log(
    JSON.stringify({
      plugin_contract_version: contract.contract_version,
      plugin_content_sha256: materializedContentSha256,
      plugin_mcp_config_sha256: mcpConfigSha256,
      plugin_tool_schema_sha256: contract.mcp_tool_schema_sha256,
      plugin_build_fingerprint_sha256:
        contract.mcp_build_fingerprint_sha256,
    }),
  );
}

function computePluginContentSha256(pluginRoot) {
  const hash = createHash("sha256");
  for (const relativePath of listPluginFiles(pluginRoot)) {
    const content = fs.readFileSync(path.join(pluginRoot, relativePath));
    hash.update(relativePath.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listPluginFiles(pluginRoot, relativeDirectory = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(pluginRoot, relativeDirectory), {
    withFileTypes: true,
  })) {
    if (PLUGIN_HASH_EXCLUDES.has(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...listPluginFiles(pluginRoot, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Unsupported plugin entry: ${relativePath}`);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}
