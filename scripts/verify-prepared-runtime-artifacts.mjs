#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

function usage() {
  console.error(
    "Usage: scripts/verify-prepared-runtime-artifacts.mjs <prepare|verify> --marker FILE [--symlink-boundary DIR] [--root-subset] --path FILE_OR_DIRECTORY [--path ...]",
  );
}

const [mode, ...rawArgs] = process.argv.slice(2);
let markerPath = "";
let symlinkBoundary = "";
let verifyRootSubset = false;
const roots = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const argument = rawArgs[index];
  if (argument === "--marker") {
    markerPath = rawArgs[index + 1] ?? "";
    index += 1;
  } else if (argument === "--path") {
    roots.push(rawArgs[index + 1] ?? "");
    index += 1;
  } else if (argument === "--symlink-boundary") {
    symlinkBoundary = rawArgs[index + 1] ?? "";
    index += 1;
  } else if (argument === "--root-subset") {
    verifyRootSubset = true;
  } else {
    usage();
    process.exit(2);
  }
}

if (
  !["prepare", "verify"].includes(mode) ||
  !markerPath ||
  roots.some((root) => !root)
) {
  usage();
  process.exit(2);
}
if (mode === "prepare" && roots.length === 0) {
  usage();
  process.exit(2);
}
if ((mode !== "verify" && verifyRootSubset) || (verifyRootSubset && roots.length === 0)) {
  usage();
  process.exit(2);
}

const normalizedMarkerPath = path.resolve(markerPath);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function collectEntry(absolutePath, logicalPath, entries, boundaryRoot) {
  const stats = await lstat(absolutePath);
  if (stats.isDirectory()) {
    const children = await readdir(absolutePath);
    children.sort((left, right) => left.localeCompare(right));
    for (const child of children) {
      await collectEntry(
        path.join(absolutePath, child),
        `${logicalPath}/${child}`,
        entries,
        boundaryRoot,
      );
    }
    return;
  }

  if (stats.isSymbolicLink()) {
    const target = await readlink(absolutePath);
    const resolvedTarget = path.resolve(path.dirname(absolutePath), target);
    if (!isWithin(boundaryRoot, resolvedTarget)) {
      throw new Error(
        `Prepared artifact symlink escapes its sealed root: ${absolutePath} -> ${target}`,
      );
    }
    entries.push({
      path: logicalPath,
      kind: "symlink",
      target,
    });
    return;
  }

  if (!stats.isFile()) {
    throw new Error(`Unsupported prepared artifact type: ${absolutePath}`);
  }

  entries.push({
    path: logicalPath,
    kind: "file",
    mode: stats.mode & 0o777,
    sha256: sha256(await readFile(absolutePath)),
  });
}

