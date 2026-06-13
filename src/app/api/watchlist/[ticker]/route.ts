import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  booleanInput,
  errorResponse,
  parseJsonObject,
  requireIndexedTicker,
  stringArrayInput,
  stringInput,
} from "@/lib/watchlist/api";
import { getWatchlistCompanyDetail } from "@/lib/watchlist/workspace";
import type { Database, UserCompanyMarkRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARK_SELECT =
  "user_id, ticker, is_watchlisted, is_holding, priority, interest_reason, tags, last_activity_at, created_at, updated_at";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;

  try {
    const detail = await getWatchlistCompanyDetail(user.id, tickerResult.ticker);
    if (!detail) {
      return errorResponse(404, "not_found", "종목 워크스페이스를 찾지 못했습니다.");
    }
    return Response.json(detail);
  } catch {
    return errorResponse(500, "internal_error", "종목 워크스페이스를 불러오지 못했습니다.");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const update: Database["public"]["Tables"]["user_company_marks"]["Insert"] = {
    user_id: user.id,
    ticker: tickerResult.ticker,
    last_activity_at: new Date().toISOString(),
  };
  const isWatchlisted = booleanInput(body, "is_watchlisted");
  const isHolding = booleanInput(body, "is_holding");
  const interestReason = stringInput(body, "interest_reason", { maxLength: 1200 });
  const tags = stringArrayInput(body, "tags");

  if (isWatchlisted !== undefined) update.is_watchlisted = isWatchlisted;
  if (isHolding !== undefined) update.is_holding = isHolding;
  if (body.interest_reason !== undefined) update.interest_reason = interestReason || null;
  if (tags !== undefined) update.tags = tags;

  const { data: mark, error } = await getSupabaseAdmin()
    .from("user_company_marks")
    .upsert(update, { onConflict: "user_id,ticker" })
    .select(MARK_SELECT)
    .single<UserCompanyMarkRow>();

  if (error || !mark) {
    return errorResponse(500, "internal_error", "종목 상태를 저장하지 못했습니다.");
  }

  return Response.json({ mark });
}
