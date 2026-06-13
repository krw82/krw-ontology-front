import type { NextRequest } from "next/server";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { startDesktopDeviceLogin } from "@/lib/desktop/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await startDesktopDeviceLogin({
      deviceName: stringValue(body.device_name, "KRW Desktop"),
      platform: optionalStringValue(body.platform),
      arch: optionalStringValue(body.arch),
      appVersion: optionalStringValue(body.app_version),
      protocolVersion: stringValue(body.protocol_version, "desktop/v1"),
    });

    return Response.json(response);
  } catch (error) {
    return handleDesktopApiError(error);
  }
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
