import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/api/validation";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCompanyCoverageForWrite,
  errorResponse,
  parseJsonObject,
  requireIndexedTicker,
  stringArrayInput,
  stringInput,
  textInput,
} from "@/lib/watchlist/api";
import type { UserResearchNoteRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTE_SELECT =
  "id, user_id, ticker, title, body, note_type, tags, source_chat_session_id, source_message_id, created_at, updated_at";
const VALID_NOTE_TYPES = new Set([
  "manual",
  "chat_summary",
  "thesis_check",
  "filing_check",
  "risk_memo",
  "earnings_setup",
  "earnings_review",
  "tearsheet",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string; noteId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker, noteId } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;
  if (!isUuid(noteId)) {
    return errorResponse(404, "not_found", "노트를 찾지 못했습니다.");
  }

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const update: Partial<
    Pick<UserResearchNoteRow, "title" | "body" | "note_type" | "tags">
  > = {};
  const title = stringInput(body, "title", { maxLength: 200 });
  const noteBody = textInput(body, "body", { maxLength: 20_000 });
  const noteType = stringInput(body, "note_type");
  const tags = stringArrayInput(body, "tags");

  if (body.title !== undefined) {
    if (!title) {
      return errorResponse(400, "validation_error", "노트 제목을 입력해주세요.");
    }
    update.title = title;
  }
  if (body.body !== undefined) {
    update.body = noteBody ?? "";
  }
  if (body.note_type !== undefined) {
    if (!noteType || !VALID_NOTE_TYPES.has(noteType)) {
      return errorResponse(400, "validation_error", "노트 유형이 올바르지 않습니다.");
    }
    update.note_type = noteType as UserResearchNoteRow["note_type"];
  }
  if (tags !== undefined) {
    update.tags = tags;
  }

  if (Object.keys(update).length === 0) {
    return errorResponse(400, "validation_error", "수정할 항목이 없습니다.");
  }

  const coverageError = await ensureCompanyCoverageForWrite({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
    source: "note_updated",
  });
  if (coverageError) return coverageError;

  const { data, error } = await getSupabaseAdmin()
    .from("user_research_notes")
    .update(update)
    .eq("id", noteId)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker)
    .select(NOTE_SELECT)
    .maybeSingle<UserResearchNoteRow>();

  if (error) {
    return errorResponse(500, "internal_error", "노트를 저장하지 못했습니다.");
  }
  if (!data) {
    return errorResponse(404, "not_found", "노트를 찾지 못했습니다.");
  }

  return Response.json({ note: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string; noteId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { ticker: rawTicker, noteId } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;
  if (!isUuid(noteId)) {
    return errorResponse(404, "not_found", "노트를 찾지 못했습니다.");
  }

  const coverageError = await ensureCompanyCoverageForWrite({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
    source: "note_updated",
  });
  if (coverageError) return coverageError;

  const { error } = await getSupabaseAdmin()
    .from("user_research_notes")
    .delete()
    .eq("id", noteId)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker);

  if (error) {
    return errorResponse(500, "internal_error", "노트를 삭제하지 못했습니다.");
  }

  return Response.json({ success: true, note_id: noteId });
}
