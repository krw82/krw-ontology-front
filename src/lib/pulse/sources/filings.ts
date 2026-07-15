import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type {
  Database,
  SecFilingEventRow,
  UserFilingNotificationRow,
} from "@/types/database";

interface FilingEntry {
  notification: UserFilingNotificationRow;
  event: SecFilingEventRow;
}

export async function getFilingCandidates(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date,
): Promise<PulseCandidate[]> {
  const { data: notifications, error: notificationError } = await supabase
    .from("user_filing_notifications")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "filing_received")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (notificationError) throw notificationError;
  if (notifications.length === 0) return [];

  const visibleNotifications = notifications.filter(
    (notification) =>
      !notification.snoozed_until || Date.parse(notification.snoozed_until) <= now.getTime(),
  );
  if (visibleNotifications.length === 0) return [];

  const eventIds = [...new Set(visibleNotifications.map((item) => item.filing_event_id))];
  const { data: events, error: eventError } = await supabase
    .from("sec_filing_events")
    .select("*")
    .in("id", eventIds);
  if (eventError) throw eventError;

  const eventMap = new Map(events.map((event) => [event.id, event]));
  const entries = visibleNotifications.flatMap((notification) => {
    const event = eventMap.get(notification.filing_event_id);
    return event ? [{ notification, event }] : [];
  });

  return groupFilingEntries(entries).map(toCandidate);
}

function groupFilingEntries(entries: FilingEntry[]): FilingEntry[][] {
  const groups = new Map<string, FilingEntry[]>();
  for (const entry of entries) {
    const eventTime = Date.parse(entry.event.accepted_at ?? entry.event.first_seen_at);
    const groupKey = filingGroupKey(entry.event, entry.notification.id, eventTime);
    const group = groups.get(groupKey) ?? [];
    group.push(entry);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

export function filingGroupKey(
  event: Pick<SecFilingEventRow, "alert_priority" | "cik">,
  notificationId: string,
  eventTime: number,
): string {
  return event.alert_priority === "urgent"
    ? `urgent:${notificationId}`
    : `${event.cik}:${Math.floor(eventTime / 600_000)}`;
}

function toCandidate(group: FilingEntry[]): PulseCandidate {
  const lead = [...group].sort((left, right) =>
    Date.parse(right.notification.created_at) - Date.parse(left.notification.created_at),
  )[0];
  const notificationIds = group.map((entry) => entry.notification.id).sort();
  const event = lead.event;
  const isGrouped = group.length > 1;
  const sourceId = notificationIds.join(",");
  const eventLabel = filingEventLabel(event);
  const priority = event.alert_priority === "urgent"
    ? "urgent"
    : event.alert_priority === "normal" ? "high" : "normal";
  const detailHref = isGrouped ? "/filings" : lead.notification.destination_path;
  const params = new URLSearchParams({
    ticker: event.ticker,
    query: `${event.ticker} ${event.form_type} ${eventLabel} 공시에서 투자 판단에 중요한 원문 근거를 확인해줘`,
  });

  return {
    item_key: makePulseItemKey("filing", sourceId),
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: sourceId,
    ticker: event.ticker,
    eyebrow: event.is_amendment ? `${event.form_type} 정정 공시` : `${event.form_type} 새 공시`,
    title: isGrouped ? `${event.ticker}에서 공시 ${group.length}건이 도착했습니다` : lead.notification.title,
    body: isGrouped
      ? group.map((entry) => filingEventLabel(entry.event)).join(" · ")
      : lead.notification.body,
    reason_code: "filing_subscription",
    reason_label: `${event.ticker} 공시 알림을 켰기 때문입니다.`,
    priority,
    occurred_at: event.accepted_at ?? event.first_seen_at,
    available_at: lead.notification.created_at,
    expires_at: new Date(Date.parse(lead.notification.created_at) + 90 * 24 * 60 * 60 * 1_000).toISOString(),
    read_at: group.every((entry) => entry.notification.read_at)
      ? lead.notification.read_at
      : null,
    saved_at: group.some((entry) => entry.notification.pinned_at)
      ? lead.notification.pinned_at
      : null,
    snoozed_until: null,
    group_key: isGrouped ? `${event.cik}:${Math.floor(Date.parse(event.accepted_at ?? event.first_seen_at) / 600_000)}` : null,
    primary_action: { type: "link", label: isGrouped ? "공시함에서 보기" : "공시 보기", href: detailHref },
    secondary_actions: [
      { type: "link", label: "이 공시로 질문", href: `/chat/new?${params}`, analytics_name: "pulse_answer_prefilled" },
      { type: "mutation", label: "검토 완료", action: "review" },
      { type: "mutation", label: "내일 다시 보기", action: "snooze" },
    ],
    metadata: {
      form_type: event.form_type,
      alert_priority: event.alert_priority,
      primary_event_tag: event.primary_event_tag,
      notification_count: group.length,
      is_amendment: event.is_amendment,
    },
    is_pinned: group.some((entry) => Boolean(entry.notification.pinned_at)),
  };
}

function filingEventLabel(event: SecFilingEventRow): string {
  if (event.primary_event_tag) return event.primary_event_tag.replaceAll("_", " ");
  if (event.sec_items.length > 0) return `Item ${event.sec_items.join(", ")}`;
  return event.form_type;
}
