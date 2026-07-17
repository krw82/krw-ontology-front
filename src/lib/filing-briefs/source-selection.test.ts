import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  boundSourceSections,
  createFilingBriefEvidence,
  isVerifiedFilingDocumentUrl,
  renderFilingBriefEvidenceInput,
  selectFilingBriefSections,
} from "./source-selection";

describe("filing brief source selection", () => {
  it("prefers the disclosed SEC Item and keeps source input within a hard bound", () => {
    const selected = selectFilingBriefSections({
      parsed: {
        normalizedText: "",
        normalizedTextLength: 0,
        truncated: false,
        sections: [
          { key: "item:1.01", heading: "Item 1.01", itemCode: "1.01", text: "A".repeat(8_000), kind: "sec_item", confidence: "exact" },
          { key: "item:2.02", heading: "Item 2.02", itemCode: "2.02", text: "B".repeat(9_000), kind: "sec_item", confidence: "exact" },
        ],
      },
      secItems: ["1.01"],
      documentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form8k.htm",
    });

    const bounded = boundSourceSections(selected.sections, 4_000);
    expect(selected.sections.map((section) => section.key)).toEqual(["item:1.01"]);
    expect(bounded.input.length).toBeLessThanOrEqual(4_000);
    expect(bounded.truncated).toBe(true);
  });

  it("accepts only the numeric SEC CIK archive path for the filing accession", () => {
    const filing = { cik: "0000320193", accession_number: "0000320193-26-000001" };
    expect(isVerifiedFilingDocumentUrl(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form8k.htm",
      filing,
    )).toBe(true);
    expect(isVerifiedFilingDocumentUrl(
      "https://www.sec.gov/Archives/edgar/data/0000320193/000032019326000001/form8k.htm",
      filing,
    )).toBe(false);
    expect(isVerifiedFilingDocumentUrl(
      "https://evil.example/Archives/edgar/data/320193/000032019326000001/form8k.htm",
      filing,
    )).toBe(false);
  });

  it("turns selected source text into bounded, exact evidence fragments", () => {
    const sections = [{
      key: "item:2.02",
      heading: "Item 2.02",
      text: "First source sentence. Second source sentence with more detail. ".repeat(40),
      documentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form8k.htm",
    }];
    const evidence = createFilingBriefEvidence(sections);
    const input = renderFilingBriefEvidenceInput(sections, evidence);

    expect(evidence.length).toBeGreaterThan(1);
    expect(evidence.every((fragment) => fragment.text.length >= 12 && fragment.text.length <= 600)).toBe(true);
    expect(evidence.every((fragment) => fragment.sectionKey === "item:2.02" && sections[0]?.text.includes(fragment.text))).toBe(true);
    expect(input).toContain("[EVIDENCE e1]");
  });
});
