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
