import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildGuruLightCompanyContext,
  getActiveOntologyCatalogRelease,
  getIndexedCompany,
  getIndexedCompanies,
  listIndexedCompanies,
  searchIndexedCompanies,
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
const ORIGINAL_E2E_STATIC_CATALOG = process.env.KRW_E2E_STATIC_CATALOG;
const ORIGINAL_DEV_AUTH_BYPASS = process.env.DEV_AUTH_BYPASS;

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
  source_json: { global_spine_path: "indexes/global_spine.sqlite" },
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
    documents_json: [
      {
        period: "CY2025Q3",
        document_type: "10-Q",
        doc_type_key: "10Q",
        generated_at: "2026-05-28T14:55:00.000Z",
      },
      {
        period: "FY2025",
        document_type: "10-K",
        doc_type_key: "10K",
        generated_at: "2026-05-28T14:50:00.000Z",
      },
    ],
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
  private inFilters = new Map<string, unknown[]>();
  private search: string | null = null;
  private rowLimit: number | null = null;

  constructor(private table: string) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.set(key, value);
    return this;
  }

  in(key: string, values: unknown[]) {
    this.inFilters.set(key, values);
    return this;
  }

  or(filter: string) {
    this.search = filter;
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
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
        company.release_id === this.filters.get("release_id") &&
        (!this.inFilters.has("ticker") ||
          this.inFilters.get("ticker")?.includes(company.ticker)) &&
        (!this.search || this.matchesSearch(company)),
    );
    return {
      data: rows.slice(0, this.rowLimit ?? rows.length) as T,
      error: null,
    };
  }

  private matchesSearch(company: OntologyCompanyRow) {
    const match = this.search?.match(/name\.ilike\.\*([^*]+)\*/);
    const query = match?.[1]?.toLowerCase();
    if (!query) return true;
    return [
      company.ticker,
      company.name,
      company.description ?? "",
      company.sector ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }
}

describe("ontology catalog", () => {
  it("builds neutral Guru company context with trusted anchors only", () => {
    const context = buildGuruLightCompanyContext({
      ticker: "AAPL",
      name: "Apple Inc.",
      sector: "Technology",
      industry: "Consumer electronics",
      description: "Apple designs devices and ecosystem services.",
      primary_activities: ["devices", "ecosystem services"],
      products_or_segments: ["iPhone", "Services"],
      revenue_logic: "Device sales and ecosystem services.",
      latest_period: "CY2026Q1",
      coverage: "coverage",
      icon: "hub",
      document_count: 2,
      document_types: ["10-Q", "10-K"],
      periods: ["CY2026Q1", "CY2025"],
      documents: [
        {
          period: "CY2026Q1",
          document_type: "10-Q",
          doc_type_key: "10Q",
          generated_at: null,
        },
        {
          period: "CY2025",
          document_type: "10-K",
          doc_type_key: "10K",
          generated_at: null,
        },
      ],
      generated_at: null,
      core_strength: "must not reach the Guru question input",
      critical_risk: "must not reach the Guru question input",
    });

    expect(context.contextAnchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ anchorId: "business_description" }),
        expect.objectContaining({ anchorId: "primary_activity_1" }),
        expect.objectContaining({ anchorId: "revenue_logic" }),
      ]),
    );
    expect(JSON.stringify(context)).not.toContain("must not reach");
    expect(context.filingAvailability).toEqual({
      hasCurrentFiling: true,
      hasAnnualBaseline: true,
    });
  });

  beforeEach(() => {
    process.env.KRW_ONTOLOGY_ENV = "prod";
    process.env.KRW_E2E_STATIC_CATALOG = "0";
    process.env.DEV_AUTH_BYPASS = "0";
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: (table: string) => new QueryMock(table),
    } as unknown as ReturnType<typeof getSupabaseAdmin>);
  });

  afterEach(() => {
    process.env.KRW_ONTOLOGY_ENV = ORIGINAL_ENV;
    process.env.KRW_E2E_STATIC_CATALOG = ORIGINAL_E2E_STATIC_CATALOG;
    process.env.DEV_AUTH_BYPASS = ORIGINAL_DEV_AUTH_BYPASS;
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
      documents: [
        {
          period: "CY2025Q3",
          document_type: "10-Q",
          doc_type_key: "10Q",
          generated_at: "2026-05-28T14:55:00.000Z",
        },
        {
          period: "FY2025",
          document_type: "10-K",
          doc_type_key: "10K",
          generated_at: "2026-05-28T14:50:00.000Z",
        },
      ],
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

  it("does not expose placeholder ticker rows from the index", async () => {
    companyRows.push({
      ...companyRows[0],
      ticker: "UNKNOWN",
      name: "Unknown company",
    });

    try {
      const companies = await listIndexedCompanies();

      expect(companies.map((company) => company.ticker)).toEqual([
        "AAPL",
        "XOM",
      ]);
      await expect(getIndexedCompany("UNKNOWN")).resolves.toBeNull();
    } finally {
      companyRows.pop();
    }
  });

  it("batch loads tickers once and preserves requested ticker order", async () => {
    const companies = await getIndexedCompanies([" xom ", "AAPL", "XOM", "MISS"]);

    expect(companies.map((company) => company.ticker)).toEqual(["XOM", "AAPL"]);
  });

  it("searches indexed companies with a bounded DB-side query", async () => {
    const companies = await searchIndexedCompanies({
      query: "apple",
      limit: 1,
    });

    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({
      ticker: "AAPL",
      name: "Apple Inc.",
    });
  });

  it("uses the static E2E catalog across catalog entrypoints", async () => {
    process.env.KRW_E2E_STATIC_CATALOG = "1";
    process.env.DEV_AUTH_BYPASS = "1";
    vi.mocked(getSupabaseAdmin).mockImplementation(() => {
      throw new Error("Supabase should not be used for the static E2E catalog");
    });

    await expect(listIndexedCompanies()).resolves.toMatchObject([
      {
        ticker: "AMZN",
        name: "Amazon.com, Inc.",
        latest_period: "FY2025",
      },
    ]);
    await expect(searchIndexedCompanies({ query: "amazon" })).resolves.toHaveLength(
      1,
    );
    await expect(getIndexedCompanies(["amzn", "aapl"])).resolves.toMatchObject([
      { ticker: "AMZN" },
    ]);
    await expect(getIndexedCompany("amzn")).resolves.toMatchObject({
      ticker: "AMZN",
      document_types: ["10-K"],
    });
  });
});
