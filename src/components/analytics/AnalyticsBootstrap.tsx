"use client";

import { useEffect } from "react";
import {
  bootstrapAnalyticsContext,
  trackClientEventSilently,
} from "@/lib/analytics/client";
import { buildAnalyticsPageProperties } from "@/lib/analytics/page-context";

let lastTrackedPageViewKey: string | null = null;

export default function AnalyticsBootstrap() {
  useEffect(() => {
    bootstrapAnalyticsContext();

    const trackPageView = () => {
      const pagePath = window.location.pathname;
      const pageSearch = window.location.search;
      const eventKey = `${pagePath}${pageSearch}`;
      if (eventKey === lastTrackedPageViewKey) return;
      lastTrackedPageViewKey = eventKey;

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
