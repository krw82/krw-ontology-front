import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/api/validation";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  errorResponse,
  parseJsonObject,
  requireIndexedTicker,
  stringInput,
} from "@/lib/watchlist/api";
import type { UserCompanyQuestionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUESTION_SELECT =
  "id, user_id, ticker, question, status, source, source_chat_session_id, source_message_id, answered_at, visible_after_at, created_at, updated_at";
const VALID_STATUSES = new Set(["open", "answered", "dismissed"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string; questionId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker, questionId } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;
  if (!isUuid(questionId)) {
    return errorResponse(404, "not_found", "질문을 찾지 못했습니다.");
  }

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const update: Partial<UserCompanyQuestionRow> = {};
  const status = stringInput(body, "status");
  const question = stringInput(body, "question", { maxLength: 1200 });

  if (body.status !== undefined) {
    if (!status || !VALID_STATUSES.has(status)) {
      return errorResponse(400, "validation_error", "질문 상태가 올바르지 않습니다.");
    }
    update.status = status as UserCompanyQuestionRow["status"];
    update.answered_at = status === "answered" ? new Date().toISOString() : null;
  }

  if (body.question !== undefined) {
    if (!question) {
      return errorResponse(400, "validation_error", "질문을 입력해주세요.");
    }
    update.question = question;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_questions")
    .update(update)
    .eq("id", questionId)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker)
    .select(QUESTION_SELECT)
    .maybeSingle<UserCompanyQuestionRow>();

  if (error) {
    return errorResponse(500, "internal_error", "질문을 저장하지 못했습니다.");
  }
  if (!data) {
    return errorResponse(404, "not_found", "질문을 찾지 못했습니다.");
  }

  return Response.json({ question: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string; questionId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker, questionId } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;
  if (!isUuid(questionId)) {
    return errorResponse(404, "not_found", "질문을 찾지 못했습니다.");
  }

  const { error } = await getSupabaseAdmin()
    .from("user_company_questions")
    .delete()
    .eq("id", questionId)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker);

  if (error) {
    return errorResponse(500, "internal_error", "질문을 삭제하지 못했습니다.");
  }

  return Response.json({ success: true, question_id: questionId });
}
