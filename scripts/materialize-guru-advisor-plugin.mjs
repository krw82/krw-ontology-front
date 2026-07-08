#!/usr/bin/env node

import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const defaultOntologySourceDir = path.join(homedir(), "krw-ontology");
const defaultSource = path.join(
  defaultOntologySourceDir,
  "plugins",
  "krw-guru-advisor",
);
const defaultGuruDataRoot = path.join(homedir(), "krw-ontology-guru-data");

const args = process.argv.slice(2);
let env = "";
let source = process.env.KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH || defaultSource;
let out = process.env.KRW_GURU_ADVISOR_PLUGIN_PATH || "";
let ontologySourceDir =
  process.env.KRW_ONTOLOGY_SOURCE_DIR || defaultOntologySourceDir;
let guruDataRoot = process.env.KRW_GURU_DATA_ROOT || defaultGuruDataRoot;
let guruReleaseRoot = process.env.KRW_GURU_RELEASE_ROOT || "";

function usage() {
  console.error(
    `Usage: scripts/materialize-guru-advisor-plugin.mjs --env dev|prod [--source DIR] [--out DIR] [--ontology-source-dir DIR] [--guru-data-root DIR] [--guru-release-root DIR]`,
  );
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  switch (arg) {
    case "--env":
      env = args[++index] || "";
      break;
    case "--source":
      source = args[++index] || "";
      break;
    case "--out":
      out = args[++index] || "";
      break;
    case "--ontology-source-dir":
      ontologySourceDir = args[++index] || "";
      break;
    case "--guru-data-root":
      guruDataRoot = args[++index] || "";
      break;
    case "--guru-release-root":
      guruReleaseRoot = args[++index] || "";
      break;
    case "--help":
    case "-h":
      usage();
      process.exit(0);
      break;
    default:
      usage();
      process.exit(1);
  }
}

if (env !== "dev" && env !== "prod") {
  usage();
  throw new Error(`Invalid guru plugin env: ${env || "unset"}`);
}

if (!out) {
  out = path.join(repoRoot, "ref", "plugins", env, "krw-guru-advisor");
}
if (!guruReleaseRoot) {
  guruReleaseRoot = path.join(guruDataRoot, "releases", env, "current");
}

const resolvedSource = path.resolve(source);
const resolvedOut = path.resolve(out);
const resolvedOntologySourceDir = path.resolve(ontologySourceDir);
const resolvedGuruDataRoot = path.resolve(guruDataRoot);
const resolvedGuruReleaseRoot = path.resolve(guruReleaseRoot);

if (!existsSync(path.join(resolvedSource, ".claude-plugin", "plugin.json"))) {
  throw new Error(`Missing source guru plugin manifest: ${resolvedSource}`);
}
if (!existsSync(path.join(resolvedOntologySourceDir, "pyproject.toml"))) {
  throw new Error(`Missing ontology source pyproject.toml: ${resolvedOntologySourceDir}`);
}
if (resolvedOut === resolvedSource || resolvedOut.startsWith(`${resolvedSource}${path.sep}`)) {
  throw new Error(`Refusing to materialize guru plugin into its source directory: ${resolvedOut}`);
}

rmSync(resolvedOut, { force: true, recursive: true });
cpSync(resolvedSource, resolvedOut, {
  recursive: true,
  filter: (sourcePath) => path.basename(sourcePath) !== ".DS_Store",
});

writeFileSync(
  path.join(resolvedOut, ".mcp.json"),
  `${JSON.stringify(
    {
      mcpServers: {
        "krw-guru-advisor": {
          command: "uv",
          args: [
            "--directory",
            resolvedOntologySourceDir,
            "run",
            "krw-guru-advisor-mcp",
          ],
          env: {
            KRW_GURU_ENV: env,
            KRW_GURU_DATA_ROOT: resolvedGuruDataRoot,
            KRW_GURU_RELEASE_ROOT: resolvedGuruReleaseRoot,
          },
        },
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`Materialized ${env} KRW Guru Advisor plugin: ${resolvedOut}`);
console.log(`Guru release root: ${resolvedGuruReleaseRoot}`);
