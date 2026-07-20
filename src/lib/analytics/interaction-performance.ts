export const ANALYTICS_NAVIGATION_COMMITTED_EVENT =
  "krwo:analytics-navigation-committed";

export interface NavigationCommittedDetail {
  locationKey: string;
}

export function normalizeSameOriginNavigationTarget({
  href,
  origin,
}: {
  href: string;
  origin: string;
}): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function navigationTargetMatches(
  targetLocationKey: string,
  committedLocationKey: string,
): boolean {
  return targetLocationKey === committedLocationKey;
}
