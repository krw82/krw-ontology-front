import type { AnalyticsEventRow, Database, Json } from "@/types/database";

export const ANALYTICS_EVENT_NAMES = [
  "page_viewed",
  "cta_clicked",
  "home_cta_clicked",
  "signup_started",
  "login_completed",
  "company_selected",
  "question_prefilled",
  "suggested_question_clicked",
  "starter_question_clicked",
  "question_submitted",
  "answer_completed",
  "answer_failed",
  "citation_opened",
  "share_created",
  "share_viewed",
  "share_answer_read",
  "share_cta_clicked",
  "share_starter_loaded",
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
  "company_followed",
  "push_permission_requested",
  "push_permission_prompted",
  "push_permission_granted",
  "push_permission_denied",
  "push_subscribed",
  "push_unsubscribed",
  "filing_notification_clicked",
  "filing_subscription_created",
  "filing_subscription_removed",
  "filing_history_loaded",
  "filing_detail_viewed",
  "push_notification_clicked",
  "key_exhibit_opened",
  "sec_source_opened",
  "filing_analysis_started",
  "filing_history_backfilled",
  "historical_filing_opened",
  "pwa_install_prompt_seen",
  "pwa_installed",
  "test_push_requested",
  "test_push_received",
  "filing_detected",
  "filing_notification_created",
  "push_provider_accepted",
  "sw_push_received",
  "notification_show_called",
  "notification_clicked",
  "filings_inbox_viewed",
  "filing_marked_read",
  "filing_snoozed",
  "filing_pinned",
  "filing_archived",
  "digest_opened",
  "alert_rule_created",
  "alert_rule_removed",
  "filing_delivery_mode_changed",
  "amendment_comparison_opened",
  "company_filing_timeline_viewed",
  "pulse_viewed",
  "pulse_item_impression",
  "pulse_item_opened",
  "pulse_item_actioned",
  "pulse_summary_actioned",
  "pulse_filter_changed",
  "pulse_preferences_updated",
  "pulse_new_items_seen",
  "pulse_end_reached",
  "pulse_feedback_submitted",
  "pulse_source_degraded",
  "pulse_answer_prefilled",
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
const FORBIDDEN_PROPERTY_KEYS = new Set([
  "answer",
  "answertext",
  "answer_text",
  "attachment_text",
  "attachmenttext",
  "full_answer",
  "full_answer_text",
  "full_attachment_text",
  "full_prompt",
  "full_question",
  "fullanswer",
  "fullanswertext",
  "fullattachmenttext",
  "fullprompt",
  "fullquestion",
  "prompt",
  "question",
  "raw_answer",
  "raw_attachment_text",
  "raw_content",
  "raw_prompt",
  "raw_question",
  "rawanswer",
  "rawattachmenttext",
  "rawcontent",
  "rawprompt",
  "rawquestion",
]);

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
      .filter(([key]) => !isForbiddenAnalyticsPropertyKey(key))
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

function isForbiddenAnalyticsPropertyKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return FORBIDDEN_PROPERTY_KEYS.has(key) || FORBIDDEN_PROPERTY_KEYS.has(normalized);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
