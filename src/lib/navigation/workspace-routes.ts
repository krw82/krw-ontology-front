import type { Locale } from "@/i18n/config";
import {
  localizedPath,
  queryLocalizedPath,
  stripLocalePrefix,
} from "@/i18n/routing";
import { buildNewChatHref } from "@/lib/chat/history-state";

export type WorkspaceRouteId =
  | "feed"
  | "discover"
  | "wideResearch"
  | "perspectives"
  | "companies"
  | "notebook"
  | "filings"
  | "holdings";

export type WorkspaceNavigationGroupId = "now" | "explore" | "research" | "monitor";
export type WorkspaceShellMode =
  | "standard"
  | "immersive"
  | "self-managed"
  | "public";
export type WorkspaceTabId = "feed" | "explore" | "coverage" | "filings";

interface WorkspaceRouteDefinition {
  id: WorkspaceRouteId;
  group: WorkspaceNavigationGroupId;
  icon: string;
  labels: Record<Locale, string>;
  onboardingTarget: string;
  desktop?: boolean;
  visible?: () => boolean;
  href: (locale: Locale) => string;
  matches: (pathname: string) => boolean;
}

export interface WorkspaceNavigationItem {
  id: WorkspaceRouteId;
  icon: string;
  label: string;
  href: string;
  active: boolean;
  onboardingTarget: string;
  desktop: boolean;
}

export interface WorkspaceNavigationGroup {
  id: WorkspaceNavigationGroupId;
  label: string;
  items: WorkspaceNavigationItem[];
}

export interface WorkspaceTabItem {
  id: WorkspaceTabId;
  icon: string;
  label: string;
  href: string;
  active: boolean;
}

const GROUP_LABELS: Record<Locale, Record<WorkspaceNavigationGroupId, string>> = {
  ko: {
    now: "지금",
    explore: "탐색",
    research: "내 리서치",
    monitor: "모니터링",
  },
  en: {
    now: "Now",
    explore: "Explore",
    research: "My research",
    monitor: "Monitor",
  },
};

const GROUP_ORDER: WorkspaceNavigationGroupId[] = [
  "now",
  "explore",
  "research",
  "monitor",
];

const WORKSPACE_ROUTES: WorkspaceRouteDefinition[] = [
  {
    id: "feed",
    group: "now",
    icon: "dynamic_feed",
    labels: { ko: "피드", en: "Feed" },
    onboardingTarget: "research-pulse-nav",
    href: (locale) => queryLocalizedPath(locale, "/pulse"),
    matches: (pathname) => pathname === "/pulse" || pathname.startsWith("/pulse/"),
  },
  {
    id: "discover",
    group: "explore",
    icon: "travel_explore",
    labels: { ko: "조건으로 기업 검색", en: "Company search by criteria" },
    onboardingTarget: "stock-discovery-nav",
    href: (locale) => queryLocalizedPath(locale, "/discover"),
    matches: (pathname) => pathname === "/discover" || pathname.startsWith("/discover/"),
  },
  {
    id: "perspectives",
    group: "explore",
    icon: "psychology",
    labels: { ko: "관점별 분석", en: "Perspective analysis" },
    onboardingTarget: "guru-advisor-nav",
    href: (locale) => queryLocalizedPath(locale, "/guru"),
    matches: (pathname) => pathname === "/guru" || pathname.startsWith("/guru/"),
  },
  {
    id: "wideResearch",
    group: "explore",
    icon: "hub",
    labels: { ko: "와이드 리서치", en: "Wide research" },
    onboardingTarget: "wide-research-nav",
    desktop: false,
    href: (locale) => buildNewChatHref(undefined, { locale }),
    matches: () => false,
  },
  {
    id: "companies",
    group: "explore",
    icon: "search",
    labels: { ko: "회사", en: "Companies" },
    onboardingTarget: "company-search-nav",
    href: (locale) => localizedPath(locale, "/companies"),
    matches: (pathname) => pathname === "/companies" || pathname.startsWith("/companies/"),
  },
  {
    id: "notebook",
    group: "research",
    icon: "article",
    labels: { ko: "리서치 노트북", en: "Research Notebook" },
    onboardingTarget: "research-notebook-nav",
    href: (locale) => queryLocalizedPath(locale, "/watchlist"),
    matches: (pathname) => pathname === "/watchlist" || pathname.startsWith("/watchlist/"),
  },
  {
    id: "filings",
    group: "monitor",
    icon: "notifications",
    labels: { ko: "공시 알림", en: "Filing alerts" },
    onboardingTarget: "filing-alerts-nav",
    href: (locale) => queryLocalizedPath(locale, "/filings"),
    matches: (pathname) => pathname === "/filings" || pathname.startsWith("/filings/"),
  },
  {
    id: "holdings",
    group: "monitor",
    icon: "monitoring",
    labels: { ko: "13F 보유", en: "13F Holdings" },
    onboardingTarget: "institutional-holdings-nav",
    href: (locale) => queryLocalizedPath(locale, "/institutional-holdings"),
    matches: (pathname) =>
      pathname === "/institutional-holdings" ||
      pathname.startsWith("/institutional-holdings/"),
  },
];

