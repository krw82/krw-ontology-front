import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    orderCalls: [] as Array<[string, Record<string, unknown> | undefined]>,
  };
  // Chainable PostgREST-style builder: .from().select().gt().order()...limit()
  const builder: Record<string, unknown> = {
    from: () => builder,
    select: () => builder,
    gt: () => builder,
    order: (column: string, options?: Record<string, unknown>) => {
      state.orderCalls.push([column, options]);
      return builder;
    },
    limit: () => ({ data: state.rows, error: null }),
  };
  return {
    state,
    getSupabaseAdmin: () => ({ from: () => builder }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: db.getSupabaseAdmin,
}));

import { GET } from "./route";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/valuation/summary", {
    headers,
  });
}

interface SummaryPayload {
  generated_at: string | null;
  count: number;
  valuations: Array<{
    ticker: string;
    pe_ttm: number | null;
    computed_at: string | null;
  }>;
}

function snapshotRow(
  ticker: string,
  fields: Partial<Record<string, string | number | null>> = {},
): Record<string, unknown> {
  return {
    ticker,
    market_cap: null,
    pe_ttm: null,
    pb: null,
    roe_ttm: null,
    roic_ttm: null,
    fundamental_period_end: null,
    computed_at: null,
    ...fields,
  };
}

describe("GET /api/valuation/summary", () => {
  beforeEach(() => {
    db.state.rows = [];
    db.state.orderCalls = [];
  });

  it("returns the latest row per ticker with a 200 payload", async () => {
    db.state.rows = [
      snapshotRow("AAPL", { pe_ttm: 35.2, computed_at: "2026-08-27T01:00:00Z" }),
      snapshotRow("MSFT", { pe_ttm: 30.1, computed_at: "2026-08-28T09:00:00Z" }),
    ];

    const response = await GET(request());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SummaryPayload;
    expect(payload.count).toBe(2);
    expect(payload.valuations.map((row) => row.ticker)).toEqual([
      "AAPL",
      "MSFT",
    ]);
  });

  it("orders snapshots by session_date before computed_at like the valuation repository", async () => {
    db.state.rows = [];

    await GET(request());

    expect(db.state.orderCalls).toEqual([
      ["session_date", { ascending: false, nullsFirst: false }],
      ["computed_at", { ascending: false }],
    ]);
  });

  it("keeps the compound-order winner when a ticker has a backfilled row", async () => {
    // Newest session_date first even though its computed_at is older: the
    // repository treats session_date as the primary freshness key, so a
    // same-session recompute must not lose to an older-session backfill.
    db.state.rows = [
      snapshotRow("AAPL", {
        pe_ttm: 35.2,
        session_date: "2026-08-28",
        computed_at: "2026-08-27T01:00:00Z",
      }),
      snapshotRow("AAPL", {
        pe_ttm: 25,
        session_date: "2026-08-01",
        computed_at: "2026-08-28T09:00:00Z",
      }),
    ];

    const response = await GET(request());

    const payload = (await response.json()) as SummaryPayload;
    expect(payload.count).toBe(1);
    expect(payload.valuations[0].pe_ttm).toBe(35.2);
  });

  it("reports generated_at as the newest computed_at across returned rows", async () => {
    db.state.rows = [
      snapshotRow("AAPL", { computed_at: "2026-08-27T01:00:00Z" }),
      snapshotRow("MSFT", { computed_at: "2026-08-28T09:00:00Z" }),
    ];

    const response = await GET(request());

    const payload = (await response.json()) as SummaryPayload;
    expect(payload.generated_at).toBe("2026-08-28T09:00:00Z");
  });

  it("sends revalidation cache headers so the ETag can actually work", async () => {
    db.state.rows = [snapshotRow("AAPL")];

    const response = await GET(request());

    const cacheControl = response.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("must-revalidate");
    expect(cacheControl).not.toContain("no-store");
    expect(response.headers.get("ETag")).toMatch(/^"/);
  });

  it("answers a matching If-None-Match with 304 and the same cache policy", async () => {
    db.state.rows = [snapshotRow("AAPL", { computed_at: "2026-08-28T09:00:00Z" })];

    const first = await GET(request());
    const etag = first.headers.get("ETag") ?? "";

    const revalidated = await GET(request({ "if-none-match": etag }));

    expect(revalidated.status).toBe(304);
    const cacheControl = revalidated.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("must-revalidate");
    expect(cacheControl).not.toContain("no-store");
    expect(revalidated.headers.get("ETag")).toBe(etag);
  });
});
