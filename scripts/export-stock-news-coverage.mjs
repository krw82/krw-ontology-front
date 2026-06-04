#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
let ontologyEnv = process.env.KRW_ONTOLOGY_ENV || "prod";
let envFile = process.env.STOCK_NEWS_COVERAGE_ENV_FILE || "";
let outPath = "";
let releaseId = "";
let minCompanies = null;

const STOP_PHRASES = new Set([
  "the",
  "and",
  "with",
  "from",
  "this",
  "that",
  "risk",
  "risks",
  "revenue",
  "margin",
  "cash flow",
]);

function usage() {
  console.log(`Usage: scripts/export-stock-news-coverage.mjs --env dev|staging|prod --out FILE [--env-file FILE] [--release-id ID] [--min-companies N]

Export the active Supabase ontology web catalog into the stock-news MCP
coverage_companies.json format.`);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  switch (arg) {
    case "--env":
      ontologyEnv = args[++index] || "";
      break;
    case "--env-file":
      envFile = args[++index] || "";
      break;
    case "--out":
      outPath = args[++index] || "";
      break;
    case "--release-id":
      releaseId = args[++index] || "";
      break;
    case "--min-companies":
      minCompanies = Number.parseInt(args[++index] || "", 10);
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

if (!["dev", "staging", "prod"].includes(ontologyEnv)) {
  usage();
  throw new Error(`Invalid ontology env: ${ontologyEnv || "unset"}`);
}
if (!outPath) {
  usage();
  throw new Error("--out is required");
}
if (
  minCompanies !== null &&
  (!Number.isSafeInteger(minCompanies) || minCompanies < 0)
) {
  throw new Error(`--min-companies must be a non-negative integer: ${minCompanies}`);
}

loadEnvFile(resolvePath(".env.production"));
loadEnvFile(resolvePath(".env"));
if (envFile) loadEnvFile(resolvePath(envFile), { override: true });

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
}

const landingProfiles = loadLandingProfiles();
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const release = releaseId
  ? await readReleaseById(releaseId)
  : await readActiveRelease();
if (!release) {
  throw new Error(
    releaseId
      ? `No ontology catalog release found for env=${ontologyEnv} release_id=${releaseId}`
      : `No active ontology catalog release found for env=${ontologyEnv}`,
  );
}

const rows = await readCompanies(release.release_id);
const coverage = rows
  .filter((row) => row.document_count > 0)
  .map((row) => companyToCoverage(row, landingProfiles.get(row.ticker)))
  .sort((a, b) => a.ticker.localeCompare(b.ticker));

const expectedMinimum = minCompanies ?? release.company_count ?? 1;
if (coverage.length < expectedMinimum) {
  throw new Error(
    `Stock-news coverage too small: expected at least ${expectedMinimum}, got ${coverage.length}`,
  );
}

const resolvedOutPath = resolvePath(outPath);
mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
writeFileSync(resolvedOutPath, `${JSON.stringify(coverage, null, 2)}\n`);

console.log(
  [
    "Exported stock-news coverage",
    `env=${ontologyEnv}`,
    `release_id=${release.release_id}`,
    `companies=${coverage.length}`,
    `out=${resolvedOutPath}`,
  ].join(" "),
);

async function readActiveRelease() {
  const { data, error } = await supabase
    .from("ontology_catalog_releases")
    .select("env, release_id, active, company_count")
    .eq("env", ontologyEnv)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`Failed to read active catalog release: ${error.message}`);
  return data ?? null;
}

