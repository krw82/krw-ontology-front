import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  errorResponse,
  parseJsonObject,
  requireIndexedTicker,
  stringInput,
} from "@/lib/watchlist/api";
import { listCompanyQuestions } from "@/lib/watchlist/workspace";
import type { UserCompanyQuestionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUESTION_SELECT =
  "id, user_id, ticker, question, status, source, source_chat_session_id, source_message_id, answered_at, visible_after_at, created_at, updated_at";

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
    return Response.json({
      questions: await listCompanyQuestions(user.id, tickerResult.ticker),
    });
  } catch {
    return errorResponse(500, "internal_error", "열린 질문을 불러오지 못했습니다.");
  }
}

export async function POST(
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

  const question = stringInput(body, "question", {
    maxLength: 1200,
    required: true,
  });
  if (!question) {
    return errorResponse(400, "validation_error", "질문을 입력해주세요.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_questions")
    .insert({
      user_id: user.id,
      ticker: tickerResult.ticker,
      question,
      source: "manual",
    })
    .select(QUESTION_SELECT)
    .single<UserCompanyQuestionRow>();

  if (error || !data) {
    return errorResponse(500, "internal_error", "열린 질문을 저장하지 못했습니다.");
  }

  await touchMark(user.id, tickerResult.ticker);
  return Response.json({ question: data }, { status: 201 });
}

async function touchMark(userId: string, ticker: string) {
  const now = new Date().toISOString();
  await getSupabaseAdmin()
    .from("user_company_marks")
    .upsert(
      {
        user_id: userId,
        ticker,
        is_watchlisted: true,
        last_activity_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,ticker" },
    );
}
