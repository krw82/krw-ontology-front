import { describe, expect, it, vi } from "vitest";
import type * as LandingCopyModule from "@/lib/companies/landing-copy";

const mocks = vi.hoisted(() => ({
  hasCompanyLandingCopyForTicker: vi.fn<(ticker: string) => boolean>(),
  listCompanyLandingCopyTickers: vi.fn<() => string[]>(),
  listIndexedCompanies: vi.fn(),
}));

vi.mock("@/lib/companies/landing-copy", async (importOriginal) => {
  const actual = await importOriginal<typeof LandingCopyModule>();

  return {
    ...actual,
    hasCompanyLandingCopyForTicker: mocks.hasCompanyLandingCopyForTicker,
    listCompanyLandingCopyTickers: mocks.listCompanyLandingCopyTickers,
  };
});

vi.mock("@/lib/ontology/catalog", () => ({
  listIndexedCompanies: mocks.listIndexedCompanies,
}));

import sitemap from "./sitemap";

describe("sitemap", () => {
  it("keeps question graph pages out of search sitemap", async () => {
    mocks.listIndexedCompanies.mockResolvedValue([]);
    mocks.hasCompanyLandingCopyForTicker.mockReturnValue(false);
    mocks.listCompanyLandingCopyTickers.mockReturnValue([]);

    const urls = await sitemap();
    const paths = urls.map((item) => new URL(item.url).pathname);

    expect(paths).toContain("/ko");
    expect(paths).toContain("/en");
    expect(paths).toContain("/ko/companies");
    expect(paths).toContain("/en/companies");
    expect(paths).not.toContain("/ko/questions");
    expect(paths).not.toContain("/en/questions");
    expect(paths.some((path) => path.includes("/questions/"))).toBe(false);
    expect(
      urls.find((item) => new URL(item.url).pathname === "/ko")?.alternates
        ?.languages,
    ).toMatchObject({
      ko: "https://krwontology.com/ko",
      en: "https://krwontology.com/en",
    });
  });

  it("only includes company pages backed by curated landing copy", async () => {
    mocks.listIndexedCompanies.mockResolvedValue([
      {
        ticker: "AAPL",
        generated_at: "2026-05-20T00:00:00.000Z",
      },
      {
        ticker: "WMT",
        generated_at: "2026-05-20T00:00:00.000Z",
      },
    ]);
    mocks.hasCompanyLandingCopyForTicker.mockImplementation(
      (ticker) => ticker === "AAPL",
    );
    mocks.listCompanyLandingCopyTickers.mockReturnValue(["AAPL"]);

    const urls = await sitemap();
    const paths = urls.map((item) => new URL(item.url).pathname);

    expect(paths).toContain("/ko/companies/AAPL");
    expect(paths).toContain("/en/companies/AAPL");
    expect(paths).not.toContain("/ko/companies/WMT");
    expect(paths).not.toContain("/en/companies/WMT");
  });

  it("falls back to curated company landing pages when the indexed catalog is unavailable", async () => {
    mocks.listIndexedCompanies.mockResolvedValue([]);
    mocks.hasCompanyLandingCopyForTicker.mockReturnValue(false);
    mocks.listCompanyLandingCopyTickers.mockReturnValue(["AAPL", "MSFT"]);

    const urls = await sitemap();
    const paths = urls.map((item) => new URL(item.url).pathname);

    expect(paths).toContain("/ko/companies/AAPL");
    expect(paths).toContain("/en/companies/AAPL");
    expect(paths).toContain("/ko/companies/MSFT");
    expect(paths).toContain("/en/companies/MSFT");
  });
});
