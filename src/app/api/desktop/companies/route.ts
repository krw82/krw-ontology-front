import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { parsePositiveIntParam } from "@/lib/api/validation";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { listDesktopCompanies } from "@/lib/desktop/resources/company-catalog-service";
import { requireDesktopRemoteResourcesEnabled } from "@/lib/desktop/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireDesktopRemoteResourcesEnabled();
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopFeatureAccess(auth, "evidence_research");
    const url = new URL(request.url);
    const result = await listDesktopCompanies({
      query: url.searchParams.get("q"),
      cursor: url.searchParams.get("cursor"),
      limit: parsePositiveIntParam(url.searchParams.get("limit"), 20, {
        max: 50,
      }),
    });

    if (request.headers.get("if-none-match") === result.etag) {
      return new Response(null, {
        status: 304,
        headers: catalogHeaders(result.etag),
      });
    }

    return Response.json(result.payload, {
      headers: catalogHeaders(result.etag),
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}

function catalogHeaders(etag: string) {
  return {
    ETag: etag,
    "Cache-Control": "private, max-age=0, must-revalidate",
    Vary: "Authorization",
  };
}
