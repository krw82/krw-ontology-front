import { describe, expect, it } from "vitest";

import { buildFilingBriefPrompt } from "./prompt";

describe("filing brief prompt", () => {
  it("requires deterministic evidence identifiers instead of model-copied SEC quotes", () => {
    const prompt = buildFilingBriefPrompt({
      filingEventId: "11111111-1111-4111-8111-111111111111",
      ticker: "VLO",
      formType: "8-K",
      filingDate: "2026-07-16",
      sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1/1/doc.htm",
      sourceSha256: "a".repeat(64),
      sourceSections: [],
      sourceEvidence: [],
      input: "[SECTION item:7.01 | Item 7.01 | https://www.sec.gov/Archives/edgar/data/1/1/doc.htm]\\n[EVIDENCE e1] Example source.",
      inputCharCount: 100,
      sourceTruncated: false,
    });

    expect(prompt.system).toContain("facts[].evidence_id");
    expect(prompt.system).toContain("Do not return a section_key or source_quote field");
    expect(prompt.system).not.toContain("literal contiguous English source text");
  });
});
