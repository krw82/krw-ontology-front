import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { desktopJsonError, handleDesktopApiError } from "@/lib/desktop/api-responses";
import { getDesktopCompany } from "@/lib/desktop/resources/company-catalog-service";
import { requireDesktopRemoteResourcesEnabled } from "@/lib/desktop/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  try {
    requireDesktopRemoteResourcesEnabled();
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopFeatureAccess(auth, "evidence_research");
    const { ticker } = await params;
    const result = await getDesktopCompany(ticker);
    if (!result) {
      return desktopJsonError(
        "not_found",
        "회사 정보를 찾지 못했습니다.",
        404,
      );
    }
    return Response.json(result, {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate",
        Vary: "Authorization",
      },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
