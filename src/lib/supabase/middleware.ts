import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import { isDevAuthBypassEnabledForHost } from "@/lib/dev-auth-runtime";
import { normalizeInternalNextPath } from "@/lib/auth/redirect-path";
import type { Database } from "@/types/database";

interface UpdateSessionOptions {
  requestHeaderOverrides?: Headers;
}

export async function updateSession(
  request: NextRequest,
  { requestHeaderOverrides }: UpdateSessionOptions = {},
) {
  function nextResponseWithRequestHeaders() {
    const headers = new Headers(request.headers);
    requestHeaderOverrides?.forEach((value, key) => {
      headers.set(key, value);
    });

    return NextResponse.next({ request: { headers } });
  }

  let supabaseResponse = nextResponseWithRequestHeaders();
  const protectedPaths = ["/chat", "/settings"];
  const isProtected = protectedPaths.some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );
  const isLogin = request.nextUrl.pathname === "/login";
  const isDesktopLoginApproval =
    isLogin && request.nextUrl.searchParams.has("desktop_code");
  const hasOAuthCode = request.nextUrl.searchParams.has("code");

  if (
    hasOAuthCode &&
    request.nextUrl.pathname !== "/auth/callback" &&
    (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/login")
  ) {
    const url = new URL("/auth/callback", request.nextUrl.origin);
    request.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
    return NextResponse.redirect(url);
  }

  if (isDevAuthBypassEnabledForHost(request.nextUrl.hostname)) {
    if (request.nextUrl.pathname === "/login" && !isDesktopLoginApproval) {
      const url = new URL(
        normalizeInternalNextPath(request.nextUrl.searchParams.get("next")),
        request.nextUrl.origin,
      );
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  }

  if (!isProtected && !isLogin) {
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = nextResponseWithRequestHeaders();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtected) {
    const url = new URL("/login", request.nextUrl.origin);
    const nextPath = normalizeInternalNextPath(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && isLogin && !isDesktopLoginApproval) {
    const url = new URL(
      normalizeInternalNextPath(request.nextUrl.searchParams.get("next")),
      request.nextUrl.origin,
    );
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
