import { updateSession } from "@/lib/supabase/middleware";
import { getClientIp } from "@/lib/http/client-ip";
import { getConfiguredAppOrigin } from "@/lib/auth/origin";
import { buildContentSecurityPolicy } from "@/lib/security/headers";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import {
  getPathLocale,
  isPublicLocalizedPathname,
  localizedPath,
  stripLocalePrefix,
} from "@/i18n/routing";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const WINDOW_MS = 60_000;
const DEFAULT_GROSS_ABUSE_LIMIT = 300;
const isDevelopment = process.env.NODE_ENV === "development";

function getGrossAbuseLimit(): number {
  const raw = process.env.CHAT_RUN_PROXY_GROSS_ABUSE_PER_MINUTE;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? parsed
    : DEFAULT_GROSS_ABUSE_LIMIT;
}

function isRateLimited(ip: string, limit = getGrossAbuseLimit()): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.lastReset > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, lastReset: now });
    return false;
  }

  entry.count++;
  return entry.count > limit;
}

function shouldApplyContentSecurityPolicy(pathname: string) {
  return !pathname.startsWith("/api/");
}

function shouldApplyCanonicalRedirect(pathname: string) {
  return !pathname.startsWith("/api/") && !pathname.startsWith("/internal/");
}

function getCanonicalRedirectUrl(request: NextRequest): URL | null {
  if (
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    return null;
  }
  if (!shouldApplyCanonicalRedirect(request.nextUrl.pathname)) return null;

  const canonicalOrigin = getConfiguredAppOrigin();
  if (!canonicalOrigin) return null;

  const canonicalUrl = new URL(canonicalOrigin);
  const requestHost =
    request.headers.get("host")?.split(":")[0]?.trim().toLowerCase() ||
    request.nextUrl.hostname;

  if (requestHost === canonicalUrl.hostname) {
    return null;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.protocol = canonicalUrl.protocol;
  redirectUrl.hostname = canonicalUrl.hostname;
  redirectUrl.port = canonicalUrl.port;
  return redirectUrl;
}

function getRequestLocale(pathname: string): Locale {
  return getPathLocale(pathname) ?? DEFAULT_LOCALE;
}

function getLocaleRedirectUrl(request: NextRequest): URL | null {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const { pathname } = request.nextUrl;
  if (getPathLocale(pathname)) return null;
  if (!isPublicLocalizedPathname(pathname)) return null;

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = localizedPath(DEFAULT_LOCALE, stripLocalePrefix(pathname));
  return redirectUrl;
}

function createCspRequestHeaders() {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy({
    isDevelopment,
    nonce,
  });
  const requestHeaderOverrides = new Headers();
  requestHeaderOverrides.set("x-nonce", nonce);
  requestHeaderOverrides.set(
    "Content-Security-Policy",
    contentSecurityPolicy,
  );

  return { contentSecurityPolicy, requestHeaderOverrides };
}

function createRequestHeaderOverrides({
  contentSecurityPolicy,
  locale,
}: {
  contentSecurityPolicy: ReturnType<typeof createCspRequestHeaders> | null;
  locale: Locale;
}) {
  const requestHeaderOverrides =
    contentSecurityPolicy?.requestHeaderOverrides ?? new Headers();
  requestHeaderOverrides.set("x-krw-locale", locale);
  return requestHeaderOverrides;
}

declare global {
  var _rateLimitCleanup: ReturnType<typeof setInterval> | undefined;
}

if (typeof globalThis._rateLimitCleanup === "undefined") {
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
      if (now - entry.lastReset > WINDOW_MS * 2) {
        rateLimitMap.delete(ip);
      }
    }
  }, WINDOW_MS);
  cleanup.unref?.();
  globalThis._rateLimitCleanup = cleanup;
}

export async function proxy(request: NextRequest) {
  const canonicalRedirectUrl = getCanonicalRedirectUrl(request);
  if (canonicalRedirectUrl) {
    return NextResponse.redirect(canonicalRedirectUrl, 308);
  }

  const localeRedirectUrl = getLocaleRedirectUrl(request);
  if (localeRedirectUrl) {
    return NextResponse.redirect(localeRedirectUrl, 308);
  }

  const requestLocale = getRequestLocale(request.nextUrl.pathname);
  const csp = shouldApplyContentSecurityPolicy(request.nextUrl.pathname)
    ? createCspRequestHeaders()
    : null;

  if (request.nextUrl.pathname === "/api/chat/run") {
    const ip = getClientIp(request.headers);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        {
          error: {
            code: "rate_limited" as const,
            message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-Rate-Limit-Scope": "proxy-gross-abuse",
          },
        },
      );
    }
  }

  const response = await updateSession(request, {
    requestHeaderOverrides: createRequestHeaderOverrides({
      contentSecurityPolicy: csp,
      locale: requestLocale,
    }),
  });
  if (csp) {
    response.headers.set("Content-Security-Policy", csp.contentSecurityPolicy);
  }

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

export function resetProxyRateLimitForTests() {
  rateLimitMap.clear();
}
