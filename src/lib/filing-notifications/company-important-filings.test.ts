import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { getRecentCompanyImportantFilings } from "./company-important-filings";

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result,
    returns: async () => result,
  };
  return chain;
}

describe("getRecentCompanyImportantFilings", () => {
  const originalFilingWorkerEnv = process.env.FILING_WORKER_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FILING_WORKER_ENV = "prod";
  });

  afterEach(() => {
    if (originalFilingWorkerEnv === undefined) {
      delete process.env.FILING_WORKER_ENV;
    } else {
      process.env.FILING_WORKER_ENV = originalFilingWorkerEnv;
    }
  });

  it("returns recent 8-K and 6-K records without requiring a user subscription", async () => {
    mocks.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "sec_company_identifiers") {
          return query({
            data: { ticker: "A", cik: "0001090872" },
            error: null,
          });
        }
        if (table === "sec_filing_events") {
          return query({
            data: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                form_type: "8-K",
                is_amendment: false,
                filing_date: "2026-07-20",
                occurred_at: "2026-07-20T16:00:00.000Z",
                sec_items: ["2.02", "9.01"],
                primary_event_tag: "earnings_or_financial_results",
              },
              {
                id: "22222222-2222-4222-8222-222222222222",
                form_type: "6-K",
                is_amendment: false,
                filing_date: "2026-07-19",
                occurred_at: "2026-07-19T16:00:00.000Z",
                sec_items: [],
                primary_event_tag: "foreign_issuer_report",
              },
            ],
            error: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    await expect(getRecentCompanyImportantFilings("A")).resolves.toEqual([
      {
        filingEventId: "11111111-1111-4111-8111-111111111111",
        formType: "8-K",
        isAmendment: false,
        filingDate: "2026-07-20",
        occurredAt: "2026-07-20T16:00:00.000Z",
        secItems: ["2.02", "9.01"],
        primaryEventTag: "earnings_or_financial_results",
      },
      {
        filingEventId: "22222222-2222-4222-8222-222222222222",
        formType: "6-K",
        isAmendment: false,
        filingDate: "2026-07-19",
        occurredAt: "2026-07-19T16:00:00.000Z",
        secItems: [],
        primaryEventTag: "foreign_issuer_report",
      },
    ]);
  });

  it("returns no records for an invalid ticker before reading SEC tables", async () => {
    await expect(getRecentCompanyImportantFilings(" ")).resolves.toEqual([]);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });
});
