import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSecText: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  reserveSecRequestSlot: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));
vi.mock("@/lib/filing-notifications/sec-client", () => ({
  fetchSecText: mocks.fetchSecText,
  SecRequestError: class SecRequestError extends Error {
    code = "request_failed";
  },
}));
vi.mock("@/lib/filing-notifications/sec-request-limiter", () => ({
  reserveSecRequestSlot: mocks.reserveSecRequestSlot,
}));

import {
  getFilingBrief,
  getForm4InsiderTransactions,
  isVerifiedFilingDocumentUrl,
  listFilingDocuments,
  readFilingDocument,
  readFilingSection,
} from "./on-demand-filing-reader";

const NARRATIVE_FILING = {
  id: "11111111-1111-4111-8111-111111111111",
  env: "prod",
  ticker: "AAPL",
  cik: "0000320193",
  accession_number: "0000320193-26-000001",
  form_type: "8-K",
  filing_date: "2026-01-01",
  report_date: null,
  accepted_at: "2026-01-01T12:00:00.000Z",
  sec_items: ["2.02"],
  event_tags: ["earnings"],
  filing_detail_url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm",
  primary_document_url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20260101.htm",
  primary_document_name: "aapl-20260101.htm",
  enrichment_status: "completed",
};

const FORM4_FILING = {
  ...NARRATIVE_FILING,
  id: "22222222-2222-4222-8222-222222222222",
  ticker: "HOOD",
  form_type: "4",
};

const FILING_BRIEF = {
  filing_event_id: NARRATIVE_FILING.id,
  locale: "ko-KR",
  headline_ko: "Apple이 새 계약 체결을 공시했습니다",
  summary_sentences: ["공시는 Example Corp와의 최종 계약 체결 사실을 설명합니다."],
  facts: [{
    fact_ko: "최종 계약 체결 사실이 공시에 기재됐습니다.",
    section_key: "item:1.01",
    source_quote: "entered into a definitive agreement",
    section_heading: "Item 1.01",
    source_document_url: NARRATIVE_FILING.primary_document_url,
  }],
  question_suggestions: ["계약의 주요 조건을 원문 기준으로 정리해줘"],
  uncertainty_notes: [],
  source_document_url: NARRATIVE_FILING.primary_document_url,
  source_section_keys: ["item:1.01"],
  source_truncated: false,
  generator_model: "deepseek-v4-flash",
  prompt_version: "filing-brief-ko-v1",
  schema_version: 1,
  generated_at: "2026-01-01T12:01:00.000Z",
};

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result,
    returns: async () => result,
  };
  return chain;
}

