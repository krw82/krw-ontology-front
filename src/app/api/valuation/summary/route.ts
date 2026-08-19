import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Latest valuation snapshot per ticker for the companies browse screen.
 * The valuation worker refreshes snapshots at least every few days, so a
 * 30-day window plus in-memory dedupe (newest row wins per ticker) always
 * covers the newest row while keeping the payload bounded (~355 tickers).
 */
const WINDOW_DAYS = 30;
const MAX_ROWS = 2000;
const COLUMNS =
  "ticker, market_cap, pe_ttm, pb, roe_ttm, fundamental_period_end, computed_at";

interface SnapshotRow {
  ticker: string | null;
  market_cap: number | null;
  pe_ttm: number | null;
  pb: number | null;
  roe_ttm: number | null;
  fundamental_period_end: string | null;
  computed_at: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const windowStart = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const admin = getSupabaseAdmin();
    const { data: rows, error } = await admin
      .from("valuation_snapshots")
      .select(COLUMNS)
      .gt("computed_at", windowStart)
      .order("computed_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);

    const latestByTicker = new Map<string, SnapshotRow>();
    for (const row of (rows ?? []) as SnapshotRow[]) {
      const ticker = row?.ticker?.trim().toUpperCase();
      if (!ticker || latestByTicker.has(ticker)) continue;
      latestByTicker.set(ticker, row);
    }

    const valuations = [...latestByTicker.values()].map((row) => ({
      ticker: row.ticker as string,
      market_cap: row.market_cap,
      pe_ttm: row.pe_ttm,
      pb: row.pb,
      roe_ttm: row.roe_ttm,
      fundamental_period_end: row.fundamental_period_end,
      computed_at: row.computed_at,
    }));

    const generatedAt =
      valuations.length > 0 ? (valuations[0].computed_at as string) : "";
    const etag = `"valuation-summary-${generatedAt}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag },
      });
    }

    return Response.json(
      { generated_at: generatedAt || null, count: valuations.length, valuations },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          ETag: etag,
        },
      },
    );
  } catch (error) {
    console.error("valuation_summary_failed", error);
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "밸류에이션 요약을 불러오지 못했습니다.",
        },
      },
      { status: 503 },
    );
  }
}
