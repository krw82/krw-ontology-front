import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/coverage/activation", () => ({
  tryRecordCoverageActivation: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/filing-notifications/filing-access", () => ({
  resolveFilingAccess: vi.fn(),
  resolveFilingContextTicker: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { getAuthUser } from "@/lib/auth";
import { tryRecordCoverageActivation } from "@/lib/coverage/activation";
import {
  resolveFilingAccess,
  resolveFilingContextTicker,
} from "@/lib/filing-notifications/filing-access";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GET } from "./route";

const eventId = "10000000-0000-4000-8000-000000000001";
const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1/report.htm";

describe("GET /api/out/filings/[eventId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000001",
      email: "user@example.test",
    } as never);
    vi.mocked(resolveFilingAccess).mockResolvedValue({
      subscription: { ticker: "AAPL" },
    } as never);
    vi.mocked(resolveFilingContextTicker).mockResolvedValue("AAPL");
  });

  it("durably records the SEC source before redirecting and re-evaluates activation", async () => {
    const fake = adminForSourceOpen(null);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await GET(
      new NextRequest(`http://localhost/api/out/filings/${eventId}?context_ticker=GOOGL`),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(sourceUrl);
    expect(resolveFilingContextTicker).toHaveBeenCalledWith(
      expect.objectContaining({ requestedTicker: "GOOGL" }),
    );
    expect(fake.upserts).toEqual([
      expect.objectContaining({
        user_id: "20000000-0000-4000-8000-000000000001",
        filing_event_id: eventId,
        ticker: "AAPL",
        last_opened_at: expect.any(String),
      }),
    ]);
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "sec_source_opened",
        userId: "20000000-0000-4000-8000-000000000001",
      }),
    );
    expect(tryRecordCoverageActivation).toHaveBeenCalledWith(
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("does not redirect or claim evidence when the durable write fails", async () => {
    const fake = adminForSourceOpen({ message: "database unavailable" });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const response = await GET(
      new NextRequest(`http://localhost/api/out/filings/${eventId}`),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(503);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(tryRecordCoverageActivation).not.toHaveBeenCalled();
  });
});

function adminForSourceOpen(sourceOpenError: { message: string } | null) {
  const upserts: Array<Record<string, unknown>> = [];
  const filing = {
    id: eventId,
    ticker: "AAPL",
    filing_detail_url: sourceUrl,
    primary_document_url: sourceUrl,
  };
  const admin = {
    from(table: string) {
      if (table === "user_filing_source_opens") {
        return {
          upsert(payload: Record<string, unknown>) {
            upserts.push(payload);
            return Promise.resolve({ data: null, error: sourceOpenError });
          },
        };
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: filing, error: null }),
      };
      return builder;
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
  return { admin, upserts };
}
