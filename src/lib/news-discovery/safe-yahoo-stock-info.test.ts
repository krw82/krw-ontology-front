import { describe, expect, it } from "vitest";
import { buildSafeYahooStockInfo } from "./safe-yahoo-stock-info";

describe("buildSafeYahooStockInfo", () => {
  it("keeps quote, technical, identity, and size fields", () => {
    const safe = buildSafeYahooStockInfo({
      longName: "NVIDIA Corporation",
      shortName: "NVIDIA",
      sector: "Technology",
      industry: "Semiconductors",
      currentPrice: 192.53,
      regularMarketPrice: 192.53,
      previousClose: 195.74,
      regularMarketChangePercent: -1.64,
      volume: 123456,
      averageVolume: 234567,
      fiftyDayAverage: 210.086,
      twoHundredDayAverage: 190.6402,
      fiftyTwoWeekLow: 151.49,
      fiftyTwoWeekHigh: 236.54,
      marketCap: 4663269130240,
      sharesOutstanding: 24221000000,
    });

    expect(safe).toMatchObject({
      schema_version: "safe-yahoo-stock-info/v1",
      identity: {
        longName: "NVIDIA Corporation",
        shortName: "NVIDIA",
        sector: "Technology",
        industry: "Semiconductors",
      },
      quote: {
        currentPrice: 192.53,
        regularMarketPrice: 192.53,
        previousClose: 195.74,
        regularMarketChangePercent: -1.64,
        volume: 123456,
        averageVolume: 234567,
      },
      technical: {
        fiftyDayAverage: 210.086,
        twoHundredDayAverage: 190.6402,
        fiftyTwoWeekLow: 151.49,
        fiftyTwoWeekHigh: 236.54,
      },
      size: {
        marketCap: 4663269130240,
        sharesOutstanding: 24221000000,
      },
    });
  });

  it("excludes valuation, consensus, recommendation, and estimate fields", () => {
    const safe = buildSafeYahooStockInfo({
      currentPrice: 192.53,
      forwardPE: 15.125293,
      trailingPE: 29.48392,
      pegRatio: 0.59,
      trailingPegRatio: 0.5925,
      targetHighPrice: 500,
      targetLowPrice: 180,
      targetMeanPrice: 300.5862,
      targetMedianPrice: 294,
      recommendationMean: 1.29508,
      recommendationKey: "strong_buy",
      numberOfAnalystOpinions: 58,
      earningsGrowth: 2.145,
      revenueGrowth: 0.852,
      priceToBook: 23.857498,
      priceToSalesTrailing12Months: 18.396193,
      enterpriseToRevenue: 18.221,
      enterpriseToEbitda: 27.906,
      grossMargins: 0.74144995,
      operatingMargins: 0.65596,
      profitMargins: 0.62966,
    });

    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain("forwardPE");
    expect(serialized).not.toContain("trailingPE");
    expect(serialized).not.toContain("pegRatio");
    expect(serialized).not.toContain("targetMeanPrice");
    expect(serialized).not.toContain("recommendationKey");
    expect(serialized).not.toContain("numberOfAnalystOpinions");
    expect(serialized).not.toContain("earningsGrowth");
    expect(serialized).not.toContain("revenueGrowth");
    expect(serialized).not.toContain("priceToBook");
    expect(serialized).not.toContain("enterpriseToEbitda");
    expect(serialized).not.toContain("grossMargins");
    expect(safe).toMatchObject({
      quote: {
        currentPrice: 192.53,
      },
    });
  });

  it("drops invalid value types instead of coercing them", () => {
    const safe = buildSafeYahooStockInfo({
      currentPrice: "192.53",
      previousClose: Number.NaN,
      fiftyDayAverage: Infinity,
      marketCap: 4663269130240,
      longName: "  NVIDIA Corporation  ",
      sector: "",
    });

    expect(safe).toMatchObject({
      identity: {
        longName: "NVIDIA Corporation",
      },
      size: {
        marketCap: 4663269130240,
      },
    });
    expect(safe).not.toHaveProperty("quote");
    expect(safe).not.toHaveProperty("technical");
  });
});
