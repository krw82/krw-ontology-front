import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserOnboardingStateRow } from "@/types/database";

export const ONBOARDING_STATE_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "skipped",
] as const;

export type OnboardingStateStatus = (typeof ONBOARDING_STATE_STATUSES)[number];

export const ONBOARDING_STATE_ACTIONS = [
  "started",
  "company_selected",
  "question_started",
  "evidence_opened",
  "skipped",
] as const;

export type OnboardingStateAction = (typeof ONBOARDING_STATE_ACTIONS)[number];

export type OnboardingStateActionResult = {
  state: UserOnboardingStateRow | null;
  changed: boolean;
};

export function isPendingOnboardingState(
  state: Pick<UserOnboardingStateRow, "status"> | null | undefined,
): boolean {
  return state?.status === "not_started" || state?.status === "in_progress";
}

export function isMissingOnboardingStateTable(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    Boolean(error?.message?.includes("user_onboarding_states"))
  );
}

export async function getOnboardingState(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserOnboardingStateRow | null> {
  const { data, error } = await supabase
    .from("user_onboarding_states")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<UserOnboardingStateRow>();
  if (error) {
    if (isMissingOnboardingStateTable(error)) return null;
    throw error;
  }
  return data;
}

export async function recordOnboardingStateAction(
  supabase: SupabaseClient<Database>,
  userId: string,
  action: OnboardingStateAction,
): Promise<OnboardingStateActionResult> {
  const current = await getOnboardingState(supabase, userId);
  if (!current || !canRecordOnboardingAction(current, action)) {
    return { state: current, changed: false };
  }

  const now = new Date().toISOString();
  const patch = patchForOnboardingAction(action, now);
  const allowedStatuses: OnboardingStateStatus[] = [
    "not_started",
    "in_progress",
  ];

  const { data, error } = await supabase
    .from("user_onboarding_states")
    .update(patch)
    .eq("user_id", userId)
    .in("status", allowedStatuses)
    .select("*")
    .maybeSingle<UserOnboardingStateRow>();
  if (error) {
    if (isMissingOnboardingStateTable(error)) {
      return { state: null, changed: false };
    }
    throw error;
  }
  return { state: data, changed: Boolean(data) };
}

function canRecordOnboardingAction(
  state: UserOnboardingStateRow,
  action: OnboardingStateAction,
): boolean {
  if (state.status === "completed" || state.status === "skipped") return false;

  switch (action) {
    case "started":
      return state.started_at === null;
    case "company_selected":
      return state.first_company_selected_at === null;
    case "question_started":
      return state.first_question_started_at === null;
    case "evidence_opened":
      return state.first_evidence_opened_at === null;
    case "skipped":
      return state.skipped_at === null;
  }
}

export function patchForOnboardingAction(
  action: OnboardingStateAction,
  now: string,
): Database["public"]["Tables"]["user_onboarding_states"]["Update"] {
  switch (action) {
    case "started":
      return { status: "in_progress", started_at: now };
    case "company_selected":
      return { status: "in_progress", first_company_selected_at: now };
    case "question_started":
      return { status: "in_progress", first_question_started_at: now };
    case "evidence_opened":
      return {
        status: "completed",
        first_evidence_opened_at: now,
        completed_at: now,
      };
    case "skipped":
      return { status: "skipped", skipped_at: now };
  }
}
