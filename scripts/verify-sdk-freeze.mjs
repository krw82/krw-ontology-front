#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`SDK removal check failed: ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function sourceFiles(relativePath) {
  const root = path.join(repoRoot, relativePath);
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const pnpmLock = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");

if (packageJson.dependencies?.["@anthropic-ai/claude-agent-sdk"]) {
  fail("package.json still declares the retired frontend SDK");
}
if (packageLock.packages?.[""]?.dependencies?.["@anthropic-ai/claude-agent-sdk"]) {
  fail("package-lock still declares the retired frontend SDK");
}
if (Object.keys(packageLock.packages ?? {}).some((name) => name.includes("@anthropic-ai/claude-agent-sdk"))) {
  fail("package-lock still contains an SDK package");
}
if (pnpmLock.includes("@anthropic-ai/claude-agent-sdk")) {
  fail("pnpm-lock still contains the retired frontend SDK");
}

const sdkImport = /(?:from\s+|import\s*\(|require\s*\()(['"])@anthropic-ai\/claude-agent-sdk\1/;
for (const file of sourceFiles("src")) {
  const source = readFileSync(file, "utf8");
  if (sdkImport.test(source)) {
    fail(`active frontend source imports the retired SDK: ${path.relative(repoRoot, file)}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("SDK removal verified: frontend package and lockfile contain no Claude Agent SDK");
