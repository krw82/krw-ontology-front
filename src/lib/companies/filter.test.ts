import { describe, expect, it } from "vitest";
import { filterAndSortCompanies } from "@/lib/companies/filter";

const companies = [
  {
    ticker: "MSFT",
    name: "Technology",
    description: "Cloud services and software",
    coverage: "latest FY2025",
    core_strength: "Azure cloud services",
    critical_risk: "regulatory approval",
  },
  {
    ticker: "AMZN",
    name: "Technology",
    description: "Retail marketplace and AWS",
    coverage: "latest FY2025",
    core_strength: "Fulfillment operations",
    critical_risk: "foreign exchange rate",
  },
  {
    ticker: "CVX",
    name: "Energy",
    description: "Integrated oil and gas",
    coverage: "latest FY2025",
    core_strength: "Upstream production",
    critical_risk: "crude oil price",
  },
];

describe("filterAndSortCompanies", () => {
  it("filters against ticker, description, coverage, activity, and risk text", () => {
    expect(
      filterAndSortCompanies(companies, "foreign exchange", "relevance").map(
        (company) => company.ticker,
      ),
    ).toEqual(["AMZN"]);

    expect(
      filterAndSortCompanies(companies, "cloud", "relevance").map(
        (company) => company.ticker,
      ),
    ).toEqual(["MSFT"]);
  });

  it("sorts by ticker without mutating the original company order", () => {
    const sorted = filterAndSortCompanies(companies, "", "ticker").map(
      (company) => company.ticker,
    );

    expect(sorted).toEqual(["AMZN", "CVX", "MSFT"]);
    expect(companies.map((company) => company.ticker)).toEqual([
      "MSFT",
      "AMZN",
      "CVX",
    ]);
  });

  it("hides placeholder tickers from company results", () => {
    const unknownCompany = {
      ...companies[0],
      ticker: "UNKNOWN",
      name: "Unknown company",
    };

    expect(
      filterAndSortCompanies([...companies, unknownCompany], "", "ticker").map(
        (company) => company.ticker,
      ),
    ).toEqual(["AMZN", "CVX", "MSFT"]);
  });
});
