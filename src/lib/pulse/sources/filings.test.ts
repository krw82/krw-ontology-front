import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFilingCandidates } from "@/lib/pulse/sources/filings";
import type { Database } from "@/types/database";

function filingRow(filingEventId: string, candidateBucket = "preferred") {
  return {
    filing_event_id: filingEventId,
    ticker: "AAPL",
    covered_tickers: ["AAPL"],
    cik: "0000320193",
    accession_number: `0000000000-00-${filingEventId}`,
    form_type: "8-K",
    is_amendment: false,
    filing_date: "2026-07-15",
    report_date: null,
    accepted_at: "2026-07-15T00:00:00.000Z",
    first_seen_at: "2026-07-15T00:00:00.000Z",
    occurred_at: "2026-07-15T00:00:00.000Z",
    feed_available_at: "2026-07-15T00:00:00.000Z",
    feed_expires_at: null,
    feed_lane: 10,
    feed_priority_rank: 1,
    alert_priority: "normal",
    primary_event_tag: "material_agreement",
    sec_items: ["1.01"],
    event_tags: [],
    filing_detail_url: "https://www.sec.gov/Archives/example",
    primary_document_url: null,
    source_metadata: {},
    processing_status: "ready",
    form4_reported_purchase_value: null,
    form4_reported_sale_value: null,
    form4_tenb5_one_status: null,
    form4_has_reported_open_market_trade: null,
    candidate_bucket: candidateBucket,
    filing_brief_headline_ko: null,
    filing_brief_summary_sentences: null,
    filing_brief_facts: null,
    filing_brief_question_suggestions: null,
    filing_brief_source_document_url: null,
    filing_brief_generated_at: null,
  };
}

describe("Pulse filing source", () => {
  it("uses the brief-aware bounded candidate RPC instead of following every global feed page", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name !== "get_catalog_pulse_filing_candidates_v3") throw new Error("unexpected rpc");
      return {
        data: [filingRow("event-1")],
        error: null,
      };
    });
    const supabase = { rpc } as unknown as SupabaseClient<Database>;

    const candidates = await getFilingCandidates(
      supabase,
      new Date("2026-07-15T00:00:00.000Z"),
      ["AAPL"],
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_catalog_pulse_filing_candidates_v3", expect.objectContaining({
      p_preferred_tickers: ["AAPL"],
      p_urgent_limit: 80,
      p_priority_limit: 100,
    }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      item_key: "filing:event-1",
      reason_code: "catalog_sec_filing",
      metadata: { candidate_bucket: "preferred" },
    });
  });

  it("uses a ready source-grounded brief for the card without changing Form 4 behavior", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name !== "get_catalog_pulse_filing_candidates_v3") throw new Error("unexpected rpc");
      return {
        data: [{
          ...filingRow("event-brief"),
          filing_brief_headline_ko: "AAPL 계약 변경 공시",
          filing_brief_summary_sentences: ["회사는 계약 변경 사실을 공시했습니다."],
          filing_brief_facts: [{ fact_ko: "계약 상대방이 명시됐습니다." }],
          filing_brief_question_suggestions: ["계약 변경의 핵심 조항을 원문 기준으로 정리해줘"],
          filing_brief_generated_at: "2026-07-15T01:00:00.000Z",
        }],
        error: null,
      };
    });
    const supabase = { rpc } as unknown as SupabaseClient<Database>;

    const [candidate] = await getFilingCandidates(supabase, new Date("2026-07-15T00:00:00.000Z"));

    expect(candidate?.title).toBe("AAPL 계약 변경 공시");
    expect(candidate?.body).toBe("회사는 계약 변경 사실을 공시했습니다.");
    expect(candidate?.secondary_actions[0]).toMatchObject({ label: "이 요약으로 질문" });
    expect(candidate?.metadata).toMatchObject({ filing_brief_ready: true, filing_brief_fact_count: 1 });
  });
});
