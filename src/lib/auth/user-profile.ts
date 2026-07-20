import "server-only";

import type { User } from "@supabase/supabase-js";
import type { TopNavUserProfile } from "@/components/TopNav";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function topNavProfileFromUser(
  user: User | null | undefined,
): TopNavUserProfile | null {
  if (!user?.email) return null;

  const metadata = user.user_metadata;
  return {
    id: user.id,
    email: user.email,
    name:
      stringValue(metadata?.full_name) ??
      stringValue(metadata?.name) ??
      stringValue(metadata?.display_name),
    avatarUrl:
      stringValue(metadata?.avatar_url) ??
      stringValue(metadata?.picture) ??
      stringValue(metadata?.photo_url),
  };
}

export function shouldPreserveInitialProfile(
  user: User | null | undefined,
): boolean {
  return user?.app_metadata?.provider === "dev-auth-bypass";
}
