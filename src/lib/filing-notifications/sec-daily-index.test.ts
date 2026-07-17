import { describe, expect, it } from "vitest";
import { dailyMasterIndexUrl, parseSecDailyMasterIndex } from "@/lib/filing-notifications/sec-daily-index";

describe("SEC daily master index", () => {
  it("builds the SEC quarter path and keeps only tracked forms", () => {
    expect(dailyMasterIndexUrl(new Date("2026-07-15T12:00:00Z"))).toBe(
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/master.20260715.idx",
    );
    const filings = parseSecDailyMasterIndex([
      "CIK|Company Name|Form Type|Date Filed|Filename",
      "320193|APPLE INC|8-K|2026-07-15|edgar/data/320193/000032019326000001/main.htm",
      "320193|APPLE INC|10-Q|2026-07-15|edgar/data/320193/000032019326000002/q.htm",
    ].join("\n"));
    expect(filings).toEqual([expect.objectContaining({
      cik: "0000320193",
      accessionNumber: "0000320193-26-000001",
      formType: "8-K",
    })]);
  });
});
