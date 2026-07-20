import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function tryRecordCoverageActivation(
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "try_record_coverage_activation",
      { p_user_id: userId },
    );
    if (error) {
      console.warn("[coverage] failed to evaluate activation milestone", {
        reason: error.message,
      });
      return false;
    }
    return data === true;
  } catch (error) {
    console.warn("[coverage] failed to start activation milestone check", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}
