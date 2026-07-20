import type { NextRequest } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { tryRecordCoverageActivation } from "@/lib/coverage/activation";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { saveFilingJudgmentSchema } from "@/lib/judgments/contracts";
import { getFilingJudgment, saveFilingJudgment } from "@/lib/judgments/repository";
import { errorResponse } from "@/lib/watchlist/api";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventIdSchema = z.uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const eventIdResult = eventIdSchema.safeParse((await params).eventId);
  if (!eventIdResult.success) {
    return errorResponse(400, "validation_error", "올바른 공시 이벤트 ID가 아닙니다.");
  }
  try {
    const judgment = await getFilingJudgment(user.id, eventIdResult.data);
    if (!judgment) return errorResponse(404, "not_found", "저장된 공시 판단이 없습니다.");
    return Response.json({ judgment });
  } catch {
    return errorResponse(500, "internal_error", "공시 판단을 불러오지 못했습니다.");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  return writeJudgment(request, params, false);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  return writeJudgment(request, params, true);
}

async function writeJudgment(
  request: NextRequest,
  params: Promise<{ eventId: string }>,
  requireExpectedRevision: boolean,
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const eventIdResult = eventIdSchema.safeParse((await params).eventId);
  if (!eventIdResult.success) {
    return errorResponse(400, "validation_error", "올바른 공시 이벤트 ID가 아닙니다.");
  }
  const body = await request.json().catch(() => null);
  const input = saveFilingJudgmentSchema.safeParse(body);
  if (!input.success) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "공시 판단 입력을 확인해주세요.",
          details: input.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  if (requireExpectedRevision && input.data.expected_revision_number === undefined) {
    return errorResponse(
      400,
      "validation_error",
      "수정할 판단의 expected_revision_number가 필요합니다.",
    );
  }

  try {
    const result = await saveFilingJudgment(user.id, eventIdResult.data, {
      ...input.data,
      expected_revision_number: requireExpectedRevision
        ? input.data.expected_revision_number
        : 0,
    });
    if (!result.idempotent_replay) {
      const source = request.headers.get("referer")?.includes("/pulse")
        ? "pulse"
        : "filing_detail";
      await recordAnalyticsEventFromRequest(request, {
        eventName: result.judgment.revision_number === 1
          ? "filing_judgment_completed"
          : "filing_judgment_revised",
        userId: user.id,
        properties: {
          filing_event_id: result.judgment.filing_event_id,
          judgment_id: result.judgment.id,
          revision_id: result.judgment.current_revision_id,
          revision_number: result.judgment.revision_number,
          ticker: result.judgment.ticker,
          impact: result.judgment.impact,
          next_action: result.judgment.next_action,
          has_previous_judgment: result.judgment.revision_number > 1,
          source,
        },
      });
      for (const ruleId of result.created_rule_ids ?? []) {
        const rule = result.judgment.monitoring_rules.find(
          (candidate) => candidate.id === ruleId,
        );
        if (!rule) continue;
        await recordAnalyticsEventFromRequest(request, {
          eventName: "monitoring_rule_created",
          userId: user.id,
          properties: {
            monitoring_rule_id: rule.id,
            judgment_id: result.judgment.id,
            filing_event_id: result.judgment.filing_event_id,
            ticker: result.judgment.ticker,
            rule_type: rule.rule_type,
            source,
          },
        });
      }
      await tryRecordCoverageActivation(user.id);
    }
    return Response.json(result, {
      status: requireExpectedRevision || result.idempotent_replay ? 200 : 201,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("idempotency_key_conflict")) {
      return errorResponse(
        409,
        "idempotency_conflict",
        "같은 저장 요청 번호가 다른 공시에 이미 사용되었습니다.",
      );
    }
    if (error instanceof Error && error.message.includes("judgment_revision_conflict")) {
      return errorResponse(
        409,
        "judgment_revision_conflict",
        "다른 기기에서 판단이 먼저 수정되었습니다. 최신 내용을 확인해주세요.",
      );
    }
    if (error instanceof Error && error.message.includes("filing_event_not_found")) {
      return errorResponse(404, "not_found", "공시 이벤트를 찾지 못했습니다.");
    }
    if (
      error instanceof Error &&
      error.message.includes("coverage_reactivation_required")
    ) {
      return errorResponse(
        409,
        "coverage_reactivation_required",
        "종료한 회사입니다. 커버리지를 다시 시작한 뒤 다음 행동을 저장해주세요.",
      );
    }
    if (error instanceof Error && error.message.includes("filing_access_forbidden")) {
      return errorResponse(403, "forbidden", "현재 접근 가능한 공시에만 판단을 저장할 수 있습니다.");
    }
    if (
      error instanceof Error &&
      (error.message.includes("filing_access_unavailable") ||
        error.message.includes("personal_filing_context_unavailable") ||
        error.message.includes("active_catalog_release_unavailable") ||
        error.message.includes("catalog_filing_coverage_unavailable"))
    ) {
      return errorResponse(503, "service_unavailable", "공시의 회사 맥락을 확인하지 못했습니다.");
    }
    if (error instanceof Error && error.message.includes("invalid_filing_context_ticker")) {
      return errorResponse(422, "invalid_filing_context", "공시와 회사 맥락이 일치하지 않습니다.");
    }
    return errorResponse(500, "internal_error", "공시 판단을 저장하지 못했습니다.");
  }
}
