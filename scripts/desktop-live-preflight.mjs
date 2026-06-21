#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:8787/anthropic";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

if (!options.noNextEnv) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
}
if (options.envFile) loadEnvFile(options.envFile);

const checks = [];

addEnvCheck("supabase_url", ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
addEnvCheck("supabase_service_role", ["SUPABASE_SERVICE_ROLE_KEY"], {
  secret: true,
});
addEnvCheck("llm_job_token_secret", ["KRW_LLM_JOB_TOKEN_SECRET"], {
  secret: true,
  minLength: 32,
});
addEnvCheck("deepseek_api_key", ["DEEPSEEK_API_KEY"], { secret: true });

const gatewayBaseUrl =
  options.gatewayBaseUrl ??
  value("DESKTOP_LLM_GATEWAY_BASE_URL") ??
  DEFAULT_GATEWAY_BASE_URL;
addUrlCheck("gateway_base_url", gatewayBaseUrl, {
  message: "Desktop LLM gateway base URL is configured.",
});

if (!options.skipGatewayHealth) {
  const gatewayHealthUrl =
    options.gatewayHealthUrl ??
    value("DESKTOP_LLM_GATEWAY_HEALTH_URL") ??
    deriveGatewayHealthUrl(gatewayBaseUrl);
  await addHttpJsonHealthCheck("gateway_health", gatewayHealthUrl, {
    required: true,
    expectedService: "krw-llm-gateway",
  });
}

if (!options.skipOntologyMcp) {
  const mcpUrl = options.ontologyMcpUrl ?? value("KRW_ONTOLOGY_MCP_URL");
  if (!mcpUrl) {
    addCheck({
      id: "ontology_mcp_url",
      required: Boolean(options.requireOntologyMcp),
      ok: false,
      status: options.requireOntologyMcp ? "fail" : "warn",
      message: "KRW_ONTOLOGY_MCP_URL is not configured.",
    });
  } else {
    addUrlCheck("ontology_mcp_url", mcpUrl, {
      message: "KRW ontology MCP URL is configured.",
    });
    const healthUrl =
      options.ontologyMcpHealthUrl ??
      value("KRW_ONTOLOGY_MCP_HEALTH_URL") ??
      deriveMcpHealthUrl(mcpUrl);
    await addHttpJsonHealthCheck("ontology_mcp_health", healthUrl, {
      required: Boolean(options.requireOntologyMcp),
    });
  }
}

const required = checks.filter((check) => check.required);
const failed = required.filter((check) => !check.ok);
const warnings = checks.filter((check) => !check.required && !check.ok);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: failed.length === 0,
      service: "krw-desktop-live-preflight",
      checks,
      summary: {
        required: required.length,
        passed: required.length - failed.length,
        failed: failed.length,
        warnings: warnings.length,
      },
    },
    null,
    2,
  )}\n`,
);

if (failed.length > 0) process.exitCode = 1;

function parseArgs(argv) {
  const parsed = {
    envFile: null,
    gatewayBaseUrl: null,
    gatewayHealthUrl: null,
    ontologyMcpUrl: null,
    ontologyMcpHealthUrl: null,
    requireOntologyMcp: false,
    noNextEnv: false,
    skipGatewayHealth: false,
    skipOntologyMcp: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") parsed.envFile = requireValue(argv, ++index, arg);
    else if (arg === "--gateway-base-url") {
      parsed.gatewayBaseUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--gateway-health-url") {
      parsed.gatewayHealthUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--ontology-mcp-url") {
      parsed.ontologyMcpUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--ontology-mcp-health-url") {
      parsed.ontologyMcpHealthUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--require-ontology-mcp") {
      parsed.requireOntologyMcp = true;
    } else if (arg === "--no-next-env") {
      parsed.noNextEnv = true;
    } else if (arg === "--skip-gateway-health") {
      parsed.skipGatewayHealth = true;
    } else if (arg === "--skip-ontology-mcp") {
      parsed.skipOntologyMcp = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function usage() {
  process.stdout.write(`Usage: node scripts/desktop-live-preflight.mjs [options]

