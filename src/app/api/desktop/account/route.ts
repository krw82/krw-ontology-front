import type { NextRequest } from "next/server";
import { authenticateDesktopRequest } from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateDesktopRequest(request);

    return Response.json({
      ok: true,
      account: {
        user_id: auth.userId,
        email: auth.userEmail,
      },
      device: {
        id: auth.deviceId,
        auth_method: auth.authMethod,
      },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
