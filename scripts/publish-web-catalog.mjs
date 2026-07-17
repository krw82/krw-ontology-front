#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  enrichCatalogWithSecIdentifiers,
  fetchSecTickerIndex,
} from "./sec-company-mapping.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
let catalogPath = "";
let envFile = process.env.WEB_CATALOG_ENV_FILE || ".env";

function usage() {
  console.log(`Usage: scripts/publish-web-catalog.mjs --file web_catalog.json [--env-file FILE]

Publish an exported KRW Ontology web catalog to Supabase and mark its
release active for the catalog env.`);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--file") {
    catalogPath = args[++index] || "";
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

if (!catalogPath) {
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCatalog(filePath) {
  const catalog = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(catalog)) {
    throw new Error("Catalog JSON must be an object");
  }
  if (catalog.format !== "krw-ontology-web-catalog/v1") {
    throw new Error(`Unsupported catalog format: ${String(catalog.format)}`);
  }
  if (!["dev", "staging", "prod"].includes(catalog.env)) {
    throw new Error(`Invalid catalog env: ${String(catalog.env)}`);
  }
  if (typeof catalog.release_id !== "string" || !catalog.release_id.trim()) {
    throw new Error("Catalog release_id is required");
  }
  if (!Array.isArray(catalog.companies)) {
    throw new Error("Catalog companies must be an array");
  }
  return catalog;
}

loadEnvFile(resolvePath(".env.production"));
loadEnvFile(resolvePath(envFile), { override: true });

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
}

const catalogFilePath = resolvePath(catalogPath);
if (!existsSync(catalogFilePath)) {
  throw new Error(`Catalog file not found: ${catalogFilePath}`);
}

const inputCatalog = readCatalog(catalogFilePath);
const secTickerIndex = await fetchSecTickerIndex({ userAgent: process.env.SEC_USER_AGENT });
const catalog = enrichCatalogWithSecIdentifiers(inputCatalog, secTickerIndex);
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: publishRows, error: publishError } = await client.rpc(
  "publish_ontology_web_catalog",
  { p_catalog: catalog },
);

if (publishError) {
  throw new Error(`publish_ontology_web_catalog failed: ${publishError.message}`);
}

const published = Array.isArray(publishRows) ? publishRows[0] : null;
if (!published) {
  throw new Error("publish_ontology_web_catalog returned no result");
}

const { data: activeRelease, error: releaseError } = await client
  .from("ontology_catalog_releases")
  .select("env, release_id, active, company_count, document_count, object_count")
  .eq("env", catalog.env)
  .eq("active", true)
  .maybeSingle();

if (releaseError) {
  throw new Error(`Failed to verify active catalog release: ${releaseError.message}`);
}
if (!activeRelease || activeRelease.release_id !== catalog.release_id) {
  throw new Error(
    `Active catalog mismatch: expected ${catalog.env}/${catalog.release_id}, got ${
      activeRelease
        ? `${activeRelease.env}/${activeRelease.release_id}`
        : "none"
    }`,
  );
}

const { count, error: companyCountError } = await client
  .from("ontology_companies")
  .select("ticker", { count: "exact", head: true })
  .eq("env", catalog.env)
  .eq("release_id", catalog.release_id);

if (companyCountError) {
  throw new Error(`Failed to verify catalog companies: ${companyCountError.message}`);
}
if (count !== catalog.companies.length) {
  throw new Error(
    `Published company count mismatch: expected ${catalog.companies.length}, got ${count}`,
  );
}

console.log(
  [
    "Published web catalog",
    `env=${published.env}`,
    `release_id=${published.release_id}`,
    `companies=${published.company_count}`,
    "sec_mappings=verified",
    `documents=${published.document_count}`,
    `objects=${published.object_count}`,
  ].join(" "),
);
