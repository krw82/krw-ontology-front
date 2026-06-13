import type { NextRequest } from "next/server";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { pollDesktopDeviceLogin } from "@/lib/desktop/device-auth";
import { DesktopAuthError } from "@/lib/desktop/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.device_code !== "string" || !body.device_code.trim()) {
      throw new DesktopAuthError("Missing device_code", {
        publicMessage: "Desktop 로그인 코드가 필요합니다.",
        status: 400,
      });
    }

    const response = await pollDesktopDeviceLogin(body.device_code);
    return Response.json(response);
  } catch (error) {
    return handleDesktopApiError(error);
  }
}
