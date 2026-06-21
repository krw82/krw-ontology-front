#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const DEFAULT_WEB_HEALTH_URL = "http://127.0.0.1:3000/api/healthz";
const DEFAULT_GATEWAY_PORT = 8787;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

if (!options.noNextEnv) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
}
const envFile = options.envFile;
if (envFile) loadEnvFile(envFile);

const gatewayBaseUrl =
  options.gatewayBaseUrl ??
  value("DESKTOP_LLM_GATEWAY_BASE_URL") ??
  `http://127.0.0.1:${options.gatewayPort}/anthropic`;
const gatewayHealthUrl =
  options.gatewayHealthUrl ??
  value("DESKTOP_LLM_GATEWAY_HEALTH_URL") ??
  deriveGatewayHealthUrl(gatewayBaseUrl);
const webHealthUrl = options.webHealthUrl ?? DEFAULT_WEB_HEALTH_URL;

process.env.DESKTOP_LLM_GATEWAY_BASE_URL = gatewayBaseUrl;
process.env.DESKTOP_LLM_GATEWAY_HEALTH_URL = gatewayHealthUrl;

const startupPreflightStatus = runPreflight({
  envFile,
  gatewayBaseUrl,
  gatewayHealthUrl,
  ontologyMcpUrl: options.ontologyMcpUrl,
  ontologyMcpHealthUrl: options.ontologyMcpHealthUrl,
  requireOntologyMcp: options.requireOntologyMcp,
  noNextEnv: options.noNextEnv,
  skipGatewayHealth: true,
  skipOntologyMcp: options.skipOntologyMcp,
});
if (startupPreflightStatus !== 0) process.exit(startupPreflightStatus);
if (options.preflightOnly) process.exit(0);

let shuttingDown = false;
const children = [];

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

