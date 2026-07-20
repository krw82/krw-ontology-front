#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";

const [rawSource, rawDestination, expectedSha256, rawMode = "400"] =
  process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!rawSource || !rawDestination || !expectedSha256) {
  fail(
    "Usage: atomic-transition-sealed-file.mjs SOURCE DESTINATION SHA256 [MODE]",
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
const expectedMode = Number.parseInt(rawMode, 8);
if (source === destination) {
  fail("Atomic transition source and destination must differ");
}

const digest = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const assertRegular = (file, label) => {
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`Atomic transition ${label} must be a regular non-symlink file`);
  }
  return stats;
};
const assertDirectory = (directory, label) => {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(`Atomic transition ${label} must be a regular non-symlink directory`);
  }
  return stats;
};
const fsyncFile = (file) => {
  const fd = openSync(file, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
const fsyncDirectory = (directory) => {
  const fd = openSync(directory, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

const sourceExists = existsSync(source);
const destinationExists = existsSync(destination);
if (!sourceExists) {
  if (!destinationExists) {
    fail("Atomic transition source and destination are both absent");
  }
  assertRegular(destination, "destination");
  if (digest(destination) !== expectedSha256) {
    fail("Atomic transition destination does not match its expected digest");
  }
  if ((lstatSync(destination).mode & 0o777) !== expectedMode) {
    fail("Atomic transition destination mode does not match its expected mode");
  }
  process.exit(0);
}
if (destinationExists) {
  assertRegular(source, "source");
  assertRegular(destination, "destination");
  fail("Atomic transition refuses an ambiguous source-and-destination state");
}

const sourceStats = assertRegular(source, "source");
if (digest(source) !== expectedSha256) {
  fail("Atomic transition source does not match its expected digest");
}
const sourceParent = path.dirname(source);
const destinationParent = path.dirname(destination);
const sourceParentStats = assertDirectory(sourceParent, "source parent");
const destinationParentStats = assertDirectory(
  destinationParent,
  "destination parent",
);
if (
  sourceStats.dev !== sourceParentStats.dev ||
  sourceParentStats.dev !== destinationParentStats.dev
) {
  fail("Atomic transition requires source and destination on one filesystem");
}

chmodSync(source, expectedMode);
fsyncFile(source);
renameSync(source, destination);
fsyncDirectory(sourceParent);
if (destinationParent !== sourceParent) fsyncDirectory(destinationParent);
assertRegular(destination, "destination");
if (digest(destination) !== expectedSha256) {
  fail("Atomic transition destination does not match its expected digest");
}
if ((lstatSync(destination).mode & 0o777) !== expectedMode) {
  fail("Atomic transition destination mode does not match its expected mode");
}
