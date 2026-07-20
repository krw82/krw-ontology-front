"use client";

import { createClientId } from "@/lib/client-id";
import {
  type AnalyticsEventName,
  type AnalyticsUtmContext,
} from "@/lib/analytics/events";
import {
  ANALYTICS_ANONYMOUS_ID_COOKIE,
  ANALYTICS_UTM_COOKIE,
  extractUtmContext,
  mergeUtmContext,
  parseUtmContext,
  serializeUtmContext,
} from "@/lib/analytics/utm";
import {
  buildAnalyticsPageProperties,
  getAnalyticsDeviceType,
  sanitizeAnalyticsLocationKey,
  sanitizeAnalyticsReferrer,
} from "@/lib/analytics/page-context";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const TRACK_TIMEOUT_MS = 800;

export function bootstrapAnalyticsContext(): void {
  if (typeof window === "undefined") return;
  getOrCreateAnalyticsAnonymousId();

  const incoming = extractUtmContext(
    new URLSearchParams(window.location.search),
  );
  if (!incoming) return;

  const firstTouch = getStoredUtmContext();
  const merged = mergeUtmContext(firstTouch, incoming);
  if (merged) setStoredUtmContext(merged);
}

export function getOrCreateAnalyticsAnonymousId(): string {
  const existing = getCookie(ANALYTICS_ANONYMOUS_ID_COOKIE);
  if (existing) return existing;

  const id = createClientId();
  setCookie(ANALYTICS_ANONYMOUS_ID_COOKIE, id);
  return id;
}

export function getStoredUtmContext(): AnalyticsUtmContext | null {
  return parseUtmContext(getCookie(ANALYTICS_UTM_COOKIE));
}

export function setStoredUtmContext(context: AnalyticsUtmContext): void {
  const serialized = serializeUtmContext(context);
  if (!serialized) return;
  setCookie(ANALYTICS_UTM_COOKIE, serialized);
}

export async function trackClientEvent(
  eventName: AnalyticsEventName,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (typeof window === "undefined") return;

  const anonymousId = getOrCreateAnalyticsAnonymousId();
  const commonProperties = buildAnalyticsPageProperties(
    window.location.pathname,
    window.location.search,
  );
  const mergedProperties = {
    ...commonProperties,
    device_type: getAnalyticsDeviceType(),
    ...properties,
  };
  const body = {
    event_name: eventName,
    anonymous_id: anonymousId,
    properties: mergedProperties,
    path: sanitizeAnalyticsLocationKey(
      `${window.location.pathname}${window.location.search}`,
    ),
    referrer: sanitizeAnalyticsReferrer(
      document.referrer,
      window.location.origin,
    ),
    utm: getStoredUtmContext(),
  };

  const response = await fetch("/api/analytics/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    keepalive: JSON.stringify(body).length < 60_000,
  });

  if (!response.ok) {
    throw new Error("Failed to record analytics event");
  }
}

export function trackClientEventSilently(
  eventName: AnalyticsEventName,
  properties: Record<string, unknown> = {},
): void {
  void trackClientEvent(eventName, properties).catch(() => undefined);
}

export async function trackClientEventWithTimeout(
  eventName: AnalyticsEventName,
  properties: Record<string, unknown> = {},
  timeoutMs = TRACK_TIMEOUT_MS,
): Promise<void> {
  await Promise.race([
    trackClientEvent(eventName, properties).catch(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const encodedName = `${encodeURIComponent(name)}=`;
  const part = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(encodedName));
  if (!part) return null;
  try {
    return decodeURIComponent(part.slice(encodedName.length));
  } catch {
    return part.slice(encodedName.length);
  }
}

function setCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    window.location.protocol === "https:" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
