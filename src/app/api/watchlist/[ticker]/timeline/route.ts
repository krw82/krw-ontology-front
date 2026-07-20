import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { listCompanyCoverageTimeline } from "@/lib/judgments/timeline";
import { errorResponse, requireIndexedTicker } from "@/lib/watchlist/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
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
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "30");
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) {
    return errorResponse(400, "validation_error", "limit은 1부터 100 사이여야 합니다.");
  }
  try {
    return Response.json(
      await listCompanyCoverageTimeline({
        userId: user.id,
        ticker: tickerResult.ticker,
        limit: limitRaw,
        cursor: request.nextUrl.searchParams.get("cursor"),
      }),
    );
  } catch {
    return errorResponse(500, "internal_error", "회사 판단 타임라인을 불러오지 못했습니다.");
  }
}
