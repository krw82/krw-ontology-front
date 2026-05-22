import type { AnalyticsEventRow, Database, Json } from "@/types/database";

export const ANALYTICS_EVENT_NAMES = [
  "page_viewed",
  "cta_clicked",
  "home_cta_clicked",
  "signup_started",
  "login_completed",
  "company_selected",
  "question_prefilled",
  "starter_question_clicked",
  "question_submitted",
  "answer_completed",
  "answer_failed",
  "citation_opened",
  "share_created",
  "session_renamed",
  "session_deleted",
  "attachment_added",
  "attachment_rejected",
  "usage_warning_shown",
  "usage_limit_reached",
  "quota_warning_shown",
  "quota_blocked",
  "upgrade_clicked",
  "subscription_started",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export type AnalyticsUtmContext = Partial<
  Pick<
    AnalyticsEventRow,
    "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term"
  >
>;

export interface AnalyticsEventPayload {
  eventName: AnalyticsEventName;
  userId?: string | null;
  anonymousId?: string | null;
  properties?: Record<string, unknown>;
  path?: string | null;
  referrer?: string | null;
  utm?: AnalyticsUtmContext | null;
  sessionId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  createdAt?: string;
}

export type AnalyticsEventInsert =
  Database["public"]["Tables"]["analytics_events"]["Insert"];

const MAX_PROPERTY_DEPTH = 4;
const MAX_PROPERTY_STRING_LENGTH = 500;
const MAX_PROPERTY_ARRAY_LENGTH = 25;
const MAX_PROPERTY_KEYS = 50;
const MAX_CONTEXT_STRING_LENGTH = 500;

const eventNameSet = new Set<string>(ANALYTICS_EVENT_NAMES);

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && eventNameSet.has(value);
}

export function normalizeAnalyticsText(
  value: string | null | undefined,
  maxLength = MAX_CONTEXT_STRING_LENGTH,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

export function sanitizeAnalyticsProperties(
  value: Record<string, unknown> | undefined,
): Json {
  if (!value) return {};
  const sanitized = sanitizeJsonValue(value, 0);
  return isPlainObject(sanitized) ? sanitized : {};
}

export function buildAnalyticsEventInsert(
  payload: AnalyticsEventPayload,
): AnalyticsEventInsert | null {
  const userId = normalizeAnalyticsText(payload.userId, 128);
  const anonymousId = normalizeAnalyticsText(payload.anonymousId, 128);

  if (!userId && !anonymousId) return null;

  return {
    user_id: userId,
    anonymous_id: anonymousId,
    event_name: payload.eventName,
    properties: sanitizeAnalyticsProperties(payload.properties),
    path: normalizeAnalyticsText(payload.path),
    referrer: normalizeAnalyticsText(payload.referrer),
    utm_source: normalizeAnalyticsText(payload.utm?.utm_source, 160),
    utm_medium: normalizeAnalyticsText(payload.utm?.utm_medium, 160),
    utm_campaign: normalizeAnalyticsText(payload.utm?.utm_campaign, 240),
    utm_content: normalizeAnalyticsText(payload.utm?.utm_content, 240),
    utm_term: normalizeAnalyticsText(payload.utm?.utm_term, 240),
    session_id: normalizeAnalyticsText(payload.sessionId, 128),
    message_id: normalizeAnalyticsText(payload.messageId, 128),
    run_id: normalizeAnalyticsText(payload.runId, 128),
    created_at: payload.createdAt,
  };
}

function sanitizeJsonValue(value: unknown, depth: number): Json | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return value.slice(0, MAX_PROPERTY_STRING_LENGTH);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_PROPERTY_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_PROPERTY_ARRAY_LENGTH)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item): item is Json => item !== undefined);
    return items;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .slice(0, MAX_PROPERTY_KEYS)
      .map(([key, item]) => [
        key.slice(0, 80),
        sanitizeJsonValue(item, depth + 1),
      ] as const)
      .filter((entry): entry is readonly [string, Json] => entry[1] !== undefined);

    return Object.fromEntries(entries) as Json;
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
