import type { NextRequest } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { isUuid } from "@/lib/api/validation";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { requireMenuFeatureAccess } from "@/lib/billing/feature-access-server";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  errorResponse,
  parseJsonObject,
  requireIndexedTicker,
  stringArrayInput,
  stringInput,
  textInput,
} from "@/lib/watchlist/api";
import type { UserCompanyThesisRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THESIS_SELECT =
  "id, user_id, ticker, title, thesis_text, monitored_variables, counter_evidence, decision_change_condition, status, tags, archived_at, source_chat_session_id, source_message_id, created_at, updated_at";
const VALID_STATUSES = new Set([
  "active",
  "needs_review",
  "weakened",
  "mixed",
  "archived",
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

  const featureAccess = await requireMenuFeatureAccess(
    user.id,
    user.email,
    "research_notebook",
  );
  if (featureAccess) return featureAccess;

  const { ticker: rawTicker } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_theses")
    .select(THESIS_SELECT)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .returns<UserCompanyThesisRow[]>();

  if (error) {
    return errorResponse(500, "internal_error", "Thesis를 불러오지 못했습니다.");
  }

  return Response.json({ theses: data ?? [] });
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

  const featureAccess = await requireMenuFeatureAccess(
    user.id,
    user.email,
    "research_notebook",
  );
  if (featureAccess) return featureAccess;

  const { ticker: rawTicker } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const title = stringInput(body, "title", { maxLength: 200, required: true });
  const thesisText = textInput(body, "thesis_text", {
    maxLength: 20_000,
    required: true,
  });
  const monitoredVariables = stringArrayInput(body, "monitored_variables") ?? [];
  const counterEvidence = textInput(body, "counter_evidence", { maxLength: 8_000 }) ?? "";
  const decisionChangeCondition = textInput(body, "decision_change_condition", { maxLength: 4_000 }) ?? "";
  const status = stringInput(body, "status") || "active";
  const sourceChatSessionId = stringInput(body, "source_chat_session_id");
  const sourceMessageId = stringInput(body, "source_message_id");

  if (!title) {
    return errorResponse(400, "validation_error", "Thesis 제목을 입력해주세요.");
  }
  if (!thesisText) {
    return errorResponse(400, "validation_error", "Thesis 내용을 입력해주세요.");
  }
  if (!VALID_STATUSES.has(status)) {
    return errorResponse(400, "validation_error", "Thesis 상태가 올바르지 않습니다.");
  }
  if (monitoredVariables.length > 3) {
    return errorResponse(400, "validation_error", "확인 변수는 최대 3개까지 저장할 수 있습니다.");
  }
  if (sourceChatSessionId && !isUuid(sourceChatSessionId)) {
    return errorResponse(400, "validation_error", "채팅 세션 참조가 올바르지 않습니다.");
  }
  if (sourceMessageId && !isUuid(sourceMessageId)) {
    return errorResponse(400, "validation_error", "메시지 참조가 올바르지 않습니다.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_theses")
    .insert({
      user_id: user.id,
      ticker: tickerResult.ticker,
      title,
      thesis_text: thesisText,
      monitored_variables: monitoredVariables,
      counter_evidence: counterEvidence,
      decision_change_condition: decisionChangeCondition,
      status: status as UserCompanyThesisRow["status"],
      tags: stringArrayInput(body, "tags") ?? [],
      source_chat_session_id: sourceChatSessionId || null,
      source_message_id: sourceMessageId || null,
    })
    .select(THESIS_SELECT)
    .single<UserCompanyThesisRow>();

  if (error || !data) {
    return errorResponse(500, "internal_error", "Thesis를 저장하지 못했습니다.");
  }

  void recordAnalyticsEventFromRequest(request, {
    eventName: "thesis_updated",
    userId: user.id,
    properties: {
      thesis_id: data.id,
      ticker: data.ticker,
      status: "created",
      source: "watchlist",
      source_type: "thesis",
    },
  });
  return Response.json({ thesis: data }, { status: 201 });
}
