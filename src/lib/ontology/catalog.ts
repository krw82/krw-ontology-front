import "server-only";

import { readdir, readFile } from "fs/promises";
import path from "path";

import { getKrwOntologyPluginPath } from "@/lib/agent/mcp-client";
import { normalizeTicker } from "@/lib/ontology/ticker";

type CompanyArtifactIndex = {
  ticker?: string;
  generated_at?: string;
  documents?: Record<
    string,
    {
      document_type?: string;
      doc_type_key?: string;
    }
  >;
};

type CompanyBusinessProfile = {
  company_name?: string;
  legal_name?: string;
  display_name?: string;
  name?: string;
  business_model_summary?: string;
  sector?: string;
  primary_business_activities?: string[];
  key_external_factors?: string[];
};

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
  generated_at: string | null;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readFirstJsonl<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf8");
    const line = content.split(/\r?\n/).find(Boolean);
    return line ? (JSON.parse(line) as T) : null;
  } catch {
    return null;
  }
}

async function resolveRootFromPlugin(): Promise<string | null> {
  const pluginPath = getKrwOntologyPluginPath();
  const mcpConfig = await readJsonFile<{
    mcpServers?: Record<string, { env?: Record<string, string> }>;
  }>(path.join(pluginPath, ".mcp.json"));

  return (
    mcpConfig?.mcpServers?.["krw-ontology"]?.env?.KRW_ONTOLOGY_ROOT ?? null
  );
}

export async function getOntologyRoot(): Promise<string> {
  const root = process.env.KRW_ONTOLOGY_ROOT || (await resolveRootFromPlugin());
  if (!root) {
    throw new Error("Missing required environment variable: KRW_ONTOLOGY_ROOT");
  }
  return root;
}

function periodRank(period: string): number {
  const match = /^(?:FY|CY)(\d{4})(?:Q(\d))?$/.exec(period);
  if (!match) return 0;
  const year = Number(match[1]);
  const quarter = match[2] ? Number(match[2]) : 5;
  return year * 10 + quarter;
}

function trimSentence(text: string, maxLength = 260): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

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

function normalizeLabelKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function formatLabel(value: string | undefined): string {
  if (!value) return "인덱싱된 기업";
  const sectorLabel = SECTOR_LABELS[normalizeLabelKey(value)];
  if (sectorLabel) return sectorLabel;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstTextValue(...values: Array<string | undefined>): string | null {
  const value = values.find((item) => item?.trim());
  return value ? value.trim() : null;
}

function iconForCompany(profile: CompanyBusinessProfile | null): string {
  const haystack = [
    profile?.sector,
    ...(profile?.primary_business_activities ?? []),
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

async function buildCompany(root: string, ticker: string): Promise<IndexedCompany | null> {
  const companyRoot = path.join(root, "companies", ticker);
  const indexPath = path.join(companyRoot, "indexes", "company_artifact_index.json");
  const artifactIndex = await readJsonFile<CompanyArtifactIndex>(indexPath);
  if (!artifactIndex?.documents) return null;

  const periods = Object.keys(artifactIndex.documents).sort(
    (a, b) => periodRank(b) - periodRank(a),
  );
  const latestPeriod = periods[0] ?? null;
  const documentTypes = Array.from(
    new Set(
      periods
        .map((period) => artifactIndex.documents?.[period]?.document_type)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
  const profile = await readFirstJsonl<CompanyBusinessProfile>(
    path.join(companyRoot, "context", "company_business_profiles.jsonl"),
  );

  const description =
    profile?.business_model_summary ||
    `Indexed ontology coverage for ${ticker}.`;
  const activities = profile?.primary_business_activities?.slice(0, 3) ?? [];
  const factors = profile?.key_external_factors?.slice(0, 4) ?? [];
  const sector = profile?.sector ? formatLabel(profile.sector) : null;
  const companyName =
    firstTextValue(
      profile?.company_name,
      profile?.legal_name,
      profile?.display_name,
      profile?.name,
    ) ??
    FALLBACK_COMPANY_NAMES[ticker] ??
    ticker;
  const coverage = `${periods.length}개 공시 인덱싱${
    documentTypes.length ? ` · ${documentTypes.join(", ")}` : ""
  }${latestPeriod ? ` · 최신 ${latestPeriod}` : ""}`;

  return {
    ticker,
    name: companyName,
    sector,
    description: trimSentence(description),
    latest_period: latestPeriod,
    coverage,
    core_strength: activities.length ? activities.join(", ") : undefined,
    critical_risk: factors.length ? factors.join(", ") : undefined,
    icon: iconForCompany(profile),
    document_count: periods.length,
    document_types: documentTypes,
    periods,
    generated_at: artifactIndex.generated_at ?? null,
  };
}

export async function listIndexedCompanies(): Promise<IndexedCompany[]> {
  const root = await getOntologyRoot();
  let entries;
  try {
    entries = await readdir(path.join(root, "companies"), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const tickers = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeTicker(entry.name))
    .filter((ticker): ticker is string => Boolean(ticker))
    .sort();
  const companies = await Promise.all(
    tickers.map((ticker) => buildCompany(root, ticker)),
  );

  return companies.filter((company): company is IndexedCompany => Boolean(company));
}

export async function getIndexedCompany(
  ticker: string,
): Promise<IndexedCompany | null> {
  const normalized = normalizeTicker(ticker);
  if (!normalized) return null;
  const root = await getOntologyRoot();
  return buildCompany(root, normalized);
}
