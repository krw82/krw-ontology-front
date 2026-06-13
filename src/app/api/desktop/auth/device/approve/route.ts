import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { DesktopAuthError } from "@/lib/desktop/auth";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { approveDesktopDeviceLoginCode } from "@/lib/desktop/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  try {
    const body = await request.json();
    if (typeof body.user_code !== "string" || !body.user_code.trim()) {
      throw new DesktopAuthError("Missing user_code", {
        publicMessage: "Desktop 승인 코드가 필요합니다.",
        status: 400,
      });
    }

    await approveDesktopDeviceLoginCode({
      userCode: body.user_code,
      userId: user.id,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
