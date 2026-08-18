#!/usr/bin/env node

/**
 * Materialize and verify the operator-owned TLS MCP gateway which sits between
 * a sealed Rust Agent release and the already-running local MCP services.
 *
 * The upstream ontology repository is deliberately untouched.  The gateway is
 * where the Agent V1 session-isolation contract is declared and enforced.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import {
  resolveMcpOrigin,
  resolveMcpSessionReuse,
} from "./krw-agent-mcp-contract.mjs";

const CONTRACT_ID = "krw-agent/mcp-tool-session-stateless/v1";
const GATEWAY_LABEL = "com.krw.agent.local-mcp-gateways";
const CONFIGS = [
  { name: "ontology", endpointRef: "krw-ontology-local" },
  { name: "feed", endpointRef: "krw-feed-local" },
  { name: "filings", endpointRef: "krw-filings-local" },
];

function usage() {
  process.stderr.write(
    "Usage: install-krw-agent-local-mcp-gateways.mjs --mode prepare|activate|verify --agent-bundle /absolute/sealed/provider --operator-root /absolute/operator-root\n",
  );
}

function fail(message) {
  throw new Error(`local MCP gateway: ${message}`);
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
    fail(`${label} must be an absolute safe path`);
  }
  return path.resolve(value);
}

async function regularFile(value, label) {
  const stat = await lstat(value).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) fail(`${label} is missing or unsafe`);
}

async function directory(value, label) {
  const stat = await lstat(value).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} is missing or unsafe`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function attestation(config) {
  const envelope = {
    contract_id: CONTRACT_ID,
    data_release_hash: config.releaseManifestSha256,
    protocol_version: config.protocolVersion,
    server_build: config.buildId,
    server_schema_bundle_hash: config.toolSchemaSha256,
  };
  return {
    contract_id: CONTRACT_ID,
    attestation_sha256: `sha256:${sha256(JSON.stringify(envelope))}`,
  };
}

function assertGatewayConfig(config, expectedReuse, label, origin) {
  if (!config || typeof config !== "object" || Array.isArray(config)) fail(`${label} config is invalid`);
  if (config.toolSessionReuse !== expectedReuse) fail(`${label} session contract was not materialized`);
  if (config.checkUpstreamReady !== true || config.normalizeReadiness !== true) {
    fail(`${label} gateway must probe and normalize live upstream readiness`);
  }
  if (!["http_json", "mcp_initialize"].includes(config.upstreamReadinessMode)) {
    fail(`${label} gateway has no supported upstream readiness mode`);
  }
  for (const field of ["service", "protocolVersion", "buildId", "toolSchemaSha256", "releaseManifestSha256"]) {
    if (typeof config[field] !== "string" || !config[field]) fail(`${label} config has no ${field}`);
  }
  if (!config.listen || !Number.isInteger(config.listen.port) || config.listen.port < 1 || config.listen.port > 65535) {
    fail(`${label} config has no valid listen port`);
  }
  if (!config.upstream || typeof config.upstream.host !== "string" || !Number.isInteger(config.upstream.port)) {
    fail(`${label} config has no valid upstream`);
  }
  if (!config.tls || typeof config.tls.keyFile !== "string" || typeof config.tls.certFile !== "string") {
    fail(`${label} config has no valid TLS material`);
  }
  if (
    !Array.isArray(config.allowedOrigins) ||
    config.allowedOrigins.length !== 1 ||
    config.allowedOrigins[0] !== origin
  ) {
    fail(`${label} config has no exact Rust MCP Origin allowlist`);
  }
}

async function atomicWrite(destination, content, mode) {
  const temporary = `${destination}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(temporary, content, { mode });
  await chmod(temporary, mode);
  const handle = await open(temporary, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
  const directoryHandle = await open(path.dirname(destination), "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

function httpsRequest({ ca, origin, port, pathname, method = "GET", body = null }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method,
        ca,
        rejectUnauthorized: true,
        timeout: 5000,
        headers: {
          origin,
          ...(body === null ? {} : {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-protocol-version": "2025-06-18",
            "content-length": Buffer.byteLength(body),
          }),
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size <= 1024 * 1024) chunks.push(chunk);
        });
        response.once("end", () => {
          if (size > 1024 * 1024) {
            reject(new Error("gateway response exceeded verification bound"));
            return;
          }
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("gateway request timeout")));
    request.once("error", reject);
    if (body !== null) request.end(body);
    else request.end();
  });
}

function parseSseResult(body) {
  const line = body.split(/\r?\n/).find((entry) => entry.startsWith("data: "));
  if (!line) fail("initialize response did not contain an MCP SSE message");
  const payload = JSON.parse(line.slice("data: ".length));
  if (payload?.jsonrpc !== "2.0" || !payload?.result) fail("initialize response was not JSON-RPC success");
  return payload.result;
}

function equalJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} does not match the pinned session contract`);
}

function parseArguments(args) {
  const value = { mode: "", agentBundle: "", operatorRoot: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--mode") value.mode = args[++index] ?? "";
    else if (argument === "--agent-bundle") value.agentBundle = args[++index] ?? "";
    else if (argument === "--operator-root") value.operatorRoot = args[++index] ?? "";
    else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else {
      usage();
      process.exit(2);
    }
  }
  if (!["prepare", "activate", "verify"].includes(value.mode)) fail("mode must be prepare, activate, or verify");
  value.agentBundle = absolute(value.agentBundle, "agent bundle");
  value.operatorRoot = absolute(value.operatorRoot, "operator root");
  return value;
}

async function materialize(options) {
  await directory(options.agentBundle, "sealed agent bundle");
  await directory(options.operatorRoot, "operator root");
  const source = path.join(options.agentBundle, "packaging", "local-mcp-gateways", "mcp_tls_proxy.mjs");
  const runtime = path.join(options.operatorRoot, "runtime");
  const runtimeProxy = path.join(runtime, "mcp_tls_proxy.mjs");
  const configRoot = path.join(options.operatorRoot, "config", "runtime");
  const tls = path.join(options.operatorRoot, "tls", "ca.pem");
  const endpointRegistry = path.join(options.agentBundle, "deployments", "endpoint-registry.yaml");
  const deploymentBinding = path.join(options.agentBundle, "deployments", "deployment-binding.yaml");
  await regularFile(source, "sealed MCP gateway asset");
  await directory(runtime, "operator runtime directory");
  await directory(configRoot, "gateway config directory");
  await regularFile(tls, "gateway CA certificate");
  await regularFile(endpointRegistry, "sealed endpoint registry");
  await regularFile(deploymentBinding, "sealed deployment binding");
  const origin = resolveMcpOrigin(await readFile(endpointRegistry, "utf8"));
  const sessionReuse = resolveMcpSessionReuse(await readFile(deploymentBinding, "utf8"));

  const configs = [];
  for (const entry of CONFIGS) {
    const reuse = sessionReuse[entry.endpointRef];
    const configPath = path.join(configRoot, `${entry.name}-tls.json`);
    await regularFile(configPath, `${entry.name} gateway config`);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.toolSessionReuse = reuse;
    // A synthetic gateway-ready response must never outlive its upstream.
    // Each upstream gets the narrowest truthful readiness proof, so a stale
    // operator JSON cannot announce a dead worker.
    config.checkUpstreamReady = true;
    config.normalizeReadiness = true;
    // Each upstream gets the narrowest truthful readiness proof, so a stale
    // operator JSON cannot announce a dead worker. All local workers expose
    // JSON readiness routes.
    config.upstreamReadinessMode = "http_json";
    config.upstreamReadinessPath = config.upstreamReadinessPath ?? "/readyz";
    // The operator files contain endpoint identity and TLS material; this
    // release-bound client identity is deliberately materialized here so an
    // upgraded fail-closed proxy cannot be started with an empty allowlist.
    config.allowedOrigins = [origin];
    assertGatewayConfig(config, reuse, entry.name, origin);
    configs.push({ ...entry, reuse, configPath, config });
  }

  if (options.mode !== "verify") {
    const sourceBytes = await readFile(source);
    await atomicWrite(runtimeProxy, sourceBytes, 0o700);
    for (const entry of configs) {
      await atomicWrite(entry.configPath, `${JSON.stringify(entry.config, null, 2)}\n`, 0o600);
    }
    const receipt = {
      schema_version: "krw-agent-local-mcp-gateway-contract/v1",
      source_sha256: `sha256:${sha256(sourceBytes)}`,
      origin,
      endpoints: configs.map(({ name, reuse, config }) => ({
        name,
        service: config.service,
        listen_port: config.listen.port,
        tool_session_reuse: reuse,
        attestation_sha256: reuse === "attested-stateless-v1" ? attestation(config).attestation_sha256 : null,
      })),
    };
    await atomicWrite(path.join(runtime, "local-mcp-gateway-contract.json"), `${JSON.stringify(receipt, null, 2)}\n`, 0o600);
  } else {
    await regularFile(runtimeProxy, "materialized MCP gateway asset");
    const [sourceBytes, runtimeBytes] = await Promise.all([readFile(source), readFile(runtimeProxy)]);
    if (sha256(sourceBytes) !== sha256(runtimeBytes)) {
      fail("materialized gateway asset does not match the sealed agent bundle");
    }
  }
  return { configs, ca: await readFile(tls, "utf8"), origin, runtime };
}

async function verifyLive(materialized) {
  for (const entry of materialized.configs) {
    const ready = await httpsRequest({
      ca: materialized.ca,
      origin: materialized.origin,
      port: entry.config.listen.port,
      pathname: "/readyz",
    });
    if (ready.status !== 200) fail(`${entry.name} readiness returned HTTP ${ready.status}`);
    const document = JSON.parse(ready.body);
    for (const [actual, expected, label] of [
      [document?.ok, true, "ok"],
      [document?.protocol_version, entry.config.protocolVersion, "protocol version"],
      [document?.build_id, entry.config.buildId, "build"],
      [document?.tool_schema_sha256, entry.config.toolSchemaSha256, "schema"],
      [document?.release_manifest_sha256, entry.config.releaseManifestSha256, "release"],
    ]) {
      if (actual !== expected) fail(`${entry.name} readiness ${label} differs from its pinned config`);
    }
    if (entry.reuse !== "attested-stateless-v1") continue;
    const expectedAttestation = attestation(entry.config);
    equalJson(document.tool_session_contract, expectedAttestation, `${entry.name} readiness attestation`);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "gateway-contract-check",
      method: "initialize",
      params: {
        protocolVersion: entry.config.protocolVersion,
        capabilities: {},
        clientInfo: { name: "krw-agent-gateway-verifier", version: "1" },
      },
    });
    const initialized = await httpsRequest({
      ca: materialized.ca,
      origin: materialized.origin,
      port: entry.config.listen.port,
      pathname: "/mcp",
      method: "POST",
      body,
    });
    if (initialized.status !== 200) fail(`${entry.name} initialize returned HTTP ${initialized.status}`);
    const result = parseSseResult(initialized.body);
    if (result.protocolVersion !== entry.config.protocolVersion) fail(`${entry.name} initialize protocol differs`);
    equalJson(result?.capabilities?.experimental?.krwAgentToolSession, expectedAttestation, `${entry.name} initialize attestation`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const materialized = await materialize(options);
  if (options.mode === "activate") {
    const domain = `gui/${process.getuid()}`;
    execFileSync("launchctl", ["kickstart", "-k", `${domain}/${GATEWAY_LABEL}`], { stdio: "inherit" });
  }
  if (options.mode !== "prepare") {
    const deadline = Date.now() + 30000;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        await verifyLive(materialized);
        process.stdout.write(`Local MCP gateway ${options.mode} verification passed.\n`);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw lastError ?? new Error("local MCP gateway did not become ready");
  }
  process.stdout.write("Local MCP gateway contract prepared.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "local MCP gateway failed"}\n`);
  process.exitCode = 1;
});
