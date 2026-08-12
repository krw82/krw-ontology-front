#!/usr/bin/env node

/**
 * Local full-stack development entry point.
 *
 * The web app and the Rust research daemon have a shared, generated release
 * pin. Starting only the web app before that pin exists used to leave a
 * developer on the legacy/fallback path, which looks like a product outage.
 * This wrapper reuses a healthy local daemon when present, otherwise owns one
 * for the life of this `npm run dev` process.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const frontRoot = process.cwd();
loadEnvConfig(frontRoot, true);

const agentRoot = resolve(
  process.env.KRW_AGENT_REPO_DIR ?? join(frontRoot, "..", "krw-agnet"),
);
const stateDir = resolve(
  process.env.KRW_AGENT_LOCAL_STATE_DIR ??
    join(agentRoot, ".local", "agent-gateway-front-dev"),
);
const runtimeEnvFile = resolve(
  process.env.KRW_AGENT_FRONTEND_ENV_FILE ?? join(stateDir, "frontend.env"),
);
const gatewayPort = portFromEnv("KRW_AGENT_GATEWAY_PORT", 15419);
const capabilityPort = portFromEnv("KRW_AGENT_LOCAL_CAPABILITY_PORT", 19439);
const tlsPort = portFromEnv("KRW_AGENT_LOCAL_MCP_TLS_PORT", 20439);
const gatewayHealthUrl = `http://127.0.0.1:${gatewayPort}/healthz`;
const runtimeStartScript = join(agentRoot, "scripts", "start_local_agent_gateway_stack.sh");
const configuredProvider = process.env.KRW_AGENT_PROVIDER?.trim() || "glm";

let ownedRuntime = null;
let web = null;
let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

try {
  if (configuredProvider !== "glm" && configuredProvider !== "deepseek") {
    throw new Error("KRW_AGENT_PROVIDER must be glm or deepseek");
  }
  // `next dev` maintains a lock for a single worktree. Starting a second
  // wrapper used to launch auxiliary workers, then fail after choosing a
  // different port. Reuse the already-running development server instead.
  if (await webIsListening()) {
    if (await runtimeIsReady()) {
      process.stdout.write(
        `[dev:research] web and Rust research engine are already running. Open http://localhost:3000\n`,
      );
      process.exit(0);
    }
    throw new Error(
      "web is already running but its Rust research engine is not ready; stop the existing dev server, then run npm run dev once",
    );
  }

  if (await runtimeIsReady()) {
    process.stdout.write(`[dev:research] reusing Rust research engine on ${gatewayHealthUrl}\n`);
  } else {
    if (await gatewayIsListening()) {
      throw new Error(
        `Rust research engine is already running with a different or stale provider pin; stop it, then start with KRW_AGENT_PROVIDER=${configuredProvider}`,
      );
    }
    process.stdout.write("[dev:research] starting local Rust research engine…\n");
    ownedRuntime = startRuntime();
    await waitForRuntime(ownedRuntime);
    process.stdout.write(`[dev:research] Rust research engine is ready on ${gatewayHealthUrl}\n`);
  }

  web = spawn(process.execPath, ["scripts/dev-with-worker.mjs"], {
    cwd: frontRoot,
    env: {
      ...process.env,
      // Do not allow a stale shell export to silently select the retired
      // worker after the Rust runtime was successfully admitted above.
      KRW_AGENT_BACKEND_MODE: "rust",
      // Keep the provider identity available even when reusing an older local
      // runtime env file that predates the provider pin.
      KRW_AGENT_PROVIDER: configuredProvider,
      KRW_AGENT_FRONTEND_ENV_FILE: runtimeEnvFile,
    },
    stdio: "inherit",
  });
  web.once("error", (error) => {
    process.stderr.write(`[dev:research] web process failed to start: ${error.message}\n`);
    void shutdown("web-error").finally(() => process.exit(1));
  });
  web.once("exit", (code, signal) => {
    if (shuttingDown) return;
    const status = code ?? (signal ? 1 : 0);
    void shutdown("web-exit").finally(() => process.exit(status));
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "research engine startup failed";
  process.stderr.write(`[dev:research] ${message}\n`);
  await shutdown("startup-error");
  process.exit(1);
}

function startRuntime() {
  const databaseUrl = value("AGENT_V1_DATABASE_URL") ?? value("KRW_AGENT_DATABASE_URL");
  const provider = configuredProvider;

  const runtimeEnv = {
    ...process.env,
    KRW_AGENT_LOCAL_STATE_DIR: stateDir,
    KRW_AGENT_GATEWAY_PORT: String(gatewayPort),
    KRW_AGENT_LOCAL_CAPABILITY_PORT: String(capabilityPort),
    KRW_AGENT_LOCAL_MCP_TLS_PORT: String(tlsPort),
    KRW_AGENT_DATABASE_MODE: "supabase",
    KRW_AGENT_SUPABASE_PROJECT_DIR: frontRoot,
    KRW_AGENT_PROVIDER: provider,
  };
  if (databaseUrl) runtimeEnv.KRW_AGENT_DATABASE_URL = databaseUrl;

  const child = spawn("bash", [runtimeStartScript], {
    cwd: agentRoot,
    env: runtimeEnv,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(`[dev:research] runtime process failed to start: ${error.message}\n`);
  });
  return child;
}

async function waitForRuntime(child) {
  const deadline = Date.now() + 12 * 60 * 1000;
  let childExit = null;
  child.once("exit", (code, signal) => {
    childExit = `Rust research engine exited before ready (code=${code ?? "none"}, signal=${signal ?? "none"})`;
  });

  while (Date.now() < deadline) {
    if (childExit) throw new Error(childExit);
    if (await runtimeIsReady()) return;
    await delay(250);
  }
  throw new Error("Rust research engine did not become ready within 12 minutes");
}

async function runtimeIsReady() {
  if (!(await hasUsableRuntimePin())) return false;
  try {
    const response = await fetch(gatewayHealthUrl, {
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}

async function gatewayIsListening() {
  try {
    const response = await fetch(gatewayHealthUrl, {
      signal: AbortSignal.timeout(1_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function webIsListening() {
  try {
    await fetch("http://127.0.0.1:3000/", {
      redirect: "manual",
      signal: AbortSignal.timeout(1_000),
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  }
}

async function hasUsableRuntimePin() {
  let source;
  try {
    source = await readFile(runtimeEnvFile, "utf8");
  } catch {
    return false;
  }
  if (Buffer.byteLength(source, "utf8") > 16 * 1024) return false;

  const values = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) return false;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  if (values.get("KRW_AGENT_BACKEND_MODE") !== "rust") return false;
  // Do not reuse a healthy daemon from the other provider lane. Older local
  // env files may not have the explicit provider key, so the immutable public
  // descriptor remains the compatibility source of truth in that case.
  const pinnedProvider = values.get("KRW_AGENT_PROVIDER");
  if (pinnedProvider && pinnedProvider !== configuredProvider) return false;
  const descriptor = values.get("KRW_AGENT_RELEASE_DESCRIPTOR_PATH");
  const descriptorArtifactHash = values.get("KRW_AGENT_RELEASE_ARTIFACT_HASH");
  const releaseSetHash = values.get("KRW_AGENT_RELEASE_SET_HASH");
  const hashPattern = /^sha256:[0-9a-f]{64}$/;
  if (
    !descriptor
    || !descriptor.startsWith("/")
    || !hashPattern.test(descriptorArtifactHash ?? "")
    || !hashPattern.test(releaseSetHash ?? "")
  ) return false;
  try {
    await access(descriptor, constants.R_OK);
    const descriptorBytes = await readFile(descriptor);
    const observedArtifactHash = `sha256:${createHash("sha256").update(descriptorBytes).digest("hex")}`;
    if (observedArtifactHash !== descriptorArtifactHash) return false;
    const descriptorValue = JSON.parse(descriptorBytes.toString("utf8"));
    if (descriptorValue?.release_set_hash !== releaseSetHash) return false;
    const expectedModel = configuredProvider === "glm"
      ? "glm-5.2"
      : "deepseek-v4-flash";
    const entries = Array.isArray(descriptorValue?.entries)
      ? descriptorValue.entries
      : [];
    if (
      descriptorValue?.schema_version !== 3 ||
      entries.length === 0 ||
      !entries.every(
        (entry) => entry?.execution?.resolved_model === expectedModel,
      )
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function portFromEnv(name, fallback) {
  const raw = value(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer in 1..65535`);
  }
  return parsed;
}

function value(name) {
  const raw = process.env[name]?.trim();
  return raw || null;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (web && web.exitCode === null && !web.killed) web.kill("SIGTERM");
  if (ownedRuntime && ownedRuntime.exitCode === null && !ownedRuntime.killed) {
    ownedRuntime.kill("SIGTERM");
  }
  if (reason !== "web-exit") {
    process.stdout.write(`[dev:research] stopped (${reason})\n`);
  }
}
