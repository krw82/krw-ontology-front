import { NextResponse } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getConfiguredRedirectOrigin } from "@/lib/auth/origin";
import { normalizeInternalNextPath } from "@/lib/auth/redirect-path";
import { createClient } from "@/lib/supabase/server";

// The landing route resolves the user-owned first-login state. Keeping it as
// the default preserves explicit deep links while avoiding a client-side race
// between the auth callback and the first destination.
const FALLBACK_NEXT_PATH = "/auth/landing";

function getSafeNextPath(value: string | null): string {
  return normalizeInternalNextPath(value, FALLBACK_NEXT_PATH);
}

function getRedirectOrigin(origin: string): string {
  return getConfiguredRedirectOrigin(origin);
}

function truncateLogValue(value: string | null): string | null {
  if (!value) return null;
  return value.length > 240 ? `${value.slice(0, 240)}...` : value;
}

function getErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? truncateLogValue(message) : null;
}

function loginErrorUrl(redirectOrigin: string, reason: string): URL {
  const url = new URL("/login", redirectOrigin);
  url.searchParams.set("error", "oauth");
  url.searchParams.set("reason", reason);
  return url;
}

async function redirectIfSessionExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  next: string,
  redirectOrigin: string,
): Promise<NextResponse | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      return NextResponse.redirect(new URL(next, redirectOrigin));
    }
  } catch (error) {
    console.warn("[auth] failed to inspect session after OAuth callback error", {
      message: getErrorMessage(error),
    });
  }

  return null;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeNextPath(requestUrl.searchParams.get("next"));
  const redirectOrigin = getRedirectOrigin(requestUrl.origin);
  const providerError =
    requestUrl.searchParams.get("error") ||
    requestUrl.searchParams.get("error_code");

  if (providerError) {
    console.warn("[auth] OAuth provider callback failed", {
      error: truncateLogValue(providerError),
      description: truncateLogValue(
        requestUrl.searchParams.get("error_description"),
      ),
    });
    return NextResponse.redirect(loginErrorUrl(redirectOrigin, "provider"));
  }

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      try {
        await recordAnalyticsEventFromRequest(request, {
          eventName: "login_completed",
          userId: data?.user?.id ?? null,
          properties: {
            next_path: next,
            provider: "google",
          },
        });
      } catch (analyticsError) {
        console.warn("[auth] failed to record login analytics", {
          message: getErrorMessage(analyticsError),
        });
      }
      return NextResponse.redirect(new URL(next, redirectOrigin));
    }

    console.warn("[auth] OAuth code exchange failed", {
      message: getErrorMessage(error),
    });
    return (
      (await redirectIfSessionExists(supabase, next, redirectOrigin)) ??
      NextResponse.redirect(loginErrorUrl(redirectOrigin, "exchange"))
    );
  }

  console.warn("[auth] OAuth callback reached without code");
  return (
    (await redirectIfSessionExists(supabase, next, redirectOrigin)) ??
    NextResponse.redirect(loginErrorUrl(redirectOrigin, "missing_code"))
  );
}
