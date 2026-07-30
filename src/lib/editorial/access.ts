import type { User } from "@supabase/supabase-js";
import { DEV_AUTH_EMAIL, isLocalDevHost } from "@/lib/dev-auth";

/**
 * The editorial console is deliberately a local operations tool. Public
 * company and Pulse pages may render published images in every environment,
 * but the console and all draft/write paths must never be exposed by a
 * production deployment.
 */
export function isLocalEditorialAdminHost(host: string | null | undefined): boolean {
  if (process.env.NODE_ENV !== "development" || !host) return false;

  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return isLocalDevHost(hostname);
  } catch {
    return false;
  }
}

export function isLocalEditorialAdminRequest(request: Pick<Request, "url" | "headers">): boolean {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    return isLocalEditorialAdminHost(host);
  } catch {
    return false;
  }
}

/**
 * Editorial mutations always run through a server route. Production access is
 * opt-in through PULSE_EDITORIAL_ADMIN_EMAILS; local test accounts are allowed
 * only while running Next in development.
 */
export function isEditorialAdmin(user: Pick<User, "email">): boolean {
  const email = user.email?.trim().toLowerCase();
  if (!email) return false;

  const configured = (process.env.PULSE_EDITORIAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.includes(email)) return true;

  return process.env.NODE_ENV === "development" && (
    email === DEV_AUTH_EMAIL || email.endsWith("@local.test")
  );
}
