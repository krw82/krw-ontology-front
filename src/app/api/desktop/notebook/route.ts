import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { getDesktopNotebookOverview } from "@/lib/desktop/resources/notebook-service";
import { requireDesktopRemoteResourcesEnabled } from "@/lib/desktop/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireDesktopRemoteResourcesEnabled();
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopFeatureAccess(auth, "evidence_research");
    const result = await getDesktopNotebookOverview(auth.userId);

    if (request.headers.get("if-none-match") === result.etag) {
      return new Response(null, {
        status: 304,
        headers: notebookHeaders(result.etag),
      });
    }

    return Response.json(result.payload, {
      headers: notebookHeaders(result.etag),
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}

function notebookHeaders(etag: string) {
  return {
    ETag: etag,
    "Cache-Control": "private, max-age=0, must-revalidate",
    Vary: "Authorization",
  };
}
