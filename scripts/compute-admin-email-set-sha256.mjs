#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const envPath = process.argv[2];
if (!envPath) {
  console.error("Usage: scripts/compute-admin-email-set-sha256.mjs ENV_FILE");
  process.exit(2);
}

let rawValue = null;
for (const raw of (await readFile(envPath, "utf8")).split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator <= 0 || line.slice(0, separator).trim() !== "ADMIN_EMAILS") {
    continue;
  }
  if (rawValue !== null) {
    throw new Error("ADMIN_EMAILS must be defined exactly once");
  }
  rawValue = line.slice(separator + 1).trim();
  if (
    rawValue.length >= 2 &&
    ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'")))
  ) {
    rawValue = rawValue.slice(1, -1);
  }
}

if (rawValue === null) throw new Error("ADMIN_EMAILS is missing");
const emails = [
  ...new Set(
    rawValue
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
].sort();
if (emails.length === 0) {
  throw new Error("ADMIN_EMAILS must contain at least one address");
}
if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
  throw new Error("ADMIN_EMAILS contains an invalid address");
}

process.stdout.write(createHash("sha256").update(emails.join("\n")).digest("hex"));
