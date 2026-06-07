import "server-only";

import { getOntologyEnv, type OntologyEnv } from "@/lib/env";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  Json,
  OntologyCatalogReleaseRow,
  OntologyCompanyRow,
} from "@/types/database";

export interface IndexedCompany {
  ticker: string;
  name: string;
  sector: string | null;
  description: string;
  latest_period: string | null;
  coverage: string;
  core_strength?: string;
  critical_risk?: string;
  icon: string;
  document_count: number;
  document_types: string[];
  periods: string[];
  documents: IndexedCompanyDocument[];
  generated_at: string | null;
}

export interface IndexedCompanyDocument {
  period: string;
  document_type: string;
  doc_type_key: string | null;
  generated_at: string | null;
}

interface SearchIndexedCompaniesOptions {
  query?: string | null;
  limit?: number;
}

type UnknownRecord = Record<string, unknown>;

const COMPANY_SELECT_COLUMNS =
  "env, release_id, ticker, name, sector, description, latest_period, document_count, document_types, periods, coverage_json, documents_json, company_json, generated_at, created_at, updated_at";
const DEFAULT_COMPANY_SEARCH_LIMIT = 50;
const MAX_COMPANY_SEARCH_LIMIT = 100;

const SECTOR_LABELS: Record<string, string> = {
  consumer: "소비재",
  consumer_discretionary: "임의소비재",
  consumer_staples: "필수소비재",
  energy: "에너지",
  energy_lng: "에너지 · LNG",
  financials: "금융",
  healthcare: "헬스케어",
  industrials: "산업재",
  materials: "소재",
  semiconductor: "반도체",
  technology: "기술",
  utilities: "유틸리티",
};

const FALLBACK_COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.",
  AMZN: "Amazon.com, Inc.",
  AVGO: "Broadcom Inc.",
  CLF: "Cleveland-Cliffs Inc.",
  CPNG: "Coupang, Inc.",
  CVX: "Chevron Corporation",
  EMR: "Emerson Electric Co.",
  ERII: "Energy Recovery, Inc.",
  ETN: "Eaton Corporation plc",
  GOOG: "Alphabet Inc.",
  JNJ: "Johnson & Johnson",
  LNG: "Cheniere Energy, Inc.",
  MA: "Mastercard Incorporated",
  META: "Meta Platforms, Inc.",
  MSFT: "Microsoft Corporation",
  NVDA: "NVIDIA Corporation",
  OII: "Oceaneering International, Inc.",
  OXY: "Occidental Petroleum Corporation",
  PG: "The Procter & Gamble Company",
  PLTR: "Palantir Technologies Inc.",
  ROK: "Rockwell Automation, Inc.",
  SLB: "SLB",
  TSLA: "Tesla, Inc.",
  UNH: "UnitedHealth Group Incorporated",
  V: "Visa Inc.",
  VG: "Venture Global, Inc.",
  VST: "Vistra Corp.",
  WMT: "Walmart Inc.",
  XOM: "Exxon Mobil Corporation",
  XYL: "Xylem Inc.",
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isNonEmptyString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function normalizeLabelKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function formatLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const sectorLabel = SECTOR_LABELS[normalizeLabelKey(value)];
  if (sectorLabel) return sectorLabel;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function trimSentence(text: string, maxLength = 260): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function normalizeCompanySearchQuery(query: string | null | undefined): string {
  return (query ?? "")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/[,%*()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function clampCompanySearchLimit(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit) || !limit || limit < 1) {
    return DEFAULT_COMPANY_SEARCH_LIMIT;
  }
  return Math.min(limit, MAX_COMPANY_SEARCH_LIMIT);
}

function companySearchFilter(query: string): string {
  const pattern = `*${query}*`;
  return [
    `ticker.ilike.${pattern}`,
    `name.ilike.${pattern}`,
    `description.ilike.${pattern}`,
    `sector.ilike.${pattern}`,
  ].join(",");
}

function iconForCompany(row: OntologyCompanyRow): string {
  const company = isRecord(row.company_json) ? row.company_json : {};
  const coverage = isRecord(row.coverage_json) ? row.coverage_json : {};
  const haystack = [
    row.sector,
    row.description,
    stringArrayValue(company.primary_business_activities).join(" "),
    stringArrayValue(coverage.document_types).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("semiconductor")) return "memory";
  if (haystack.includes("energy") || haystack.includes("oil")) return "bolt";
  if (haystack.includes("industrial") || haystack.includes("manufactur")) {
    return "precision_manufacturing";
  }
  if (haystack.includes("health")) return "medical_services";
  if (haystack.includes("technology") || haystack.includes("software")) {
    return "hub";
  }
  return "business";
}

function buildCoverage(row: OntologyCompanyRow): string {
  const latestPeriod = row.latest_period;
  const documentCount = row.document_count || row.periods.length;
  return `${documentCount}개 공시 인덱싱${
    row.document_types.length ? ` · ${row.document_types.join(", ")}` : ""
  }${latestPeriod ? ` · 최신 ${latestPeriod}` : ""}`;
}

function textListFromJson(json: Json, key: string): string | undefined {
  if (!isRecord(json)) return undefined;
  const values = stringArrayValue(json[key]);
  return values.length ? values.join(", ") : undefined;
}

