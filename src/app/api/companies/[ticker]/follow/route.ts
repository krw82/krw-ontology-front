import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordCoverageMutationAnalytics } from "@/lib/coverage/analytics";
import {
  followCompanyServer,
  unfollowCompanyServer,
} from "@/lib/follow/company-follow";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { errorResponse, requireIndexedTicker } from "@/lib/watchlist/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_MESSAGE =
  "관심 기업은 무료 플랜에서 3개까지예요. 무제한 관심·알림은 유료 플랜에서 만날 수 있어요.";

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

  const result = await followCompanyServer({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
    source: "company_follow_api",
  });
  if (result.ok) {
    await recordCoverageMutationAnalytics(
      request,
      user.id,
      result.coverageResult,
      "watchlist",
    );
    return Response.json({
      mark: result.mark,
      alerts: result.alerts,
      news_follow: result.newsFollow,
    });
  }
  if (result.reason === "limit_reached") {
    return errorResponse(409, "coverage_limit_reached", LIMIT_MESSAGE);
  }
  return errorResponse(
    503,
    "service_unavailable",
    "관심 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
  );
}

export async function DELETE(
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

  const result = await unfollowCompanyServer({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
  });
  if (result.ok) return Response.json({ ok: true });
  return errorResponse(
    503,
    "service_unavailable",
    "관심 상태를 해제하지 못했습니다. 잠시 후 다시 시도해주세요.",
  );
}
