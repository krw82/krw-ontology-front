"use client";

import { useReportWebVitals } from "next/web-vitals";
import {
  getOrCreateAnalyticsAnonymousId,
  trackClientEventSilently,
} from "@/lib/analytics/client";
import {
  parseAnalyticsSampleRate,
  shouldSampleAnalyticsKey,
} from "@/lib/analytics/sampling";
import {
  APP_VERSION,
  SERVICE_WORKER_VERSION_DATASET_KEY,
} from "@/lib/app-version";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];
type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
    downlink?: number;
    rtt?: number;
  };
  standalone?: boolean;
};

const WEB_VITALS_SAMPLE_RATE = parseAnalyticsSampleRate(
  process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE,
  process.env.NODE_ENV === "production" ? 0.1 : 1,
);

const reportWebVital: ReportWebVitalsCallback = (metric) => {
  const anonymousId = getOrCreateAnalyticsAnonymousId();
  if (!shouldSampleAnalyticsKey(anonymousId, WEB_VITALS_SAMPLE_RATE)) return;

  const browserNavigator = navigator as NavigatorWithConnection;
  const connection = browserNavigator.connection;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    browserNavigator.standalone === true;

  trackClientEventSilently("performance_metric_reported", {
    metric_id: metric.id,
    metric_name: metric.name,
    metric_value: metric.value,
    metric_delta: metric.delta,
    metric_rating: metric.rating,
    navigation_type: metric.navigationType,
    is_standalone: isStandalone,
    visibility_state: document.visibilityState,
    connection_effective_type: connection?.effectiveType ?? null,
    connection_save_data: connection?.saveData ?? null,
    connection_downlink_mbps: connection?.downlink ?? null,
    connection_rtt_ms: connection?.rtt ?? null,
    app_version: APP_VERSION,
    service_worker_version:
      document.documentElement.dataset[SERVICE_WORKER_VERSION_DATASET_KEY] ??
      null,
  });
};

export default function WebVitalsReporter() {
  useReportWebVitals(reportWebVital);
  return null;
}