function mockAdmin(
  filing: typeof NARRATIVE_FILING | typeof FORM4_FILING,
  brief: typeof FILING_BRIEF | null = null,
) {
  mocks.getSupabaseAdmin.mockReturnValue({
    from: (table: string) => {
      if (table === "sec_filing_events") return query({ data: filing, error: null });
      if (table === "sec_filing_briefs") return query({ data: brief, error: null });
      if (table === "ontology_catalog_releases") return query({ data: { release_id: "release-1" }, error: null });
      if (table === "sec_filing_event_catalog_coverage") return query({ data: { filing_event_id: filing.id }, error: null });
      if (table === "sec_filing_documents") {
        return query({
          data: [{
            filing_event_id: filing.id,
            document_name: filing.primary_document_name,
            document_url: filing.primary_document_url,
            is_primary: true,
          }],
          error: null,
        });
      }
      if (table === "sec_form4_event_summaries") return query({ data: null, error: null });
      if (table === "sec_form4_reporting_owners") return query({ data: [], error: null });
      if (table === "sec_form4_transactions") return query({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    },
  });
}

describe("isVerifiedFilingDocumentUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserveSecRequestSlot.mockResolvedValue(new Date());
  });

  const filing = { cik: "0000320193", accession_number: "0000320193-26-000001" };

  it("accepts only a primary-document URL under the filing's SEC archive directory", () => {
    expect(isVerifiedFilingDocumentUrl(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20260101.htm",
      filing,
    )).toBe(true);
  });

  it("rejects a different archive filing and non-SEC hosts", () => {
    expect(isVerifiedFilingDocumentUrl(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/aapl.htm",
      filing,
    )).toBe(false);
    expect(isVerifiedFilingDocumentUrl(
      "https://example.com/Archives/edgar/data/320193/000032019326000001/aapl.htm",
      filing,
    )).toBe(false);
  });

  it("marks an on-demand 8-K section citation as deterministic HTML extraction", async () => {
    mockAdmin(NARRATIVE_FILING);
    mocks.fetchSecText.mockResolvedValue(`
      <html><body>
        <h1>Item 2.02 Results of Operations and Financial Condition</h1>
        <p>Revenue increased for the reported period.</p>
      </body></html>
    `);

    const result = await readFilingSection({
      filingEventId: NARRATIVE_FILING.id,
      sectionKey: "document:primary",
      maxChars: 1_000,
    });

    expect(result.citation.extraction).toBe("deterministic_html");
    expect(result.text).toContain("Revenue increased");
    expect(mocks.fetchSecText).toHaveBeenCalledOnce();
  });

  it("lists and reads only a verified text Exhibit from the selected filing index", async () => {
    const filing = {
      ...NARRATIVE_FILING,
      id: "33333333-3333-4333-8333-333333333333",
    };
    mockAdmin(filing);
    const exhibitUrl = "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-ex991.htm";
    mocks.fetchSecText.mockImplementation(async (url: string) => {
      if (url === filing.filing_detail_url) {
        return `<table>
          <tr><td>1</td><td>8-K</td><td><a href="aapl-20260101.htm">aapl-20260101.htm</a></td><td>8-K</td><td>1234</td></tr>
          <tr><td>2</td><td>Earnings results press release</td><td><a href="aapl-ex991.htm">aapl-ex991.htm</a></td><td>EX-99.1</td><td>4321</td></tr>
          <tr><td>3</td><td>PDF exhibit</td><td><a href="aapl-ex991.pdf">aapl-ex991.pdf</a></td><td>EX-99.2</td><td>2000</td></tr>
          <tr><td>4</td><td>Wrong accession</td><td><a href="/Archives/edgar/data/320193/000032019325000001/other.htm">other.htm</a></td><td>EX-99.3</td><td>2000</td></tr>
        </table>`;
      }
      if (url === exhibitUrl) {
        return "<html><body><h1>Apple Results</h1><p>EXHIBIT_SENTINEL Revenue increased.</p></body></html>";
      }
      throw new Error(`Unexpected SEC URL: ${url}`);
    });

    const listed = await listFilingDocuments(filing.id);
    const exhibit = listed.documents.find((document) => document.document_type === "EX-99.1");
    const pdf = listed.documents.find((document) => document.document_type === "EX-99.2");

    expect(exhibit).toMatchObject({
      document_name: "aapl-ex991.htm",
      document_url: exhibitUrl,
      readable: true,
    });
    expect(exhibit?.document_key).toMatch(/^document:/);
    expect(pdf).toMatchObject({ readable: false });
    expect(listed.documents).not.toContainEqual(expect.objectContaining({ document_name: "other.htm" }));

    const result = await readFilingDocument({
      filingEventId: filing.id,
      documentKey: exhibit?.document_key ?? "document:missing",
      maxChars: 1_000,
    });

    expect(result.text).toContain("EXHIBIT_SENTINEL Revenue increased");
    expect(result.citation).toMatchObject({
      document_url: exhibitUrl,
      document_name: "aapl-ex991.htm",
      document_type: "EX-99.1",
      extraction: "deterministic_html",
    });
    expect(mocks.fetchSecText).toHaveBeenCalledTimes(2);

    await expect(readFilingDocument({
      filingEventId: filing.id,
      documentKey: "document:not-in-the-index",
    })).rejects.toMatchObject({ code: "document_not_found" });
    expect(mocks.fetchSecText).toHaveBeenCalledTimes(2);
  });

  it("marks stored Form 4 facts as structured Form 4 extraction", async () => {
    mockAdmin(FORM4_FILING);

    const result = await getForm4InsiderTransactions(FORM4_FILING.id);

    expect(result.source).toBe("stored_structured_form4_facts");
    expect(result.citation.extraction).toBe("stored_structured_form4");
    expect(mocks.fetchSecText).not.toHaveBeenCalled();
  });

  it("returns a validated stored brief without fetching an SEC document", async () => {
    mockAdmin(NARRATIVE_FILING, FILING_BRIEF);

    const result = await getFilingBrief(NARRATIVE_FILING.id);

    expect(result).toMatchObject({
      status: "ready",
      machine_generated: true,
      brief: { headline_ko: FILING_BRIEF.headline_ko },
    });
    expect(result.note).toContain("not an investment conclusion");
    expect(mocks.fetchSecText).not.toHaveBeenCalled();
  });
});
