import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveFilingContextTicker } from "./filing-access";

const filing = {
  id: "10000000-0000-4000-8000-000000000001",
  env: "prod",
  ticker: "GOOG",
  cik: "0001652044",
} as const;

describe("resolveFilingContextTicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps an existing judgment ticker immutable", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({ judgmentTicker: "GOOGL", sourceOpenTicker: "GOOG" }),
    );

    await expect(
      resolveFilingContextTicker({
        userId: "20000000-0000-4000-8000-000000000001",
        filing,
        requestedTicker: "GOOG",
      }),
    ).resolves.toBe("GOOGL");
  });

  it("uses the only active covered share class over stale canonical context", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        sourceOpenTicker: "GOOG",
        coveredTickers: ["GOOG", "GOOGL"],
        activeTickers: ["GOOGL"],
      }),
    );

    await expect(
      resolveFilingContextTicker({
        userId: "20000000-0000-4000-8000-000000000001",
        filing,
        access: {
          source: "subscription",
          subscription: { ticker: "GOOG" } as never,
          notification: null,
        },
      }),
    ).resolves.toBe("GOOGL");
  });

  it("honors a validated requested share class when both are active", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        coveredTickers: ["GOOG", "GOOGL"],
        activeTickers: ["GOOG", "GOOGL"],
      }),
    );

    await expect(
      resolveFilingContextTicker({
        userId: "20000000-0000-4000-8000-000000000001",
        filing,
        requestedTicker: "GOOGL",
      }),
    ).resolves.toBe("GOOGL");
  });

  it("rejects an unrelated requested ticker", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        coveredTickers: ["GOOG", "GOOGL"],
        activeTickers: ["GOOG", "GOOGL"],
      }),
    );

    await expect(
      resolveFilingContextTicker({
        userId: "20000000-0000-4000-8000-000000000001",
        filing,
        requestedTicker: "MSFT",
      }),
    ).rejects.toThrow("invalid_filing_context_ticker");
  });
});

function fakeAdmin(options: {
  judgmentTicker?: string | null;
  sourceOpenTicker?: string | null;
  coveredTickers?: string[];
  activeTickers?: string[];
}) {
  const admin = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        maybeSingle: () => {
          if (table === "user_filing_judgments") {
            return Promise.resolve({
              data: options.judgmentTicker
                ? { ticker: options.judgmentTicker }
                : null,
              error: null,
            });
          }
          if (table === "user_filing_source_opens") {
            return Promise.resolve({
              data: options.sourceOpenTicker
                ? { ticker: options.sourceOpenTicker }
                : null,
              error: null,
            });
          }
          if (table === "ontology_catalog_releases") {
            return Promise.resolve({
              data: { release_id: "release-1" },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        returns: () => {
          if (table === "ontology_companies") {
            return Promise.resolve({
              data: (options.coveredTickers ?? ["GOOG", "GOOGL"]).map(
                (ticker) => ({ ticker }),
              ),
              error: null,
            });
          }
          if (table === "user_company_marks") {
            return Promise.resolve({
              data: (options.activeTickers ?? []).map((ticker) => ({
                ticker,
                coverage_status: "watching",
              })),
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
  return admin as unknown as ReturnType<typeof getSupabaseAdmin>;
}
