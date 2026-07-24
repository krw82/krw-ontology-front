import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { getRecentCompanyInsiderTransactions } from "./company-insider-transactions";

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

describe("getRecentCompanyInsiderTransactions", () => {
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

  it("returns retained Form 4 facts without Pulse eligibility or user state", async () => {
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
                form_type: "4",
                is_amendment: false,
                filing_date: "2026-07-20",
                occurred_at: "2026-07-20T16:00:00.000Z",
              },
            ],
            error: null,
          });
        }
        if (table === "sec_form4_event_summaries") {
          return query({
            data: [
              {
                filing_event_id: "11111111-1111-4111-8111-111111111111",
                reported_purchase_value: "1250000",
                reported_sale_value: null,
                tenb5_one_status: "yes",
                has_reported_open_market_trade: true,
              },
            ],
            error: null,
          });
        }
        if (table === "sec_form4_reporting_owners") {
          return query({
            data: [
              {
                filing_event_id: "11111111-1111-4111-8111-111111111111",
                reporting_owner_index: 0,
                owner_name: "Jane Director",
                is_director: true,
                is_officer: true,
                is_ten_percent_owner: false,
                is_other: false,
                officer_title: "Chief Executive Officer",
              },
            ],
            error: null,
          });
        }
        if (table === "sec_form4_transactions") {
          return query({
            data: [
              {
                filing_event_id: "11111111-1111-4111-8111-111111111111",
                transaction_date: "2026-07-18",
              },
            ],
            error: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    await expect(getRecentCompanyInsiderTransactions("A")).resolves.toEqual([
      {
        filingEventId: "11111111-1111-4111-8111-111111111111",
        formType: "4",
        isAmendment: false,
        filingDate: "2026-07-20",
        occurredAt: "2026-07-20T16:00:00.000Z",
        transactionDate: "2026-07-18",
        reportedPurchaseValue: 1_250_000,
        reportedSaleValue: null,
        hasReportedOpenMarketTrade: true,
        tenb5OneStatus: "yes",
        owners: [
          {
            name: "Jane Director",
            isDirector: true,
            isOfficer: true,
            isTenPercentOwner: false,
            isOther: false,
            officerTitle: "Chief Executive Officer",
          },
        ],
      },
    ]);
  });

  it("excludes non-market Form 4 records from the company summary", async () => {
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
                id: "22222222-2222-4222-8222-222222222222",
                form_type: "4",
                is_amendment: false,
                filing_date: "2026-07-20",
                occurred_at: "2026-07-20T16:00:00.000Z",
              },
              {
                id: "33333333-3333-4333-8333-333333333333",
                form_type: "4",
                is_amendment: false,
                filing_date: "2026-07-19",
                occurred_at: "2026-07-19T16:00:00.000Z",
              },
            ],
            error: null,
          });
        }
        if (table === "sec_form4_event_summaries") {
          return query({
            data: [
              {
                filing_event_id: "22222222-2222-4222-8222-222222222222",
                reported_purchase_value: null,
                reported_sale_value: null,
                tenb5_one_status: "unknown",
                has_reported_open_market_trade: false,
              },
              {
                filing_event_id: "33333333-3333-4333-8333-333333333333",
                reported_purchase_value: null,
                reported_sale_value: "400000",
                tenb5_one_status: "no",
                has_reported_open_market_trade: true,
              },
            ],
            error: null,
          });
        }
        if (table === "sec_form4_reporting_owners") {
          return query({ data: [], error: null });
        }
        if (table === "sec_form4_transactions") {
          return query({
            data: [
              {
                filing_event_id: "22222222-2222-4222-8222-222222222222",
                transaction_date: "2026-07-20",
              },
              {
                filing_event_id: "33333333-3333-4333-8333-333333333333",
                transaction_date: "2026-07-18",
              },
            ],
            error: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const transactions = await getRecentCompanyInsiderTransactions("A", 3);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      filingEventId: "33333333-3333-4333-8333-333333333333",
      transactionDate: "2026-07-18",
      reportedSaleValue: 400_000,
      hasReportedOpenMarketTrade: true,
    });
  });
});
