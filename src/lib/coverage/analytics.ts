import "server-only";

import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import type { CompanyCoverageMutationResult } from "@/lib/coverage/repository";

export async function recordCoverageMutationAnalytics(
  request: Request,
  userId: string,
  result: CompanyCoverageMutationResult,
  source: "watchlist" | "companies" | "desktop" | "onboarding" | "api",
) {
  if (result.idempotentReplay || !result.changed) return;
  await recordAnalyticsEventFromRequest(request, {
    eventName: result.previousStatus === null
      ? "coverage_added"
      : "coverage_status_changed",
    userId,
    properties: {
      coverage_event_id: result.eventId,
      ticker: result.mark.ticker,
      previous_coverage_status: result.previousStatus ?? "none",
      coverage_status: result.mark.coverage_status,
      source,
    },
  });
}
