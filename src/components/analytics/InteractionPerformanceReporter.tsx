"use client";

import { useEffect } from "react";
import {
  getOrCreateAnalyticsAnonymousId,
  trackClientEventSilently,
} from "@/lib/analytics/client";
import {
  ANALYTICS_NAVIGATION_COMMITTED_EVENT,
  navigationTargetMatches,
  normalizeSameOriginNavigationTarget,
  type NavigationCommittedDetail,
} from "@/lib/analytics/interaction-performance";
import {
  parseAnalyticsSampleRate,
  shouldSampleAnalyticsKey,
} from "@/lib/analytics/sampling";
import {
  APP_VERSION,
  SERVICE_WORKER_VERSION_DATASET_KEY,
} from "@/lib/app-version";
import { sanitizeAnalyticsLocationKey } from "@/lib/analytics/page-context";

const INTERACTION_SAMPLE_RATE = parseAnalyticsSampleRate(
  process.env.NEXT_PUBLIC_INTERACTION_METRICS_SAMPLE_RATE,
  process.env.NODE_ENV === "production" ? 0.1 : 1,
);
const MAX_LONG_TASK_REPORTS_PER_PAGE = 5;
const NAVIGATION_TIMEOUT_MS = 10_000;

type PendingNavigation = {
  startedAt: number;
  targetLocationKey: string;
  sourceLabel: string | null;
  timeoutId: number;
};

function reportInteractionMetric(
  metricName: string,
  metricValue: number,
  properties: Record<string, unknown> = {},
) {
  trackClientEventSilently("performance_metric_reported", {
    metric_name: metricName,
    metric_value: Math.max(0, Math.round(metricValue * 100) / 100),
    metric_category: "interaction",
    visibility_state: document.visibilityState,
    app_version: APP_VERSION,
    service_worker_version:
      document.documentElement.dataset[SERVICE_WORKER_VERSION_DATASET_KEY] ??
      null,
    ...properties,
  });
}

export default function InteractionPerformanceReporter() {
  useEffect(() => {
    const anonymousId = getOrCreateAnalyticsAnonymousId();
    if (!shouldSampleAnalyticsKey(anonymousId, INTERACTION_SAMPLE_RATE)) return;

    let pendingNavigation: PendingNavigation | null = null;
    let longTaskReports = 0;

    const clearPendingNavigation = () => {
      if (!pendingNavigation) return;
      window.clearTimeout(pendingNavigation.timeoutId);
      pendingNavigation = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      const targetLocationKey = normalizeSameOriginNavigationTarget({
        href: anchor.href,
        origin: window.location.origin,
      });
      if (!targetLocationKey) return;
      const currentLocationKey = `${window.location.pathname}${window.location.search}`;
      if (targetLocationKey === currentLocationKey) return;

      clearPendingNavigation();
      const startedAt = performance.now();
      pendingNavigation = {
        startedAt,
        targetLocationKey,
        sourceLabel:
          anchor.getAttribute("data-analytics-id") ??
          anchor.getAttribute("data-onboarding-target") ??
          null,
        timeoutId: window.setTimeout(
          clearPendingNavigation,
          NAVIGATION_TIMEOUT_MS,
        ),
      };

      window.requestAnimationFrame(() => {
        reportInteractionMetric(
          "navigation_pressed_paint_ms",
          performance.now() - startedAt,
          { destination: sanitizeAnalyticsLocationKey(targetLocationKey) },
        );
      });
    };

    const handleNavigationCommitted = (event: Event) => {
      if (!pendingNavigation) return;
      const detail = (event as CustomEvent<NavigationCommittedDetail>).detail;
      if (
        !detail ||
        !navigationTargetMatches(
          pendingNavigation.targetLocationKey,
          detail.locationKey,
        )
      ) {
        return;
      }
      reportInteractionMetric(
        "navigation_committed_ms",
        performance.now() - pendingNavigation.startedAt,
        {
          destination: sanitizeAnalyticsLocationKey(
            pendingNavigation.targetLocationKey,
          ),
          source_label: pendingNavigation.sourceLabel,
        },
      );
      clearPendingNavigation();
    };

    document.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
      passive: true,
    });
    window.addEventListener(
      ANALYTICS_NAVIGATION_COMMITTED_EVENT,
      handleNavigationCommitted,
    );

    let longTaskObserver: PerformanceObserver | null = null;
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("longtask")
    ) {
      longTaskObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (longTaskReports >= MAX_LONG_TASK_REPORTS_PER_PAGE) break;
          longTaskReports += 1;
          reportInteractionMetric("main_thread_long_task_ms", entry.duration, {
            entry_name: entry.name,
          });
        }
      });
      longTaskObserver.observe({ type: "longtask", buffered: true });
    }

    return () => {
      clearPendingNavigation();
      longTaskObserver?.disconnect();
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener(
        ANALYTICS_NAVIGATION_COMMITTED_EVENT,
        handleNavigationCommitted,
      );
    };
  }, []);

  return null;
}
