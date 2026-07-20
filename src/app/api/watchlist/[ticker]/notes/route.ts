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
import { listCompanyNotes } from "@/lib/watchlist/workspace";
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
      notes: await listCompanyNotes(user.id, tickerResult.ticker),
    });
  } catch {
    return errorResponse(500, "internal_error", "리서치 노트를 불러오지 못했습니다.");
  }
}

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

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const title = stringInput(body, "title", { maxLength: 200, required: true });
  if (!title) {
    return errorResponse(400, "validation_error", "노트 제목을 입력해주세요.");
  }
  const noteType = stringInput(body, "note_type") || "manual";
  if (!VALID_NOTE_TYPES.has(noteType)) {
    return errorResponse(400, "validation_error", "노트 유형이 올바르지 않습니다.");
  }
  const sourceChatSessionId = stringInput(body, "source_chat_session_id");
  const sourceMessageId = stringInput(body, "source_message_id");
  if (sourceChatSessionId && !isUuid(sourceChatSessionId)) {
    return errorResponse(400, "validation_error", "채팅 세션 참조가 올바르지 않습니다.");
  }
  if (sourceMessageId && !isUuid(sourceMessageId)) {
    return errorResponse(400, "validation_error", "메시지 참조가 올바르지 않습니다.");
  }

  const coverageError = await ensureCompanyCoverageForWrite({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
    source: "note_created",
  });
  if (coverageError) return coverageError;

  const { data, error } = await getSupabaseAdmin()
    .from("user_research_notes")
    .insert({
      user_id: user.id,
      ticker: tickerResult.ticker,
      title,
      body: textInput(body, "body", { maxLength: 20_000 }) ?? "",
      note_type: noteType as UserResearchNoteRow["note_type"],
      tags: stringArrayInput(body, "tags") ?? [],
      source_chat_session_id: sourceChatSessionId || null,
      source_message_id: sourceMessageId || null,
    })
    .select(NOTE_SELECT)
    .single<UserResearchNoteRow>();

  if (error || !data) {
    return errorResponse(500, "internal_error", "리서치 노트를 저장하지 못했습니다.");
  }

  return Response.json({ note: data }, { status: 201 });
}
