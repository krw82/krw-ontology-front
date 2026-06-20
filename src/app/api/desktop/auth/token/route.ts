import type { NextRequest } from "next/server";
import {
  checkDurableRateLimits,
  readPositiveIntEnv,
} from "@/lib/api/rate-limit";
import { handleDesktopApiError } from "@/lib/desktop/api-responses";
import { exchangeDesktopAuthorizationCode } from "@/lib/desktop/authorization";
import { DesktopAuthError } from "@/lib/desktop/auth";
import { getClientIp } from "@/lib/http/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TOKEN_EXCHANGES_PER_IP_PER_MINUTE = 30;

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkDurableRateLimits([
      {
        key: `ip:${getClientIp(request.headers)}`,
        bucket: "desktop_authorization_exchange:ip:minute",
        limit: readPositiveIntEnv(
          "DESKTOP_AUTHORIZATION_EXCHANGES_PER_IP_PER_MINUTE",
          DEFAULT_TOKEN_EXCHANGES_PER_IP_PER_MINUTE,
        ),
      },
    ]);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit);

    const body = await request.json();
    const response = await exchangeDesktopAuthorizationCode({
      clientId: requiredString(body.client_id, "client_id"),
      redirectUri: requiredString(body.redirect_uri, "redirect_uri"),
      authorizationCode: requiredString(body.code, "code"),
      codeVerifier: requiredString(body.code_verifier, "code_verifier"),
    });
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleDesktopApiError(error);
  }
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
            ? "인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
            : "인증 요청 제한 상태를 확인하지 못했습니다.",
      },
    },
    { status: result.status, headers },
  );
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new DesktopAuthError(`${name} is required`, {
      publicMessage: "Desktop 인증 코드 교환 요청이 올바르지 않습니다.",
      status: 400,
    });
  }
  return value.trim();
}
