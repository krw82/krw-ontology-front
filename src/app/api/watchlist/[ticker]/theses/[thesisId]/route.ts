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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string; thesisId: string }> },
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

  const { ticker: rawTicker, thesisId } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;
  if (!isUuid(thesisId)) {
    return errorResponse(404, "not_found", "Thesis를 찾지 못했습니다.");
  }

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const update: Partial<
    Pick<
      UserCompanyThesisRow,
      "title" | "thesis_text" | "monitored_variables" | "counter_evidence" | "decision_change_condition" | "status" | "tags" | "archived_at"
    >
  > = {};
  const title = stringInput(body, "title", { maxLength: 200 });
  const thesisText = textInput(body, "thesis_text", { maxLength: 20_000 });
  const status = stringInput(body, "status");
  const tags = stringArrayInput(body, "tags");
  const monitoredVariables = stringArrayInput(body, "monitored_variables");
  const counterEvidence = textInput(body, "counter_evidence", { maxLength: 8_000 });
  const decisionChangeCondition = textInput(body, "decision_change_condition", { maxLength: 4_000 });

  if (body.title !== undefined) {
    if (!title) {
      return errorResponse(400, "validation_error", "Thesis 제목을 입력해주세요.");
    }
    update.title = title;
  }
  if (body.thesis_text !== undefined) {
    if (!thesisText) {
      return errorResponse(400, "validation_error", "Thesis 내용을 입력해주세요.");
    }
    update.thesis_text = thesisText;
  }
  if (body.status !== undefined) {
    if (!status || !VALID_STATUSES.has(status)) {
      return errorResponse(400, "validation_error", "Thesis 상태가 올바르지 않습니다.");
    }
    update.status = status as UserCompanyThesisRow["status"];
    update.archived_at = status === "archived" ? new Date().toISOString() : null;
  }
  if (tags !== undefined) {
    update.tags = tags;
  }
  if (monitoredVariables !== undefined) {
    if (monitoredVariables.length > 3) {
      return errorResponse(400, "validation_error", "확인 변수는 최대 3개까지 저장할 수 있습니다.");
    }
    update.monitored_variables = monitoredVariables;
  }
  if (body.counter_evidence !== undefined) {
    update.counter_evidence = counterEvidence ?? "";
  }
  if (body.decision_change_condition !== undefined) {
    update.decision_change_condition = decisionChangeCondition ?? "";
  }

  if (Object.keys(update).length === 0) {
    return errorResponse(400, "validation_error", "수정할 항목이 없습니다.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_company_theses")
    .update(update)
    .eq("id", thesisId)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker)
    .select(THESIS_SELECT)
    .maybeSingle<UserCompanyThesisRow>();

  if (error) {
    return errorResponse(500, "internal_error", "Thesis를 저장하지 못했습니다.");
  }
  if (!data) {
    return errorResponse(404, "not_found", "Thesis를 찾지 못했습니다.");
  }

  void recordAnalyticsEventFromRequest(request, {
    eventName: "thesis_updated",
    userId: user.id,
    properties: {
      thesis_id: data.id,
      ticker: data.ticker,
      status: data.status,
      outcome: "updated",
      source: "watchlist",
      source_type: "thesis",
    },
  });
  return Response.json({ thesis: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string; thesisId: string }> },
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

  const { ticker: rawTicker, thesisId } = await params;
  const tickerResult = await requireIndexedTicker(rawTicker);
  if (!tickerResult.ok) return tickerResult.response;
  if (!isUuid(thesisId)) {
    return errorResponse(404, "not_found", "Thesis를 찾지 못했습니다.");
  }

  const { error } = await getSupabaseAdmin()
    .from("user_company_theses")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
    })
    .eq("id", thesisId)
    .eq("user_id", user.id)
    .eq("ticker", tickerResult.ticker);

  if (error) {
    return errorResponse(500, "internal_error", "Thesis를 보관하지 못했습니다.");
  }

  void recordAnalyticsEventFromRequest(request, {
    eventName: "thesis_updated",
    userId: user.id,
    properties: {
      thesis_id: thesisId,
      ticker: tickerResult.ticker,
      status: "archived",
      outcome: "updated",
      source: "watchlist",
      source_type: "thesis",
    },
  });
  return Response.json({ success: true, thesis_id: thesisId });
}
