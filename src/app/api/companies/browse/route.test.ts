import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompanyBrowseCatalog: vi.fn(),
}));
vi.mock("@/content/companies/display", () => ({
  getCompanyDisplayCopyForTicker: vi.fn(() => ({
    companyNameKo: "애플",
    core_strength: "기기와 서비스",
  })),
}));

import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";
import { getIndexedCompanyBrowseCatalog } from "@/lib/ontology/catalog";
import { GET } from "./route";

describe("GET /api/companies/browse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getIndexedCompanyBrowseCatalog).mockResolvedValue({
      release_id: "release-2026-07-20",
      generated_at: "2026-07-20T00:00:00.000Z",
      companies: [
        {
          ticker: "AAPL",
          name: "Apple Inc.",
          sector: "Technology",
          description: "Devices and services.",
          latest_period: "CY2026Q1",
          coverage: "2개 공시 인덱싱 · 10-Q",
          document_count: 2,
          document_types: ["10-Q"],
          periods: ["CY2026Q1"],
          generated_at: "2026-07-20T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns a localized, private browse read model with diagnostics", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/companies/browse?locale=ko"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("server-timing")).toContain("catalog");
    expect(Number(response.headers.get("x-krw-payload-bytes"))).toBeGreaterThan(0);
    await expect(response.json()).resolves.toMatchObject({
      release_id: "release-2026-07-20",
      companies: [
        {
          ticker: "AAPL",
          companyNameKo: "애플",
          core_strength: "기기와 서비스",
        },
      ],
    });
    expect(getCompanyDisplayCopyForTicker).toHaveBeenCalledWith("ko", "AAPL");
  });

  it("uses the default locale for an invalid locale parameter", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/companies/browse?locale=invalid"),
    );

    expect(response.status).toBe(200);
    expect(getCompanyDisplayCopyForTicker).toHaveBeenCalledWith("ko", "AAPL");
  });

  it("returns a bounded service error when the shared read model is unavailable", async () => {
    vi.mocked(getIndexedCompanyBrowseCatalog).mockRejectedValueOnce(
      new Error("catalog unavailable"),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/companies/browse"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error" },
    });
  });
});
