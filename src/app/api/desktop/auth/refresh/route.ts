import type { NextRequest } from "next/server";
import { DesktopAuthError } from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { refreshDesktopTokens } from "@/lib/desktop/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.device_id !== "string" || !body.device_id.trim()) {
      throw new DesktopAuthError("Missing device_id", {
        publicMessage: "Desktop 기기 ID가 필요합니다.",
        status: 400,
      });
    }
    if (
      typeof body.desktop_refresh_token !== "string" ||
      !body.desktop_refresh_token.trim()
    ) {
      throw new DesktopAuthError("Missing desktop_refresh_token", {
        publicMessage: "Desktop refresh token이 필요합니다.",
        status: 400,
      });
    }

    const tokens = await refreshDesktopTokens({
      deviceId: body.device_id,
      refreshToken: body.desktop_refresh_token,
    });

    return Response.json({
      ok: true,
      ...tokens,
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
