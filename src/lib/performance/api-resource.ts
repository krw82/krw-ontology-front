export interface ApiServerTimingMetric {
  name: string;
  duration: number;
}

export interface ApiResourceTimingLike {
  name: string;
  initiatorType: string;
  duration: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  serverTiming?: readonly ApiServerTimingMetric[];
}

export interface ApiResourceMetric {
  apiPath: string;
  durationMs: number;
  transferSizeBytes: number;
  encodedBodySizeBytes: number;
  decodedBodySizeBytes: number;
  serverTiming: Record<string, number>;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_SEGMENT = /^[a-z0-9_-]{24,}$/i;
const MAX_SERVER_TIMING_METRICS = 10;

/**
 * Converts browser resource timing into a bounded, identifier-free API metric.
 * Query strings and opaque path segments are never sent to analytics.
 */
export function apiResourceMetricFromEntry(
  entry: ApiResourceTimingLike,
  origin: string,
): ApiResourceMetric | null {
  if (entry.initiatorType !== "fetch" && entry.initiatorType !== "xmlhttprequest") {
    return null;
  }

  let url: URL;
  try {
    url = new URL(entry.name, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) return null;
  if (url.pathname === "/api/analytics/events") return null;

  const serverTiming = Object.fromEntries(
    (entry.serverTiming ?? [])
      .slice(0, MAX_SERVER_TIMING_METRICS)
      .map((metric) => [
        metric.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "work",
        roundedNonNegative(metric.duration),
      ]),
  );

  return {
    apiPath: sanitizeApiPath(url.pathname),
    durationMs: roundedNonNegative(entry.duration),
    transferSizeBytes: nonNegativeInteger(entry.transferSize),
    encodedBodySizeBytes: nonNegativeInteger(entry.encodedBodySize),
    decodedBodySizeBytes: nonNegativeInteger(entry.decodedBodySize),
    serverTiming,
  };
}

function sanitizeApiPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      UUID_SEGMENT.test(segment) || OPAQUE_SEGMENT.test(segment) ? ":id" : segment,
    )
    .join("/");
}

function roundedNonNegative(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.round(value));
}
