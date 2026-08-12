#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(new URL("..", import.meta.url).pathname);
const agentRepo = parseAgentRepo(process.argv.slice(2));
const vendorRoot = join(root, "vendor", "krw-agent-host");
const temporaryRoot = await mkdtemp(join(tmpdir(), "krw-agent-host-sync-"));

try {
  const output = await run(
    process.execPath,
    [join(agentRepo, "scripts", "package-host-ts.mjs")],
    agentRepo,
    { KRW_AGENT_HOST_PACKAGE_OUTPUT: join(temporaryRoot, "package") },
  );
  const provenance = parseLastJsonLine(output.stdout);
  validateProvenance(provenance, agentRepo);
  const archiveBytes = await readFile(provenance.archive_path);
  const archiveHash = `sha256:${createHash("sha256").update(archiveBytes).digest("hex")}`;
  if (archiveHash !== provenance.sha256) throw new Error("host_package_output_hash_mismatch");

  await mkdir(vendorRoot, { recursive: true });
  const archiveTarget = join(vendorRoot, provenance.archive);
  const temporaryArchive = join(vendorRoot, `.${provenance.archive}.${process.pid}.tmp`);
  const temporaryProvenance = join(vendorRoot, `.provenance.${process.pid}.tmp`);
  await writeFile(temporaryArchive, archiveBytes, { mode: 0o644, flag: "wx" });
  await writeFile(
    temporaryProvenance,
    `${JSON.stringify({
      package: provenance.package,
      version: provenance.version,
      agent_git_commit: provenance.agent_git_commit,
      agent_git_tree: provenance.agent_git_tree,
      archive: provenance.archive,
      sha256: provenance.sha256,
    }, null, 2)}\n`,
    { mode: 0o644, flag: "wx" },
  );
  await rename(temporaryArchive, archiveTarget);
  await rename(temporaryProvenance, join(vendorRoot, "provenance.json"));

  await run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--offline"], root);
  await run("npm", ["install", "--ignore-scripts", "--offline"], root);
  await run(process.execPath, [join(root, "scripts", "verify-krw-agent-host-package.mjs")], root);
  console.log(JSON.stringify({
    status: "synced",
    package: provenance.package,
    version: provenance.version,
    archive: provenance.archive,
    sha256: provenance.sha256,
    agent_git_commit: provenance.agent_git_commit,
    agent_git_tree: provenance.agent_git_tree,
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function parseAgentRepo(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--agent-repo") {
    throw new Error("usage: node scripts/sync-krw-agent-host-package.mjs --agent-repo /absolute/krw-agnet");
  }
  if (!argumentsList[1].startsWith("/")) throw new Error("agent-repo must be an absolute directory");
  const value = resolve(argumentsList[1]);
  if (value === "/") throw new Error("agent-repo must be an absolute directory");
  return value;
}

function parseLastJsonLine(output) {
  const line = output.trim().split("\n").at(-1);
  if (!line) throw new Error("host_package_provenance_missing");
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error("host_package_provenance_invalid", { cause: error });
  }
}

function validateProvenance(value, agentRepo) {
  if (
    !value
    || value.package !== "@krw-agent/host"
    || typeof value.version !== "string"
    || !value.archive_path.startsWith(`${resolve(agentRepo)}/`)
    || !/^krw-agent-host-[0-9A-Za-z._-]+\.tgz$/.test(value.archive)
    || !/^sha256:[0-9a-f]{64}$/.test(value.sha256)
    || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value.agent_git_commit)
    || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value.agent_git_tree)
    || value.dirty_source === true
  ) {
    throw new Error("host_package_provenance_policy_failed");
  }
}

function run(command, args, cwd, extraEnvironment = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnvironment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise({ stdout, stderr });
      reject(new Error(`${command} ${args.join(" ")} failed with ${code}: ${stderr}`));
    });
  });
}
