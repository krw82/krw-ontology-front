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
  textInput,
} from "@/lib/watchlist/api";
import type { UserCompanyCardRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CARD_SELECT =
  "id, user_id, ticker, title, summary, content_md, basis_release_id, basis_period, basis_document_type, source_chat_session_id, source_message_id, created_at, updated_at";

export async function PUT(
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

  const title = stringInput(body, "title", { maxLength: 200 }) || "종목 카드";
  const summary = stringInput(body, "summary", { maxLength: 1200 });
  const contentMd = textInput(body, "content_md", { maxLength: 30_000 }) ?? "";
  const basisPeriod = stringInput(body, "basis_period", { maxLength: 40 });
  const basisDocumentType = stringInput(body, "basis_document_type", {
    maxLength: 80,
  });
  const sourceChatSessionId = stringInput(body, "source_chat_session_id");
  const sourceMessageId = stringInput(body, "source_message_id");
  if (sourceChatSessionId && !isUuid(sourceChatSessionId)) {
    return errorResponse(400, "validation_error", "채팅 세션 참조가 올바르지 않습니다.");
  }
  if (sourceMessageId && !isUuid(sourceMessageId)) {
    return errorResponse(400, "validation_error", "메시지 참조가 올바르지 않습니다.");
  }

  const now = new Date().toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_cards")
    .upsert(
      {
        user_id: user.id,
        ticker: tickerResult.ticker,
        title,
        summary: summary || null,
        content_md: contentMd,
        basis_period: basisPeriod || null,
        basis_document_type: basisDocumentType || null,
        source_chat_session_id: sourceChatSessionId || null,
        source_message_id: sourceMessageId || null,
        updated_at: now,
      },
      { onConflict: "user_id,ticker" },
    )
    .select(CARD_SELECT)
    .single<UserCompanyCardRow>();

  if (error || !data) {
    return errorResponse(500, "internal_error", "종목 카드를 저장하지 못했습니다.");
  }

  return Response.json({ card: data });
}
