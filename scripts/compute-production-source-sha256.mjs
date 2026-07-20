#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const outputMode = process.argv[3] || "--sha256";
if (outputMode !== "--sha256" && outputMode !== "--list0") {
  process.stderr.write(
    "Usage: compute-production-source-sha256.mjs [root] [--sha256|--list0]\n",
  );
  process.exit(1);
}
const excludedAnywhere = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  ".tox",
  ".nox",
]);
const excludedAtRoot = new Set([
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
  // Next.js rewrites this generated type-reference file whenever a build uses
  // a different distDir (for example the isolated `.next-e2e` release gate).
  // It is required in the source tree for TypeScript, but is not authored
  // production source and must not make a verified gate self-mutate.
  "next-env.d.ts",
  // This repository links the separately pinned ontology source here. The
  // link target is host-specific (relative on Mac, absolute on GCP), while
  // the ontology tree has its own independent production digest.
  "krw-ontology",
]);

function excluded(relativePath, name) {
  const isRootEntry = !relativePath.includes("/");
  if (excludedAnywhere.has(name) || name.startsWith(".venv")) return true;
  if (
    isRootEntry &&
    (excludedAtRoot.has(name) || name.startsWith(".next-"))
  ) {
    return true;
  }
  if (name === ".DS_Store" || name.startsWith("._")) return true;
  if (name.endsWith(".tsbuildinfo")) return true;
  if (name.endsWith(".pyc") || name.endsWith(".pyo")) return true;
  if (name === ".supabase-prod-db-password") return true;
  // Runtime/source copies intentionally exclude every env-shaped file. Keep
  // identity semantics identical so `.env.example` cannot make a sealed copy
  // differ from the gated source tree.
  if (name === ".env" || name.startsWith(".env.")) {
    return true;
  }
  return (
    relativePath === "supabase/.temp" ||
    relativePath.startsWith("supabase/.temp/") ||
    relativePath === "supabase/.branches" ||
    relativePath.startsWith("supabase/.branches/")
  );
}

const entries = [];
async function walk(absoluteDirectory, relativeDirectory = "") {
  const children = await readdir(absoluteDirectory);
  children.sort((left, right) => left.localeCompare(right));
  for (const name of children) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${name}`
      : name;
    if (excluded(relativePath, name)) continue;
    const absolutePath = path.join(absoluteDirectory, name);
    const stats = await lstat(absolutePath);
    if (stats.isDirectory()) {
      entries.push([relativePath, "directory", stats.mode & 0o7777, Buffer.alloc(0)]);
      await walk(absolutePath, relativePath);
    } else if (stats.isFile()) {
      entries.push([
        relativePath,
        "file",
        stats.mode & 0o7777,
        await readFile(absolutePath),
      ]);
    } else if (stats.isSymbolicLink()) {
      entries.push([
        relativePath,
        "symlink",
        0o777,
        Buffer.from(`symlink:${await readlink(absolutePath)}`, "utf8"),
      ]);
    } else {
      throw new Error(`Unsupported production source entry type: ${relativePath}`);
    }
  }
}

await walk(root);
entries.sort(([left], [right]) => left.localeCompare(right));
if (outputMode === "--list0") {
  process.stdout.write(entries.map(([relativePath]) => `${relativePath}\0`).join(""));
} else {
  const digest = createHash("sha256");
  digest.update("krw-production-source/v2\0");
  for (const [relativePath, type, mode, content] of entries) {
    const pathBytes = Buffer.from(relativePath, "utf8");
    const typeByte =
      type === "file" ? 1 : type === "symlink" ? 2 : type === "directory" ? 3 : 0;
    if (typeByte === 0) throw new Error(`Unsupported canonical entry type: ${type}`);
    // Source identity must remain stable across the Mac and Linux copies of
    // the same tree. Git's only semantic permission bit is owner-executable;
    // ownership, umask-derived read/write bits, and directory traversal modes
    // are deployment-container metadata rather than source content.
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
  process.stdout.write(digest.digest("hex"));
}
