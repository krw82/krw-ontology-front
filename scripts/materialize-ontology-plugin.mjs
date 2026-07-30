#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const pluginContractVersion = "krw-ontology-plugin-contract/v1";
const mcpContractVersion = "krw-ontology-mcp/v2";
const pluginContractFilename = ".krw-ontology-contract.json";
const contentHashExcludes = new Set([
  ".DS_Store",
  ".mcp.json",
  pluginContractFilename,
]);
const defaultSource = path.join(
  homedir(),
  "krw-ontology",
  "plugins",
  "krw-ontology",
);

const args = process.argv.slice(2);
let env = "";
let source = process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH || defaultSource;
let out = "";
let mcpUrl = process.env.KRW_ONTOLOGY_MCP_URL || "";
let stockNewsMcpUrl = process.env.STOCK_NEWS_MCP_URL || "";
let filingsMcpUrl = process.env.KRW_FILINGS_MCP_URL || "";
let feedMcpUrl = process.env.KRW_FEED_MCP_URL || "";

function usage() {
  console.error(
    `Usage: scripts/materialize-ontology-plugin.mjs --env dev|prod [--source DIR] [--out DIR] [--mcp-url URL] [--stock-news-url URL] [--filings-mcp-url URL] [--feed-mcp-url URL]`,
  );
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  switch (arg) {
    case "--env":
      env = args[++index] || "";
      break;
    case "--source":
      source = args[++index] || "";
      break;
    case "--out":
      out = args[++index] || "";
      break;
    case "--mcp-url":
      mcpUrl = args[++index] || "";
      break;
    case "--stock-news-url":
      stockNewsMcpUrl = args[++index] || "";
      break;
    case "--filings-mcp-url":
      filingsMcpUrl = args[++index] || "";
      break;
    case "--feed-mcp-url":
      feedMcpUrl = args[++index] || "";
      break;
    case "--help":
    case "-h":
      usage();
      process.exit(0);
      break;
    default:
      usage();
      process.exit(1);
  }
}

if (env !== "dev" && env !== "prod") {
  usage();
  throw new Error(`Invalid plugin env: ${env || "unset"}`);
}

if (!out) {
  out = path.join(repoRoot, "ref", "plugins", env, "krw-ontology");
}
if (!mcpUrl) {
  const port = env === "prod" ? 8765 : 8766;
  mcpUrl = `http://127.0.0.1:${port}/mcp`;
}
if (!stockNewsMcpUrl) {
  const port = env === "prod" ? 8775 : 8776;
  stockNewsMcpUrl = `http://127.0.0.1:${port}/mcp`;
}
if (!filingsMcpUrl) {
  const port = env === "prod" ? 8785 : 8786;
  filingsMcpUrl = `http://127.0.0.1:${port}/mcp`;
}
if (!feedMcpUrl) {
  const port = env === "prod" ? 8795 : 8796;
  feedMcpUrl = `http://127.0.0.1:${port}/mcp`;
}

const stockNewsEnabled = isStockNewsEnabled();
const filingsMcpEnabled = isFilingsMcpEnabled();
const feedMcpEnabled = isKrwFeedMcpEnabled();
mcpUrl = validateMcpUrl(mcpUrl, "KRW Ontology MCP");
if (stockNewsEnabled) {
  stockNewsMcpUrl = validateMcpUrl(stockNewsMcpUrl, "Stock News MCP");
}
if (filingsMcpEnabled) {
  filingsMcpUrl = validateMcpUrl(filingsMcpUrl, "On-demand filings MCP");
}
if (feedMcpEnabled) {
  feedMcpUrl = validateMcpUrl(feedMcpUrl, "KRW Feed MCP");
}

const resolvedSource = path.resolve(source);
const resolvedOut = path.resolve(out);
if (!existsSync(path.join(resolvedSource, ".claude-plugin", "plugin.json"))) {
  throw new Error(`Missing source plugin manifest: ${resolvedSource}`);
}
if (
  resolvedOut === resolvedSource ||
  resolvedOut.startsWith(`${resolvedSource}${path.sep}`)
) {
  throw new Error(
    `Refusing to materialize plugin into its source directory: ${resolvedOut}`,
  );
}