function documentArrayValue(value: Json): IndexedCompanyDocument[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const period = stringValue(item.period);
      const documentType = stringValue(item.document_type);
      if (!period || !documentType) return null;

      return {
        period,
        document_type: documentType,
        doc_type_key: stringValue(item.doc_type_key),
        generated_at: stringValue(item.generated_at),
      };
    })
    .filter((document): document is IndexedCompanyDocument => Boolean(document));
}

function companyFromRow(row: OntologyCompanyRow): IndexedCompany {
  const company = isRecord(row.company_json) ? row.company_json : {};
  const name =
    row.name ||
    stringValue(company.name) ||
    FALLBACK_COMPANY_NAMES[row.ticker] ||
    row.ticker;
  const description =
    row.description ||
    stringValue(company.description) ||
    `Indexed ontology coverage for ${row.ticker}.`;

  return {
    ticker: row.ticker,
    name,
    sector: formatLabel(row.sector),
    description: trimSentence(description),
    latest_period: row.latest_period,
    coverage: buildCoverage(row),
    core_strength:
      textListFromJson(row.company_json, "primary_business_activities") ??
      textListFromJson(row.coverage_json, "core_strengths"),
    critical_risk:
      textListFromJson(row.company_json, "key_external_factors") ??
      textListFromJson(row.coverage_json, "critical_risks"),
    icon: iconForCompany(row),
    document_count: row.document_count,
    document_types: row.document_types,
    periods: row.periods,
    documents: documentArrayValue(row.documents_json),
    generated_at: row.generated_at,
  };
}

export async function getActiveOntologyCatalogRelease(
  env: OntologyEnv = getOntologyEnv(),
): Promise<OntologyCatalogReleaseRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("ontology_catalog_releases")
    .select(
      "env, release_id, active, format, generated_at, release_created_at, index_generated_at, company_count, document_count, index_document_count, object_count, manifest_json, summary_json, source_json, catalog_json, created_at, updated_at",
    )
    .eq("env", env)
    .eq("active", true)
    .maybeSingle<OntologyCatalogReleaseRow>();

  if (error) {
    throw new Error(`Failed to read active ontology catalog release: ${error.message}`);
  }
  return data ?? null;
}

export async function listIndexedCompanies(): Promise<IndexedCompany[]> {
  const env = getOntologyEnv();
  const release = await getActiveOntologyCatalogRelease(env);
  if (!release) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("ontology_companies")
    .select(COMPANY_SELECT_COLUMNS)
    .eq("env", env)
    .eq("release_id", release.release_id)
    .order("ticker", { ascending: true })
    .returns<OntologyCompanyRow[]>();

  if (error) {
    throw new Error(`Failed to read ontology catalog companies: ${error.message}`);
  }

  return (data ?? []).map(companyFromRow);
}

export async function searchIndexedCompanies(
  options: SearchIndexedCompaniesOptions = {},
): Promise<IndexedCompany[]> {
  const env = getOntologyEnv();
  const release = await getActiveOntologyCatalogRelease(env);
  if (!release) return [];

  const query = normalizeCompanySearchQuery(options.query);
  const limit = clampCompanySearchLimit(options.limit);
  const builder = getSupabaseAdmin()
    .from("ontology_companies")
    .select(COMPANY_SELECT_COLUMNS)
    .eq("env", env)
    .eq("release_id", release.release_id)
    .order("ticker", { ascending: true })
    .limit(limit);

  const { data, error } = await (query
    ? builder.or(companySearchFilter(query))
    : builder
  ).returns<OntologyCompanyRow[]>();

  if (error) {
    throw new Error(`Failed to search ontology catalog companies: ${error.message}`);
  }

  return (data ?? []).map(companyFromRow);
}

export async function getIndexedCompanies(
  tickers: string[],
): Promise<IndexedCompany[]> {
  const normalizedTickers = Array.from(
    new Set(tickers.map(normalizeTicker).filter(isNonEmptyString)),
  );
  if (normalizedTickers.length === 0) return [];

  const env = getOntologyEnv();
  const release = await getActiveOntologyCatalogRelease(env);
  if (!release) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("ontology_companies")
    .select(COMPANY_SELECT_COLUMNS)
    .eq("env", env)
    .eq("release_id", release.release_id)
    .in("ticker", normalizedTickers)
    .returns<OntologyCompanyRow[]>();

  if (error) {
    throw new Error(`Failed to read ontology catalog companies: ${error.message}`);
  }

  const companiesByTicker = new Map(
    (data ?? []).map((row) => [row.ticker, companyFromRow(row)]),
  );
  return normalizedTickers
    .map((ticker) => companiesByTicker.get(ticker))
    .filter((company): company is IndexedCompany => Boolean(company));
}

export async function getIndexedCompany(
  ticker: string,
): Promise<IndexedCompany | null> {
  const normalized = normalizeTicker(ticker);
  if (!normalized) return null;

  const env = getOntologyEnv();
  const release = await getActiveOntologyCatalogRelease(env);
  if (!release) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("ontology_companies")
    .select(COMPANY_SELECT_COLUMNS)
    .eq("env", env)
    .eq("release_id", release.release_id)
    .eq("ticker", normalized)
    .maybeSingle<OntologyCompanyRow>();

  if (error) {
    throw new Error(`Failed to read ontology catalog company ${normalized}: ${error.message}`);
  }
  return data ? companyFromRow(data) : null;
}
