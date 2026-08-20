import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const upsert = vi.fn();
const update = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "user_filing_subscriptions") return { upsert, update };
      return { upsert };
    },
  }),
}));
vi.mock("@/lib/filing-notifications/company-identifiers", () => ({
  ensureSecCompanyIdentifier: vi.fn(),
  normalizeFilingTicker: vi.fn(),
}));

import { ensureSecCompanyIdentifier } from "@/lib/filing-notifications/company-identifiers";
import {
  disableFilingSubscription,
  enableFilingSubscription,
} from "./subscription-service";

describe("enableFilingSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureSecCompanyIdentifier).mockResolvedValue({
      cik: "0000320193",
    } as never);
  });

  it("returns on after a successful upsert and poll-state sync", async () => {
    upsert.mockResolvedValue({ data: {}, error: null });
    const result = await enableFilingSubscription({
      userId: "u1",
      ticker: "AAPL",
    });
    expect(result).toEqual({ status: "on" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        ticker: "AAPL",
        cik: "0000320193",
        enabled: true,
        disabled_at: null,
      }),
      { onConflict: "user_id,ticker" },
    );
  });

  it("returns unsupported when the SEC identifier is missing", async () => {
    vi.mocked(ensureSecCompanyIdentifier).mockResolvedValue(null as never);
    const result = await enableFilingSubscription({
      userId: "u1",
      ticker: "XXXX",
    });
    expect(result).toEqual({ status: "unsupported" });
  });

  it("returns error when the upsert fails", async () => {
    upsert.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await enableFilingSubscription({
      userId: "u1",
      ticker: "AAPL",
    });
    expect(result).toEqual({ status: "error" });
  });
});

describe("disableFilingSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables only enabled rows and reports success", async () => {
    update.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    });
    const result = await disableFilingSubscription({
      userId: "u1",
      ticker: "AAPL",
    });
    expect(result).toBe(true);
    expect(update).toHaveBeenCalledWith({
      enabled: false,
      disabled_at: expect.any(String),
    });
  });

  it("reports failure when the update errors", async () => {
    update.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "boom" } }),
        }),
      }),
    });
    const result = await disableFilingSubscription({
      userId: "u1",
      ticker: "AAPL",
    });
    expect(result).toBe(false);
  });
});