const toolSchemaSha256 = resolveToolSchemaSha256(resolvedSource);
const buildFingerprintSha256 = resolveBuildFingerprintSha256(resolvedSource);
const sourceContentSha256 = computePluginContentSha256(resolvedSource);

rmSync(resolvedOut, { force: true, recursive: true });
cpSync(resolvedSource, resolvedOut, {
  recursive: true,
  filter: (sourcePath) => path.basename(sourcePath) !== ".DS_Store",
});

const mcpServers = {
  "krw-ontology": {
    type: "http",
    url: mcpUrl,
    alwaysLoad: true,
  },
};

if (stockNewsEnabled) {
  mcpServers["stock-news"] = {
    type: "http",
    url: stockNewsMcpUrl,
  };
}
if (filingsMcpEnabled) {
  mcpServers["krw-filings"] = {
    type: "http",
    url: filingsMcpUrl,
  };
}
if (feedMcpEnabled) {
  mcpServers["krw-feed"] = {
    type: "http",
    url: feedMcpUrl,
  };
}

const mcpConfigPath = path.join(resolvedOut, ".mcp.json");
writeFileSync(
  mcpConfigPath,
  `${JSON.stringify(
    {
      mcpServers,
    },
    null,
    2,
  )}\n`,
);

const materializedContentSha256 = computePluginContentSha256(resolvedOut);
if (materializedContentSha256 !== sourceContentSha256) {
  throw new Error(
    `Materialized plugin content mismatch: ${materializedContentSha256} !== ${sourceContentSha256}`,
  );
}
const mcpConfigSha256 = sha256(readFileSync(mcpConfigPath));
writeFileSync(
  path.join(resolvedOut, pluginContractFilename),
  `${JSON.stringify(
    {
      contract_version: pluginContractVersion,
      environment: env,
      mcp_contract_version: mcpContractVersion,
      source_content_sha256: sourceContentSha256,
      materialized_content_sha256: materializedContentSha256,
      mcp_config_sha256: mcpConfigSha256,
      mcp_tool_schema_sha256: toolSchemaSha256,
      mcp_build_fingerprint_sha256: buildFingerprintSha256,
    },
    null,
    2,
  )}\n`,
);

console.log(`Materialized ${env} KRW Ontology plugin: ${resolvedOut}`);
console.log(`MCP URL: ${mcpUrl}`);
console.log(`Stock News MCP: ${stockNewsEnabled ? "enabled" : "disabled"}`);
console.log(`On-demand filings MCP: ${filingsMcpEnabled ? "enabled" : "disabled"}`);
console.log(`KRW Feed MCP: ${feedMcpEnabled ? "enabled" : "disabled"}`);
console.log(`Plugin content SHA-256: ${materializedContentSha256}`);
console.log(`MCP tool schema SHA-256: ${toolSchemaSha256}`);
console.log(`MCP build fingerprint SHA-256: ${buildFingerprintSha256}`);

function isStockNewsEnabled() {
  if (!truthyEnv(process.env.STOCK_NEWS_RELEASE_ENABLED)) return false;
  if (truthyEnv(process.env.STOCK_NEWS_FORCE_DISABLED)) return false;
  if (!truthyEnv(process.env.STOCK_NEWS_ENABLED)) return false;
  if (!process.env.FINNHUB_API_KEY) {
    throw new Error("STOCK_NEWS_ENABLED=1 but FINNHUB_API_KEY is missing");
  }
  return true;
}

function isFilingsMcpEnabled() {
  if (!truthyEnv(process.env.FILINGS_MCP_ENABLED)) return false;
  if (!process.env.FILINGS_MCP_AUTH_TOKEN?.trim()) {
    throw new Error("FILINGS_MCP_ENABLED=1 but FILINGS_MCP_AUTH_TOKEN is missing");
  }
  return true;
}

function isKrwFeedMcpEnabled() {
  if (!truthyEnv(process.env.KRW_FEED_MCP_ENABLED)) return false;
  if (!(process.env.KRW_FEED_MCP_TOKEN || process.env.FEED_MCP_AUTH_TOKEN)?.trim()) {
    throw new Error("KRW_FEED_MCP_ENABLED=1 but KRW_FEED_MCP_TOKEN is missing");
  }
  return true;
}

