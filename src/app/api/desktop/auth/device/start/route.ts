import type { NextRequest } from "next/server";
import {
  checkDurableRateLimits,
  readPositiveIntEnv,
} from "@/lib/api/rate-limit";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { startDesktopDeviceLogin } from "@/lib/desktop/device-auth";
import { getClientIp } from "@/lib/http/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DEVICE_LOGIN_STARTS_PER_IP_PER_MINUTE = 10;

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkDurableRateLimits([
      {
        key: `ip:${getClientIp(request.headers)}`,
        bucket: "desktop_device_login_start:ip:minute",
        limit: readPositiveIntEnv(
          "DESKTOP_DEVICE_LOGIN_STARTS_PER_IP_PER_MINUTE",
          DEFAULT_DEVICE_LOGIN_STARTS_PER_IP_PER_MINUTE,
        ),
      },
    ]);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit);

    const body = await request.json();
    const response = await startDesktopDeviceLogin({
      deviceName: stringValue(body.device_name, "KRW Desktop"),
      installationId: optionalStringValue(body.installation_id),
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

function rateLimitResponse(result: Exclude<Awaited<ReturnType<typeof checkDurableRateLimits>>, { ok: true }>) {
  const headers =
    result.retryAfterSeconds === undefined
      ? undefined
      : { "Retry-After": String(result.retryAfterSeconds) };
  return Response.json(
    {
      error: {
        code: result.code,
        message:
          result.status === 429
            ? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
            : "요청 제한 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
      },
    },
    { status: result.status, headers },
  );
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
