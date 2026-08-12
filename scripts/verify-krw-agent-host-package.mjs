#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const vendorRoot = join(root, "vendor", "krw-agent-host");
const provenancePath = join(vendorRoot, "provenance.json");
const lockPath = join(root, "package-lock.json");

const provenance = await readJson(provenancePath, "host package provenance");
const required = [
  "package",
  "version",
  "agent_git_commit",
  "agent_git_tree",
  "archive",
  "sha256",
];
if (
  required.some((key) => !(key in provenance))
  || provenance.package !== "@krw-agent/host"
  || provenance.version !== "0.1.0"
  || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(provenance.agent_git_commit)
  || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(provenance.agent_git_tree)
  || !/^krw-agent-host-[0-9A-Za-z._-]+\.tgz$/.test(provenance.archive)
  || !/^sha256:[0-9a-f]{64}$/.test(provenance.sha256)
) {
  throw new Error("invalid_krw_agent_host_provenance");
}

const archivePath = join(vendorRoot, provenance.archive);
const archiveBytes = await readFile(archivePath);
const sha256 = `sha256:${createHash("sha256").update(archiveBytes).digest("hex")}`;
if (sha256 !== provenance.sha256) throw new Error("host_package_sha256_mismatch");

const lock = await readJson(lockPath, "package lock");
const lockEntry = lock.packages?.["node_modules/@krw-agent/host"];
const expectedResolved = `file:vendor/krw-agent-host/${provenance.archive}`;
if (!lockEntry || lockEntry.resolved !== expectedResolved) {
  throw new Error("host_package_lock_path_mismatch");
}
const expectedIntegrity = `sha512-${createHash("sha512").update(archiveBytes).digest("base64")}`;
if (lockEntry.integrity !== expectedIntegrity) {
  throw new Error("host_package_lock_integrity_mismatch");
}

const installedPackagePath = join(root, "node_modules", "@krw-agent", "host", "package.json");
const installedPackage = await readJson(installedPackagePath, "installed host package");
if (installedPackage.name !== provenance.package || installedPackage.version !== provenance.version) {
  throw new Error("installed_host_package_identity_mismatch");
}

console.log(JSON.stringify({
  status: "verified",
  package: provenance.package,
  version: provenance.version,
  archive: provenance.archive,
  sha256: provenance.sha256,
  agent_git_commit: provenance.agent_git_commit,
  agent_git_tree: provenance.agent_git_tree,
}));

async function readJson(path, label) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label}_unavailable`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_not_object`);
  }
  return value;
}
