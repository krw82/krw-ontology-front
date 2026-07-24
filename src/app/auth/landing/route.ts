import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getConfiguredRedirectOrigin } from "@/lib/auth/origin";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { queryLocalizedPath } from "@/i18n/routing";
import {
  getOnboardingState,
  recordOnboardingStateAction,
} from "@/lib/onboarding/state";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function landingPathForLocale(locale: string): string {
  return queryLocalizedPath(
    isLocale(locale) ? locale : DEFAULT_LOCALE,
    "/auth/landing",
  );
}

function loginPath(landingPath: string): string {
  return `/login?next=${encodeURIComponent(landingPath)}`;
}

function companiesPath(locale: "ko" | "en"): string {
  const destination = queryLocalizedPath(locale, "/companies");
  return `${destination}?tour=1`;
}

/**
 * The only default post-login branch. A new account receives the company
 * directory once; marking that visit started makes every later sign-in land
 * in Pulse. Explicit `next` destinations still bypass this route entirely.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const requestedLocale = requestUrl.searchParams.get("locale");
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  const landingPath = landingPathForLocale(locale);
  const redirectOrigin = getConfiguredRedirectOrigin(requestUrl.origin);

  const user = await getAuthUser().catch(() => null);
  if (!user) {
    return NextResponse.redirect(new URL(loginPath(landingPath), redirectOrigin));
  }

  // Local development intentionally keeps this entry repeatable for the
  // existing test account. Production remains state-driven below.
  if (process.env.NODE_ENV === "development") {
    return NextResponse.redirect(new URL(companiesPath(locale), redirectOrigin));
  }

  try {
    const admin = getSupabaseAdmin();
    const state = await getOnboardingState(admin, user.id);
    if (state?.status === "not_started") {
      // The durable state changes before the redirect, so refreshes and future
      // sign-ins resolve to the feed instead of repeating a company prompt.
      await recordOnboardingStateAction(admin, user.id, "started");
      return NextResponse.redirect(
        new URL(companiesPath(locale), redirectOrigin),
      );
    }
  } catch (error) {
    console.warn("[auth] failed to resolve default landing", {
      message: error instanceof Error ? error.message : null,
    });
  }

  return NextResponse.redirect(
    new URL(queryLocalizedPath(locale, "/pulse"), redirectOrigin),
  );
}
