import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth";
import { requireEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export async function createClient() {
  if (isDevAuthBypassEnabled()) {
    return getSupabaseAdmin();
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Cookie already set by middleware or cannot be set from Server Component
          }
        },
      },
    }
  );
}
