#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { context } from "esbuild";
import nextEnv from "@next/env";

const workerEntry = "src/worker/agent-worker.ts";
const workerOutfile = ".worker/agent-worker.mjs";
const documentWorkerEntry = "src/worker/document-worker.ts";
const documentWorkerOutfile = ".worker/document-worker.mjs";
const serverOnlyShim = resolve("src/worker/server-only-shim.ts");

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

function configureDevOntologyEnv() {
  const allowProdOntology = process.env.KRW_DEV_ALLOW_PROD_ONTOLOGY === "1";
  const frontDir = process.cwd();
  process.env.DOCUMENT_STORAGE_ROOT =
    process.env.DOCUMENT_STORAGE_ROOT ||
    join(frontDir, ".tmp", "document-attachments");
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
  const globalSpinePath = join(releaseRoot, "indexes", "global_spine.sqlite");
  const shardManifestPath = join(releaseRoot, "indexes", "shard_manifest.json");
  const pluginSourcePath = join(
    homedir(),
    "krw-ontology",
    "plugins",
    "krw-ontology",
  );
  const pluginPath = join(frontDir, "ref", "plugins", "dev", "krw-ontology");
  const guruPluginSourcePath = join(
    homedir(),
    "krw-ontology",
    "plugins",
    "krw-guru-advisor",
  );
  const guruPluginPath = join(
    frontDir,
    "ref",
    "plugins",
    "dev",
    "krw-guru-advisor",
  );
  const guruDataRoot =
    process.env.KRW_GURU_DATA_ROOT ||
    join(homedir(), "krw-ontology-guru-data");
  const guruReleaseRoot =
    process.env.KRW_GURU_RELEASE_ROOT ||
    join(guruDataRoot, "releases", "dev", "current");
  const mcpUrl = process.env.KRW_DEV_MCP_URL || "http://127.0.0.1:8766/mcp";
  const stockNewsMcpUrl =
    process.env.STOCK_NEWS_MCP_URL || "http://127.0.0.1:8776/mcp";
  const feedMcpUrl =
    process.env.KRW_FEED_MCP_URL || "http://127.0.0.1:8796/mcp";

  if (!allowProdOntology || !process.env.KRW_ONTOLOGY_ENV) {
    process.env.KRW_ONTOLOGY_ENV = "dev";
  }
  process.env.KRW_ONTOLOGY_RELEASE_ROOT = releaseRoot;
  process.env.KRW_ONTOLOGY_ROOT = releaseRoot;
  if (!isInsideRoot(process.env.KRW_ONTOLOGY_MANIFEST_PATH, releaseRoot)) {
    process.env.KRW_ONTOLOGY_MANIFEST_PATH = manifestPath;
  }
  if (!isInsideRoot(process.env.KRW_ONTOLOGY_GLOBAL_SPINE_PATH, releaseRoot)) {
    process.env.KRW_ONTOLOGY_GLOBAL_SPINE_PATH = globalSpinePath;
  }
  if (!isInsideRoot(process.env.KRW_ONTOLOGY_SHARD_MANIFEST_PATH, releaseRoot)) {
    process.env.KRW_ONTOLOGY_SHARD_MANIFEST_PATH = shardManifestPath;
  }
  process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH =
    process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH || pluginSourcePath;
  process.env.KRW_ONTOLOGY_SOURCE_DIR =
    process.env.KRW_ONTOLOGY_SOURCE_DIR || join(homedir(), "krw-ontology");
  if (process.env.KRW_DEV_ALLOW_CUSTOM_PLUGIN_PATH !== "1") {
    process.env.KRW_ONTOLOGY_PLUGIN_PATH = pluginPath;
  }
  process.env.KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH =
    process.env.KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH || guruPluginSourcePath;
  if (process.env.KRW_DEV_ALLOW_CUSTOM_GURU_PLUGIN_PATH !== "1") {
    process.env.KRW_GURU_ADVISOR_PLUGIN_PATH = guruPluginPath;
  }
  process.env.KRW_GURU_DATA_ROOT = guruDataRoot;
  process.env.KRW_GURU_RELEASE_ROOT = guruReleaseRoot;
  process.env.KRW_ONTOLOGY_MCP_URL = mcpUrl;
  process.env.KRW_ONTOLOGY_MCP_HEALTH_URL = healthUrlFromMcpUrl(mcpUrl);
  process.env.KRW_ONTOLOGY_MCP_HOST = new URL(mcpUrl).hostname;
  process.env.KRW_ONTOLOGY_MCP_PORT = new URL(mcpUrl).port || "80";
  process.env.KRW_ONTOLOGY_MCP_PATH = new URL(mcpUrl).pathname || "/mcp";
  process.env.STOCK_NEWS_MCP_URL = stockNewsMcpUrl;
  process.env.STOCK_NEWS_MCP_HOST = new URL(stockNewsMcpUrl).hostname;
  process.env.STOCK_NEWS_MCP_PORT = new URL(stockNewsMcpUrl).port || "80";
  process.env.STOCK_NEWS_MCP_PATH =
    new URL(stockNewsMcpUrl).pathname || "/mcp";
  process.env.KRW_FEED_MCP_URL = feedMcpUrl;
  process.env.KRW_FEED_MCP_HOST = new URL(feedMcpUrl).hostname;
  process.env.KRW_FEED_MCP_PORT = new URL(feedMcpUrl).port || "80";
  if (process.env.KRW_DEV_ALLOW_CUSTOM_MCP_BASE_URL !== "1") {
    process.env.MCP_BASE_URL = new URL(mcpUrl).origin;
  }
  console.info("[dev] ontology env", {
    releaseRoot: process.env.KRW_ONTOLOGY_RELEASE_ROOT,
    pluginPath: process.env.KRW_ONTOLOGY_PLUGIN_PATH,
    guruPluginPath: process.env.KRW_GURU_ADVISOR_PLUGIN_PATH,
    mcpUrl: process.env.KRW_ONTOLOGY_MCP_URL,
    stockNewsMcpUrl: process.env.STOCK_NEWS_MCP_URL,
    feedMcpUrl: process.env.KRW_FEED_MCP_URL,
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

let worker = null;
let documentWorker = null;
let nextDev = null;
let devMcp = null;
let stockNewsMcp = null;
let feedMcp = null;
let shuttingDown = false;
let workerStartQueued = false;
let workerRestarting = false;
let documentWorkerStartQueued = false;
let documentWorkerRestarting = false;
let expectedStockNewsCoverageCount = null;

materializeDevPlugin();

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

function truthyEnv(value) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isKrwFeedMcpEnabled() {
  return truthyEnv(process.env.KRW_FEED_MCP_ENABLED)
    && Boolean(process.env.KRW_FEED_MCP_TOKEN || process.env.FEED_MCP_AUTH_TOKEN);
}

// Content work (for example an editorial Storage import) does not need the
// queue consumers.  Keeping them opt-out makes a local DB incident easier to
// isolate and prevents background claims/cleanup from competing with a manual
// content bootstrap.  `npm run dev` keeps the existing all-workers behavior.
const shouldRunAgentWorker = !truthyEnv(process.env.KRW_DEV_SKIP_AGENT_WORKER);
const shouldRunDocumentWorker = !truthyEnv(process.env.KRW_DEV_SKIP_DOCUMENT_WORKER);

function isStockNewsEnabled() {
  if (!truthyEnv(process.env.STOCK_NEWS_RELEASE_ENABLED)) return false;
  if (truthyEnv(process.env.STOCK_NEWS_FORCE_DISABLED)) return false;
  if (!truthyEnv(process.env.STOCK_NEWS_ENABLED)) return false;
  if (!process.env.FINNHUB_API_KEY) {
    throw new Error("STOCK_NEWS_ENABLED=1 but FINNHUB_API_KEY is missing");
  }
  return true;
}

function materializeDevPlugin() {
  const ontologyResult = spawnSync(
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
      "--stock-news-url",
      process.env.STOCK_NEWS_MCP_URL,
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );
  if (ontologyResult.status !== 0) {
    throw new Error("Failed to materialize dev KRW Ontology plugin");
  }

  const guruResult = spawnSync(
    process.execPath,
    [
      "scripts/materialize-guru-advisor-plugin.mjs",
      "--env",
      "dev",
      "--source",
      process.env.KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH,
      "--out",
      process.env.KRW_GURU_ADVISOR_PLUGIN_PATH,
      "--ontology-source-dir",
      process.env.KRW_ONTOLOGY_SOURCE_DIR || join(homedir(), "krw-ontology"),
      "--guru-data-root",
      process.env.KRW_GURU_DATA_ROOT,
      "--guru-release-root",
      process.env.KRW_GURU_RELEASE_ROOT,
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );
  if (guruResult.status !== 0) {
    throw new Error("Failed to materialize dev KRW Guru Advisor plugin");
  }

  if (isStockNewsEnabled()) {
    exportDevStockNewsCoverage();
  }
}

function exportDevStockNewsCoverage() {
  const coveragePath = join(
    process.env.KRW_ONTOLOGY_PLUGIN_PATH,
    "stock-news",
    "coverage_companies.json",
  );
  const result = spawnSync(
    process.execPath,
    [
      "scripts/export-stock-news-coverage.mjs",
      "--env",
      process.env.KRW_ONTOLOGY_ENV || "dev",
      "--out",
      coveragePath,
      "--min-companies",
      "1",
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    console.warn(
      "[dev:stock-news-mcp] failed to export ontology catalog coverage; using stock-news package fallback coverage",
    );
    return;
  }

  process.env.STOCK_NEWS_COVERAGE_PATH = coveragePath;
  expectedStockNewsCoverageCount = readCoverageCount(coveragePath);
}

function readCoverageCount(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
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
  if (!shouldRunAgentWorker) return;
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

async function restartDocumentWorker() {
  if (!shouldRunDocumentWorker) return;
  if (shuttingDown) return;
  if (documentWorkerStartQueued) return;
  documentWorkerStartQueued = true;

  try {
    documentWorkerRestarting = true;
    await stopChild(documentWorker);
    documentWorkerRestarting = false;
    if (shuttingDown) return;
    documentWorker = spawnLabeled(
      "document-worker",
      "nice",
      ["-n", String(devWorkerNice), process.execPath, documentWorkerOutfile],
      (code) => {
        if (documentWorkerRestarting) return;
        void shutdown("document-worker-exit").finally(() =>
          process.exit(code ?? 1),
        );
      },
    );
  } finally {
    documentWorkerRestarting = false;
    documentWorkerStartQueued = false;
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

async function readStockNewsMcpHealth() {
  try {
    const response = await fetch(healthUrlFromMcpUrl(process.env.STOCK_NEWS_MCP_URL), {
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

async function waitForStockNewsMcpHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await readStockNewsMcpHealth();
    if (
      result?.response.status === 200 &&
      result.payload?.ok === true &&
      result.payload?.name === "stock-news-mcp"
    ) {
      console.info("[dev:stock-news-mcp] ready", {
        coverageCount: result.payload.coverage_count,
        hasZaiApiKey: result.payload.has_zai_api_key,
      });
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("Stock News dev MCP server did not become healthy");
}

async function ensureStockNewsMcpServer() {
  const reuseDeadline = Date.now() + 5_000;
  while (Date.now() < reuseDeadline) {
    const existing = await readStockNewsMcpHealth();
    if (
      existing?.response.status === 200 &&
      existing.payload?.ok === true &&
      existing.payload?.name === "stock-news-mcp" &&
      stockNewsCoverageMatches(existing.payload)
    ) {
      console.info("[dev:stock-news-mcp] reusing existing server", {
        coverageCount: existing.payload.coverage_count,
        hasZaiApiKey: existing.payload.has_zai_api_key,
      });
      return;
    }
    if (
      existing?.response.status === 200 &&
      existing.payload?.ok === true &&
      existing.payload?.name === "stock-news-mcp" &&
      !stockNewsCoverageMatches(existing.payload)
    ) {
      console.info("[dev:stock-news-mcp] replacing existing server with stale coverage", {
        coverageCount: existing.payload.coverage_count,
        expectedCoverageCount: expectedStockNewsCoverageCount,
      });
      stopManagedStockNewsListener();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  stockNewsMcp = spawnLabeled(
    "stock-news-mcp",
    "nice",
    ["-n", String(devMcpNice), "scripts/start-stock-news-mcp-dev.sh"],
    async (code) => {
      const existing = await readStockNewsMcpHealth();
      if (
        existing?.response.status === 200 &&
        existing.payload?.ok === true &&
        existing.payload?.name === "stock-news-mcp"
      ) {
        console.info("[dev:stock-news-mcp] spawned server exited; reusing existing server", {
          coverageCount: existing.payload.coverage_count,
        });
        stockNewsMcp = null;
        return;
      }
      void shutdown("stock-news-mcp-exit").finally(() => process.exit(code ?? 1));
    },
  );
  await waitForStockNewsMcpHealth();
}

async function readKrwFeedMcpHealth() {
  try {
    const response = await fetch(healthUrlFromMcpUrl(process.env.KRW_FEED_MCP_URL));
    return { response, payload: await response.json() };
  } catch {
    return null;
  }
}

async function waitForKrwFeedMcpHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await readKrwFeedMcpHealth();
    if (
      result?.response.status === 200 &&
      result.payload?.ok === true &&
      result.payload?.name === "krw-feed-mcp" &&
      result.payload?.enabled === true
    ) {
      console.info("[dev:krw-feed-mcp] ready", {
        environment: result.payload.environment,
      });
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("KRW Feed dev MCP server did not become healthy");
}

async function ensureKrwFeedMcpServer() {
  const reuseDeadline = Date.now() + 5_000;
  while (Date.now() < reuseDeadline) {
    const existing = await readKrwFeedMcpHealth();
    if (
      existing?.response.status === 200 &&
      existing.payload?.ok === true &&
      existing.payload?.name === "krw-feed-mcp" &&
      existing.payload?.enabled === true
    ) {
      console.info("[dev:krw-feed-mcp] reusing existing server", {
        environment: existing.payload.environment,
      });
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  feedMcp = spawnLabeled(
    "krw-feed-mcp",
    "nice",
    ["-n", String(devMcpNice), "scripts/start-krw-feed-mcp-dev.sh"],
    async (code) => {
      const existing = await readKrwFeedMcpHealth();
      if (
        existing?.response.status === 200 &&
        existing.payload?.ok === true &&
        existing.payload?.name === "krw-feed-mcp"
      ) {
        feedMcp = null;
        return;
      }
      void shutdown("krw-feed-mcp-exit").finally(() => process.exit(code ?? 1));
    },
  );
  await waitForKrwFeedMcpHealth();
}

function stockNewsCoverageMatches(payload) {
  if (!expectedStockNewsCoverageCount) return true;
  return payload?.coverage_count === expectedStockNewsCoverageCount;
}

function stopManagedStockNewsListener() {
  const port = new URL(process.env.STOCK_NEWS_MCP_URL).port || "8776";
  const result = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  const pids = result.stdout
    .split(/\s+/)
    .map((pid) => pid.trim())
    .filter(Boolean);
  for (const pid of pids) {
    const command = spawnSync("ps", ["-p", pid, "-o", "command="], {
      encoding: "utf8",
    }).stdout;
    if (!command.includes("stock-news-mcp") && !command.includes("dist/server.js")) {
      throw new Error(`Port ${port} is occupied by an unmanaged process: pid=${pid}`);
    }
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Process may have exited between lsof and kill.
    }
  }
}

function stopManagedDevMcpListener() {
  const port = new URL(process.env.KRW_ONTOLOGY_MCP_URL).port || "8766";
  const result = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  const pids = result.stdout
    .split(/\s+/)
    .map((pid) => pid.trim())
    .filter(Boolean);
  for (const pid of pids) {
    const command = spawnSync("ps", ["-p", pid, "-o", "command="], {
      encoding: "utf8",
    }).stdout;
    if (
      !command.includes("krw-ontology-mcp") &&
      !command.includes("krw-ontology") &&
      !command.includes("uv")
    ) {
      throw new Error(`Port ${port} is occupied by an unmanaged process: pid=${pid}`);
    }
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Process may have exited between lsof and kill.
    }
  }
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

const documentWorkerRestartPlugin = {
  name: "document-worker-restart",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({
      path: serverOnlyShim,
    }));

    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error(
          "[dev:document-worker] build failed; keeping previous document worker",
        );
        return;
      }
      void restartDocumentWorker();
    });
  },
};

const workerContext = shouldRunAgentWorker ? await context({
  entryPoints: [workerEntry],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  packages: "external",
  outfile: workerOutfile,
  plugins: [workerRestartPlugin],
}) : null;

const documentWorkerContext = shouldRunDocumentWorker ? await context({
  entryPoints: [documentWorkerEntry],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  packages: "external",
  outfile: documentWorkerOutfile,
  plugins: [documentWorkerRestartPlugin],
}) : null;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[dev] shutting down after ${signal}`);

  // The dev MCP server (`uv run krw-ontology-mcp`) spawns a child `python3`
  // that survives SIGTERM on the `uv` parent. Kill any lingering listener on
  // the MCP port so it does not block the next `npm run dev`.
  try {
    stopManagedDevMcpListener();
  } catch (error) {
    console.warn(`[dev:mcp] cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  }

  await Promise.allSettled([
    workerContext?.dispose(),
    documentWorkerContext?.dispose(),
    stopChild(worker),
    stopChild(documentWorker),
    stopChild(devMcp),
    stopChild(stockNewsMcp),
    stopChild(feedMcp),
    stopChild(nextDev),
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

await ensureDevMcpServer();
if (isStockNewsEnabled()) {
  await ensureStockNewsMcpServer();
} else {
  console.info("[dev:stock-news-mcp] disabled");
}
if (isKrwFeedMcpEnabled()) {
  await ensureKrwFeedMcpServer();
} else {
  console.info("[dev:krw-feed-mcp] disabled");
}

nextDev = spawnLabeled("web", "npm", ["run", "dev:web"], (code) => {
  void shutdown("web-exit").finally(() => process.exit(code ?? 1));
});
if (workerContext) {
  await workerContext.watch();
} else {
  console.info("[dev:worker] disabled by KRW_DEV_SKIP_AGENT_WORKER");
}
if (documentWorkerContext) {
  await documentWorkerContext.watch();
} else {
  console.info("[dev:document-worker] disabled by KRW_DEV_SKIP_DOCUMENT_WORKER");
}
await new Promise(() => {
  // Keep the wrapper alive; child exit handlers and signal handlers own shutdown.
});
