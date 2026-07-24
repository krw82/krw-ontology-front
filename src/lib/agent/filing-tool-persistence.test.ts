import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccumulatedToolCall } from "./stream-handler";
import {
  filingBodyReadSummary,
  redactFilingCitationForPersistence,
  redactFilingToolCallForPersistence,
} from "./filing-tool-persistence";

const RAW_EXHIBIT = "EXHIBIT_SENTINEL This raw SEC attachment must not reach durable logs.";

describe("on-demand filing tool persistence", () => {
  it("keeps Exhibit identity but removes the source body from durable tool-call fields", () => {
    const sourceCall: AccumulatedToolCall = {
      id: "tool-1",
      toolName: "read_filing_document",
      argumentsJson: JSON.stringify({
        filing_event_id: "11111111-1111-4111-8111-111111111111",
        document_key: "document:source",
      }),
      resultSummary: RAW_EXHIBIT,
      resultJson: {
        filing: { filing_event_id: "11111111-1111-4111-8111-111111111111", ticker: "AAPL" },
        document: { document_key: "document:source", document_name: "aapl-ex991.htm", document_type: "EX-99.1" },
        text: RAW_EXHIBIT,
        offset: 0,
        next_offset: null,
        citation: { filing_event_id: "11111111-1111-4111-8111-111111111111", document_url: "https://www.sec.gov/Archives/example.htm", extraction: "deterministic_html" },
      },
      resultText: JSON.stringify({ text: RAW_EXHIBIT }),
      startedAt: "2026-07-22T00:00:00.000Z",
      finishedAt: "2026-07-22T00:00:01.000Z",
      errorMessage: null,
    };

    const persisted = redactFilingToolCallForPersistence(sourceCall);

    expect(persisted.resultText).toBeNull();
    expect(persisted.resultSummary).toBe(filingBodyReadSummary(RAW_EXHIBIT.length));
    expect(persisted.resultJson).toMatchObject({
      source_body_persisted: false,
      body_char_count: RAW_EXHIBIT.length,
      document: { document_name: "aapl-ex991.htm", document_type: "EX-99.1" },
    });
    expect(JSON.stringify(persisted)).not.toContain("EXHIBIT_SENTINEL");
  });

  it("removes on-demand filing quotes from persisted citations without affecting other citations", () => {
    const filingCitation = redactFilingCitationForPersistence({
      object_id: "sec-filing:11111111-1111-4111-8111-111111111111",
      ticker: "AAPL",
      document_type: "current_report",
      period: "2026-01-01",
      section: "EX-99.1",
      quote_text: RAW_EXHIBIT,
      claim_text: "https://www.sec.gov/Archives/example.htm",
      evidence_grade: "high",
      source_quality: "filing_direct",
      trace_json: {
        filing_event_id: "11111111-1111-4111-8111-111111111111",
        extraction: "deterministic_html",
      },
    });
    const nonFilingCitation = redactFilingCitationForPersistence({
      object_id: "object-1",
      ticker: "AAPL",
      document_type: "other",
      period: null,
      section: null,
      quote_text: "Keep this ordinary citation.",
      claim_text: null,
      evidence_grade: null,
      source_quality: null,
      trace_json: null,
    });

    expect(filingCitation.quote_text).toBeNull();
    expect(nonFilingCitation.quote_text).toBe("Keep this ordinary citation.");
  });

  it("ships a legacy-data migration that removes prior filing bodies and quotes", () => {
    const migration = readFileSync(
      "supabase/migrations/20260722183000_redact_on_demand_filing_bodies.sql",
      "utf8",
    );

    expect(migration).toContain("'read_filing_section', 'read_filing_document'");
    expect(migration).toContain("result_text = NULL");
    expect(migration).toContain("source_body_persisted");
    expect(migration).toContain("SET quote_text = NULL");
    expect(migration).toContain("'deterministic_html'");
    expect(migration).toContain("UPDATE public.agent_run_events");
    expect(migration).toContain("'tool_call_end'");
  });
});
