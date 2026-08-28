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
// Snapshots refresh at most hourly, so a short private browser cache plus
// ETag revalidation keeps repeat /companies visits cheap without serving
// meaningfully stale metrics.
const CACHE_CONTROL = "private, max-age=300, must-revalidate";
const COLUMNS =
  "ticker, market_cap, pe_ttm, pb, roe_ttm, roic_ttm, fundamental_period_end, computed_at";

interface SnapshotRow {
  ticker: string | null;
  market_cap: number | null;
  pe_ttm: number | null;
  pb: number | null;
  roe_ttm: number | null;
  roic_ttm: number | null;
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
      // Same freshness key as lib/valuation/repository: a same-session
      // recompute must not lose to an older-session backfill with a newer
      // computed_at.
      .order("session_date", { ascending: false, nullsFirst: false })
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
      roic_ttm: row.roic_ttm,
      fundamental_period_end: row.fundamental_period_end,
      computed_at: row.computed_at,
    }));

    // ISO-8601 UTC strings compare lexicographically, so reduce gives the
    // newest compute time across tickers for a stable ETag seed.
    const generatedAt = valuations.reduce<string>((newest, row) => {
      const computedAt = row.computed_at ?? "";
      return computedAt > newest ? computedAt : newest;
    }, "");
    const etag = `"valuation-summary-${generatedAt}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { "Cache-Control": CACHE_CONTROL, ETag: etag },
      });
    }

    return Response.json(
      { generated_at: generatedAt || null, count: valuations.length, valuations },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
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
