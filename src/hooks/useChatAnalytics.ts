"use client";

import { useEffect, useRef } from "react";

import { trackClientEventSilently } from "@/lib/analytics/client";
import type { EntitlementStatus } from "@/types/entitlement";

export interface UseChatAnalyticsParams {
  initialComposerValue: string | undefined;
  prefillSource: "url_query" | "share_cta" | "template_id" | null;
  templateSlug: string | null | undefined;
  contextTickersKey: string;
  entitlement: EntitlementStatus | null;
}

export function useChatAnalytics({
  initialComposerValue,
  prefillSource,
  templateSlug,
  contextTickersKey,
  entitlement,
}: UseChatAnalyticsParams): void {
  const budgetAlertTrackedRef = useRef<string | null>(null);
  const prefilledQuestionTrackedRef = useRef<string | null>(null);

  useEffect(() => {
    const trimmedQuestion = initialComposerValue?.trim();
    if (!trimmedQuestion || !prefillSource) return;

    const eventKey = `${prefillSource}:${templateSlug ?? "custom"}:${trimmedQuestion}:${contextTickersKey || "global"}`;
    if (prefilledQuestionTrackedRef.current === eventKey) return;
    prefilledQuestionTrackedRef.current = eventKey;

    const analyticsTickers = contextTickersKey
      ? contextTickersKey.split(",").filter(Boolean)
      : [];

    trackClientEventSilently("question_prefilled", {
      source: prefillSource,
      template_id: templateSlug ?? null,
      ticker: analyticsTickers[0] ?? null,
      tickers: analyticsTickers,
      question_length: trimmedQuestion.length,
    });
  }, [contextTickersKey, initialComposerValue, prefillSource, templateSlug]);

  useEffect(() => {
    const alertLevel = entitlement?.usage.alert_level;
    if (!alertLevel || alertLevel === "ok") return;

    const eventKey = `${entitlement.plan.key}:${entitlement.usage.period_start}:${alertLevel}:${entitlement.usage.budget_used_usd}:${entitlement.usage.budget_reserved_usd}`;
    if (budgetAlertTrackedRef.current === eventKey) return;
    budgetAlertTrackedRef.current = eventKey;

    trackClientEventSilently(
      alertLevel === "blocked" ? "usage_limit_reached" : "usage_warning_shown",
      {
        plan: entitlement.plan.key,
        budget_used_usd: entitlement.usage.budget_used_usd,
        budget_reserved_usd: entitlement.usage.budget_reserved_usd,
        budget_limit_usd: entitlement.usage.budget_limit_usd,
        percent_used: entitlement.usage.percent_used,
      },
    );
  }, [entitlement]);
}
