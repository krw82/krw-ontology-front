#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  enrichCatalogWithSecIdentifiers,
  fetchSecTickerIndex,
} from "./sec-company-mapping.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let catalogEnv = "prod";
let envFile = ".env";

function usage() {
  console.log("Usage: scripts/backfill-active-catalog-sec-identifiers.mjs [--env prod] [--env-file FILE]");
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--env") catalogEnv = args[++index] || "";
  else if (arg === "--env-file") envFile = args[++index] || "";
  else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else {
    usage();
    process.exit(1);
  }
}

if (!["dev", "staging", "prod"].includes(catalogEnv)) {
  throw new Error("--env must be dev, staging, or prod");
}

function resolvePath(input) {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (override || !process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolvePath(".env.production"));
loadEnvFile(resolvePath(envFile), { override: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: activeRelease, error: activeReleaseError } = await client
  .from("ontology_catalog_releases")
  .select("env, release_id, catalog_json")
  .eq("env", catalogEnv)
  .eq("active", true)
  .maybeSingle();
if (activeReleaseError) throw new Error(`Failed to load active catalog: ${activeReleaseError.message}`);
if (!activeRelease || !activeRelease.catalog_json || typeof activeRelease.catalog_json !== "object") {
  throw new Error(`No active ${catalogEnv} catalog release is available for SEC identifier backfill`);
}

const catalog = activeRelease.catalog_json;
if (catalog.env !== catalogEnv || catalog.release_id !== activeRelease.release_id) {
  throw new Error("Active catalog payload does not match its release row");
}
const secTickerIndex = await fetchSecTickerIndex({ userAgent: process.env.SEC_USER_AGENT });
const enrichedCatalog = enrichCatalogWithSecIdentifiers(catalog, secTickerIndex);
const { data, error } = await client.rpc("publish_ontology_web_catalog", { p_catalog: enrichedCatalog });
if (error) throw new Error(`SEC identifier backfill failed: ${error.message}`);
const result = Array.isArray(data) ? data[0] : null;
if (!result || result.release_id !== activeRelease.release_id) {
  throw new Error("SEC identifier backfill returned an unexpected catalog release");
}
console.log(`Backfilled SEC identifiers env=${result.env} release_id=${result.release_id} companies=${result.company_count}`);
