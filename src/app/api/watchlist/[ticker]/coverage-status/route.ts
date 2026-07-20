import type { NextRequest } from "next/server";
import { recordCoverageMutationAnalytics } from "@/lib/coverage/analytics";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { setCompanyCoverageSchema } from "@/lib/coverage/contracts";
import {
  CoverageIdempotencyConflictError,
  CoverageLimitError,
  getCompanyCoverageStatus,
  setCompanyCoverageStatusWithEvent,
} from "@/lib/coverage/repository";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { errorResponse, requireIndexedTicker } from "@/lib/watchlist/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const tickerResult = await requireIndexedTicker((await params).ticker);
  if (!tickerResult.ok) return tickerResult.response;
  try {
    const mark = await getCompanyCoverageStatus(user.id, tickerResult.ticker);
    return Response.json({ coverage_status: mark?.coverage_status ?? null, mark });
  } catch {
    return errorResponse(500, "internal_error", "회사 커버리지 상태를 불러오지 못했습니다.");
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const tickerResult = await requireIndexedTicker((await params).ticker);
  if (!tickerResult.ok) return tickerResult.response;
  const input = setCompanyCoverageSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return errorResponse(400, "validation_error", "회사 커버리지 입력을 확인해주세요.");
  }
  try {
    const result = await setCompanyCoverageStatusWithEvent({
      userId: user.id,
      userEmail: user.email,
      ticker: tickerResult.ticker,
      coverageStatus: input.data.coverage_status,
      idempotencyKey: input.data.idempotency_key,
      source: input.data.source ?? "coverage_status_api",
      priority: input.data.priority,
      interestReason: input.data.interest_reason,
      tags: input.data.tags,
    });
    await recordCoverageMutationAnalytics(request, user.id, result, "companies");
    return Response.json({
      coverage_status: result.mark.coverage_status,
      mark: result.mark,
      idempotent_replay: result.idempotentReplay,
    });
  } catch (error) {
    if (error instanceof CoverageLimitError) {
      return errorResponse(409, error.code, error.message);
    }
    if (error instanceof CoverageIdempotencyConflictError) {
      return errorResponse(409, error.code, error.message);
    }
    return errorResponse(500, "internal_error", "회사 커버리지 상태를 저장하지 못했습니다.");
  }
}
