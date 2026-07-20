#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const envPath = path.resolve(process.cwd(), options.envFile);
const sourcePath = path.resolve(process.cwd(), options.sourceEnv);
const referencePath = options.referenceEnv
  ? path.resolve(process.cwd(), options.referenceEnv)
  : null;
const [runtimeSource, sourceEnv, referenceEnv] = await Promise.all([
  readFile(envPath, "utf8"),
  readFile(sourcePath, "utf8"),
  referencePath ? readFile(referencePath, "utf8") : Promise.resolve(""),
]);
const runtimeValues = parseEnv(runtimeSource);
const sourceValues = parseEnv(sourceEnv);
const referenceValues = parseEnv(referenceEnv);

const existingOrSource = (key) =>
  cleanValue(runtimeValues.get(key)) || cleanValue(sourceValues.get(key));
const referenceOrExistingOrSource = (key) =>
  cleanValue(referenceValues.get(key)) || existingOrSource(key);
const uniqueSecret = (existing, reserved) => {
  if (existing && existing.length >= 32 && !reserved.has(existing)) return existing;
  let value = randomBytes(48).toString("base64url");
  while (reserved.has(value)) value = randomBytes(48).toString("base64url");
  return value;
};

const reserved = new Set();
const jobTokenSecret = uniqueSecret(
  referenceOrExistingOrSource("KRW_LLM_JOB_TOKEN_SECRET"),
  reserved,
);
reserved.add(jobTokenSecret);
const internalApiKey = uniqueSecret(
  referenceOrExistingOrSource("INTERNAL_API_KEY"),
  reserved,
);
reserved.add(internalApiKey);

const deepSeekApiKey = referenceOrExistingOrSource("DEEPSEEK_API_KEY");
if (!deepSeekApiKey || deepSeekApiKey.length < 16) {
  throw new Error(
    `DEEPSEEK_API_KEY must be configured in ${options.envFile} or ${options.sourceEnv}`,
  );
}

const publicAppUrl =
  referenceOrExistingOrSource("NEXT_PUBLIC_APP_URL") ||
  referenceOrExistingOrSource("NEXT_PUBLIC_SITE_URL");
const desktopGatewayBaseUrl = publicGatewayBaseUrl(publicAppUrl);

const updates = new Map([
  ["KRW_LLM_JOB_TOKEN_SECRET", jobTokenSecret],
  ["DESKTOP_LLM_GATEWAY_BASE_URL", desktopGatewayBaseUrl],
  ["DESKTOP_LLM_MODEL_PROFILE", "deepseek-v4-flash"],
  ["DESKTOP_LLM_UPSTREAM_MODEL", "deepseek-v4-flash"],
  ["DEEPSEEK_API_KEY", deepSeekApiKey],
  ["INTERNAL_API_KEY", internalApiKey],
  ["ANALYSIS_CREDIT_ENFORCEMENT_MODE", "enforced"],
  ["TRUSTED_CLIENT_IP_HEADER", "x-krw-client-ip"],
]);

if (options.enableFilingBriefs) {
  const filingBriefToken = uniqueSecret(
    referenceOrExistingOrSource("FILING_BRIEF_GATEWAY_TOKEN"),
    reserved,
  );
  updates.set("FILING_BRIEF_ENABLED", "1");
  updates.set("FILING_BRIEF_GATEWAY_TOKEN", filingBriefToken);
  updates.set("FILING_BRIEF_GATEWAY_URL", "http://llm-gateway:8787");
  updates.set("FILING_BRIEF_MODEL", "deepseek-v4-flash");
  for (const key of [
    "FILING_BRIEF_BATCH_SIZE",
    "FILING_BRIEF_MAX_JOBS_PER_DAY",
    "FILING_BRIEF_MAX_INPUT_CHARS",
    "FILING_BRIEF_MAX_OUTPUT_TOKENS",
    "FILING_BRIEF_GATEWAY_TIMEOUT_MS",
    "FILING_BRIEF_UPSTREAM_TIMEOUT_MS",
    "FILING_BRIEF_WORKER_TICK_MS",
  ]) {
    const value = referenceOrExistingOrSource(key);
    if (value) updates.set(key, value);
  }
}

