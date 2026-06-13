import type { NextRequest } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { revokeDesktopDevice } from "@/lib/desktop/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateDesktopRequest(request);
    const body = await request.json().catch(() => ({}));
    await revokeDesktopDevice({
      auth,
      deviceId: typeof body.device_id === "string" ? body.device_id : null,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