try {
  if (!options.skipWeb) {
    await ensureHttpReady({
      label: "web",
      url: webHealthUrl,
      spawnWhenMissing: () => spawnManaged("web", "npm", ["run", "dev:web"]),
      timeoutMs: 30_000,
    });
  }

  if (!options.skipGateway) {
    runCommand("build llm-gateway", "npm", ["run", "build:llm-gateway"]);
    await ensureHttpReady({
      label: "llm-gateway",
      url: gatewayHealthUrl,
      spawnWhenMissing: () =>
        spawnManaged("llm-gateway", process.execPath, [".services/llm-gateway.mjs"], {
          ...process.env,
          PORT: String(options.gatewayPort),
        }),
      timeoutMs: 15_000,
      expectedService: "krw-llm-gateway",
    });
  }

  const livePreflightStatus = runPreflight({
    envFile,
    gatewayBaseUrl,
    gatewayHealthUrl,
    ontologyMcpUrl: options.ontologyMcpUrl,
    ontologyMcpHealthUrl: options.ontologyMcpHealthUrl,
    requireOntologyMcp: options.requireOntologyMcp,
    noNextEnv: options.noNextEnv,
    skipGatewayHealth: options.skipGateway,
    skipOntologyMcp: options.skipOntologyMcp,
  });
  if (livePreflightStatus !== 0) {
    await shutdown("preflight-failed");
    process.exit(livePreflightStatus);
  }

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        service: "krw-desktop-live-stack",
        web_health_url: options.skipWeb ? null : webHealthUrl,
        gateway_base_url: options.skipGateway ? null : gatewayBaseUrl,
        gateway_health_url: options.skipGateway ? null : gatewayHealthUrl,
      },
      null,
      2,
    ) + "\n",
  );

  await new Promise(() => {
    // Keep child processes alive until interrupted.
  });
} catch (error) {
  await shutdown("error");
  process.stderr.write(
    `${error instanceof Error ? error.message : "Desktop live stack failed"}\n`,
  );
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    envFile: null,
    webHealthUrl: null,
    gatewayBaseUrl: null,
    gatewayHealthUrl: null,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    ontologyMcpUrl: null,
    ontologyMcpHealthUrl: null,
    requireOntologyMcp: false,
    noNextEnv: false,
    skipWeb: false,
    skipGateway: false,
    skipOntologyMcp: false,
    preflightOnly: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") parsed.envFile = requireValue(argv, ++index, arg);
    else if (arg === "--web-health-url") {
      parsed.webHealthUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--gateway-base-url") {
      parsed.gatewayBaseUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--gateway-health-url") {
      parsed.gatewayHealthUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--gateway-port") {
      parsed.gatewayPort = positiveInt(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--ontology-mcp-url") {
      parsed.ontologyMcpUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--ontology-mcp-health-url") {
      parsed.ontologyMcpHealthUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--require-ontology-mcp") {
      parsed.requireOntologyMcp = true;
    } else if (arg === "--no-next-env") {
      parsed.noNextEnv = true;
    } else if (arg === "--skip-web") {
      parsed.skipWeb = true;
    } else if (arg === "--skip-gateway") {
      parsed.skipGateway = true;
    } else if (arg === "--skip-ontology-mcp") {
      parsed.skipOntologyMcp = true;
    } else if (arg === "--preflight-only") {
      parsed.preflightOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function usage() {
  process.stdout.write(`Usage: node scripts/desktop-live-stack.mjs [options]

Starts the local Desktop live web/API and LLM gateway stack after secret-safe
preflight checks. The command keeps running until interrupted.

Options:
  --env-file FILE                 Load environment variables from FILE
  --web-health-url URL            Override web readiness URL
  --gateway-base-url URL          Override DESKTOP_LLM_GATEWAY_BASE_URL
  --gateway-health-url URL        Override gateway health URL
  --gateway-port PORT             Local gateway port when starting it
  --ontology-mcp-url URL          Override KRW_ONTOLOGY_MCP_URL for preflight
  --ontology-mcp-health-url URL   Override ontology MCP health URL
  --require-ontology-mcp          Treat missing/failing ontology MCP as fatal
  --no-next-env                   Do not load Next.js .env* files first
  --skip-web                      Reuse/skip web server startup and health check
  --skip-gateway                  Reuse/skip LLM gateway startup and health check
  --skip-ontology-mcp             Skip ontology MCP preflight checks
  --preflight-only                Run startup preflight and exit
  --help                          Show this help
`);
}

function requireValue(argv, index, flag) {
  const item = argv[index];
  if (!item) throw new Error(`${flag} requires a value`);
  return item;
}

function positiveInt(raw, flag) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function loadEnvFile(file) {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`Env file not found: ${file}`);
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    process.env[line.slice(0, index).trim()] = parseEnvValue(
      line.slice(index + 1).trim(),
    );
  }
}

function parseEnvValue(text) {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function value(name) {
  const text = process.env[name]?.trim();
  return text ? text : null;
}

function deriveGatewayHealthUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/anthropic\/?$/, "/healthz");
  if (!url.pathname.endsWith("/healthz")) url.pathname = "/healthz";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function runPreflight({
  envFile,
  gatewayBaseUrl,
  gatewayHealthUrl,
  ontologyMcpUrl,
  ontologyMcpHealthUrl,
  requireOntologyMcp,
  noNextEnv,
  skipGatewayHealth,
  skipOntologyMcp,
}) {
  const args = [
    "scripts/desktop-live-preflight.mjs",
    "--gateway-base-url",
    gatewayBaseUrl,
    "--gateway-health-url",
    gatewayHealthUrl,
  ];
  if (envFile) args.push("--env-file", envFile);
  if (noNextEnv) args.push("--no-next-env");
  if (ontologyMcpUrl) args.push("--ontology-mcp-url", ontologyMcpUrl);
  if (ontologyMcpHealthUrl) {
    args.push("--ontology-mcp-health-url", ontologyMcpHealthUrl);
  }
  if (requireOntologyMcp) args.push("--require-ontology-mcp");
  if (skipGatewayHealth) args.push("--skip-gateway-health");
  if (skipOntologyMcp) args.push("--skip-ontology-mcp");
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  }).status ?? 1;
}

function runCommand(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status}`);
  }
}

async function ensureHttpReady({
  label,
  url,
  spawnWhenMissing,
  timeoutMs,
  expectedService,
}) {
  if (await isHttpReady(url, expectedService)) {
    console.info(`[desktop-live-stack] reusing ${label}: ${url}`);
    return;
  }

  spawnWhenMissing();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHttpReady(url, expectedService)) {
      console.info(`[desktop-live-stack] ${label} ready: ${url}`);
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${label} did not become ready: ${url}`);
}

async function isHttpReady(url, expectedService) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    if (!expectedService) return true;
    const payload = await response.json().catch(() => null);
    return payload?.service === expectedService && payload?.ok !== false;
  } catch {
    return false;
  }
}

function spawnManaged(label, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const suffix = signal ? `signal ${signal}` : `code ${code}`;
    process.stderr.write(`[desktop-live-stack:${label}] exited with ${suffix}\n`);
    void shutdown(`${label}-exit`).finally(() => process.exit(code ?? 1));
  });
  return child;
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[desktop-live-stack] shutting down: ${reason}`);
  await Promise.allSettled(children.map((child) => stopChild(child)));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 5_000);
  timeout.unref?.();
  try {
    await new Promise((resolvePromise) => child.once("exit", resolvePromise));
  } finally {
    clearTimeout(timeout);
  }
}
