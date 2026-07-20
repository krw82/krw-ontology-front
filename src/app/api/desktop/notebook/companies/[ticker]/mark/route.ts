import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { updateDesktopNotebookMark } from "@/lib/desktop/resources/notebook-service";
import { requireDesktopRemoteResourcesEnabled } from "@/lib/desktop/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  try {
    requireDesktopRemoteResourcesEnabled();
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopFeatureAccess(auth, "evidence_research");
    const { ticker } = await params;
    const payload = await updateDesktopNotebookMark({
      userId: auth.userId,
      userEmail: auth.userEmail,
      ticker,
      expectedVersion: request.headers.get("if-match"),
      body: await request.json().catch(() => null),
    });
    return Response.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Authorization",
      },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
