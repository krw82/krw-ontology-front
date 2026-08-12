#!/usr/bin/env node

import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
let sourcePath = ".env";
let targetPath = ".env.mac-worker.production";

function usage() {
  console.log(`Usage: scripts/sync-valuation-refresh-env.mjs [options]

Copy only valuation worker settings into an existing Mac runtime env without
overwriting its production Supabase, ontology, or worker settings.

Options:
  --from FILE           Source env containing FMP_API_KEY (default: .env)
  --out FILE            Existing Mac env to update (default: .env.mac-worker.production)
`);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--from") {
    sourcePath = args[++index] || "";
  } else if (arg === "--out") {
    targetPath = args[++index] || "";
  } else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else {
    usage();
    process.exit(1);
  }
}

if (!sourcePath || !targetPath) {
  throw new Error("--from and --out require file paths");
}

const sourceAbsolute = resolve(sourcePath);
const targetAbsolute = resolve(targetPath);
if (sourceAbsolute === targetAbsolute) {
  throw new Error("Source and target env files must be different");
}

const sourceText = await readFile(sourceAbsolute, "utf8");
const targetText = await readFile(targetAbsolute, "utf8");

function parseAssignments(text) {
  const result = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) result.set(match[1], rawLine);
  }
  return result;
}

const sourceAssignments = parseAssignments(sourceText);
const targetAssignments = parseAssignments(targetText);
const requiredKeys = ["FMP_API_KEY"];
const optionalDefaults = new Map([
  ["VALUATION_REFRESH_WORKER_ID", "VALUATION_REFRESH_WORKER_ID=valuation-refresh-mac"],
  ["VALUATION_REFRESH_INTERVAL_MS", "VALUATION_REFRESH_INTERVAL_MS=3600000"],
  ["VALUATION_REFRESH_BATCH_SIZE", "VALUATION_REFRESH_BATCH_SIZE=20"],
  ["VALUATION_REFRESH_TICKERS", "VALUATION_REFRESH_TICKERS="],
  ["VALUATION_REFRESH_LOG_DIR", "VALUATION_REFRESH_LOG_DIR="],
  ["VALUATION_REFRESH_NICE", "VALUATION_REFRESH_NICE=10"],
  ["VALUATION_REFRESH_MAXFILES", "VALUATION_REFRESH_MAXFILES=4096"],
]);

const updates = new Map();
for (const key of [...requiredKeys, ...optionalDefaults.keys()]) {
  const sourceLine = sourceAssignments.get(key);
  if (key === "FMP_API_KEY") {
    if (!sourceLine || sourceLine.replace(/^[^=]*=/, "").trim() === "") {
      throw new Error(`Missing non-empty ${key} in ${sourceAbsolute}`);
    }
    updates.set(key, sourceLine);
  } else {
    updates.set(key, sourceLine || optionalDefaults.get(key));
  }
}

const outputLines = [];
const written = new Set();
for (const rawLine of targetText.split(/\r?\n/)) {
  const match = rawLine.match(/^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && updates.has(match[2])) {
    outputLines.push(updates.get(match[2]));
    written.add(match[2]);
  } else {
    outputLines.push(rawLine);
  }
}

for (const [key, line] of updates) {
  if (!written.has(key)) outputLines.push(line);
}

const temporaryPath = `${targetAbsolute}.valuation-sync-${process.pid}-${Date.now()}`;
await writeFile(temporaryPath, `${outputLines.join("\n").replace(/\n+$/, "")}\n`, {
  mode: 0o600,
});
await chmod(temporaryPath, 0o600);
await rename(temporaryPath, targetAbsolute);

console.log(`Updated valuation settings in ${targetAbsolute}`);
console.log(`  source=${sourceAbsolute}`);
console.log(`  keys=${[...updates.keys()].join(",")}`);
