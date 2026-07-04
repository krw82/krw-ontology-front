import type { NextRequest } from "next/server";
import { getInstitutionalHoldingsDashboard } from "@/lib/sec-13f/service";
import { DEFAULT_13F_MANAGER_CIK } from "@/lib/sec-13f/types";
import { errorResponse } from "@/lib/watchlist/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cik =
    request.nextUrl.searchParams.get("cik")?.trim() || DEFAULT_13F_MANAGER_CIK;

  try {
    return Response.json(await getInstitutionalHoldingsDashboard(cik));
  } catch {
    return errorResponse(
      500,
      "internal_error",
      "13F 보유 데이터를 불러오지 못했습니다.",
    );
  }
}
