import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { tryRecordCoverageActivation } from "@/lib/coverage/activation";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCompanyCoverageForWrite,
  errorResponse,
  requireIndexedTicker,
} from "@/lib/watchlist/api";
import type { UserCompanyMonitoringRuleRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ruleSchema = z.discriminatedUnion("rule_type", [
  z.object({
    rule_type: z.literal("scheduled_review"),
    next_review_at: z.iso.datetime(),
  }),
  z.object({
    rule_type: z.enum(["filing_form", "filing_item", "keyword"]),
    value: z.string().trim().min(1).max(500),
  }),
]);

const RULE_SELECT =
  "id,user_id,ticker,rule_type,operator,value,next_review_at,dedupe_key,enabled,created_by_judgment_revision_id,created_at,updated_at";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const tickerResult = await requireIndexedTicker((await params).ticker);
  if (!tickerResult.ok) return tickerResult.response;
  const parsed = ruleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "validation_error", "다음 확인 조건을 확인해주세요.");
  }

  const coverageError = await ensureCompanyCoverageForWrite({
    userId: user.id,
    userEmail: user.email,
    ticker: tickerResult.ticker,
    source: "monitoring_rule_created",
    requireActive: true,
  });
  if (coverageError) return coverageError;

  const now = Date.now();
  let operator: UserCompanyMonitoringRuleRow["operator"];
  let value: string | null;
  let nextReviewAt: string | null;
  let dedupeKey: string;
  if (parsed.data.rule_type === "scheduled_review") {
    const reviewAt = new Date(parsed.data.next_review_at);
    if (
      !Number.isFinite(reviewAt.getTime()) ||
      reviewAt.getTime() < now + 60_000 ||
      reviewAt.getTime() > now + 2 * 365 * 24 * 60 * 60 * 1_000
    ) {
      return errorResponse(400, "validation_error", "다음 확인 시점은 1분 뒤부터 2년 안으로 정해주세요.");
    }
    operator = "on_or_after";
    value = null;
    nextReviewAt = reviewAt.toISOString();
    dedupeKey = `scheduled_review|on_or_after|${nextReviewAt}`;
  } else {
    operator = parsed.data.rule_type === "keyword" ? "contains" : "matches";
    value = parsed.data.value;
    nextReviewAt = null;
    dedupeKey = `${parsed.data.rule_type}|${operator}|${value.toLocaleLowerCase("en-US")}`;
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_company_monitoring_rules")
    .upsert(
      {
        user_id: user.id,
        ticker: tickerResult.ticker,
        rule_type: parsed.data.rule_type,
        operator,
        value,
        next_review_at: nextReviewAt,
        dedupe_key: dedupeKey,
        enabled: true,
        created_by_judgment_revision_id: null,
      },
      { onConflict: "user_id,ticker,dedupe_key" },
    )
    .select(RULE_SELECT)
    .single<UserCompanyMonitoringRuleRow>();
  if (error || !data) {
    return errorResponse(500, "internal_error", "다음 확인 조건을 저장하지 못했습니다.");
  }

  await recordAnalyticsEventFromRequest(request, {
    eventName: "monitoring_rule_created",
    userId: user.id,
    properties: {
      monitoring_rule_id: data.id,
      ticker: data.ticker,
      rule_type: data.rule_type,
      source: "watchlist",
      source_type: "monitoring_rule",
      status: "created",
    },
  });
  await tryRecordCoverageActivation(user.id);
  return Response.json({ rule: data }, { status: 201 });
}
