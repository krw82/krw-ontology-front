import { NextResponse } from "next/server";
import { normalizeInternalNextPath } from "@/lib/auth/redirect-path";
import { createClient } from "@/lib/supabase/server";

const FALLBACK_NEXT_PATH = "/companies";
const REDIRECT_ORIGIN_ENV_KEYS = [
  "AUTH_REDIRECT_ORIGIN",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

function getSafeNextPath(value: string | null): string {
  return normalizeInternalNextPath(value, FALLBACK_NEXT_PATH);
}

function normalizeRedirectOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getRedirectOrigin(origin: string): string {
  for (const key of REDIRECT_ORIGIN_ENV_KEYS) {
    const configuredOrigin = normalizeRedirectOrigin(process.env[key]);
    if (configuredOrigin) return configuredOrigin;
  }

  return origin;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeNextPath(requestUrl.searchParams.get("next"));
  const redirectOrigin = getRedirectOrigin(requestUrl.origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, redirectOrigin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=oauth", redirectOrigin));
}
