import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCompanyNotebook } from "@/lib/watchlist/workspace";
import { errorResponse, requireIndexedTicker } from "@/lib/watchlist/api";
import type { UserCompanyNotebookRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTEBOOK_SELECT =
  "id, user_id, ticker, title, content_md, previous_content_md, basis_release_id, basis_period, last_source_chat_session_id, last_source_message_id, created_at, updated_at";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
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

  const existing = await getCompanyNotebook(user.id, tickerResult.ticker);
  if (!existing || !existing.previous_content_md) {
    return errorResponse(409, "conflict", "되돌릴 이전 노트북 내용이 없습니다.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_notebooks")
    .update({
      content_md: existing.previous_content_md,
      previous_content_md: existing.content_md,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker)
    .select(NOTEBOOK_SELECT)
    .single<UserCompanyNotebookRow>();

  if (error || !data) {
    return errorResponse(500, "internal_error", "리서치 노트북을 되돌리지 못했습니다.");
  }

  return Response.json({ notebook: data });
}
