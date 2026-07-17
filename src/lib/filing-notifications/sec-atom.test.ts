import { describe, expect, it } from "vitest";
import { parseSecAtomCurrentFeed } from "@/lib/filing-notifications/sec-atom";

describe("SEC Atom current-feed parser", () => {
  it("derives durable CIK and accession metadata from a SEC Archives entry", () => {
    const entries = parseSecAtomCurrentFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>8-K - Apple Inc.</title>
          <updated>2026-07-16T01:02:03-04:00</updated>
          <summary type="html">Filed: 2026-07-16 &amp;lt;b&amp;gt;Material Event&amp;lt;/b&amp;gt;</summary>
          <link href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm" />
        </entry>
      </feed>`, "8-K");

    expect(entries).toEqual([
      expect.objectContaining({
        cik: "0000320193",
        accessionNumber: "0000320193-26-000001",
        formType: "8-K",
        filingDate: "2026-07-16",
        filingDetailUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm",
      }),
    ]);
  });
});
