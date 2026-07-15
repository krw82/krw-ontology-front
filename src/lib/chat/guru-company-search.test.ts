import { describe, expect, it } from "vitest";

import { filterGuruCompanies } from "./guru-company-search";

const companies = [
  {
    ticker: "ACME",
    name: "Acme Systems",
    companyNameKo: "애크미 시스템즈",
    sector: "Technology",
    description: "Enterprise software",
  },
  {
    ticker: "BRAVO",
    name: "Bravo Retail",
    sector: "Consumer",
  },
];

describe("filterGuruCompanies", () => {
  it("returns all companies for a blank query", () => {
    expect(filterGuruCompanies(companies, "  ", "en")).toEqual(companies);
  });

  it("matches a ticker, localized company name, and descriptive metadata", () => {
    expect(filterGuruCompanies(companies, "acme", "en")).toEqual([
      companies[0],
    ]);
    expect(filterGuruCompanies(companies, "애크미", "ko")).toEqual([
      companies[0],
    ]);
    expect(filterGuruCompanies(companies, "enterprise software", "en")).toEqual([
      companies[0],
    ]);
  });
});
