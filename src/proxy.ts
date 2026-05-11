import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.lastReset > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, lastReset: now });
    return false;
  }

  entry.count++;
  return entry.count > MAX_REQUESTS;
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
  if (request.nextUrl.pathname === "/api/chat/run") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
