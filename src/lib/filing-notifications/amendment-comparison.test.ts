import { describe, expect, it } from "vitest";
import { diffFilingText, findAmendedOriginal, originalFormType } from "@/lib/filing-notifications/amendment-comparison";
import type { SecFilingEventRow } from "@/types/database";

function event(overrides: Partial<SecFilingEventRow>): SecFilingEventRow {
  return {
    id: crypto.randomUUID(), cik: "0000320193", ticker: "AAPL", accession_number: "0000320193-26-000001",
    form_type: "8-K", is_amendment: false, filing_date: "2026-06-01", report_date: null, accepted_at: "2026-06-01T12:00:00Z",
    primary_document_name: "main.htm", filing_detail_url: "https://www.sec.gov/Archives/example", primary_document_url: "https://www.sec.gov/Archives/example/main.htm",
    sec_items: [], event_tags: [], primary_event_tag: null, alert_priority: "digest", classification_source: "unclassified", classification_version: 1, source_metadata: {}, first_seen_at: "2026-06-01T12:00:00Z", enrichment_status: "not_requested", analysis_status: "not_requested", analysis_requested_at: null, analysis_completed_at: null, analysis_error: null, created_at: "2026-06-01T12:00:00Z", updated_at: "2026-06-01T12:00:00Z",
    ...overrides,
  };
}

describe("amendment comparison", () => {
  it("matches an original named in amendment text", () => {
    const original = event({ filing_date: "2026-06-01" });
    const amendment = event({ form_type: "8-K/A", is_amendment: true, filing_date: "2026-06-10", accepted_at: "2026-06-10T12:00:00Z" });
    expect(findAmendedOriginal({ amendment, candidates: [original], amendmentText: "This Amendment amends the Form 8-K filed on June 1, 2026." })).toMatchObject({ filing: { id: original.id }, reason: "amendment_text" });
  });

  it("reports plain-text changes without persisting SEC source text", () => {
    const preview = diffFilingText("<p>Alpha</p><p>Beta</p>", "<p>Alpha</p><p>Gamma</p>");
    expect(preview).toMatchObject({ addedLines: 1, removedLines: 1 });
    expect(preview.lines).toEqual(expect.arrayContaining([{ kind: "added", text: "Gamma" }, { kind: "removed", text: "Beta" }]));
  });

  it("keeps the unamended form type", () => {
    expect(originalFormType("6-K/A")).toBe("6-K");
  });
});
