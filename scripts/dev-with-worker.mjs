#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import process from "node:process";
import { context } from "esbuild";
import nextEnv from "@next/env";

const workerEntry = "src/worker/agent-worker.ts";
const workerOutfile = ".worker/agent-worker.mjs";
const serverOnlyShim = resolve("src/worker/server-only-shim.ts");

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

let worker = null;
let nextDev = null;
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

function spawnLabeled(label, command, args, onUnexpectedExit) {
  const child = spawn(command, args, {
    env: childEnv(),
    stdio: "inherit",
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
    worker = spawnLabeled("worker", process.execPath, [workerOutfile], (code) => {
      if (workerRestarting) return;
      void shutdown("worker-exit").finally(() => process.exit(code ?? 1));
    });
  } finally {
    workerRestarting = false;
    workerStartQueued = false;
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
    stopChild(nextDev),
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

nextDev = spawnLabeled("web", "npm", ["run", "dev:web"], (code) => {
  void shutdown("web-exit").finally(() => process.exit(code ?? 1));
});
await workerContext.watch();
