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

async function hasAnyResearchSession(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * The only default post-login branch. Users who have never run a single
 * research session keep landing on the company directory until they start
 * one; a recorded onboarding skip opts out early. Everyone else — and any
 * lookup failure — lands in Pulse. Explicit `next` destinations still
 * bypass this route entirely.
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

  try {
    const admin = getSupabaseAdmin();
    const [state, hasResearch] = await Promise.all([
      getOnboardingState(admin, user.id),
      hasAnyResearchSession(admin, user.id),
    ]);

    if (!hasResearch && state?.status !== "skipped") {
      // Observability only — routing is decided by the session check, so a
      // user who bounces without researching is guided again next sign-in.
      await recordOnboardingStateAction(admin, user.id, "started").catch(
        () => null,
      );
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
