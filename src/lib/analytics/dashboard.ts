import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ANALYTICS_EVENT_NAMES, type AnalyticsEventName } from "@/lib/analytics/events";
import type { AnalyticsEventRow } from "@/types/database";

export interface AnalyticsDashboardEvent {
  event_name: AnalyticsEventName;
  user_id: string | null;
  anonymous_id: string | null;
  created_at: string;
  properties: unknown;
}

export interface AnalyticsFunnelSummary {
  since: string;
  until: string;
  totalEvents: number;
  uniqueActors: number;
  counts: Record<AnalyticsEventName, number>;
  rates: {
    pageToCta: number | null;
    ctaToSignup: number | null;
    signupToQuestion: number | null;
    prefillToQuestion: number | null;
    questionToAnswer: number | null;
    answerToCitation: number | null;
    answerFailureRate: number | null;
    limitToUpgrade: number | null;
  };
}

export interface AnalyticsDailyRow {
  date: string;
  counts: Record<AnalyticsEventName, number>;
  uniqueActors: number;
}

const EVENT_NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);

export async function getAnalyticsDashboardSummary(days = 30) {
  const now = new Date();
  const since = new Date(now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const { data, error } = await getSupabaseAdmin()
    .from("analytics_events")
    .select("event_name, user_id, anonymous_id, created_at, properties")
    .gte("created_at", since.toISOString())
    .lte("created_at", now.toISOString())
    .returns<AnalyticsDashboardEvent[]>();

  if (error) throw new Error(error.message);

  return {
    summary: buildAnalyticsFunnelSummary(data ?? [], {
      since: since.toISOString(),
      until: now.toISOString(),
    }),
    daily: buildAnalyticsDailyRows(data ?? []),
  };
}

export function buildAnalyticsFunnelSummary(
  events: AnalyticsDashboardEvent[],
  range: { since: string; until: string },
): AnalyticsFunnelSummary {
  const counts = emptyEventCounts();
  const actors = new Set<string>();

  for (const event of events) {
    if (!isDashboardEventName(event.event_name)) continue;
    counts[event.event_name] += 1;
    const actor = getActorKey(event);
    if (actor) actors.add(actor);
  }

  const completed = counts.answer_completed;
  const failed = counts.answer_failed;

  return {
    since: range.since,
    until: range.until,
    totalEvents: events.length,
    uniqueActors: actors.size,
    counts,
    rates: {
      pageToCta: rate(counts.cta_clicked, counts.page_viewed),
      ctaToSignup: rate(counts.signup_started, counts.cta_clicked),
      signupToQuestion: rate(counts.question_submitted, counts.signup_started),
      prefillToQuestion: rate(counts.question_submitted, counts.question_prefilled),
      questionToAnswer: rate(completed, counts.question_submitted),
      answerToCitation: rate(counts.citation_opened, completed),
      answerFailureRate: rate(failed, completed + failed),
      limitToUpgrade: rate(counts.upgrade_clicked, counts.usage_limit_reached),
    },
  };
}

export function buildAnalyticsDailyRows(
  events: AnalyticsDashboardEvent[],
): AnalyticsDailyRow[] {
  const rows = new Map<
    string,
    { counts: Record<AnalyticsEventName, number>; actors: Set<string> }
  >();

  for (const event of events) {
    if (!isDashboardEventName(event.event_name)) continue;
    const date = event.created_at.slice(0, 10);
    if (!rows.has(date)) {
      rows.set(date, { counts: emptyEventCounts(), actors: new Set() });
    }

    const row = rows.get(date)!;
    row.counts[event.event_name] += 1;
    const actor = getActorKey(event);
    if (actor) row.actors.add(actor);
  }

  return [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => ({
      date,
      counts: row.counts,
      uniqueActors: row.actors.size,
    }));
}

function emptyEventCounts(): Record<AnalyticsEventName, number> {
  return Object.fromEntries(
    ANALYTICS_EVENT_NAMES.map((eventName) => [eventName, 0]),
  ) as Record<AnalyticsEventName, number>;
}

function getActorKey(event: AnalyticsDashboardEvent): string | null {
  if (event.user_id) return `user:${event.user_id}`;
  if (event.anonymous_id) return `anon:${event.anonymous_id}`;
  return null;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function isDashboardEventName(value: string): value is AnalyticsEventName {
  return EVENT_NAME_SET.has(value);
}

export type AnalyticsDashboardRow = Pick<
  AnalyticsEventRow,
  "event_name" | "user_id" | "anonymous_id" | "created_at" | "properties"
>;
