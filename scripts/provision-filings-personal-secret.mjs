#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
let envFile = ".env.mac-worker.production";
let force = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--env-file") {
    envFile = args[index + 1] || "";
    index += 1;
  } else if (arg === "--force") {
    force = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log("Usage: node scripts/provision-filings-personal-secret.mjs [--env-file FILE] [--force]");
    process.exit(0);
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}
if (!envFile) throw new Error("--env-file requires a path");

const absolutePath = path.resolve(process.cwd(), envFile);
const source = await readFile(absolutePath, "utf8");
const values = parseEnv(source);
const serviceToken = values.get("FILINGS_MCP_AUTH_TOKEN")?.trim() || "";
if (!serviceToken) {
  throw new Error("FILINGS_MCP_AUTH_TOKEN must be configured before provisioning personal delegation");
}
const existing = values.get("FILINGS_MCP_PERSONAL_SIGNING_SECRET")?.trim() || "";
if (existing && existing !== serviceToken && !force) {
  console.log(`Personal filings signing secret is already configured in ${envFile}.`);
  process.exit(0);
}

let secret = randomBytes(48).toString("base64url");
while (secret === serviceToken) secret = randomBytes(48).toString("base64url");
const next = setEnvValue(source, "FILINGS_MCP_PERSONAL_SIGNING_SECRET", secret);
const temporaryPath = `${absolutePath}.tmp-${process.pid}`;
await writeFile(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
await chmod(temporaryPath, 0o600);
await rename(temporaryPath, absolutePath);
await chmod(absolutePath, 0o600);
console.log(`Provisioned a distinct personal filings signing secret in ${envFile} without printing it.`);

function parseEnv(value) {
  const result = new Map();
  for (const line of value.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    result.set(line.slice(0, separator).trim(), line.slice(separator + 1));
  }
  return result;
}

function setEnvValue(value, key, nextValue) {
  const lines = value.split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (new RegExp(`^${key}=`).test(line)) {
      replaced = true;
      return `${key}=${nextValue}`;
    }
    return line;
  });
  if (!replaced) {
    if (nextLines.at(-1) !== "") nextLines.push("");
    nextLines.push(`${key}=${nextValue}`);
  }
  return nextLines.join("\n");
}
