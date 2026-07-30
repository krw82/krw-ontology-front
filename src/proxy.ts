import { updateSession } from "@/lib/supabase/middleware";
import { getConfiguredAppOrigin } from "@/lib/auth/origin";
import { isLocalEditorialAdminRequest } from "@/lib/editorial/access";
import { hasTrustedClientIp } from "@/lib/http/client-ip";
import { buildContentSecurityPolicy } from "@/lib/security/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import {
  getPathLocale,
  isPublicLocalizedPathname,
  localizedPath,
  stripLocalePrefix,
} from "@/i18n/routing";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isDevelopment = process.env.NODE_ENV === "development";
const SAFE_INTERNAL_ORIGIN = "https://krw-ontology.local";

function isDockerHealthCheck(pathname: string) {
  return pathname === "/api/healthz";
}

function isLocalEditorialOperation(pathname: string) {
  return pathname === "/admin/editorial"
    || pathname.startsWith("/admin/editorial/")
    || pathname === "/api/editorial"
    || /^\/api\/editorial\/[0-9a-f-]{36}$/i.test(pathname);
}

function localEditorialNotFoundResponse() {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function requiresTrustedClientIp(request: NextRequest) {
  return (
    process.env.NODE_ENV === "production" &&
    !isDockerHealthCheck(request.nextUrl.pathname)
  );
}

function clientIpUnavailableResponse() {
  return NextResponse.json(
    {
      error: {
        code: "service_unavailable",
        message: "서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
      },
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function shouldApplyContentSecurityPolicy(pathname: string) {
  return pathname !== "/offline.html" && !pathname.startsWith("/api/");
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

function getRequestLocale(request: NextRequest): Locale {
  const explicitLocale = request.headers.get("x-krw-locale");
  if (isLocale(explicitLocale)) return explicitLocale;

  const pathLocale = getPathLocale(request.nextUrl.pathname);
  if (pathLocale) return pathLocale;

  const queryLocale = request.nextUrl.searchParams.get("locale");
  if (isLocale(queryLocale)) return queryLocale;

  const nextLocale = getLocaleFromInternalPath(
    request.nextUrl.searchParams.get("next"),
  );
  if (nextLocale) return nextLocale;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererLocale = getPathLocale(new URL(referer).pathname);
      if (refererLocale) return refererLocale;
    } catch {
      // Ignore malformed Referer headers and fall back to the default locale.
    }
  }

  return DEFAULT_LOCALE;
}

function getLocaleFromInternalPath(value: string | null): Locale | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, SAFE_INTERNAL_ORIGIN);
    const pathLocale = getPathLocale(url.pathname);
    if (pathLocale) return pathLocale;

    const queryLocale = url.searchParams.get("locale");
    return isLocale(queryLocale) ? queryLocale : null;
  } catch {
    return null;
  }
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
  pathname,
}: {
  contentSecurityPolicy: ReturnType<typeof createCspRequestHeaders> | null;
  locale: Locale;
  pathname: string;
}) {
  const requestHeaderOverrides =
    contentSecurityPolicy?.requestHeaderOverrides ?? new Headers();
  requestHeaderOverrides.set("x-krw-locale", locale);
  // Always overwrite a browser-provided value. RootLayout uses this trusted
  // request path to avoid loading workspace identity on public marketing pages.
  requestHeaderOverrides.set("x-krw-pathname", pathname);
  return requestHeaderOverrides;
}

export async function proxy(request: NextRequest) {
  // Public pages can consume published editorial assets everywhere, but the
  // operations console and its mutation endpoints are never part of a GCP
  // deployment. Keep this before every other proxy concern so production
  // returns an opaque 404 rather than an auth, route, or IP-policy response.
  if (isLocalEditorialOperation(request.nextUrl.pathname) && !isLocalEditorialAdminRequest(request)) {
    return localEditorialNotFoundResponse();
  }

  // Only Caddy can set this header for publicly reachable traffic. Rejecting
  // a missing or malformed value here prevents rate-limit routes from sharing
  // the fallback `ip:unknown` bucket when that deployment boundary breaks.
  if (requiresTrustedClientIp(request) && !hasTrustedClientIp(request.headers)) {
    return clientIpUnavailableResponse();
  }

  const canonicalRedirectUrl = getCanonicalRedirectUrl(request);
  if (canonicalRedirectUrl) {
    return NextResponse.redirect(canonicalRedirectUrl, 308);
  }

  const localeRedirectUrl = getLocaleRedirectUrl(request);
  if (localeRedirectUrl) {
    return NextResponse.redirect(localeRedirectUrl, 308);
  }

  const requestLocale = getRequestLocale(request);
  const csp = shouldApplyContentSecurityPolicy(request.nextUrl.pathname)
    ? createCspRequestHeaders()
    : null;

  const response = await updateSession(request, {
    requestHeaderOverrides: createRequestHeaderOverrides({
      contentSecurityPolicy: csp,
      locale: requestLocale,
      pathname: request.nextUrl.pathname,
    }),
  });
  if (csp) {
    response.headers.set("Content-Security-Policy", csp.contentSecurityPolicy);
  }

  return response;
}

export const config = {
  matcher: [
    // API routes own rate-limit buckets and must not be bypassed by a
    // browser-controlled prefetch marker.
    "/api/:path*",
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
