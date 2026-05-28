import { describe, expect, it } from "vitest";
import {
  getCompanyLandingCopyForTicker,
  hasCompanyLandingCopyForTicker,
  listCompanyLandingCopyTickers,
} from "@/lib/companies/landing-copy";

describe("company landing copy", () => {
  it("detects tickers with curated company copy", () => {
    expect(hasCompanyLandingCopyForTicker(" abbv ")).toBe(true);
    expect(hasCompanyLandingCopyForTicker("UNKNOWN")).toBe(false);
  });

  it("exposes stable curated company tickers for the public sitemap fallback", () => {
    const tickers = listCompanyLandingCopyTickers();

    expect(tickers).toContain("AAPL");
    expect(tickers).toContain("ABBV");
    expect(tickers).toEqual([...tickers].sort());
  });

  it("keeps curated company pages backed by description and prompts", () => {
    const copy = getCompanyLandingCopyForTicker("ABBV");

    expect(copy.companyNameKo).toBe("애브비");
    expect(copy.description).toContain("Immunology");
    expect(copy.core_strength).toContain("리서치 초점");
    expect(copy.critical_risk).toContain("리스크 변수");
    expect(copy.suggested_prompts?.length).toBeGreaterThanOrEqual(3);
  });
});
