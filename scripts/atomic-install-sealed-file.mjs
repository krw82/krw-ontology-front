#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";

const [rawSource, rawDestination, expectedSha256, rawMode = "600"] =
  process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!rawSource || !rawDestination || !expectedSha256) {
  fail(
    "Usage: atomic-install-sealed-file.mjs SOURCE DESTINATION SHA256 [MODE]",
  );
}
if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
  fail("Expected digest must be a lowercase SHA-256 value");
}
if (!/^[0-7]{3,4}$/.test(rawMode)) {
  fail("File mode must be a three- or four-digit octal value");
}

const source = path.resolve(rawSource);
const destination = path.resolve(rawDestination);
if (path.dirname(source) !== path.dirname(destination)) {
  fail("Atomic install source and destination must share one directory");
}
if (source === destination) {
  fail("Atomic install source and destination must differ");
}

for (const [file, label] of [
  [source, "source"],
  [destination, "destination"],
]) {
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`Atomic install ${label} must be a regular non-symlink file`);
  }
}

const digest = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
if (digest(source) !== expectedSha256) {
  fail("Atomic install source does not match its expected digest");
}

chmodSync(source, Number.parseInt(rawMode, 8));
const sourceFd = openSync(source, "r");
try {
  fsyncSync(sourceFd);
} finally {
  closeSync(sourceFd);
}
renameSync(source, destination);
const directoryFd = openSync(path.dirname(destination), "r");
try {
  fsyncSync(directoryFd);
} finally {
  closeSync(directoryFd);
}
if (digest(destination) !== expectedSha256) {
  fail("Atomic install destination does not match its expected digest");
}