Checks the web/LLM side of KRW Desktop live readiness without printing secrets.

Options:
  --env-file FILE                 Load environment variables from FILE
  --gateway-base-url URL          Override DESKTOP_LLM_GATEWAY_BASE_URL
  --gateway-health-url URL        Override gateway health URL
  --ontology-mcp-url URL          Override KRW_ONTOLOGY_MCP_URL
  --ontology-mcp-health-url URL   Override ontology MCP health URL
  --require-ontology-mcp          Treat missing/failing ontology MCP as fatal
  --no-next-env                   Do not load Next.js .env* files first
  --skip-gateway-health           Skip live gateway /healthz probe
  --skip-ontology-mcp             Skip ontology MCP checks
  --help                          Show this help
`);
}

function requireValue(argv, index, flag) {
  const item = argv[index];
  if (!item) throw new Error(`${flag} requires a value`);
  return item;
}

function loadEnvFile(file) {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`Env file not found: ${file}`);
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const parsed = parseEnvValue(line.slice(index + 1).trim());
    process.env[key] = parsed;
  }
}

function parseEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function addEnvCheck(id, names, options = {}) {
  const found = names.find((name) => Boolean(value(name)));
  if (!found) {
    addCheck({
      id,
      required: true,
      ok: false,
      status: "fail",
      message: `Missing required env: ${names.join(" or ")}`,
    });
    return;
  }

  const raw = value(found) ?? "";
  if (options.minLength && raw.length < options.minLength) {
    addCheck({
      id,
      required: true,
      ok: false,
      status: "fail",
      message: `${found} must be at least ${options.minLength} characters.`,
    });
    return;
  }

  addCheck({
    id,
    required: true,
    ok: true,
    status: "pass",
    message: `${found} is configured.`,
    detail: options.secret ? { configured: true } : { env: found, value: raw },
  });
}

function addUrlCheck(id, url, { message }) {
  try {
    const parsed = new URL(url);
    addCheck({
      id,
      required: true,
      ok: true,
      status: "pass",
      message,
      detail: {
        origin: parsed.origin,
        pathname: parsed.pathname,
      },
    });
  } catch {
    addCheck({
      id,
      required: true,
      ok: false,
      status: "fail",
      message: `${id} is not a valid URL.`,
      detail: { value: url },
    });
  }
}

async function addHttpJsonHealthCheck(id, url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(readHealthTimeoutMs()),
    });
    const payload = await response.json();
    const ok =
      response.ok &&
      payload?.ok !== false &&
      (!options.expectedService || payload?.service === options.expectedService);
    addCheck({
      id,
      required: options.required !== false,
      ok,
      status: ok ? "pass" : "fail",
      message: ok ? "Health endpoint is ready." : "Health endpoint is not ready.",
      detail: {
        url,
        status: response.status,
        service: payload?.service ?? null,
        release_id: payload?.release_id ?? null,
      },
    });
  } catch (error) {
    addCheck({
      id,
      required: options.required !== false,
      ok: false,
      status: "fail",
      message: error instanceof Error ? error.message : "Health check failed.",
      detail: { url },
    });
  }
}

function deriveGatewayHealthUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/anthropic\/?$/, "/healthz");
  if (!url.pathname.endsWith("/healthz")) url.pathname = "/healthz";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function deriveMcpHealthUrl(mcpUrl) {
  const url = new URL(mcpUrl);
  url.pathname = url.pathname.replace(/\/mcp\/?$/, "/health");
  if (!url.pathname.endsWith("/health")) url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function addCheck(check) {
  checks.push({
    detail: {},
    ...check,
  });
}

function value(name) {
  const text = process.env[name]?.trim();
  return text ? text : null;
}

function readHealthTimeoutMs() {
  const parsed = Number(process.env.DESKTOP_LLM_GATEWAY_HEALTH_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5_000;
}
