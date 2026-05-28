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

export function buildAnalyticsPageProperties(
  pathname: string,
  search: string | URLSearchParams | null | undefined,
): AnalyticsPageProperties {
  const params = toSearchParams(search);
  const ticker = tickerFromPathOrSearch(pathname, params);

  return {
    page_path: pathname,
    page_search: params.toString() ? `?${params.toString()}` : null,
    page_type: pageTypeFromPath(pathname, params),
    is_public: isPublicMarketingPath(pathname),
    ...(ticker ? { ticker } : {}),
  };
}

export function pageTypeFromPath(
  pathname: string,
  search: string | URLSearchParams | null | undefined = null,
): AnalyticsPageType {
  const params = toSearchParams(search);

  if (pathname === "/") return "home";
  if (pathname === "/companies") return "companies_index";
  if (pathname.startsWith("/companies/")) return "company_detail";
  if (pathname === "/questions") return "questions_index";
  if (pathname.startsWith("/questions/")) return "question_detail";
  if (pathname === "/chat/new") return "chat_new";
  if (pathname === "/chat" && params.has("sessionId")) return "chat_session";
  if (pathname.startsWith("/chat")) return "chat_new";
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/login") return "login";
  if (pathname.startsWith("/share/")) return "shared_answer";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname === "/privacy" || pathname === "/terms") return "legal";
  return "other";
}

export function isPublicMarketingPath(pathname: string): boolean {
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

export function tickerFromPathOrSearch(
  pathname: string,
  search: string | URLSearchParams | null | undefined = null,
): string | null {
  const companyTicker = pathname.match(/^\/companies\/([^/?#]+)/)?.[1];
  const candidate = companyTicker ?? toSearchParams(search).get("ticker");
  if (!candidate) return null;

  const normalized = decodeURIComponent(candidate).trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(normalized) ? normalized : null;
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
