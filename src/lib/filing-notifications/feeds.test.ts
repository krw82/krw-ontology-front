import { describe, expect, it } from "vitest";
import { buildExpectedFilingIcs, buildPrivateFilingRss } from "@/lib/filing-notifications/feeds";
import type { SecFilingEventRow } from "@/types/database";

const filing = {
  id: "4c2d8a26-e4b9-4e1a-b6ca-178b7c59c8d9", ticker: "AAPL", display_ticker: "AAPL", cik: "0000320193", accession_number: "0000320193-26-000001", form_type: "8-K", is_amendment: false, filing_date: "2026-07-15", report_date: null, accepted_at: "2026-07-15T12:00:00Z", primary_document_name: null, filing_detail_url: "https://www.sec.gov/Archives/example", primary_document_url: null, source_metadata: {}, first_seen_at: "2026-07-15T12:00:00Z", sec_items: [], event_tags: [], primary_event_tag: "earnings_or_financial_results", classification_source: "unclassified", classification_version: 1, alert_priority: "normal", enrichment_status: "not_requested", analysis_status: "not_requested", analysis_requested_at: null, analysis_completed_at: null, analysis_error: null, created_at: "2026-07-15T12:00:00Z", updated_at: "2026-07-15T12:00:00Z",
} satisfies SecFilingEventRow & { display_ticker: string };

describe("private filing feeds", () => {
  it("keeps RSS links inside the filing detail surface", () => {
    expect(buildPrivateFilingRss({ origin: "https://krwo.example", events: [filing] })).toContain("https://krwo.example/filings/4c2d8a26-e4b9-4e1a-b6ca-178b7c59c8d9");
  });

  it("labels ICS events as expected windows", () => {
    expect(buildExpectedFilingIcs({ origin: "https://krwo.example", windows: [{ ticker: "AAPL", window: { startDate: "2026-09-29", endDate: "2026-10-19", basis: "historical_earnings_cadence", observedFilings: 3, medianIntervalDays: 91 } }] })).toContain("AAPL 실적성 공시 예상 창");
  });
});
