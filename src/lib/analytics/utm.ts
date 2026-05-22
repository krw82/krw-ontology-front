import type { AnalyticsUtmContext } from "@/lib/analytics/events";

export const ANALYTICS_ANONYMOUS_ID_COOKIE = "krw_analytics_id";
export const ANALYTICS_UTM_COOKIE = "krw_utm_context";

export const UTM_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

type UtmKey = (typeof UTM_QUERY_KEYS)[number];

const MAX_UTM_VALUE_LENGTH = 240;

export function extractUtmContext(
  searchParams: URLSearchParams,
): AnalyticsUtmContext | null {
  const context: AnalyticsUtmContext = {};

  for (const key of UTM_QUERY_KEYS) {
    const value = normalizeUtmValue(searchParams.get(key));
    if (value) context[key] = value;
  }

  return Object.keys(context).length > 0 ? context : null;
}

export function mergeUtmContext(
  firstTouch: AnalyticsUtmContext | null | undefined,
  incoming: AnalyticsUtmContext | null | undefined,
): AnalyticsUtmContext | null {
  const merged: AnalyticsUtmContext = { ...(firstTouch ?? {}) };

  for (const key of UTM_QUERY_KEYS) {
    const current = normalizeUtmValue(merged[key]);
    const next = normalizeUtmValue(incoming?.[key]);
    if (current) {
      merged[key] = current;
    } else if (next) {
      merged[key] = next;
    } else {
      delete merged[key];
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

export function serializeUtmContext(
  context: AnalyticsUtmContext | null | undefined,
): string {
  if (!context) return "";
  const params = new URLSearchParams();
  for (const key of UTM_QUERY_KEYS) {
    const value = normalizeUtmValue(context[key]);
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function parseUtmContext(value: string | null | undefined): AnalyticsUtmContext | null {
  if (!value) return null;

  try {
    return extractUtmContext(new URLSearchParams(value));
  } catch {
    return null;
  }
}

export function getUtmContextFromCookieHeader(
  cookieHeader: string | null | undefined,
): AnalyticsUtmContext | null {
  const cookie = getCookieValue(cookieHeader, ANALYTICS_UTM_COOKIE);
  return parseUtmContext(cookie);
}

export function getAnonymousIdFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  return normalizeCookieValue(getCookieValue(cookieHeader, ANALYTICS_ANONYMOUS_ID_COOKIE));
}

function getCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName?.trim() !== name) continue;
    const value = rest.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

function normalizeCookieValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 128) : null;
}

function normalizeUtmValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, MAX_UTM_VALUE_LENGTH) : null;
}

export type { UtmKey };
