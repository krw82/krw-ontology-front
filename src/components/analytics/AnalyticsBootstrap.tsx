"use client";

import { useEffect } from "react";
import {
  bootstrapAnalyticsContext,
  getOrCreateAnalyticsAnonymousId,
  trackClientEventSilently,
} from "@/lib/analytics/client";
import { buildAnalyticsPageProperties } from "@/lib/analytics/page-context";
import {
  parseAnalyticsSampleRate,
  shouldSampleAnalyticsKey,
} from "@/lib/analytics/sampling";
import { ANALYTICS_NAVIGATION_COMMITTED_EVENT } from "@/lib/analytics/interaction-performance";

let lastTrackedPageViewKey: string | null = null;
const PAGE_VIEW_SAMPLE_RATE = readPageViewSampleRate();

export default function AnalyticsBootstrap() {
  useEffect(() => {
    bootstrapAnalyticsContext();

    const trackPageView = () => {
      const pagePath = window.location.pathname;
      const pageSearch = window.location.search;
      const rawLocationKey = `${pagePath}${pageSearch}`;
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_NAVIGATION_COMMITTED_EVENT, {
          detail: { locationKey: rawLocationKey },
        }),
      );
      const pageProperties = buildAnalyticsPageProperties(pagePath, pageSearch);
      const analyticsPageKey = `${pageProperties.page_path}${
        pageProperties.page_search ?? ""
      }:${pageProperties.page_type}`;
      if (analyticsPageKey === lastTrackedPageViewKey) return;
      lastTrackedPageViewKey = analyticsPageKey;
      if (!shouldTrackPageView(analyticsPageKey)) return;

      trackClientEventSilently("page_viewed", {
        ...pageProperties,
      });
    };

    trackPageView();

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(
      ...args: Parameters<History["pushState"]>
    ) {
      const result = originalPushState.apply(this, args);
      window.setTimeout(trackPageView, 0);
      return result;
    };

    window.history.replaceState = function replaceState(
      ...args: Parameters<History["replaceState"]>
    ) {
      const result = originalReplaceState.apply(this, args);
      window.setTimeout(trackPageView, 0);
      return result;
    };

    window.addEventListener("popstate", trackPageView);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", trackPageView);
    };
  }, []);

  return null;
}

function readPageViewSampleRate() {
  const raw = process.env.NEXT_PUBLIC_ANALYTICS_PAGE_VIEW_SAMPLE_RATE;
  const fallback = process.env.NODE_ENV === "production" ? 0.1 : 1;
  return parseAnalyticsSampleRate(raw, fallback);
}

function shouldTrackPageView(eventKey: string) {
  if (PAGE_VIEW_SAMPLE_RATE >= 1) return true;
  if (PAGE_VIEW_SAMPLE_RATE <= 0) return false;

  const anonymousId = getOrCreateAnalyticsAnonymousId();
  return shouldSampleAnalyticsKey(
    `${anonymousId}:${eventKey}`,
    PAGE_VIEW_SAMPLE_RATE,
  );
}