function truthyEnv(value) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function validateMcpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} URL is invalid: ${value}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} URL must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} URL must not contain credentials`);
  }
  if (parsed.pathname.replace(/\/+$/, "") !== "/mcp") {
    throw new Error(`${label} URL must end at /mcp`);
  }
  return parsed.toString();
}

function resolveToolSchemaSha256(pluginSource) {
  const configured = process.env.KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256?.trim();
  if (configured)
    return requireSha256(configured, "KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256");

  const ontologySourceDir = path.resolve(
    process.env.KRW_ONTOLOGY_SOURCE_DIR || path.join(pluginSource, "..", ".."),
  );
  const releaseRoot =
    process.env.KRW_ONTOLOGY_RELEASE_ROOT || process.env.KRW_ONTOLOGY_ROOT;
  if (!existsSync(path.join(ontologySourceDir, "pyproject.toml"))) {
    throw new Error(
      "KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256 is required when the backend source cannot be inspected",
    );
  }

  const code = releaseRoot
    ? [
        "import sys",
        "from krw_ontology.mcp_server.server import runtime_fingerprint_payload",
        "value = runtime_fingerprint_payload(root=sys.argv[1]).get('tool_schema_sha256')",
        "print(value or '')",
      ].join("\n")
    : [
        "from krw_ontology.mcp_server.server import _tool_contract_fingerprint",
        "value = _tool_contract_fingerprint().get('tool_schema_sha256')",
        "print(value or '')",
      ].join("\n");
  const pythonArgs = [
    "--directory",
    ontologySourceDir,
    "run",
    "python",
    "-c",
    code,
  ];
  if (releaseRoot) pythonArgs.push(releaseRoot);
  const result = spawnSync(process.env.UV_COMMAND || "uv", pythonArgs, {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Unable to derive MCP tool schema SHA-256: ${(result.stderr || result.stdout || "uv failed").trim()}`,
    );
  }
  return requireSha256(result.stdout.trim(), "derived MCP tool schema SHA-256");
}

function resolveBuildFingerprintSha256(pluginSource) {
  const configured =
    process.env.KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256?.trim();
  if (configured) {
    return requireSha256(
      configured,
      "KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256",
    );
  }
  const ontologySourceDir = path.resolve(
    process.env.KRW_ONTOLOGY_SOURCE_DIR || path.join(pluginSource, "..", ".."),
  );
  const releaseRoot =
    process.env.KRW_ONTOLOGY_RELEASE_ROOT || process.env.KRW_ONTOLOGY_ROOT;
  if (!existsSync(path.join(ontologySourceDir, "pyproject.toml"))) {
    throw new Error(
      "KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256 is required when the backend source cannot be inspected",
    );
  }
  const code = releaseRoot
    ? [
        "import sys",
        "from krw_ontology.mcp_server.server import runtime_fingerprint_payload",
        "value = runtime_fingerprint_payload(root=sys.argv[1]).get('build_fingerprint_sha256')",
        "print(value or '')",
      ].join("\n")
    : [
        "from krw_ontology.mcp_server.server import _runtime_fingerprints",
        "value = _runtime_fingerprints(None).get('build_fingerprint_sha256')",
        "print(value or '')",
      ].join("\n");
  const pythonArgs = [
    "--directory",
    ontologySourceDir,
    "run",
    "python",
    "-c",
    code,
  ];
  if (releaseRoot) pythonArgs.push(releaseRoot);
  const result = spawnSync(process.env.UV_COMMAND || "uv", pythonArgs, {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Unable to derive MCP build fingerprint SHA-256: ${(result.stderr || result.stdout || "uv failed").trim()}`,
    );
  }
  return requireSha256(
    result.stdout.trim(),
    "derived MCP build fingerprint SHA-256",
  );
}

function computePluginContentSha256(pluginRoot) {
  const hash = createHash("sha256");
  for (const relativePath of listPluginFiles(pluginRoot)) {
    const content = readFileSync(path.join(pluginRoot, relativePath));
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
  for (const entry of readdirSync(path.join(pluginRoot, relativeDirectory), {
    withFileTypes: true,
  })) {
    if (contentHashExcludes.has(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listPluginFiles(pluginRoot, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported plugin entry: ${relativePath}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireSha256(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}
