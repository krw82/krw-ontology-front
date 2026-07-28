import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient<any> | null = null;

export function getMarketIssueServiceClient(): SupabaseClient<any> {
  if (client) return client;

  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) {
    throw new Error("market_issue_supabase_service_credentials_missing");
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return client;
}
