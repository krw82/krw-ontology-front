import { updateSession } from "@/lib/supabase/middleware";
import { getConfiguredAppOrigin } from "@/lib/auth/origin";
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
}: {
  contentSecurityPolicy: ReturnType<typeof createCspRequestHeaders> | null;
  locale: Locale;
}) {
  const requestHeaderOverrides =
    contentSecurityPolicy?.requestHeaderOverrides ?? new Headers();
  requestHeaderOverrides.set("x-krw-locale", locale);
  return requestHeaderOverrides;
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

  const requestLocale = getRequestLocale(request);
  const csp = shouldApplyContentSecurityPolicy(request.nextUrl.pathname)
    ? createCspRequestHeaders()
    : null;

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
