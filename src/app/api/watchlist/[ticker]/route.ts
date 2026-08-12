import type { NextRequest } from "next/server";
import { recordCoverageMutationAnalytics } from "@/lib/coverage/analytics";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { requireMenuFeatureAccess } from "@/lib/billing/feature-access-server";
import { companyCoverageLevelSchema } from "@/lib/coverage/contracts";
import {
  CoverageIdempotencyConflictError,
  CoverageLimitError,
  getCompanyCoverage,
  setCompanyCoverageLevelWithEvent,
} from "@/lib/coverage/repository";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import {
  errorResponse,
  parseJsonObject,
  requireIndexedTicker,
  stringArrayInput,
  stringInput,
} from "@/lib/watchlist/api";
import { getWatchlistCompanyDetail } from "@/lib/watchlist/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const detail = await getWatchlistCompanyDetail(user.id, tickerResult.ticker);
    if (!detail) {
      return errorResponse(404, "not_found", "종목 워크스페이스를 찾지 못했습니다.");
    }
    return Response.json(detail);
  } catch {
    return errorResponse(500, "internal_error", "종목 워크스페이스를 불러오지 못했습니다.");
  }
}

export async function PATCH(
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

  let existing;
  try {
    existing = await getCompanyCoverage(user.id, tickerResult.ticker);
  } catch {
    return errorResponse(
      503,
      "service_unavailable",
      "기존 회사 상태를 확인하지 못했습니다. 다시 시도해주세요.",
    );
  }
  const requestedCoverageLevel = Object.hasOwn(body, "coverage_level")
    ? body.coverage_level
    : existing?.coverage_level ?? null;
  const coverageLevel = companyCoverageLevelSchema.safeParse(
    requestedCoverageLevel,
  );
  if (!coverageLevel.success) {
    return errorResponse(400, "validation_error", "회사 커버리지 상태를 확인해주세요.");
  }
  const interestReason = stringInput(body, "interest_reason", { maxLength: 1200 });
  const tags = stringArrayInput(body, "tags");
  try {
    const result = await setCompanyCoverageLevelWithEvent({
      userId: user.id,
      userEmail: user.email,
      ticker: tickerResult.ticker,
      coverageLevel: coverageLevel.data,
      idempotencyKey:
        typeof body.client_mutation_id === "string"
          ? body.client_mutation_id
          : undefined,
      source: "watchlist_update",
      interestReason:
        body.interest_reason !== undefined
          ? interestReason || null
          : existing?.interest_reason,
      tags: tags ?? existing?.tags,
    });
    await recordCoverageMutationAnalytics(request, user.id, result, "watchlist");
    return Response.json({
      mark: result.mark,
      idempotent_replay: result.idempotentReplay,
    });
  } catch (error) {
    if (error instanceof CoverageIdempotencyConflictError) {
      return errorResponse(409, error.code, error.message);
    }
    if (error instanceof CoverageLimitError) {
      return errorResponse(409, error.code, error.message);
    }
    return errorResponse(500, "internal_error", "종목 상태를 저장하지 못했습니다.");
  }
}
