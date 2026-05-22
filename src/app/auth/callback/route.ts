import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FALLBACK_NEXT_PATH = "/companies";
const SAFE_NEXT_ORIGIN = "https://krw-ontology.local";
const REDIRECT_ORIGIN_ENV_KEYS = [
  "AUTH_REDIRECT_ORIGIN",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

function getSafeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return FALLBACK_NEXT_PATH;
  }

  try {
    const nextUrl = new URL(value, SAFE_NEXT_ORIGIN);
    if (nextUrl.origin !== SAFE_NEXT_ORIGIN) {
      return FALLBACK_NEXT_PATH;
    }
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return FALLBACK_NEXT_PATH;
  }
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
