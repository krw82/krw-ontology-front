#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
let envFile = process.env.WEB_CATALOG_ENV_FILE || ".env";
let ontologyEnv = "prod";
let releaseId = "";

function usage() {
  console.log(`Usage: scripts/verify-web-catalog-release.mjs --release-id ID [--env prod] [--env-file FILE]

Verify that Supabase has the requested active ontology web catalog release.`);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--release-id") {
    releaseId = args[++index] || "";
  } else if (arg === "--env") {
    ontologyEnv = args[++index] || "";
  } else if (arg === "--env-file") {
    envFile = args[++index] || "";
  } else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else {
    usage();
    process.exit(1);
  }
}

if (!releaseId || !["dev", "staging", "prod"].includes(ontologyEnv)) {
  usage();
  process.exit(1);
}

function resolvePath(input) {
  if (!input) return "";
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
}

function loadEnvFile(filePath, { override = false } = {}) {
  if (!filePath || !existsSync(filePath)) return;

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || !process.env[key]) process.env[key] = value;
  }
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env value: ${key}`);
  return value;
}

loadEnvFile(resolvePath(".env.production"));
loadEnvFile(resolvePath(envFile), { override: true });

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: activeRelease, error: releaseError } = await client
  .from("ontology_catalog_releases")
  .select("env, release_id, active, company_count, document_count, object_count")
  .eq("env", ontologyEnv)
  .eq("active", true)
  .maybeSingle();

if (releaseError) {
  throw new Error(`Failed to read active catalog release: ${releaseError.message}`);
}
if (!activeRelease) {
  throw new Error(`No active web catalog release for env=${ontologyEnv}`);
}
if (activeRelease.release_id !== releaseId) {
  throw new Error(
    `Active web catalog mismatch: expected ${ontologyEnv}/${releaseId}, got ${activeRelease.env}/${activeRelease.release_id}`,
  );
}

console.log(
  [
    "OK active web catalog",
    `env=${activeRelease.env}`,
    `release_id=${activeRelease.release_id}`,
    `companies=${activeRelease.company_count}`,
    `documents=${activeRelease.document_count}`,
    `objects=${activeRelease.object_count}`,
  ].join(" "),
);
