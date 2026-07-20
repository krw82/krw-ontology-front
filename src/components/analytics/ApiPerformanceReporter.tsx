"use client";

import { useEffect } from "react";
import {
  getOrCreateAnalyticsAnonymousId,
  trackClientEventSilently,
} from "@/lib/analytics/client";
import {
  parseAnalyticsSampleRate,
  shouldSampleAnalyticsKey,
} from "@/lib/analytics/sampling";
import { APP_VERSION } from "@/lib/app-version";
import { apiResourceMetricFromEntry } from "@/lib/performance/api-resource";

const API_PERFORMANCE_SAMPLE_RATE = parseAnalyticsSampleRate(
  process.env.NEXT_PUBLIC_API_PERFORMANCE_SAMPLE_RATE,
  process.env.NODE_ENV === "production" ? 0.1 : 1,
);
const MAX_API_METRICS_PER_PAGE = 20;

export default function ApiPerformanceReporter() {
  useEffect(() => {
    const anonymousId = getOrCreateAnalyticsAnonymousId();
    if (!shouldSampleAnalyticsKey(anonymousId, API_PERFORMANCE_SAMPLE_RATE)) {
      return;
    }
    if (
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes.includes("resource")
    ) {
      return;
    }

    let reports = 0;
    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (reports >= MAX_API_METRICS_PER_PAGE) break;
        const metric = apiResourceMetricFromEntry(
          entry as PerformanceResourceTiming,
          window.location.origin,
        );
        if (!metric) continue;
        reports += 1;
        trackClientEventSilently("performance_metric_reported", {
          metric_name: "api_request_duration_ms",
          metric_value: metric.durationMs,
          metric_category: "api",
          api_path: metric.apiPath,
          transfer_size_bytes: metric.transferSizeBytes,
          encoded_body_size_bytes: metric.encodedBodySizeBytes,
          decoded_body_size_bytes: metric.decodedBodySizeBytes,
          server_timing_ms: metric.serverTiming,
          app_version: APP_VERSION,
        });
      }
    });
    observer.observe({ type: "resource", buffered: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
