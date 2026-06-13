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
import { listWatchlistOverview } from "@/lib/watchlist/workspace";
import type { UserCompanyMarkRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARK_SELECT =
  "user_id, ticker, is_watchlisted, is_holding, priority, interest_reason, tags, last_activity_at, created_at, updated_at";

export async function GET() {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  try {
    return Response.json(await listWatchlistOverview(user.id));
  } catch {
    return errorResponse(500, "internal_error", "내 종목장을 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const tickerResult = await requireIndexedTicker(stringInput(body, "ticker"));
  if (!tickerResult.ok) return tickerResult.response;

  const isWatchlisted = booleanInput(body, "is_watchlisted") ?? true;
  const isHolding = booleanInput(body, "is_holding") ?? false;
  const interestReason = stringInput(body, "interest_reason", { maxLength: 1200 });
  const tags = stringArrayInput(body, "tags") ?? [];
  const now = new Date().toISOString();

  const { data: mark, error } = await getSupabaseAdmin()
    .from("user_company_marks")
    .upsert(
      {
        user_id: user.id,
        ticker: tickerResult.ticker,
        is_watchlisted: isWatchlisted,
        is_holding: isHolding,
        interest_reason: interestReason || null,
        tags,
        last_activity_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,ticker" },
    )
    .select(MARK_SELECT)
    .single<UserCompanyMarkRow>();

  if (error || !mark) {
    return errorResponse(500, "internal_error", "종목을 저장하지 못했습니다.");
  }

  return Response.json({ mark }, { status: 201 });
}
