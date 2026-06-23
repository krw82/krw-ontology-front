import type { NextRequest } from "next/server";
import {
  authenticateDesktopRequest,
  requireDesktopFeatureAccess,
} from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { createDesktopNotebookNote } from "@/lib/desktop/resources/notebook-service";
import { requireDesktopRemoteResourcesEnabled } from "@/lib/desktop/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  try {
    requireDesktopRemoteResourcesEnabled();
    const auth = await authenticateDesktopRequest(request);
    await requireDesktopFeatureAccess(auth, "evidence_research");
    const { ticker } = await params;
    const payload = await createDesktopNotebookNote({
      userId: auth.userId,
      deviceId: auth.deviceId,
      ticker,
      idempotencyKey: request.headers.get("idempotency-key"),
      body: await request.json().catch(() => null),
    });
    return Response.json(payload, {
      status: payload.meta.replayed ? 200 : 201,
      headers: {
        "Cache-Control": "no-store",
        Vary: "Authorization",
      },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
