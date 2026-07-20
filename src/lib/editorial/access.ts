import type { User } from "@supabase/supabase-js";

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

  return process.env.NODE_ENV === "development" && email.endsWith("@local.test");
}
