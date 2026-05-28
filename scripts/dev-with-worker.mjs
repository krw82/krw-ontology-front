#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { context } from "esbuild";
import nextEnv from "@next/env";

const workerEntry = "src/worker/agent-worker.ts";
const workerOutfile = ".worker/agent-worker.mjs";
const serverOnlyShim = resolve("src/worker/server-only-shim.ts");

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

function configureDevOntologyEnv() {
  const allowProdOntology = process.env.KRW_DEV_ALLOW_PROD_ONTOLOGY === "1";
  const frontDir = process.cwd();
  const defaultReleaseRoot = join(
    homedir(),
    "krw-ontology-data",
    "releases",
    "dev",
    "current",
  );
  const configuredRoot = process.env.KRW_ONTOLOGY_RELEASE_ROOT
    ? process.env.KRW_ONTOLOGY_RELEASE_ROOT
    : isReleaseRoot(process.env.KRW_ONTOLOGY_ROOT)
      ? process.env.KRW_ONTOLOGY_ROOT
      : "";
  const releaseRoot =
    configuredRoot && (allowProdOntology || !isProdReleaseRoot(configuredRoot))
      ? configuredRoot
      : defaultReleaseRoot;
  const manifestPath = join(releaseRoot, "manifest.json");
  const indexPath = join(releaseRoot, "indexes", "agent_index.sqlite");
  const pluginSourcePath = join(
    homedir(),
    "krw-ontology",
    "plugins",
    "krw-ontology",
  );
  const pluginPath = join(frontDir, "ref", "plugins", "dev", "krw-ontology");
  const mcpUrl = process.env.KRW_DEV_MCP_URL || "http://127.0.0.1:8766/mcp";

  if (!allowProdOntology || !process.env.KRW_ONTOLOGY_ENV) {
    process.env.KRW_ONTOLOGY_ENV = "dev";
  }
  process.env.KRW_ONTOLOGY_RELEASE_ROOT = releaseRoot;
  process.env.KRW_ONTOLOGY_ROOT = releaseRoot;
  if (!isInsideRoot(process.env.KRW_ONTOLOGY_MANIFEST_PATH, releaseRoot)) {
    process.env.KRW_ONTOLOGY_MANIFEST_PATH = manifestPath;
  }
  if (!isInsideRoot(process.env.KRW_ONTOLOGY_INDEX_PATH, releaseRoot)) {
    process.env.KRW_ONTOLOGY_INDEX_PATH = indexPath;
  }
  process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH =
    process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH || pluginSourcePath;
  if (process.env.KRW_DEV_ALLOW_CUSTOM_PLUGIN_PATH !== "1") {
    process.env.KRW_ONTOLOGY_PLUGIN_PATH = pluginPath;
  }
  process.env.KRW_ONTOLOGY_MCP_URL = mcpUrl;
  process.env.KRW_ONTOLOGY_MCP_HEALTH_URL = healthUrlFromMcpUrl(mcpUrl);
  process.env.KRW_ONTOLOGY_MCP_HOST = new URL(mcpUrl).hostname;
  process.env.KRW_ONTOLOGY_MCP_PORT = new URL(mcpUrl).port || "80";
  process.env.KRW_ONTOLOGY_MCP_PATH = new URL(mcpUrl).pathname || "/mcp";
  if (process.env.KRW_DEV_ALLOW_CUSTOM_MCP_BASE_URL !== "1") {
    process.env.MCP_BASE_URL = new URL(mcpUrl).origin;
  }
  console.info("[dev] ontology env", {
    releaseRoot: process.env.KRW_ONTOLOGY_RELEASE_ROOT,
    pluginPath: process.env.KRW_ONTOLOGY_PLUGIN_PATH,
    mcpUrl: process.env.KRW_ONTOLOGY_MCP_URL,
  });
}

function isReleaseRoot(value) {
  return typeof value === "string" && value.includes("/releases/");
}

function isProdReleaseRoot(value) {
  return typeof value === "string" && value.includes("/releases/prod/");
}

function isInsideRoot(value, root) {
  if (!value) return false;
  const resolvedRoot = resolve(root);
  const resolvedValue = resolve(value);
  return (
    resolvedValue === resolvedRoot || resolvedValue.startsWith(`${resolvedRoot}/`)
  );
}

function healthUrlFromMcpUrl(mcpUrl) {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

configureDevOntologyEnv();
materializeDevPlugin();

let worker = null;
let nextDev = null;
let devMcp = null;
let shuttingDown = false;
let workerStartQueued = false;
let workerRestarting = false;

function childEnv() {
  const env = { ...process.env };
  if (!env.NO_COLOR) {
    env.FORCE_COLOR = env.FORCE_COLOR ?? "1";
  }
  return env;
}

function readNiceEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < -20 || parsed > 20) {
    throw new Error(`${name} must be an integer between -20 and 20: ${raw}`);
  }
  return parsed;
}

