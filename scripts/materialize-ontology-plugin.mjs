#!/usr/bin/env node

import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const defaultSource = path.join(
  homedir(),
  "krw-ontology",
  "plugins",
  "krw-ontology",
);

const args = process.argv.slice(2);
let env = "";
let source = process.env.KRW_ONTOLOGY_PLUGIN_SOURCE_PATH || defaultSource;
let out = "";
let mcpUrl = process.env.KRW_ONTOLOGY_MCP_URL || "";

function usage() {
  console.error(`Usage: scripts/materialize-ontology-plugin.mjs --env dev|prod [--source DIR] [--out DIR] [--mcp-url URL]`);
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
    case "--mcp-url":
      mcpUrl = args[++index] || "";
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
  throw new Error(`Invalid plugin env: ${env || "unset"}`);
}

if (!out) {
  out = path.join(repoRoot, "ref", "plugins", env, "krw-ontology");
}
if (!mcpUrl) {
  const port = env === "prod" ? 8765 : 8766;
  mcpUrl = `http://127.0.0.1:${port}/mcp`;
}

const resolvedSource = path.resolve(source);
const resolvedOut = path.resolve(out);
if (!existsSync(path.join(resolvedSource, ".claude-plugin", "plugin.json"))) {
  throw new Error(`Missing source plugin manifest: ${resolvedSource}`);
}
if (resolvedOut === resolvedSource || resolvedOut.startsWith(`${resolvedSource}${path.sep}`)) {
  throw new Error(`Refusing to materialize plugin into its source directory: ${resolvedOut}`);
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
        "krw-ontology": {
          type: "http",
          url: mcpUrl,
          alwaysLoad: true,
        },
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`Materialized ${env} KRW Ontology plugin: ${resolvedOut}`);
console.log(`MCP URL: ${mcpUrl}`);
