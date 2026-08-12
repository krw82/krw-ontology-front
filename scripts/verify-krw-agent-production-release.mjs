#!/usr/bin/env node

/**
 * Verify the portable, sealed dual-provider release which a front production
 * deploy is about to install. This is deliberately offline: provider keys,
 * database credentials, and live endpoints are never read here.
 *
 * The standalone verifier shipped inside each bundle proves the complete file
 * inventory.  This wrapper additionally binds the two bundles, the selected
 * provider. A final evidence index may additionally bind that release to the
 * front commit after the private product canary has completed.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const PROVIDERS = Object.freeze({
  glm: "glm-5.2",
  deepseek: "deepseek-v4-flash",
});
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function fail(message) {
  throw new Error(message);
}

function usage() {
  return [
    "usage: node scripts/verify-krw-agent-production-release.mjs \\",
    "  --release-root /absolute/sealed-dual-release \\",
    "  --provider glm|deepseek \\",
    "  [--evidence-index /absolute/production-evidence-index.json \\",
    "   --front-commit <git-commit>]",
  ].join("\n");
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (![
      "--release-root",
      "--evidence-index",
      "--provider",
      "--front-commit",
    ].includes(argument)) {
      fail(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`${argument} requires a value`);
    }
    values[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  for (const name of ["release_root", "provider"]) {
    if (!values[name]) fail(`missing --${name.replaceAll("_", "-")}`);
  }
  if (!Object.hasOwn(PROVIDERS, values.provider)) {
    fail("provider must be glm or deepseek");
  }
  if (Boolean(values.evidence_index) !== Boolean(values.front_commit)) {
    fail("--evidence-index and --front-commit must be supplied together");
  }
  if (values.front_commit && !GIT_OBJECT_PATTERN.test(values.front_commit)) {
    fail("front commit must be a lowercase Git object id");
  }
  return values;
}

function realDirectory(input, label) {
  if (!isAbsolute(input)) fail(`${label} must be absolute`);
  const stat = lstatSync(input, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} must be a real directory`);
  }
  const resolved = realpathSync(input);
  if (resolved === "/") fail(`${label} must not be the filesystem root`);
  return resolved;
}

function realFile(input, label) {
  if (!isAbsolute(input)) fail(`${label} must be absolute`);
  const stat = lstatSync(input, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0) {
    fail(`${label} must be a non-empty regular file`);
  }
  return realpathSync(input);
}

function jsonFile(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(`${label} must be a JSON object`);
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.includes(label)) throw error;
    fail(`${label} is not valid JSON`);
  }
}

function hashFile(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function requiredHash(value, label) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    fail(`${label} must be a SHA-256 digest`);
  }
  return value;
}

function requiredGitObject(value, label) {
  if (typeof value !== "string" || !GIT_OBJECT_PATTERN.test(value)) {
    fail(`${label} must be a lowercase Git object id`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a string`);
  return value;
}

function envValues(path, label) {
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) fail(`${label} contains an invalid assignment`);
    const key = line.slice(0, equals);
    const value = line.slice(equals + 1);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key)) {
      fail(`${label} contains an invalid or duplicate key`);
    }
    values.set(key, value);
  }
  return values;
}

function assertOnlyEntries(root, expected) {
  const actual = new Set(readdirSync(root));
  if (actual.size !== expected.size || [...actual].some((entry) => !expected.has(entry))) {
    fail("dual release root has an unexpected entry");
  }
}

function runStandaloneVerifier(bundleRoot) {
  const verifier = join(bundleRoot, "packaging", "verify_standalone_release.py");
  const verifierStat = lstatSync(verifier, { throwIfNoEntry: false });
  if (!verifierStat || verifierStat.isSymbolicLink() || !verifierStat.isFile()) {
    fail("bundle is missing its offline standalone verifier");
  }
  const completed = spawnSync("python3", [verifier, "--root", bundleRoot], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (completed.error || completed.status !== 0) {
    fail("bundle offline inventory verification failed");
  }
  try {
    return JSON.parse(completed.stdout);
  } catch {
    fail("bundle offline verifier returned an invalid receipt");
  }
}

function descriptorModel(descriptor, provider) {
  if (descriptor.schema_version !== 3 || !Array.isArray(descriptor.entries) || descriptor.entries.length === 0) {
    fail(`${provider} public descriptor has an invalid schema`);
  }
  const expected = PROVIDERS[provider];
  for (const entry of descriptor.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${provider} public descriptor has an invalid entry`);
    }
    const model = entry.execution?.resolved_model;
    if (model !== expected) {
      fail(`${provider} public descriptor model does not match its closed provider`);
    }
  }
  return expected;
}

function inspectBundle(releaseRoot, provider) {
  const bundleRoot = realDirectory(join(releaseRoot, provider), `${provider} bundle`);
  if (relative(releaseRoot, bundleRoot).startsWith("..")) {
    fail(`${provider} bundle is outside the release root`);
  }
  const verifier = runStandaloneVerifier(bundleRoot);
  if (verifier.provider_id !== provider || verifier.physical_models?.[0] !== PROVIDERS[provider]) {
    fail(`${provider} bundle verifier receipt does not match the closed provider`);
  }

  const manifest = jsonFile(join(bundleRoot, "release-manifest.json"), `${provider} manifest`);
  if (manifest.provider_id !== provider || manifest.physical_models?.length !== 1 || manifest.physical_models[0] !== PROVIDERS[provider]) {
    fail(`${provider} manifest provider/model mismatch`);
  }
  const descriptorPath = join(bundleRoot, "public-release.json");
  const descriptor = jsonFile(descriptorPath, `${provider} public descriptor`);
  const descriptorHash = hashFile(descriptorPath);
  const releaseSetHash = requiredHash(descriptor.release_set_hash, `${provider} release set hash`);
  descriptorModel(descriptor, provider);
  const env = envValues(join(bundleRoot, "frontend-runtime.env"), `${provider} frontend runtime`);
  if (
    env.get("KRW_AGENT_PROVIDER") !== provider ||
    env.get("KRW_AGENT_RELEASE_DESCRIPTOR_PATH") !== "/run/krw-agent/public-release.json" ||
    env.get("KRW_AGENT_RELEASE_ARTIFACT_HASH") !== descriptorHash ||
    env.get("KRW_AGENT_RELEASE_SET_HASH") !== releaseSetHash ||
    env.get("KRW_RUNTIME_ENVIRONMENT") !== "prod"
  ) {
    fail(`${provider} frontend runtime pins do not match its sealed descriptor`);
  }
  const manifestHash = requiredHash(manifest.manifest_hash, `${provider} manifest hash`);
  if (verifier.manifest_hash !== manifestHash) fail(`${provider} verifier manifest mismatch`);
  return {
    root: bundleRoot,
    provider_id: provider,
    physical_model: PROVIDERS[provider],
    manifest_hash: manifestHash,
    descriptor_artifact_hash: descriptorHash,
    release_set_hash: releaseSetHash,
    git_commit: requiredGitObject(manifest.git_commit, `${provider} Git commit`),
    git_tree: requiredGitObject(manifest.git_tree, `${provider} Git tree`),
  };
}

function equal(value, expected, label) {
  if (value !== expected) fail(`${label} does not match the sealed release`);
}

function verifyDualIndex(root, bundles) {
  const index = jsonFile(join(root, "dual-release-index.json"), "dual release index");
  if (index.schema_version !== 2 || !index.bundles || typeof index.bundles !== "object") {
    fail("dual release index schema is invalid");
  }
  for (const provider of Object.keys(PROVIDERS)) {
    const bundle = bundles[provider];
    const indexed = index.bundles[provider];
    if (!indexed || typeof indexed !== "object") fail(`dual release index is missing ${provider}`);
    equal(indexed.provider_id, provider, `${provider} index provider`);
    equal(indexed.physical_model, bundle.physical_model, `${provider} index model`);
    equal(indexed.manifest_hash, bundle.manifest_hash, `${provider} index manifest`);
    equal(indexed.descriptor_artifact_hash, bundle.descriptor_artifact_hash, `${provider} index descriptor`);
    equal(indexed.release_set_hash, bundle.release_set_hash, `${provider} index release set`);
    equal(index.git_commit, bundle.git_commit, `${provider} index Git commit`);
    equal(index.git_tree, bundle.git_tree, `${provider} index Git tree`);
  }
  equal(bundles.glm.git_commit, bundles.deepseek.git_commit, "provider source commit");
  equal(bundles.glm.git_tree, bundles.deepseek.git_tree, "provider source tree");
}

function verifyEvidence(path, bundles, frontCommit) {
  const index = jsonFile(path, "production evidence index");
  if (index.schema_version !== "krw-production-evidence-index/v1") {
    fail("production evidence index schema is invalid");
  }
  equal(index.agent_commit, bundles.deepseek.git_commit, "evidence agent commit");
  equal(index.agent_tree, bundles.deepseek.git_tree, "evidence agent tree");
  equal(index.front_commit, frontCommit, "evidence front commit");
  if (!index.host_package || typeof index.host_package !== "object") {
    fail("production evidence is missing host package provenance");
  }
  equal(index.host_package.package, "@krw-agent/host", "evidence host package");
  equal(index.host_package.version, "0.1.0", "evidence host package version");
  equal(index.host_package.agent_git_commit, bundles.deepseek.git_commit, "evidence host package commit");
  equal(index.host_package.agent_git_tree, bundles.deepseek.git_tree, "evidence host package tree");
  requiredHash(index.host_package.sha256, "evidence host package hash");

  for (const provider of Object.keys(PROVIDERS)) {
    const bundle = bundles[provider];
    const indexed = index.bundles?.[provider];
    if (!indexed || typeof indexed !== "object") fail(`production evidence is missing ${provider} bundle`);
    for (const key of [
      "provider_id",
      "physical_model",
      "manifest_hash",
      "descriptor_artifact_hash",
      "release_set_hash",
      "git_commit",
      "git_tree",
    ]) {
      equal(indexed[key], bundle[key], `evidence ${provider} ${key}`);
    }
    const acceptance = index.acceptance?.[provider];
    if (!acceptance || typeof acceptance !== "object") {
      fail(`production evidence is missing ${provider} acceptance`);
    }
    requiredHash(acceptance.evidence_hash, `evidence ${provider} acceptance hash`);
    requiredHash(acceptance.quality_report_hash, `evidence ${provider} quality hash`);
  }
  if (index.database_compatibility?.status !== "passed") {
    fail("production evidence database compatibility is not a pass");
  }
  const canary = index.deepseek_product_canary;
  if (
    !canary ||
    canary.status !== "passed" ||
    canary.durable_final_projection !== true ||
    canary.non_empty_answer !== true ||
    canary.same_session_followup !== true ||
    canary.cross_session_isolation !== true
  ) {
    fail("production evidence DeepSeek canary is incomplete");
  }
  return hashFile(path);
}

function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const releaseRoot = realDirectory(arguments_.release_root, "release root");
  const evidenceIndex = arguments_.evidence_index
    ? realFile(arguments_.evidence_index, "evidence index")
    : null;
  assertOnlyEntries(releaseRoot, new Set(["glm", "deepseek", "dual-release-index.json"]));
  const bundles = Object.fromEntries(
    Object.keys(PROVIDERS).map((provider) => [provider, inspectBundle(releaseRoot, provider)]),
  );
  verifyDualIndex(releaseRoot, bundles);
  const evidenceHash = evidenceIndex
    ? verifyEvidence(evidenceIndex, bundles, arguments_.front_commit)
    : null;
  const selected = bundles[arguments_.provider];
  process.stdout.write(`${JSON.stringify({
    status: "verified",
    selected_provider: selected.provider_id,
    selected_model: selected.physical_model,
    selected_descriptor_artifact_hash: selected.descriptor_artifact_hash,
    selected_release_set_hash: selected.release_set_hash,
    release_commit: selected.git_commit,
    release_tree: selected.git_tree,
    evidence_index_hash: evidenceHash,
    final_evidence_verified: evidenceHash !== null,
  })}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "production release verification failed";
  process.stderr.write(`krw-agent production release verification failed: ${message}\n`);
  process.exitCode = 1;
}
