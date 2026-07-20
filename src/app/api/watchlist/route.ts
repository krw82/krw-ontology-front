import type { NextRequest } from "next/server";
import { recordCoverageMutationAnalytics } from "@/lib/coverage/analytics";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { companyCoverageStatusSchema } from "@/lib/coverage/contracts";
import {
  CoverageIdempotencyConflictError,
  CoverageLimitError,
  setCompanyCoverageStatusWithEvent,
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
import { listWatchlistOverview } from "@/lib/watchlist/workspace";
import { ServerTiming } from "@/lib/performance/server-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const timing = new ServerTiming();
  let user;
  try {
    user = await timing.measure("auth", () => getAuthUser());
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  try {
    const overview = await timing.measure("overview", () =>
      listWatchlistOverview(user.id),
    );
    return Response.json(overview, {
      headers: timing.headers({ "Cache-Control": "private, no-store" }),
    });
  } catch {
    return errorResponse(500, "internal_error", "리서치 노트북을 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const body = await parseJsonObject(request);
  if (!body) {
    return errorResponse(400, "validation_error", "요청 본문 형식이 올바르지 않습니다.");
  }

  const tickerResult = await requireIndexedTicker(stringInput(body, "ticker"));
  if (!tickerResult.ok) return tickerResult.response;

  const coverageStatus = companyCoverageStatusSchema.safeParse(
    body.coverage_status ?? "watching",
  );
  if (!coverageStatus.success) {
    return errorResponse(400, "validation_error", "회사 커버리지 상태를 확인해주세요.");
  }
  const interestReason = stringInput(body, "interest_reason", { maxLength: 1200 });
  const tags = stringArrayInput(body, "tags") ?? [];
  try {
    const result = await setCompanyCoverageStatusWithEvent({
      userId: user.id,
      userEmail: user.email,
      ticker: tickerResult.ticker,
      coverageStatus: coverageStatus.data,
      idempotencyKey:
        typeof body.client_mutation_id === "string"
          ? body.client_mutation_id
          : undefined,
      source: "watchlist_create",
      interestReason: interestReason || null,
      tags,
    });
    await recordCoverageMutationAnalytics(request, user.id, result, "watchlist");
    return Response.json(
      { mark: result.mark, idempotent_replay: result.idempotentReplay },
      { status: result.idempotentReplay ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof CoverageIdempotencyConflictError) {
      return errorResponse(409, error.code, error.message);
    }
    if (error instanceof CoverageLimitError) {
      return errorResponse(409, error.code, error.message);
    }
    return errorResponse(500, "internal_error", "종목을 저장하지 못했습니다.");
  }
}
