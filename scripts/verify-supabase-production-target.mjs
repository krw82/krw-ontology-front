#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.argv[2] || ".env.mac-worker.production");
const rawProjectRefFile = process.argv[3] || "supabase/.temp/project-ref";
const projectRefFile =
  rawProjectRefFile === "-" ? null : path.resolve(rawProjectRefFile);
const canonicalTargetFile = path.resolve(
  process.argv[4] || "ops/production-target.json",
);
let requireOrigins = false;
let rollbackProof = null;
let rollbackSourceRoot = null;

function parseOptions() {
  const options = process.argv.slice(5);
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--require-origins") {
      if (requireOrigins) throw new Error("Duplicate option: --require-origins");
      requireOrigins = true;
      continue;
    }
    if (option === "--rollback-proof") {
      if (rollbackProof) throw new Error("Duplicate option: --rollback-proof");
      const rollbackManifest = options[index + 1];
      const releaseManifest = options[index + 2];
      if (!rollbackManifest || !releaseManifest) {
        throw new Error(
          "--rollback-proof requires rollback and release manifest paths",
        );
      }
      rollbackProof = {
        rollbackManifest: path.resolve(rollbackManifest),
        releaseManifest: path.resolve(releaseManifest),
      };
      index += 2;
      continue;
    }
    if (option === "--rollback-source-root") {
      if (rollbackSourceRoot) {
        throw new Error("Duplicate option: --rollback-source-root");
      }
      const sourceRoot = options[index + 1];
      if (!sourceRoot) {
        throw new Error("--rollback-source-root requires a directory path");
      }
      const resolvedSourceRoot = path.resolve(sourceRoot);
      const sourceRootStats = lstatSync(resolvedSourceRoot);
      if (!sourceRootStats.isDirectory() || sourceRootStats.isSymbolicLink()) {
        throw new Error(
          "--rollback-source-root must name a directory, not a symlink",
        );
      }
      rollbackSourceRoot = realpathSync(resolvedSourceRoot);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  if (Boolean(rollbackProof) !== Boolean(rollbackSourceRoot)) {
    throw new Error(
      "--rollback-proof and --rollback-source-root must be supplied together",
    );
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function assertRegularNonSymlink(file, label) {
  if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${file}`);
  }
}

function manifestValue(file, key) {
  if (!existsSync(file)) throw new Error(`Missing proof manifest: ${file}`);
  const values = [];
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || line.slice(0, separator).trim() !== key) continue;
    values.push(line.slice(separator + 1).trim());
  }
  if (values.length !== 1 || !values[0]) {
    throw new Error(`Proof manifest must define ${key} exactly once`);
  }
  return values[0];
}

// Keep this canonical source implementation byte-for-byte compatible in
// behavior with scripts/compute-production-source-sha256.mjs. This verifier
// is copied into the rollback transaction and hash-sealed by both manifests,
// so recovery never trusts executable code from the archive it is proving.
const sourceExcludedAnywhere = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  ".tox",
  ".nox",
]);
const sourceExcludedAtRoot = new Set([
  ".next",
  ".worker",
  ".services",
  ".deploy",
  ".codex",
  ".claude",
  ".gstack",
  ".agent-workspace",
  ".lazyweb",
  ".playwright-cli",
  ".playwright-mcp",
  ".vendor",
  "output",
  "out",
  "dist",
  "coverage",
  "test-results",
  "logs",
  "_workspace",
  "_temp",
  "marketing-video",
  "html-effectiveness-artifacts",
  "krw-ontology",
]);

function sourceEntryExcluded(relativePath, name) {
  const isRootEntry = !relativePath.includes("/");
  if (sourceExcludedAnywhere.has(name) || name.startsWith(".venv")) return true;
  if (
    isRootEntry &&
    (sourceExcludedAtRoot.has(name) || name.startsWith(".next-"))
  ) {
    return true;
  }
  if (name === ".DS_Store" || name.startsWith("._")) return true;
  if (name.endsWith(".tsbuildinfo")) return true;
  if (name.endsWith(".pyc") || name.endsWith(".pyo")) return true;
  if (name === ".supabase-prod-db-password") return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  return (
    relativePath === "supabase/.temp" ||
    relativePath.startsWith("supabase/.temp/") ||
    relativePath === "supabase/.branches" ||
    relativePath.startsWith("supabase/.branches/")
  );
}

function computeProductionSourceSha256(sourceRoot) {
  const stats = lstatSync(sourceRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      `Rollback source root must be a directory, not a symlink: ${sourceRoot}`,
    );
  }
  const entries = [];
  const walk = (absoluteDirectory, relativeDirectory = "") => {
    const children = readdirSync(absoluteDirectory).sort((left, right) =>
      left.localeCompare(right),
    );
    for (const name of children) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      if (sourceEntryExcluded(relativePath, name)) continue;
      const absolutePath = path.join(absoluteDirectory, name);
      const entryStats = lstatSync(absolutePath);
      if (entryStats.isDirectory()) {
        entries.push([
          relativePath,
          "directory",
          entryStats.mode & 0o7777,
          Buffer.alloc(0),
        ]);
        walk(absolutePath, relativePath);
      } else if (entryStats.isFile()) {
        entries.push([
          relativePath,
          "file",
          entryStats.mode & 0o7777,
          readFileSync(absolutePath),
        ]);
      } else if (entryStats.isSymbolicLink()) {
        entries.push([
          relativePath,
          "symlink",
          0o777,
          Buffer.from(`symlink:${readlinkSync(absolutePath)}`, "utf8"),
        ]);
      } else {
        throw new Error(
          `Unsupported production source entry type: ${relativePath}`,
        );
      }
    }
  };
  walk(sourceRoot);
  entries.sort(([left], [right]) => left.localeCompare(right));
  const digest = createHash("sha256");
  digest.update("krw-production-source/v2\0");
  for (const [relativePath, type, mode, content] of entries) {
    const pathBytes = Buffer.from(relativePath, "utf8");
    const typeByte =
      type === "file" ? 1 : type === "symlink" ? 2 : type === "directory" ? 3 : 0;
    if (typeByte === 0) {
      throw new Error(`Unsupported canonical entry type: ${type}`);
    }
    const canonicalMode = type === "file" && (mode & 0o100) !== 0 ? 1 : 0;
    const header = Buffer.alloc(21);
    header.writeUInt8(typeByte, 0);
    header.writeUInt32BE(canonicalMode, 1);
    header.writeBigUInt64BE(BigInt(pathBytes.length), 5);
    header.writeBigUInt64BE(BigInt(content.length), 13);
    digest.update(header);
    digest.update(pathBytes);
    digest.update(content);
  }
  return digest.digest("hex");
}

function verifyRollbackProof() {
  if (!rollbackProof) return false;
  const { rollbackManifest, releaseManifest } = rollbackProof;
  assertRegularNonSymlink(rollbackManifest, "rollback proof manifest");
  assertRegularNonSymlink(releaseManifest, "release proof manifest");
  if (
    manifestValue(releaseManifest, "FORMAT") !==
    "krw-production-release-registry/v1"
  ) {
    throw new Error("Invalid release proof manifest format");
  }
  if (manifestValue(rollbackManifest, "FORMAT") !== "krw-code-rollback/v2") {
    throw new Error("Invalid rollback proof manifest format");
  }
  const expectedPreviousFrontSourceSha = manifestValue(
    rollbackManifest,
    "PREVIOUS_FRONT_SOURCE_SHA256",
  );
  if (!/^[a-f0-9]{64}$/.test(expectedPreviousFrontSourceSha)) {
    throw new Error(
      "Rollback proof PREVIOUS_FRONT_SOURCE_SHA256 must be a lowercase SHA-256 digest",
    );
  }
  const expectedRollbackManifestSha = manifestValue(
    releaseManifest,
    "ROLLBACK_MANIFEST_SHA256",
  );
  if (sha256(rollbackManifest) !== expectedRollbackManifestSha) {
    throw new Error("Release and rollback proof manifests are not cross-sealed");
  }
  const expectedRuntimeEnvSha = manifestValue(
    rollbackManifest,
    "RUNTIME_ENV_SHA256",
  );
  if (sha256(envFile) !== expectedRuntimeEnvSha) {
    throw new Error("Rollback proof does not seal the supplied runtime env");
  }
  const actualPreviousFrontSourceSha =
    computeProductionSourceSha256(rollbackSourceRoot);
  if (actualPreviousFrontSourceSha !== expectedPreviousFrontSourceSha) {
    throw new Error(
      "Extracted rollback frontend source does not match PREVIOUS_FRONT_SOURCE_SHA256",
    );
  }
  const provenance = manifestValue(rollbackManifest, "ROLLBACK_PROVENANCE");
  if (provenance !== "bootstrap" && provenance !== "release-registry") {
    throw new Error("Invalid rollback proof provenance");
  }
  return provenance === "bootstrap";
}

function envValue(key) {
  if (!existsSync(envFile)) throw new Error(`Missing production env file: ${envFile}`);
  let result = "";
  for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || line.slice(0, separator).trim() !== key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result = value;
  }
  return result;
}

function envKeyCount(key) {
  if (!existsSync(envFile)) throw new Error(`Missing production env file: ${envFile}`);
  let count = 0;
  for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0 && line.slice(0, separator).trim() === key) count += 1;
  }
  return count;
}

try {
  parseOptions();
  assertRegularNonSymlink(envFile, "production env file");
  assertRegularNonSymlink(canonicalTargetFile, "canonical production target");
  const allowMissingAdminEmails = verifyRollbackProof();
  if (projectRefFile && !existsSync(projectRefFile)) {
    throw new Error(`Missing linked Supabase project ref: ${projectRefFile}`);
  }
  if (!existsSync(canonicalTargetFile)) {
    throw new Error(`Missing canonical production target: ${canonicalTargetFile}`);
  }
  const canonicalTarget = JSON.parse(readFileSync(canonicalTargetFile, "utf8"));
  if (
    canonicalTarget?.format !== "krw-production-target/v1" ||
    typeof canonicalTarget.supabaseProjectRef !== "string" ||
    !canonicalTarget.supabaseProjectRef
  ) {
    throw new Error("Invalid canonical production target contract");
  }
  for (const key of [
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]) {
    if (envKeyCount(key) !== 1) {
      throw new Error(`Production env must define ${key} exactly once`);
    }
  }
  const adminEmailsCount = envKeyCount("ADMIN_EMAILS");
  if (
    adminEmailsCount !== 1 &&
    !(allowMissingAdminEmails && adminEmailsCount === 0)
  ) {
    throw new Error("Production env must define ADMIN_EMAILS exactly once");
  }
  if (adminEmailsCount === 1) {
    const adminEmails = [
      ...new Set(
        envValue("ADMIN_EMAILS")
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (adminEmails.length === 0) {
      throw new Error("Production ADMIN_EMAILS must not be empty");
    }
    if (
      adminEmails.some(
        (email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      )
    ) {
      throw new Error("Production ADMIN_EMAILS contains an invalid address");
    }
  }
  if (requireOrigins) {
    const allowedOrigins = new Set(
      Array.isArray(canonicalTarget.siteOrigins)
        ? canonicalTarget.siteOrigins
        : [canonicalTarget.siteOrigin],
    );
    for (const key of [
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_APP_URL",
      "AUTH_REDIRECT_ORIGIN",
    ]) {
      if (envKeyCount(key) !== 1) {
        throw new Error(`Production env must define ${key} exactly once`);
      }
      const value = envValue(key).replace(/\/$/, "");
      if (!value || !allowedOrigins.has(value)) {
        throw new Error(
          `Production origin mismatch: ${key}=${value || "missing"}`,
        );
      }
    }
  }
  const linkedProjectRef = projectRefFile
    ? readFileSync(projectRefFile, "utf8").trim()
    : canonicalTarget.supabaseProjectRef;
  const projectRefFromUrl = (value, key) => {
    if (!value) throw new Error(`Missing production environment value: ${key}`);
    const hostname = new URL(value).hostname;
    return hostname.endsWith(".supabase.co")
      ? hostname.slice(0, -".supabase.co".length)
      : "";
  };
  const serviceProjectRef = projectRefFromUrl(
    envValue("SUPABASE_URL"),
    "SUPABASE_URL",
  );
  const publicProjectRef = projectRefFromUrl(
    envValue("NEXT_PUBLIC_SUPABASE_URL"),
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const publicKeys = [
    ["SUPABASE_ANON_KEY", envValue("SUPABASE_ANON_KEY")],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY")],
  ];
  const legacyJwtRole = (value) => {
    const parts = value.split(".");
    if (parts.length !== 3) return "";
    try {
      return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
        ?.role ?? "";
    } catch {
      return "";
    }
  };
  for (const [key, value] of publicKeys) {
    if (!value) throw new Error(`Missing production environment value: ${key}`);
    if (value === serviceRoleKey) {
      throw new Error(`${key} must not equal SUPABASE_SERVICE_ROLE_KEY`);
    }
    if (/^(sb_secret_|sb_service_)/.test(value)) {
      throw new Error(`${key} uses a secret/service credential format`);
    }
    if (!/^(sb_publishable_|sb_anon_)/.test(value)) {
      const role = legacyJwtRole(value);
      if (role !== "anon") {
        throw new Error(`${key} legacy JWT role must be anon, got ${role || "unrecognized"}`);
      }
    }
  }
  if (!serviceRoleKey) {
    throw new Error("Missing production environment value: SUPABASE_SERVICE_ROLE_KEY");
  }
  if (/^(sb_publishable_|sb_anon_)/.test(serviceRoleKey)) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY uses a public credential format");
  }
  const serviceRole = legacyJwtRole(serviceRoleKey);
  if (serviceRoleKey.includes(".") && serviceRole !== "service_role") {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY legacy JWT role must be service_role, got ${serviceRole || "unrecognized"}`,
    );
  }
  if (
    !linkedProjectRef ||
    serviceProjectRef !== linkedProjectRef ||
    publicProjectRef !== linkedProjectRef ||
    linkedProjectRef !== canonicalTarget.supabaseProjectRef
  ) {
    throw new Error(
      `Supabase production target mismatch: canonical=${canonicalTarget.supabaseProjectRef} linked=${linkedProjectRef || "missing"} service=${serviceProjectRef || "unrecognized"} public=${publicProjectRef || "unrecognized"}`,
    );
  }
  console.log(
    `OK Supabase production target: ${linkedProjectRef}${projectRefFile ? " (linked)" : " (runtime env)"}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