const devWorkerNice = readNiceEnv("KRW_DEV_WORKER_NICE", 10);
const devMcpNice = readNiceEnv("KRW_DEV_MCP_NICE", 10);

function materializeDevPlugin() {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/materialize-ontology-plugin.mjs",
      "--env",
      "dev",
      "--source",
      process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH,
      "--out",
      process.env.KRW_ONTOLOGY_PLUGIN_PATH,
      "--mcp-url",
      process.env.KRW_ONTOLOGY_MCP_URL,
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error("Failed to materialize dev KRW Ontology plugin");
  }
}

function spawnLabeled(label, command, args, onUnexpectedExit) {
  const child = spawn(command, args, {
    env: childEnv(),
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.stdin?.on("error", () => {
    // The child may close stdin during shutdown; process exit handling below is enough.
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const suffix = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[dev:${label}] exited with ${suffix}`);
    onUnexpectedExit?.(code, signal);
  });

  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.stdin?.end();
  child.kill("SIGTERM");

  const timeout = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
    }
  }, 5000);
  timeout.unref?.();

  try {
    await once(child, "exit");
  } catch {
    // The process is already gone.
  } finally {
    clearTimeout(timeout);
  }
}

async function restartWorker() {
  if (shuttingDown) return;
  if (workerStartQueued) return;
  workerStartQueued = true;

  try {
    workerRestarting = true;
    await stopChild(worker);
    workerRestarting = false;
    if (shuttingDown) return;
    worker = spawnLabeled(
      "worker",
      "nice",
      ["-n", String(devWorkerNice), process.execPath, workerOutfile],
      (code) => {
        if (workerRestarting) return;
        void shutdown("worker-exit").finally(() => process.exit(code ?? 1));
      },
    );
  } finally {
    workerRestarting = false;
    workerStartQueued = false;
  }
}

async function readDevMcpHealth() {
  try {
    const response = await fetch(process.env.KRW_ONTOLOGY_MCP_HEALTH_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json();
    return { response, payload };
  } catch {
    return null;
  }
}

async function waitForDevMcpHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await readDevMcpHealth();
    if (
      result?.response.status === 200 &&
      result.payload?.ok === true &&
      result.payload?.env === "dev" &&
      result.payload?.manifest_valid === true
    ) {
      console.info("[dev:mcp] ready", {
        releaseId: result.payload.release_id,
        root: result.payload.root,
      });
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("Dev MCP server did not become healthy");
}

async function ensureDevMcpServer() {
  const reuseDeadline = Date.now() + 5_000;
  while (Date.now() < reuseDeadline) {
    const existing = await readDevMcpHealth();
    if (
      existing?.response.status === 200 &&
      existing.payload?.ok === true &&
      existing.payload?.env === "dev" &&
      existing.payload?.manifest_valid === true
    ) {
      console.info("[dev:mcp] reusing existing server", {
        releaseId: existing.payload.release_id,
        root: existing.payload.root,
      });
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  devMcp = spawnLabeled(
    "mcp",
    "nice",
    ["-n", String(devMcpNice), "scripts/start-mcp-server-dev.sh"],
    async (code) => {
      const existing = await readDevMcpHealth();
      if (
        existing?.response.status === 200 &&
        existing.payload?.ok === true &&
        existing.payload?.env === "dev" &&
        existing.payload?.manifest_valid === true
      ) {
        console.info("[dev:mcp] spawned server exited; reusing existing server", {
          releaseId: existing.payload.release_id,
          root: existing.payload.root,
        });
        devMcp = null;
        return;
      }
      void shutdown("mcp-exit").finally(() => process.exit(code ?? 1));
    },
  );
  await waitForDevMcpHealth();
}

const workerRestartPlugin = {
  name: "worker-restart",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({
      path: serverOnlyShim,
    }));

    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error("[dev:worker] build failed; keeping previous worker");
        return;
      }
      void restartWorker();
    });
  },
};

const workerContext = await context({
  entryPoints: [workerEntry],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  packages: "external",
  outfile: workerOutfile,
  plugins: [workerRestartPlugin],
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[dev] shutting down after ${signal}`);

  await Promise.allSettled([
    workerContext.dispose(),
    stopChild(worker),
    stopChild(devMcp),
    stopChild(nextDev),
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

await ensureDevMcpServer();

nextDev = spawnLabeled("web", "npm", ["run", "dev:web"], (code) => {
  void shutdown("web-exit").finally(() => process.exit(code ?? 1));
});
await workerContext.watch();
await new Promise(() => {
  // Keep the wrapper alive; child exit handlers and signal handlers own shutdown.
});
