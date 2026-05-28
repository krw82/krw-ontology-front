import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getActiveOntologyCatalogRelease,
  getIndexedCompany,
  listIndexedCompanies,
} from "./catalog";
import type {
  OntologyCatalogReleaseRow,
  OntologyCompanyRow,
} from "@/types/database";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

const ORIGINAL_ENV = process.env.KRW_ONTOLOGY_ENV;

const releaseRow: OntologyCatalogReleaseRow = {
  env: "prod",
  release_id: "20260528_150000",
  active: true,
  format: "krw-ontology-web-catalog/v1",
  generated_at: "2026-05-28T15:01:00.000Z",
  release_created_at: "2026-05-28T15:00:00.000Z",
  index_generated_at: "2026-05-28T14:59:00.000Z",
  company_count: 2,
  document_count: 4,
  index_document_count: 4,
  object_count: 100,
  manifest_json: { release_id: "20260528_150000" },
  summary_json: { company_count: 2 },
  source_json: { index_path: "indexes/agent_index.sqlite" },
  catalog_json: {},
  created_at: "2026-05-28T15:01:00.000Z",
  updated_at: "2026-05-28T15:01:00.000Z",
};

const companyRows: OntologyCompanyRow[] = [
  {
    env: "prod",
    release_id: "20260528_150000",
    ticker: "AAPL",
    name: "Apple Inc.",
    sector: "technology",
    description: "Consumer technology company with indexed filings.",
    latest_period: "FY2025",
    document_count: 2,
    document_types: ["10-K", "10-Q"],
    periods: ["FY2025", "CY2025Q3"],
    coverage_json: {},
    documents_json: [],
    company_json: {
      primary_business_activities: ["Devices", "Services"],
      key_external_factors: ["China demand"],
    },
    generated_at: "2026-05-28T15:01:00.000Z",
    created_at: "2026-05-28T15:01:00.000Z",
    updated_at: "2026-05-28T15:01:00.000Z",
  },
  {
    env: "prod",
    release_id: "20260528_150000",
    ticker: "XOM",
    name: "Exxon Mobil Corporation",
    sector: "energy",
    description: null,
    latest_period: "FY2025",
    document_count: 1,
    document_types: ["10-K"],
    periods: ["FY2025"],
    coverage_json: {},
    documents_json: [],
    company_json: {},
    generated_at: null,
    created_at: "2026-05-28T15:01:00.000Z",
    updated_at: "2026-05-28T15:01:00.000Z",
  },
];

class QueryMock {
  private filters = new Map<string, unknown>();

  constructor(private table: string) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.set(key, value);
    return this;
  }

  order() {
    return this;
  }

  async maybeSingle<T>() {
    if (this.table === "ontology_catalog_releases") {
      return {
        data:
          this.filters.get("env") === releaseRow.env &&
          this.filters.get("active") === true
            ? (releaseRow as T)
            : null,
        error: null,
      };
    }

    const row =
      this.table === "ontology_companies"
        ? companyRows.find(
            (company) =>
              company.env === this.filters.get("env") &&
              company.release_id === this.filters.get("release_id") &&
              company.ticker === this.filters.get("ticker"),
          )
        : null;
    return { data: (row as T | undefined) ?? null, error: null };
  }

  async returns<T>() {
    if (this.table !== "ontology_companies") {
      return { data: [] as T, error: null };
    }
    const rows = companyRows.filter(
      (company) =>
        company.env === this.filters.get("env") &&
        company.release_id === this.filters.get("release_id"),
    );
    return { data: rows as T, error: null };
  }
}

describe("ontology catalog", () => {
  beforeEach(() => {
    process.env.KRW_ONTOLOGY_ENV = "prod";
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: (table: string) => new QueryMock(table),
    } as unknown as ReturnType<typeof getSupabaseAdmin>);
  });

  afterEach(() => {
    process.env.KRW_ONTOLOGY_ENV = ORIGINAL_ENV;
    vi.clearAllMocks();
  });

  it("reads the active catalog release from Supabase", async () => {
    await expect(getActiveOntologyCatalogRelease()).resolves.toMatchObject({
      env: "prod",
      release_id: "20260528_150000",
      active: true,
    });
  });

  it("lists indexed companies from the active Supabase catalog", async () => {
    const companies = await listIndexedCompanies();

    expect(companies).toHaveLength(2);
    expect(companies[0]).toMatchObject({
      ticker: "AAPL",
      name: "Apple Inc.",
      sector: "기술",
      latest_period: "FY2025",
      coverage: "2개 공시 인덱싱 · 10-K, 10-Q · 최신 FY2025",
      core_strength: "Devices, Services",
      critical_risk: "China demand",
      icon: "hub",
    });
  });

  it("normalizes ticker lookups and returns a fallback description", async () => {
    const company = await getIndexedCompany("xom");

    expect(company).toMatchObject({
      ticker: "XOM",
      sector: "에너지",
      description: "Indexed ontology coverage for XOM.",
      document_count: 1,
    });
  });
});
