import { normalizeTicker } from "@/lib/ontology/ticker";

export type AnalyticsPageType =
  | "home"
  | "companies_index"
  | "company_detail"
  | "questions_index"
  | "question_detail"
  | "chat_new"
  | "chat_session"
  | "pricing"
  | "login"
  | "shared_answer"
  | "settings"
  | "legal"
  | "other";

export type AnalyticsDeviceType = "mobile" | "desktop";

export interface AnalyticsPageProperties {
  page_path: string;
  page_search: string | null;
  page_type: AnalyticsPageType;
  is_public: boolean;
  ticker?: string;
}

const SAFE_ANALYTICS_CATEGORY_KEYS = [
  "locale",
  "runKind",
  "guru",
  "entry",
  "feature",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
] as const;
const SAFE_ANALYTICS_CATEGORY_VALUE = /^[a-z0-9._-]{1,64}$/i;

export function buildAnalyticsPageProperties(
  pathname: string,
  search: string | URLSearchParams | null | undefined,
): AnalyticsPageProperties {
  const params = toSearchParams(search);
  const analyticsParams = sanitizeAnalyticsSearchParams(params);
  const ticker = tickerFromPathOrSearch(pathname, params);

  return {
    page_path: sanitizeAnalyticsPathname(pathname),
    page_search: analyticsParams.toString()
      ? `?${analyticsParams.toString()}`
      : null,
    page_type: pageTypeFromPath(pathname, params),
    is_public: isPublicMarketingPath(pathname),
    ...(ticker ? { ticker } : {}),
  };
}

/**
 * Analytics must never receive prompts, search text, session/share tokens, or
 * other free-form URL state. Only normalized ticker and short categorical
 * routing dimensions are retained.
 */
export function sanitizeAnalyticsSearchParams(
  search: string | URLSearchParams | null | undefined,
): URLSearchParams {
  const input = toSearchParams(search);
  const output = new URLSearchParams();
  const ticker = tickerFromPathOrSearch("", input);
  if (ticker) output.set("ticker", ticker);

  for (const key of SAFE_ANALYTICS_CATEGORY_KEYS) {
    const value = input.get(key)?.trim();
    if (value && SAFE_ANALYTICS_CATEGORY_VALUE.test(value)) {
      output.set(key, value);
    }
  }

  return output;
}

export function sanitizeAnalyticsLocationKey(locationKey: string): string {
  try {
    const url = new URL(locationKey, "https://analytics.invalid");
    const params = sanitizeAnalyticsSearchParams(url.searchParams);
    const query = params.toString();
    return `${sanitizeAnalyticsPathname(url.pathname)}${query ? `?${query}` : ""}`;
  } catch {
    return "/unknown";
  }
}

/**
 * Share tokens are bearer credentials embedded in the route. Analytics keeps
 * the route shape for page classification, but never the credential itself.
 */
export function sanitizeAnalyticsPathname(pathname: string): string {
  return pathname.replace(
    /^\/(?:(ko|en)\/)?share\/[^/]+(?:\/.*)?$/,
    (_match, locale: string | undefined) =>
      locale ? `/${locale}/share/:token` : "/share/:token",
  );
}

export function sanitizeAnalyticsPath(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  return sanitizeAnalyticsLocationKey(value.trim());
}

export function sanitizeAnalyticsReferrer(
  value: string | null | undefined,
  currentOrigin?: string,
): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value, currentOrigin ?? "https://analytics.invalid");
    if (currentOrigin && url.origin === currentOrigin) {
      return sanitizeAnalyticsLocationKey(`${url.pathname}${url.search}`);
    }
    if (!currentOrigin && url.origin === "https://analytics.invalid") {
      return sanitizeAnalyticsLocationKey(`${url.pathname}${url.search}`);
    }
    // Cross-origin attribution needs only the origin. External paths and
    // queries can contain searches, document ids, or signed tokens.
    return url.origin;
  } catch {
    return null;
  }
}

export function pageTypeFromPath(
  pathname: string,
  search: string | URLSearchParams | null | undefined = null,
): AnalyticsPageType {
  const params = toSearchParams(search);
  const routePathname = stripAnalyticsLocalePrefix(pathname);

  if (routePathname === "/") return "home";
  if (routePathname === "/companies") return "companies_index";
  if (routePathname.startsWith("/companies/")) return "company_detail";
  if (routePathname === "/questions") return "questions_index";
  if (routePathname.startsWith("/questions/")) return "question_detail";
  if (routePathname === "/chat/new") return "chat_new";
  if (routePathname === "/chat" && params.has("sessionId")) return "chat_session";
  if (routePathname.startsWith("/chat")) return "chat_new";
  if (routePathname === "/pricing") return "pricing";
  if (routePathname === "/login") return "login";
  if (routePathname.startsWith("/share/")) return "shared_answer";
  if (routePathname.startsWith("/settings")) return "settings";
  if (
    routePathname === "/privacy" ||
    routePathname === "/terms" ||
    routePathname === "/refund"
  ) {
    return "legal";
  }
  return "other";
}

export function isPublicMarketingPath(pathname: string): boolean {
  const routePathname = stripAnalyticsLocalePrefix(pathname);
  return (
    routePathname === "/" ||
    routePathname === "/companies" ||
    routePathname.startsWith("/companies/") ||
    routePathname === "/questions" ||
    routePathname.startsWith("/questions/") ||
    routePathname === "/pricing" ||
    routePathname === "/privacy" ||
    routePathname === "/terms" ||
    routePathname === "/refund"
  );
}

export function tickerFromPathOrSearch(
  pathname: string,
  search: string | URLSearchParams | null | undefined = null,
): string | null {
  const routePathname = stripAnalyticsLocalePrefix(pathname);
  const companyTicker = routePathname.match(/^\/companies\/([^/?#]+)/)?.[1];
  const candidate = companyTicker ?? toSearchParams(search).get("ticker");
  if (!candidate) return null;

  try {
    return normalizeTicker(decodeURIComponent(candidate));
  } catch {
    return null;
  }
}

function stripAnalyticsLocalePrefix(pathname: string): string {
  const normalized = pathname.replace(/^\/(?:ko|en)(?=\/|$)/, "");
  return normalized
    ? normalized.startsWith("/")
      ? normalized
      : `/${normalized}`
    : "/";
}

export function getAnalyticsDeviceType(): AnalyticsDeviceType {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
}

function toSearchParams(
  search: string | URLSearchParams | null | undefined,
): URLSearchParams {
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  if (!search) return new URLSearchParams();
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}
