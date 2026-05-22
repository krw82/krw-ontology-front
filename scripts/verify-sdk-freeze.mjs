#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_NODE_SDK = "0.2.141";
const EXPECTED_PYTHON_SDK = "0.2.85";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`SDK freeze check failed: ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");

const declaredDependency =
  packageJson.dependencies?.["@anthropic-ai/claude-agent-sdk"];
if (declaredDependency !== EXPECTED_NODE_SDK) {
  fail(
    `package.json must pin @anthropic-ai/claude-agent-sdk to ${EXPECTED_NODE_SDK}, found ${declaredDependency}`,
  );
}

const lockedRootDependency =
  packageLock.packages?.[""]?.dependencies?.["@anthropic-ai/claude-agent-sdk"];
if (lockedRootDependency !== EXPECTED_NODE_SDK) {
  fail(
    `package-lock root dependency must pin @anthropic-ai/claude-agent-sdk to ${EXPECTED_NODE_SDK}, found ${lockedRootDependency}`,
  );
}

const lockedPackage =
  packageLock.packages?.["node_modules/@anthropic-ai/claude-agent-sdk"];
if (lockedPackage?.version !== EXPECTED_NODE_SDK) {
  fail(
    `package-lock resolved SDK must be ${EXPECTED_NODE_SDK}, found ${lockedPackage?.version}`,
  );
}

for (const [name, version] of Object.entries(
  lockedPackage?.optionalDependencies ?? {},
)) {
  if (!name.startsWith("@anthropic-ai/claude-agent-sdk-")) continue;
  if (version !== EXPECTED_NODE_SDK) {
    fail(`${name} optional dependency must be ${EXPECTED_NODE_SDK}, found ${version}`);
  }
}

const installedPackagePath = path.join(
  repoRoot,
  "node_modules",
  "@anthropic-ai",
  "claude-agent-sdk",
  "package.json",
);
if (existsSync(installedPackagePath)) {
  const installed = JSON.parse(readFileSync(installedPackagePath, "utf8"));
  if (installed.version !== EXPECTED_NODE_SDK) {
    fail(
      `installed @anthropic-ai/claude-agent-sdk must be ${EXPECTED_NODE_SDK}, found ${installed.version}`,
    );
  }
}

const ontologySourceDir =
  process.env.KRW_ONTOLOGY_SOURCE_DIR ?? path.resolve(repoRoot, "..", "krw-ontology");
const pyprojectPath = path.join(ontologySourceDir, "pyproject.toml");
if (existsSync(pyprojectPath)) {
  const pyproject = readFileSync(pyprojectPath, "utf8");
  if (!pyproject.includes(`"claude-agent-sdk==${EXPECTED_PYTHON_SDK}"`)) {
    fail(
      `${pyprojectPath} must pin claude-agent-sdk==${EXPECTED_PYTHON_SDK}`,
    );
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(
  `SDK freeze verified: node @anthropic-ai/claude-agent-sdk ${EXPECTED_NODE_SDK}, python claude-agent-sdk ${EXPECTED_PYTHON_SDK}`,
);
