"use client";

import { useEffect } from "react";
import {
  bootstrapAnalyticsContext,
  trackClientEventSilently,
} from "@/lib/analytics/client";

function pageTypeFromPath(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname === "/companies") return "company_index";
  if (pathname.startsWith("/companies/")) return "company_landing";
  if (pathname === "/questions") return "question_graph_index";
  if (pathname.startsWith("/questions/")) return "question_graph";
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/login") return "login";
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/share/")) return "shared_answer";
  if (pathname.startsWith("/settings")) return "settings";
  return "other";
}

function isPublicMarketingPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/companies" ||
    pathname.startsWith("/companies/") ||
    pathname === "/questions" ||
    pathname.startsWith("/questions/") ||
    pathname === "/pricing" ||
    pathname === "/privacy" ||
    pathname === "/terms"
  );
}

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
        page_path: pagePath,
        page_search: pageSearch || null,
        page_type: pageTypeFromPath(pagePath),
        is_public: isPublicMarketingPath(pagePath),
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
