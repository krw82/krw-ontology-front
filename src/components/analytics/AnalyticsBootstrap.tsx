"use client";

import { useEffect } from "react";
import {
  bootstrapAnalyticsContext,
  getOrCreateAnalyticsAnonymousId,
  trackClientEventSilently,
} from "@/lib/analytics/client";
import { buildAnalyticsPageProperties } from "@/lib/analytics/page-context";

let lastTrackedPageViewKey: string | null = null;
const PAGE_VIEW_SAMPLE_RATE = readPageViewSampleRate();

export default function AnalyticsBootstrap() {
  useEffect(() => {
    bootstrapAnalyticsContext();

    const trackPageView = () => {
      const pagePath = window.location.pathname;
      const pageSearch = window.location.search;
      const eventKey = `${pagePath}${pageSearch}`;
      if (eventKey === lastTrackedPageViewKey) return;
      lastTrackedPageViewKey = eventKey;
      if (!shouldTrackPageView(eventKey)) return;

      trackClientEventSilently("page_viewed", {
        ...buildAnalyticsPageProperties(pagePath, pageSearch),
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
  if (!raw) return fallback;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function shouldTrackPageView(eventKey: string) {
  if (PAGE_VIEW_SAMPLE_RATE >= 1) return true;
  if (PAGE_VIEW_SAMPLE_RATE <= 0) return false;

  const anonymousId = getOrCreateAnalyticsAnonymousId();
  return normalizedHash(`${anonymousId}:${eventKey}`) < PAGE_VIEW_SAMPLE_RATE;
}

function normalizedHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
