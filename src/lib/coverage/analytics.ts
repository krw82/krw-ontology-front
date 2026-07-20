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
    eventName: result.mark.coverage_level === null
      ? "coverage_cleared"
      : "coverage_level_changed",
    userId,
    properties: {
      coverage_event_id: result.eventId,
      ticker: result.mark.ticker,
      previous_coverage_level: result.previousLevel ?? "none",
      coverage_level: result.mark.coverage_level ?? "none",
      source,
    },
  });
}