const MOBILE_TAB_DEFINITIONS: Array<{
  id: WorkspaceTabId;
  icon: string;
  labels: Record<Locale, string>;
  href: (locale: Locale) => string;
  matches: (pathname: string) => boolean;
}> = [
  {
    id: "feed",
    icon: "dynamic_feed",
    labels: { ko: "피드", en: "Feed" },
    href: (locale) => queryLocalizedPath(locale, "/pulse"),
    matches: (pathname) =>
      pathname === "/pulse" || pathname.startsWith("/pulse/"),
  },
  {
    id: "explore",
    icon: "search",
    labels: { ko: "탐색", en: "Explore" },
    href: (locale) => localizedPath(locale, "/companies"),
    matches: (pathname) =>
      pathname === "/companies" ||
      pathname.startsWith("/companies/") ||
      pathname === "/discover" ||
      pathname.startsWith("/discover/") ||
      pathname === "/guru" ||
      pathname.startsWith("/guru/"),
  },
  {
    id: "coverage",
    icon: "radar",
    labels: { ko: "커버리지", en: "Coverage" },
    href: (locale) => queryLocalizedPath(locale, "/watchlist"),
    matches: (pathname) =>
      pathname === "/watchlist" || pathname.startsWith("/watchlist/"),
  },
  {
    id: "filings",
    icon: "notifications",
    labels: { ko: "공시", en: "Filings" },
    href: (locale) => queryLocalizedPath(locale, "/filings"),
    matches: (pathname) =>
      pathname === "/filings" || pathname.startsWith("/filings/"),
  },
];

function matchesSegment(pathname: string, segment: string): boolean {
  return pathname === segment || pathname.startsWith(`${segment}/`);
}

export function getWorkspaceShellMode(pathname: string): WorkspaceShellMode {
  const normalizedPathname = stripLocalePrefix(pathname);

  if (
    matchesSegment(normalizedPathname, "/chat") ||
    matchesSegment(normalizedPathname, "/discover")
  ) {
    return "immersive";
  }

  // Guru can render either its directory or the immersive chat workspace from
  // the same pathname. It keeps its route-owned header until those URLs split.
  if (matchesSegment(normalizedPathname, "/guru")) {
    return "self-managed";
  }

  if (
    matchesSegment(normalizedPathname, "/pulse") ||
    matchesSegment(normalizedPathname, "/companies") ||
    matchesSegment(normalizedPathname, "/watchlist") ||
    matchesSegment(normalizedPathname, "/filings") ||
    matchesSegment(normalizedPathname, "/institutional-holdings") ||
    matchesSegment(normalizedPathname, "/settings")
  ) {
    return "standard";
  }

  return "public";
}

export function getWorkspaceTabItems(
  locale: Locale,
  pathname: string,
): WorkspaceTabItem[] {
  const normalizedPathname = stripLocalePrefix(pathname);

  return MOBILE_TAB_DEFINITIONS.map((tab) => ({
    id: tab.id,
    icon: tab.icon,
    label: tab.labels[locale],
    href: tab.href(locale),
    active: tab.matches(normalizedPathname),
  }));
}

function resolveItem(
  route: WorkspaceRouteDefinition,
  locale: Locale,
  pathname: string,
): WorkspaceNavigationItem {
  return {
    id: route.id,
    icon: route.icon,
    label: route.labels[locale],
    href: route.href(locale),
    active: route.matches(pathname),
    onboardingTarget: route.onboardingTarget,
    desktop: route.desktop !== false,
  };
}

export function getWorkspaceNavigationItems(
  locale: Locale,
  pathname: string,
): WorkspaceNavigationItem[] {
  const normalizedPathname = stripLocalePrefix(pathname);
  return WORKSPACE_ROUTES
    .filter((route) => route.visible?.() ?? true)
    .map((route) => resolveItem(route, locale, normalizedPathname));
}

export function getWorkspaceNavigationGroups(
  locale: Locale,
  pathname: string,
): WorkspaceNavigationGroup[] {
  const items = getWorkspaceNavigationItems(locale, pathname);

  return GROUP_ORDER.map((group) => ({
    id: group,
    label: GROUP_LABELS[locale][group],
    items: items.filter((item) =>
      WORKSPACE_ROUTES.find((route) => route.id === item.id)?.group === group,
    ),
  })).filter((group) => group.items.length > 0);
}
