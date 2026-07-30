import "server-only";

import type { User } from "@supabase/supabase-js";
import { DEV_AUTH_EMAIL } from "@/lib/dev-auth";

export function isMarketIssueAdmin(user: Pick<User, "email">): boolean {
  const email = user.email?.trim().toLowerCase();
  if (!email) return false;

  const configured = (
    process.env.MARKET_ISSUE_ADMIN_EMAILS ||
    process.env.PULSE_EDITORIAL_ADMIN_EMAILS ||
    ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (configured.includes(email)) return true;
  return process.env.NODE_ENV === "development" && (
    email === DEV_AUTH_EMAIL || email.endsWith("@local.test")
  );
}