async function readReleaseById(id) {
  const { data, error } = await supabase
    .from("ontology_catalog_releases")
    .select("env, release_id, active, company_count")
    .eq("env", ontologyEnv)
    .eq("release_id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to read catalog release: ${error.message}`);
  return data ?? null;
}

async function readCompanies(activeReleaseId) {
  const { data, error } = await supabase
    .from("ontology_companies")
    .select(
      "env, release_id, ticker, name, sector, description, document_count, company_json, coverage_json",
    )
    .eq("env", ontologyEnv)
    .eq("release_id", activeReleaseId)
    .order("ticker", { ascending: true });
  if (error) throw new Error(`Failed to read ontology companies: ${error.message}`);
  return data ?? [];
}

function companyToCoverage(row, profile) {
  const companyJson = isRecord(row.company_json) ? row.company_json : {};
  const coverageJson = isRecord(row.coverage_json) ? row.coverage_json : {};
  const ticker = normalizeTicker(row.ticker);
  const catalogName = stringValue(row.name) || stringValue(companyJson.name);
  const companyName = bestCompanyName({
    ticker,
    catalogName,
    profileName: profile?.companyName,
  });
  const sector = stringValue(row.sector) || stringValue(companyJson.sector);
  const aliases = uniqueStrings([
    companyName,
    catalogName,
    profile?.companyNameKo,
    ...nameAliases(companyName),
    ...tickerAliases(ticker),
  ]).filter((value) => normalizeTicker(value) !== ticker);
  const fallbackKeywordSources = profile
    ? []
    : [
        ...phrasesFromText(row.description),
        ...phrasesFromList(stringArray(companyJson.primary_business_activities)),
        ...phrasesFromList(stringArray(companyJson.key_external_factors)),
        ...phrasesFromList(stringArray(coverageJson.core_strengths)),
        ...phrasesFromList(stringArray(coverageJson.critical_risks)),
      ];
  const keywords = uniqueStrings([
    sector,
    profile?.sectorKo,
    ...phrasesFromList(profile?.researchFocus),
    ...phrasesFromList(profile?.riskVariables),
    ...fallbackKeywordSources,
  ]).slice(0, 24);

  return dropUndefined({
    ticker,
    company_name: companyName,
    legal_name: companyName,
    sector: sector || undefined,
    industry: profile?.sectorKo || sector || undefined,
    aliases,
    keywords,
    ontology_ticker: ticker,
  });
}

function bestCompanyName({ ticker, catalogName, profileName }) {
  if (profileName && normalizeTicker(profileName) !== ticker) return profileName;
  if (catalogName && normalizeTicker(catalogName) !== ticker) return catalogName;
  return profileName || catalogName || ticker;
}

function tickerAliases(ticker) {
  const aliases = [];
  if (ticker === "GOOG") aliases.push("GOOGL", "Alphabet", "Google");
  if (ticker === "GOOGL") aliases.push("GOOG", "Alphabet", "Google");
  return aliases;
}

function nameAliases(name) {
  return [
    name
      .replace(/\b(Inc\.?|Corporation|Corp\.?|Company|Co\.?|plc|Ltd\.?|Limited)\b/gi, "")
      .replace(/[,.]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ].filter(Boolean);
}

function phrasesFromList(values) {
  return (values ?? [])
    .flatMap((value) => phrasesFromText(value))
    .filter(Boolean);
}

function phrasesFromText(value) {
  if (typeof value !== "string") return [];
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const phrases = new Set();
  for (const match of normalized.matchAll(/\b[A-Z][A-Z0-9&.-]{1,}\b/g)) {
    phrases.add(match[0].replace(/[.,]$/g, ""));
  }
  for (const match of normalized.matchAll(/\b[A-Za-z][A-Za-z0-9&.-]+(?:\s+[A-Za-z][A-Za-z0-9&.-]+){0,3}\b/g)) {
    const phrase = match[0].replace(/[.,]$/g, "").trim();
    if (phrase.length >= 3 && !STOP_PHRASES.has(phrase.toLowerCase())) phrases.add(phrase);
  }
  for (const match of normalized.matchAll(/[가-힣A-Za-z0-9&.-]{2,}(?:[·\s][가-힣A-Za-z0-9&.-]{2,}){0,3}/g)) {
    const phrase = match[0].replace(/[.,]$/g, "").trim();
    if (phrase.length >= 3) phrases.add(phrase);
  }

  return Array.from(phrases).slice(0, 8);
}

function loadLandingProfiles() {
  const filePath = path.join(repoRoot, "src", "lib", "companies", "landing-copy.ts");
  if (!existsSync(filePath)) return new Map();
  const source = readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  const profiles = new Map();
  let insideProfiles = false;
  let ticker = "";
  let buffer = [];
  let depth = 0;

  for (const line of lines) {
    if (!insideProfiles) {
      insideProfiles = line.includes("export const COMPANY_RESEARCH_PROFILES = {");
      continue;
    }
    if (!ticker) {
      const match = line.match(/^  ([A-Z0-9.]+): \{$/);
      if (!match) {
        if (line.startsWith("};")) break;
        continue;
      }
      ticker = normalizeTicker(match[1]);
      buffer = [line];
      depth = 1;
      continue;
    }

    buffer.push(line);
    depth += countChar(line, "{") - countChar(line, "}");
    if (depth === 0) {
      profiles.set(ticker, parseLandingProfileBlock(buffer.join("\n")));
      ticker = "";
      buffer = [];
    }
  }

  return profiles;
}

function parseLandingProfileBlock(block) {
  return {
    companyName: extractStringProperty(block, "companyName"),
    companyNameKo: extractStringProperty(block, "companyNameKo"),
    sectorKo: extractStringProperty(block, "sectorKo"),
    researchFocus: extractStringArrayProperty(block, "researchFocus"),
    riskVariables: extractStringArrayProperty(block, "riskVariables"),
  };
}

function extractStringProperty(block, key) {
  const match = block.match(new RegExp(`${key}:\\s*"([^"]+)"`));
  return match?.[1] || "";
}

function extractStringArrayProperty(block, key) {
  const start = block.indexOf(`${key}: [`);
  if (start < 0) return [];
  const end = block.indexOf("],", start);
  if (end < 0) return [];
  const slice = block.slice(start, end);
  return Array.from(slice.matchAll(/"([^"]+)"/g), (match) => match[1]);
}

function countChar(value, char) {
  return Array.from(value).filter((item) => item === char).length;
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

function resolvePath(input) {
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
}

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function dropUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null) return false;
      if (Array.isArray(item) && item.length === 0) return false;
      return true;
    }),
  );
}
