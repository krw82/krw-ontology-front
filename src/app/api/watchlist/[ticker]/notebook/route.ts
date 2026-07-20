import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/api/validation";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  defaultCompanyNotebook,
  getCompanyNotebook,
} from "@/lib/watchlist/workspace";
import {
  ensureCompanyCoverageForWrite,
  errorResponse,
  parseJsonObject,
  requireIndexedTicker,
  stringInput,
  textInput,
} from "@/lib/watchlist/api";
import type { UserCompanyNotebookRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTEBOOK_SELECT =
  "id, user_id, ticker, title, content_md, previous_content_md, basis_release_id, basis_period, last_source_chat_session_id, last_source_message_id, created_at, updated_at";

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

  const notebook =
    (await getCompanyNotebook(user.id, tickerResult.ticker)) ??
    defaultCompanyNotebook(user.id, tickerResult.ticker, tickerResult.company);

  return Response.json({ notebook });
}

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

  const title =
    stringInput(body, "title", { maxLength: 200 }) ||
    `${tickerResult.ticker} 리서치 노트북`;
  const contentMd = textInput(body, "content_md", { maxLength: 100_000 });
  if (contentMd === null) {
    return errorResponse(400, "validation_error", "노트북 내용을 입력해주세요.");
  }
  const basisPeriod = stringInput(body, "basis_period", { maxLength: 40 });
  const sourceChatSessionId = stringInput(body, "last_source_chat_session_id");
  const sourceMessageId = stringInput(body, "last_source_message_id");
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
    source: "notebook_saved",
  });
  if (coverageError) return coverageError;

  const existing = await getCompanyNotebook(user.id, tickerResult.ticker);
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("user_company_notebooks")
    .upsert(
      {
        user_id: user.id,
        ticker: tickerResult.ticker,
        title,
        content_md: contentMd,
        previous_content_md: existing?.content_md ?? null,
        basis_period: basisPeriod || tickerResult.company.latest_period,
        last_source_chat_session_id: sourceChatSessionId || null,
        last_source_message_id: sourceMessageId || null,
        updated_at: now,
      },
      { onConflict: "user_id,ticker" },
    )
    .select(NOTEBOOK_SELECT)
    .single<UserCompanyNotebookRow>();

  if (error || !data) {
    return errorResponse(500, "internal_error", "리서치 노트북을 저장하지 못했습니다.");
  }

  return Response.json({ notebook: data });
}
