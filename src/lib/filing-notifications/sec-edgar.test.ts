import { describe, expect, it } from "vitest";
import {
  filingUrls,
  isFilingCandidateWithinLookback,
  normalizeCik,
  parseRecentFilingCandidates,
} from "./sec-edgar";

describe("SEC filing notification parser", () => {
  it("normalizes SEC CIK identifiers", () => {
    expect(normalizeCik(320193)).toBe("0000320193");
    expect(normalizeCik("CIK 320193")).toBe("0000320193");
    expect(normalizeCik("not-a-cik")).toBeNull();
  });

  it("keeps only 8-K and 6-K filing candidates", () => {
    const filings = parseRecentFilingCandidates("0000320193", {
      accessionNumber: ["0000320193-26-000001", "0000320193-26-000002", "0000320193-26-000003"],
      form: ["8-K", "10-Q", "6-K/A"],
      filingDate: ["2026-07-14", "2026-07-13", "2026-07-12"],
      reportDate: ["2026-07-14", "2026-06-30", ""],
      acceptanceDateTime: ["2026-07-14T12:30:00.000Z", "2026-07-13T12:30:00.000Z", "2026-07-12T12:30:00"],
      primaryDocument: ["form8k.htm", "10q.htm", "form6ka.htm"],
      primaryDocDescription: ["Current report", "Quarterly report", "Foreign report"],
      items: ["2.02, 9.01", "", ""],
    });

    expect(filings).toHaveLength(2);
    expect(filings[0]).toMatchObject({
      formType: "8-K",
      isAmendment: false,
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form8k.htm",
      sourceMetadata: { primaryDocDescription: "Current report", secItems: ["2.02", "9.01"] },
    });
    expect(filings[1]).toMatchObject({ formType: "6-K/A", isAmendment: true });
  });

  it("builds SEC archive URLs without a document name", () => {
    expect(filingUrls("0000320193", "0000320193-26-000001", null)).toEqual({
      filingDetailUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.html",
      primaryDocumentUrl: null,
    });
  });

  it("limits catalog baseline candidates to the feed retention window", () => {
    const [candidate] = parseRecentFilingCandidates("0000320193", {
      accessionNumber: ["0000320193-26-000001"],
      form: ["8-K"],
      filingDate: ["2026-07-15"],
      acceptanceDateTime: ["2026-07-15T12:30:00.000Z"],
    });
    expect(candidate).toBeDefined();
    expect(isFilingCandidateWithinLookback(candidate!, new Date("2026-04-17T00:00:00.000Z"))).toBe(true);
    expect(isFilingCandidateWithinLookback(candidate!, new Date("2026-07-16T00:00:00.000Z"))).toBe(false);
  });
});
