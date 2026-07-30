import { describe, expect, it } from "vitest";
import { pulseCompanyHref, pulseCompanyName } from "./company-display";

describe("pulse company display", () => {
  it("prefers the server-provided Korean company name", () => {
    expect(
      pulseCompanyName({
        ticker: "AAPL",
        metadata: { company_name_ko: "애플" },
      }),
    ).toBe("애플");
  });

  it("falls back to the ticker and builds a localized company link", () => {
    expect(pulseCompanyName({ ticker: "NVDA", metadata: {} })).toBe("NVDA");
    expect(pulseCompanyHref("nvda")).toBe("/ko/companies/NVDA");
    expect(pulseCompanyHref(null)).toBeNull();
  });
});