let nextSource = runtimeSource;
for (const [key, value] of updates) {
  assertSingleLineValue(key, value);
  nextSource = setEnvValue(nextSource, key, value);
}

const temporaryPath = `${envPath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
try {
  await writeFile(temporaryPath, nextSource, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, envPath);
  await chmod(envPath, 0o600);
} catch (error) {
  await rm(temporaryPath, { force: true });
  throw error;
}

if (options.consumeReferenceEnv) {
  await removeEphemeralReferenceEnv(referencePath);
  console.log("Removed the consumed ephemeral live-runtime reference file.");
}
console.log(
  `Provisioned production LLM runtime settings in ${options.envFile} without printing secrets.`,
);

function parseArgs(args) {
  const result = {
    envFile: ".env.mac-worker.production",
    sourceEnv: ".env",
    referenceEnv: null,
    consumeReferenceEnv: false,
    enableFilingBriefs: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--env-file") {
      result.envFile = args[index + 1] || "";
      index += 1;
    } else if (argument === "--source-env") {
      result.sourceEnv = args[index + 1] || "";
      index += 1;
    } else if (argument === "--reference-env") {
      result.referenceEnv = args[index + 1] || "";
      index += 1;
    } else if (argument === "--enable-filing-briefs") {
      result.enableFilingBriefs = true;
    } else if (argument === "--consume-reference-env") {
      result.consumeReferenceEnv = true;
    } else if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: node scripts/provision-production-llm-env.mjs [--env-file FILE] [--source-env FILE] [--reference-env FILE] [--consume-reference-env] [--enable-filing-briefs]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!result.envFile) throw new Error("--env-file requires a path");
  if (!result.sourceEnv) throw new Error("--source-env requires a path");
  if (result.referenceEnv === "") {
    throw new Error("--reference-env requires a path");
  }
  if (result.consumeReferenceEnv && !result.referenceEnv) {
    throw new Error("--consume-reference-env requires --reference-env");
  }
  return result;
}

async function removeEphemeralReferenceEnv(referencePath) {
  if (!referencePath) throw new Error("Missing reference env for secure cleanup");
  const stats = await lstat(referencePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Consumed reference env must be a regular non-symlink file");
  }
  const tempRoots = new Set([
    path.resolve(os.tmpdir()),
    "/tmp",
    "/private/tmp",
  ]);
  const parent = path.dirname(referencePath);
  if (
    ![...tempRoots].some((root) => parent.startsWith(`${root}${path.sep}`)) ||
    !path.basename(parent).startsWith("krw-live-runtime.") ||
    path.basename(referencePath) !== "gcp-runtime.env"
  ) {
    throw new Error("Refusing to remove a non-ephemeral reference env file");
  }
  await rm(referencePath);
}

function publicGatewayBaseUrl(value) {
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_SITE_URL is required for the Desktop LLM gateway",
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS for the Desktop LLM gateway");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/llm/anthropic`;
}

function parseEnv(value) {
  const result = new Map();
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    result.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return result;
}

function cleanValue(value) {
  const text = value?.trim() || "";
  if (text.length >= 2) {
    const quote = text[0];
    if ((quote === '"' || quote === "'") && text.at(-1) === quote) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function setEnvValue(value, key, nextValue) {
  const lines = value.split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      if (replaced) return null;
      replaced = true;
      return `${key}=${nextValue}`;
    }
    return line;
  }).filter((line) => line !== null);
  if (!replaced) {
    if (nextLines.at(-1) !== "") nextLines.push("");
    nextLines.push(`${key}=${nextValue}`);
  }
  return nextLines.join("\n");
}

function assertSingleLineValue(key, value) {
  if (!value || /[\r\n\0]/.test(value)) {
    throw new Error(`Invalid production runtime value for ${key}`);
  }
}
