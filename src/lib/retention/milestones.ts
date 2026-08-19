import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export const RETENTION_MILESTONES = [
  "first_company_followed",
  "first_filing_subscription",
  "push_enabled",
] as const;

export type RetentionMilestone = (typeof RETENTION_MILESTONES)[number];

/**
 * Idempotent first-achievement marker for retention cohort analysis.
 * The (user_id, milestone) primary key plus ignoreDuplicates keeps the
 * ORIGINAL achieved_at, so re-follows never rewrite activation history.
 * Milestones are analytics-only: failures must never break the parent
 * mutation, hence the swallowed error.
 */
export async function recordRetentionMilestone(
  userId: string,
  milestone: RetentionMilestone,
  metadata?: Record<string, Json>,
): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from("user_retention_milestones")
      .upsert(
        {
          user_id: userId,
          milestone,
          achieved_at: new Date().toISOString(),
          metadata: metadata ?? {},
        },
        { onConflict: "user_id,milestone", ignoreDuplicates: true },
      );
  } catch (error) {
    console.error("retention_milestone_record_failed", milestone, error);
  }
}
