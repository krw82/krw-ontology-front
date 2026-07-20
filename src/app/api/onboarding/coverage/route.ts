import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { tryRecordCoverageActivation } from "@/lib/coverage/activation";
import { toCoverageOnboardingProgress } from "@/lib/onboarding/coverage-flow";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UserRetentionMilestoneRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filingEventIdSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const rawFilingEventId = request.nextUrl.searchParams.get("filing_event_id");
  const filingEventId = rawFilingEventId
    ? filingEventIdSchema.safeParse(rawFilingEventId)
    : null;
  if (filingEventId && !filingEventId.success) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "공시 식별자가 올바르지 않습니다.",
        },
      },
      { status: 400 },
    );
  }

  // Reconcile idempotently so completion never depends on which client or
  // ordering supplied the final prerequisite.
  await tryRecordCoverageActivation(user.id);
  const admin = getSupabaseAdmin();
  const [
    milestoneResult,
    coverageResult,
    judgmentResult,
    monitoringRuleResult,
    evidenceResult,
    filingEvidenceResult,
  ] = await Promise.all([
    admin
      .from("user_retention_milestones")
      .select("achieved_at")
      .eq("user_id", user.id)
      .eq("milestone", "coverage_activated")
      .maybeSingle<Pick<UserRetentionMilestoneRow, "achieved_at">>(),
    admin
      .from("user_company_marks")
      .select("ticker", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("coverage_status", ["exploring", "watching", "holding"]),
    admin
      .from("user_filing_judgments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("current_revision_id", "is", null),
    admin
      .from("user_company_monitoring_rules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("enabled", true),
    admin
      .from("user_filing_source_opens")
      .select("filing_event_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .limit(1),
    filingEventId?.success
      ? admin
          .from("user_filing_source_opens")
          .select("filing_event_id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("filing_event_id", filingEventId.data)
      : Promise.resolve({ count: 0, error: null }),
  ]);

  const error =
    milestoneResult.error ??
    coverageResult.error ??
    judgmentResult.error ??
    monitoringRuleResult.error ??
    evidenceResult.error ??
    filingEvidenceResult.error;
  if (error) {
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message: "온보딩 진행 상태를 불러오지 못했습니다.",
        },
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      progress: {
        ...toCoverageOnboardingProgress({
          achievedAt: milestoneResult.data?.achieved_at ?? null,
          coverageCount: coverageResult.count,
          judgmentCount: judgmentResult.count,
          monitoringRuleCount: monitoringRuleResult.count,
          evidenceOpened: (evidenceResult.count ?? 0) > 0,
        }),
        filing_evidence_opened: (filingEvidenceResult.count ?? 0) > 0,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
