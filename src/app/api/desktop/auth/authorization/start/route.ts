import type { NextRequest } from "next/server";
import {
  checkDurableRateLimits,
  readPositiveIntEnv,
} from "@/lib/api/rate-limit";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { startDesktopAuthorization } from "@/lib/desktop/authorization";
import { DesktopAuthError } from "@/lib/desktop/auth";
import { getClientIp } from "@/lib/http/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_AUTHORIZATION_STARTS_PER_IP_PER_MINUTE = 10;

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkDurableRateLimits([
      {
        key: `ip:${getClientIp(request.headers)}`,
        bucket: "desktop_authorization_start:ip:minute",
        limit: readPositiveIntEnv(
          "DESKTOP_AUTHORIZATION_STARTS_PER_IP_PER_MINUTE",
          DEFAULT_AUTHORIZATION_STARTS_PER_IP_PER_MINUTE,
        ),
      },
    ]);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit);

    const body = objectValue(await request.json());
    const device = objectValue(body.device);
    const response = await startDesktopAuthorization(
      {
        clientId: requiredString(body.client_id, "client_id"),
        redirectUri: requiredString(body.redirect_uri, "redirect_uri"),
        codeChallenge: requiredString(
          body.code_challenge,
          "code_challenge",
        ),
        codeChallengeMethod: requiredString(
          body.code_challenge_method,
          "code_challenge_method",
        ),
        state: requiredString(body.state, "state"),
        installationId: requiredString(
          body.installation_id,
          "installation_id",
        ),
        deviceName: optionalString(device.name) ?? "KRW Desktop",
        platform: optionalString(device.platform),
        arch: optionalString(device.arch),
        appVersion: optionalString(device.app_version),
        protocolVersion:
          optionalString(device.protocol_version) ?? "desktop/v1",
      },
      request.nextUrl.origin,
    );

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new DesktopAuthError("Request body must be an object", {
    publicMessage: "Desktop 인증 요청 형식이 올바르지 않습니다.",
    status: 400,
  });
}

function requiredString(value: unknown, name: string) {
  const text = optionalString(value);
  if (!text) {
    throw new DesktopAuthError(`${name} is required`, {
      publicMessage: "Desktop 인증 요청에 필요한 값이 없습니다.",
      status: 400,
    });
  }
  return text;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rateLimitResponse(
  result: Exclude<
    Awaited<ReturnType<typeof checkDurableRateLimits>>,
    { ok: true }
  >,
) {
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
            : "요청 제한 상태를 확인하지 못했습니다.",
      },
    },
    { status: result.status, headers },
  );
}
