import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import type { AnalyticsEventName } from "@/lib/analytics/events";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import {
  recordOnboardingStateAction,
  type OnboardingStateAction,
} from "@/lib/onboarding/state";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  action: z.enum([
    "started",
    "company_selected",
    "question_started",
    "skipped",
  ]),
  ticker: z.string().trim().min(1).max(16).optional(),
  has_company_context: z.boolean().optional(),
  preview: z.boolean().optional(),
}).strict();

const analyticsEventByAction: Record<OnboardingStateAction, AnalyticsEventName> = {
  started: "onboarding_started",
  company_selected: "onboarding_company_selected",
  question_started: "onboarding_question_started",
  evidence_opened: "onboarding_evidence_opened",
  skipped: "onboarding_skipped",
};

export async function PATCH(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();

  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "validation_error", message: "온보딩 상태가 올바르지 않습니다." } },
      { status: 400 },
    );
  }

  const ticker = parsed.data.ticker ? normalizeTicker(parsed.data.ticker) : null;
  if (parsed.data.ticker && !ticker) {
    return Response.json(
      { error: { code: "validation_error", message: "회사 티커가 올바르지 않습니다." } },
      { status: 400 },
    );
  }

  try {
    const result = await recordOnboardingStateAction(
      getSupabaseAdmin(),
      user.id,
      parsed.data.action,
    );
    if (result.changed && result.state) {
      await recordAnalyticsEventFromRequest(request, {
        eventName: analyticsEventByAction[parsed.data.action],
        userId: user.id,
        properties: {
          ...(ticker ? { ticker } : {}),
          ...(parsed.data.action === "question_started"
            ? { has_company_context: parsed.data.has_company_context === true }
            : {}),
          ...(parsed.data.preview ? { preview: true } : {}),
        },
      });
    }
    return Response.json(
      { state: result.state },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: { code: "service_unavailable", message: "온보딩 상태를 저장하지 못했습니다." } },
      { status: 503 },
    );
  }
}
