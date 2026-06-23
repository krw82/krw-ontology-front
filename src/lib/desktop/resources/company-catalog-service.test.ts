import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ontology/catalog", () => ({
  getActiveOntologyCatalogRelease: vi.fn(),
  getIndexedCompany: vi.fn(),
  listIndexedCompanies: vi.fn(),
}));

import {
  getActiveOntologyCatalogRelease,
  getIndexedCompany,
  listIndexedCompanies,
} from "@/lib/ontology/catalog";
import {
  getDesktopCompany,
  listDesktopCompanies,
} from "./company-catalog-service";

const companies = [
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    sector: "기술",
    description: "Consumer technology company",
    latest_period: "2026Q1",
    coverage: "8개 공시 · 최신 2026Q1",
    core_strength: "서비스 매출",
    critical_risk: "중국 수요",
    icon: "hub",
    document_count: 8,
    document_types: ["10-K", "10-Q"],
    periods: ["2026Q1"],
    documents: [],
    generated_at: "2026-06-20T00:00:00.000Z",
  },
  {
    ticker: "MSFT",
    name: "Microsoft Corporation",
    sector: "기술",
    description: "Cloud and software company",
    latest_period: "2026Q1",
    coverage: "6개 공시 · 최신 2026Q1",
    core_strength: "클라우드",
    critical_risk: "AI 투자 비용",
    icon: "hub",
    document_count: 6,
    document_types: ["10-K", "10-Q"],
    periods: ["2026Q1"],
    documents: [],
    generated_at: "2026-06-20T00:00:00.000Z",
  },
];

describe("Desktop company catalog service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue({
      release_id: "release-1",
      generated_at: "2026-06-20T00:00:00.000Z",
    } as never);
    vi.mocked(listIndexedCompanies).mockResolvedValue(companies as never);
    vi.mocked(getIndexedCompany).mockImplementation(async (ticker) =>
      (companies.find((company) => company.ticker === ticker.toUpperCase()) ??
        null) as never,
    );
  });

  it("returns a compact versioned first page and an opaque cursor", async () => {
    const first = await listDesktopCompanies({ limit: 1 });

    expect(first.payload).toMatchObject({
      ok: true,
      contract_version: "desktop-company-catalog/v1",
      data: {
        companies: [
          {
            ticker: "AAPL",
            display_name: "Apple Inc.",
            localized_name: null,
            coverage_label: "8개 공시 · 최신 2026Q1",
          },
        ],
      },
      meta: {
        catalog_release_id: "release-1",
        returned_count: 1,
        has_more: true,
      },
    });
    expect(first.payload.meta.next_cursor).toEqual(expect.any(String));
    expect(first.etag).toMatch(/^"catalog-/);

    const second = await listDesktopCompanies({
      limit: 1,
      cursor: first.payload.meta.next_cursor,
    });
    expect(second.payload.data.companies[0].ticker).toBe("MSFT");
    expect(second.payload.meta.has_more).toBe(false);
  });

  it("rejects cursors after the active release changes", async () => {
    const first = await listDesktopCompanies({ limit: 1 });
    vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue({
      release_id: "release-2",
      generated_at: "2026-06-21T00:00:00.000Z",
    } as never);

    await expect(
      listDesktopCompanies({ cursor: first.payload.meta.next_cursor }),
    ).rejects.toMatchObject({
      code: "validation_error",
      status: 409,
    });
  });

  it("returns a detail DTO without account or web navigation fields", async () => {
    const result = await getDesktopCompany("aapl");

    expect(result).toMatchObject({
      contract_version: "desktop-company-detail/v1",
      data: {
        company: {
          ticker: "AAPL",
          periods: ["2026Q1"],
          documents: [],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("user_id");
    expect(JSON.stringify(result)).not.toContain("action_href");
  });
});
