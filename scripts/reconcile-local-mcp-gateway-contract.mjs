#!/usr/bin/env node

/**
 * Reconcile the operator-owned local MCP gateway JSON with the active proxy's
 * fail-closed readiness contract.  This is intentionally separate from a
 * sealed release: it lets a deployment repair an old operator config before
 * that config can take every local MCP endpoint down during a cutover.
 */

import { execFileSync } from "node:child_process";
import { lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path, { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const GATEWAY_LABEL = "com.krw.agent.local-mcp-gateways";
const MAX_CONFIG_BYTES = 128 * 1024;
const ENDPOINTS = [
  { name: "ontology", readinessMode: "http_json", readinessPath: "/healthz" },
  { name: "feed", readinessMode: "http_json", readinessPath: "/readyz" },
  { name: "filings", readinessMode: "http_json", readinessPath: "/readyz" },
  { name: "guru", readinessMode: "mcp_initialize", mcpPath: "/mcp" },
];

function usage() {
  process.stderr.write(
    "Usage: reconcile-local-mcp-gateway-contract.mjs --mode check|repair --operator-root /absolute/root [--proxy /absolute/mcp_tls_proxy.mjs] [--restart]\n",
  );
}

function fail(message) {
  throw new Error(`local MCP gateway contract: ${message}`);
}

function absolute(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || /[\0\r\n]/.test(value)) {
    fail(`${label} must be an absolute safe path`);
  }
  return path.resolve(value);
}

async function regularDirectory(value, label) {
  const stat = await lstat(value).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} is missing or unsafe`);
  }
}

async function regularFile(value, label) {
  const stat = await lstat(value).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_CONFIG_BYTES) {
    fail(`${label} is missing, oversized, or unsafe`);
  }
}

function parseArguments(args) {
  const options = { mode: "", operatorRoot: "", proxy: "", restart: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--mode") options.mode = args[++index] ?? "";
    else if (argument === "--operator-root") options.operatorRoot = args[++index] ?? "";
    else if (argument === "--proxy") options.proxy = args[++index] ?? "";
    else if (argument === "--restart") options.restart = true;
    else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else {
      usage();
      process.exit(2);
    }
  }
  if (!new Set(["check", "repair"]).has(options.mode)) {
    fail("mode must be check or repair");
  }
  if (options.restart && options.mode !== "repair") {
    fail("--restart is only valid with --mode repair");
  }
  options.operatorRoot = absolute(options.operatorRoot, "operator root");
  options.proxy = options.proxy
    ? absolute(options.proxy, "proxy")
    : path.join(options.operatorRoot, "runtime", "mcp_tls_proxy.mjs");
  return options;
}

function normalizeReadinessPath(value, endpoint) {
  if (value === undefined) return endpoint.readinessPath;
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || /[\0\r\n]/.test(value)
  ) {
    fail(`${endpoint.name} config has an unsafe upstream readiness path`);
  }
  return value;
}

export function normalizeGatewayReadiness(endpoint, config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    fail(`${endpoint.name} config is not a JSON object`);
  }
  const normalized = {
    ...config,
    checkUpstreamReady: true,
    normalizeReadiness: true,
    upstreamReadinessMode: endpoint.readinessMode,
  };
  if (endpoint.readinessMode === "mcp_initialize") {
    normalized.upstreamMcpPath = normalizeReadinessPath(
      config.upstreamMcpPath,
      { name: endpoint.name, readinessPath: endpoint.mcpPath },
    );
    delete normalized.upstreamReadinessPath;
  } else {
    normalized.upstreamReadinessPath = normalizeReadinessPath(
      config.upstreamReadinessPath,
      endpoint,
    );
  }
  return normalized;
}

async function atomicWrite(destination, content) {
  const temporary = `${destination}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    const file = await open(temporary, "r");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    const directory = await open(path.dirname(destination), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function loadProxyValidator(proxyPath) {
  await regularFile(proxyPath, "active MCP TLS proxy");
  const source = await readFile(proxyPath);
  const module = await import(`${pathToFileURL(proxyPath).href}?sha=${source.toString("hex", 0, 16)}`);
  if (typeof module.validateGatewayConfig !== "function") {
    fail("active MCP TLS proxy does not export validateGatewayConfig");
  }
  return module.validateGatewayConfig;
}

async function loadConfigs(options) {
  const configRoot = path.join(options.operatorRoot, "config", "runtime");
  await regularDirectory(configRoot, "gateway config directory");
  const rows = [];
  for (const endpoint of ENDPOINTS) {
    const configPath = path.join(configRoot, `${endpoint.name}-tls.json`);
    await regularFile(configPath, `${endpoint.name} gateway config`);
    let original;
    try {
      original = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
      fail(`${endpoint.name} gateway config is not valid JSON`);
    }
    rows.push({
      endpoint,
      configPath,
      original,
      normalized: normalizeGatewayReadiness(endpoint, original),
    });
  }
  return rows;
}

function verifyWithProxy(validator, rows, useNormalized) {
  for (const row of rows) {
    try {
      validator(useNormalized ? row.normalized : row.original);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown validation error";
      fail(`${row.endpoint.name} gateway config is incompatible with the active proxy: ${message}`);
    }
  }
}

async function restartGatewaySupervisor() {
  const domain = `gui/${process.getuid()}`;
  try {
    execFileSync("launchctl", ["kickstart", "-k", `${domain}/${GATEWAY_LABEL}`], {
      stdio: "inherit",
    });
  } catch {
    fail("could not restart the local MCP gateway supervisor after repair");
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await regularDirectory(options.operatorRoot, "operator root");
  const [validator, rows] = await Promise.all([
    loadProxyValidator(options.proxy),
    loadConfigs(options),
  ]);

  if (options.mode === "check") {
    verifyWithProxy(validator, rows, false);
    const stale = rows.filter(
      (row) => !isDeepStrictEqual(row.original, row.normalized),
    );
    if (stale.length > 0) {
      fail(
        `gateway config requires endpoint-specific readiness normalization: ${stale
          .map((row) => row.endpoint.name)
          .join(", ")}`,
      );
    }
    process.stdout.write("Local MCP gateway contract is already compatible.\n");
    return;
  }

  // Validate the complete candidate set before touching any live config. A
  // malformed sibling endpoint must never leave a partially repaired fleet.
  verifyWithProxy(validator, rows, true);
  const changed = rows.filter(
    (row) => !isDeepStrictEqual(row.original, row.normalized),
  );
  for (const row of changed) {
    await atomicWrite(row.configPath, `${JSON.stringify(row.normalized, null, 2)}\n`);
  }
  if (options.restart && changed.length > 0) await restartGatewaySupervisor();
  process.stdout.write(
    changed.length > 0
      ? `Reconciled local MCP gateway readiness for: ${changed.map((row) => row.endpoint.name).join(", ")}.\n`
      : "Local MCP gateway contract already needed no repair.\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "local MCP gateway contract failed"}\n`);
  process.exitCode = 1;
});
