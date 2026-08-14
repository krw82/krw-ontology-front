#!/usr/bin/env node

/**
 * Bind a private product-canary report to one sealed provider bundle.
 *
 * The input report is produced by run-prod-chat-e2e.mjs through the public
 * chat route. This command never calls a provider or database and emits only
 * the bounded, secret-free fields required by the final admission index.
 */

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const PROVIDERS = Object.freeze({
  glm: "glm-5.3",
  deepseek: "deepseek-v4-flash",
});
const HASH = /^sha256:[0-9a-f]{64}$/;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      process.stdout.write("usage: node scripts/write-agent-v1-product-canary-evidence.mjs --report /absolute/report.json --release /absolute/provider-bundle --provider glm|deepseek --output /absolute/canary-evidence.json\n");
      process.exit(0);
    }
    if (!["--report", "--release", "--provider", "--output"].includes(flag)) {
      fail(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    values[flag.slice(2)] = value;
    index += 1;
  }
  for (const key of ["report", "release", "provider", "output"]) {
    if (!values[key]) fail(`missing --${key}`);
  }
  if (!Object.hasOwn(PROVIDERS, values.provider)) fail("provider must be glm or deepseek");
  return values;
}

function regularFile(path, label, maxBytes = Number.MAX_SAFE_INTEGER) {
  if (!isAbsolute(path)) fail(`${label} must be absolute`);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
    fail(`${label} must be a bounded regular file`);
  }
  return resolve(path);
}

function realDirectory(path, label) {
  if (!isAbsolute(path)) fail(`${label} must be absolute`);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be a real directory`);
  return resolve(path);
}

function readObject(path, label, maxBytes = MAX_REPORT_BYTES) {
  const resolved = regularFile(path, label, maxBytes);
  try {
    const value = JSON.parse(readFileSync(resolved, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must contain an object`);
    return { path: resolved, value };
  } catch (error) {
    if (error instanceof Error && error.message.includes(label)) throw error;
    fail(`${label} is not valid JSON`);
  }
}

function sha256(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function requireHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) fail(`${label} must be a SHA-256 digest`);
  return value;
}

function validateCanary(report, provider, model) {
  if (report.kind !== "prod_chat_e2e" || report.summary?.suite !== "canary") {
    fail("report is not a production chat canary");
  }
  const canary = report.canary;
  if (!canary || typeof canary !== "object") fail("report has no canary result");
  const required = [
    "durable_final_projection",
    "non_empty_answer",
    "same_session_followup",
    "cross_session_isolation",
  ];
  if (canary.status !== "pass" || required.some((key) => canary[key] !== true)) {
    fail("product canary did not pass every required check");
  }
  if (!Array.isArray(report.results) || report.results.length !== 3) {
    fail("product canary must contain exactly three product runs");
  }
  for (const result of report.results) {
    if (
      result?.db?.run?.status !== "completed" ||
      result?.db?.run?.model !== model ||
      result?.db?.assistant?.status !== "completed" ||
      !Number.isInteger(result?.db?.assistant?.chars) ||
      result.db.assistant.chars <= 0
    ) {
      fail(`product canary run is not a completed ${provider}/${model} projection`);
    }
  }
}

function writeAtomically(path, value) {
  if (!isAbsolute(path)) fail("output must be absolute");
  const output = resolve(path);
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const existing = lstatSync(output, { throwIfNoEntry: false });
  if (existing) fail("output must not already exist");
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, output);
  } finally {
    try { unlinkSync(temporary); } catch {}
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = readObject(args.report, "report");
  const bundle = realDirectory(args.release, "release");
  const manifest = readObject(`${bundle}/release-manifest.json`, "release manifest", 1024 * 1024).value;
  const descriptor = readObject(`${bundle}/public-release.json`, "release descriptor", 16 * 1024 * 1024).value;
  const model = PROVIDERS[args.provider];
  if (manifest.provider_id !== args.provider || manifest.physical_models?.length !== 1 || manifest.physical_models[0] !== model) {
    fail("sealed bundle provider/model mismatch");
  }
  if (descriptor.release_set_hash === undefined) fail("sealed descriptor has no release set hash");
  validateCanary(report.value, args.provider, model);
  const evidence = {
    schema_version: "krw-agent-product-canary/v1",
    status: "pass",
    provider_id: args.provider,
    physical_model: model,
    manifest_hash: requireHash(manifest.manifest_hash, "manifest hash"),
    release_set_hash: requireHash(descriptor.release_set_hash, "release set hash"),
    durable_final_projection: true,
    non_empty_answer: true,
    same_session_followup: true,
    cross_session_isolation: true,
    product_report_hash: sha256(report.path),
  };
  writeAtomically(args.output, evidence);
  process.stdout.write(`${JSON.stringify({ status: "pass", output: resolve(args.output) })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`product canary evidence: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}
