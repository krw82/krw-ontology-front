import { describe, expect, it } from "vitest";
import { expectedFilingWindow, summarizeFilingTimeline } from "@/lib/filing-notifications/filing-timeline";
import type { SecFilingEventRow } from "@/types/database";

function event(overrides: Partial<SecFilingEventRow>): SecFilingEventRow {
  return {
    id: crypto.randomUUID(), ticker: "AAPL", cik: "0000320193", accession_number: "0000320193-26-000001", form_type: "8-K", is_amendment: false,
    filing_date: "2026-01-01", report_date: null, accepted_at: "2026-01-01T12:00:00Z", primary_document_name: null, filing_detail_url: "https://www.sec.gov/Archives/example", primary_document_url: null,
    source_metadata: {}, first_seen_at: "2026-01-01T12:00:00Z", sec_items: [], event_tags: [], primary_event_tag: null, classification_source: "unclassified", classification_version: 1, alert_priority: "digest", enrichment_status: "not_requested", analysis_status: "not_requested", analysis_requested_at: null, analysis_completed_at: null, analysis_error: null, created_at: "2026-01-01T12:00:00Z", updated_at: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

describe("filing timeline", () => {
  it("uses recurring earnings filings to expose a labelled expected window", () => {
    const events = [event({ filing_date: "2026-07-10", accepted_at: "2026-07-10T12:00:00Z", primary_event_tag: "earnings_or_financial_results" }), event({ filing_date: "2026-04-10", accepted_at: "2026-04-10T12:00:00Z", primary_event_tag: "earnings_or_financial_results" })];
    expect(expectedFilingWindow(events, new Date("2026-07-15T00:00:00Z"))).toMatchObject({ startDate: "2026-09-29", endDate: "2026-10-19", medianIntervalDays: 91 });
  });

  it("groups timeline events without inferring investment importance", () => {
    expect(summarizeFilingTimeline([event({ primary_event_tag: "earnings_or_financial_results" }), event({ primary_event_tag: "earnings_or_financial_results" }), event({ primary_event_tag: "leadership_or_board_change" })])).toEqual([{ tag: "earnings_or_financial_results", count: 2 }, { tag: "leadership_or_board_change", count: 1 }]);
  });
});