async function collectRoots(
  rootPaths,
  configuredBoundary = "",
  logicalRootIndexes = rootPaths.map((_, index) => index),
) {
  if (logicalRootIndexes.length !== rootPaths.length) {
    throw new Error("Prepared artifact logical root index mismatch");
  }
  const entries = [];
  const normalizedRoots = rootPaths.map((root) => path.resolve(root));
  for (const [index, root] of normalizedRoots.entries()) {
    const stats = await lstat(root);
    const boundaryRoot = configuredBoundary
      ? path.resolve(configuredBoundary)
      : stats.isDirectory()
        ? root
        : path.dirname(root);
    await collectEntry(
      root,
      `root-${logicalRootIndexes[index]}`,
      entries,
      boundaryRoot,
    );
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { roots: normalizedRoots, entries };
}

async function fsyncEntry(absolutePath) {
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) return;
  if (stats.isDirectory()) {
    const children = await readdir(absolutePath);
    children.sort((left, right) => left.localeCompare(right));
    for (const child of children) {
      await fsyncEntry(path.join(absolutePath, child));
    }
  } else if (!stats.isFile()) {
    throw new Error(`Unsupported prepared artifact type: ${absolutePath}`);
  }
  const handle = await open(absolutePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncRoots(rootPaths) {
  const parentDirectories = new Set();
  for (const root of rootPaths.map((entry) => path.resolve(entry))) {
    await fsyncEntry(root);
    parentDirectories.add(path.dirname(root));
  }
  for (const directory of parentDirectories) {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

async function prepare() {
  const normalizedBoundary = symlinkBoundary
    ? path.resolve(symlinkBoundary)
    : "";
  await fsyncRoots(roots);
  const snapshot = await collectRoots(roots, normalizedBoundary);
  await fsyncRoots(snapshot.roots);
  const durableSnapshot = await collectRoots(snapshot.roots, normalizedBoundary);
  if (JSON.stringify(durableSnapshot.entries) !== JSON.stringify(snapshot.entries)) {
    throw new Error("Prepared runtime artifacts changed while their durable seal was created");
  }
  const payload = {
    format: "krw-prepared-runtime-artifacts/v1",
    preparedAt: new Date().toISOString(),
    symlinkBoundary: normalizedBoundary || null,
    ...snapshot,
  };
  await mkdir(path.dirname(normalizedMarkerPath), { recursive: true });
  const temporaryPath = `${normalizedMarkerPath}.tmp.${process.pid}`;
  const markerHandle = await open(temporaryPath, "wx", 0o600);
  try {
    await markerHandle.writeFile(`${JSON.stringify(payload, null, 2)}\n`);
    await markerHandle.sync();
  } finally {
    await markerHandle.close();
  }
  await rename(temporaryPath, normalizedMarkerPath);
  const markerDirectory = await open(path.dirname(normalizedMarkerPath), "r");
  try {
    await markerDirectory.sync();
  } finally {
    await markerDirectory.close();
  }
  console.log(
    `Prepared runtime artifact seal: ${snapshot.entries.length} entries`,
  );
}

async function verify() {
  const payload = JSON.parse(await readFile(normalizedMarkerPath, "utf8"));
  if (
    payload?.format !== "krw-prepared-runtime-artifacts/v1" ||
    !Array.isArray(payload.roots) ||
    !Array.isArray(payload.entries)
  ) {
    throw new Error("Invalid prepared runtime artifact seal");
  }

  const sealedRoots = payload.roots.map((root) => {
    if (typeof root !== "string" || !path.isAbsolute(root) || path.resolve(root) !== root) {
      throw new Error("Prepared runtime seal contains a non-canonical root");
    }
    return root;
  });
  const sealedEntryPaths = new Set();
  for (const entry of payload.entries) {
    const rootMatch = /^root-(\d+)(?:\/|$)/.exec(entry?.path ?? "");
    if (!rootMatch || Number(rootMatch[1]) >= sealedRoots.length ||
        sealedEntryPaths.has(entry.path)) {
      throw new Error("Prepared runtime seal contains an invalid or duplicate entry path");
    }
    sealedEntryPaths.add(entry.path);
    if (entry.kind === "file") {
      if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 ||
          !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
        throw new Error("Prepared runtime seal contains invalid file metadata");
      }
    } else if (entry.kind === "symlink") {
      if (typeof entry.target !== "string" || /[\r\n\0]/.test(entry.target)) {
        throw new Error("Prepared runtime seal contains invalid symlink metadata");
      }
    } else {
      throw new Error("Prepared runtime seal contains an unsupported entry kind");
    }
  }

  let verificationRoots = sealedRoots;
  let logicalRootIndexes = sealedRoots.map((_, index) => index);
  if (roots.length > 0) {
    const expectedRoots = roots.map((root) => path.resolve(root));
    if (new Set(expectedRoots).size !== expectedRoots.length) {
      throw new Error("Prepared runtime verification roots must be unique");
    }
    if (verifyRootSubset) {
      logicalRootIndexes = expectedRoots.map((root) => {
        const matches = sealedRoots
          .map((sealedRoot, index) => sealedRoot === root ? index : -1)
          .filter((index) => index >= 0);
        if (matches.length !== 1) {
          throw new Error(
            "Prepared runtime subset root is not uniquely present in the seal",
          );
        }
        return matches[0];
      });
      verificationRoots = expectedRoots;
    } else if (JSON.stringify(expectedRoots) !== JSON.stringify(sealedRoots)) {
      throw new Error(
        "Prepared runtime artifact roots do not match activation inputs",
      );
    }
  }

  const requestedBoundary = symlinkBoundary
    ? path.resolve(symlinkBoundary)
    : payload.symlinkBoundary ?? "";
  if (
    symlinkBoundary &&
    requestedBoundary !== (payload.symlinkBoundary ?? "")
  ) {
    throw new Error("Prepared runtime symlink boundary does not match activation inputs");
  }
  const current = await collectRoots(
    verificationRoots,
    requestedBoundary,
    logicalRootIndexes,
  );
  const selectedRootIndexes = new Set(logicalRootIndexes);
  const expectedEntries = verifyRootSubset
    ? payload.entries.filter((entry) => {
        const match = /^root-(\d+)(?:\/|$)/.exec(entry.path);
        return match && selectedRootIndexes.has(Number(match[1]));
      })
    : payload.entries;
  if (JSON.stringify(current.entries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      "Prepared runtime artifacts changed after they were sealed",
    );
  }

  console.log(
    `OK prepared runtime artifact seal: ${current.entries.length} entries`,
  );
}

try {
  if (mode === "prepare") await prepare();
  else await verify();
} catch (error) {
  await rm(`${normalizedMarkerPath}.tmp.${process.pid}`, { force: true }).catch(
    () => {},
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
