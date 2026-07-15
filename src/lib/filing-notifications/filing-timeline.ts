import type { SecFilingEventRow } from "@/types/database";

export type ExpectedFilingWindow = {
  startDate: string;
  endDate: string;
  basis: "historical_earnings_cadence";
  observedFilings: number;
  medianIntervalDays: number;
};

export function summarizeFilingTimeline(events: SecFilingEventRow[]) {
  const byEventTag = new Map<string, number>();
  for (const event of events) {
    const tag = event.primary_event_tag ?? "unclassified";
    byEventTag.set(tag, (byEventTag.get(tag) ?? 0) + 1);
  }
  return [...byEventTag.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

/**
 * This is deliberately a labelled window, not an earnings-calendar claim. It
 * only uses repeat Item 2.02 (or classified 6-K earnings) dates already in the
 * user's tracked SEC metadata.
 */
export function expectedFilingWindow(events: SecFilingEventRow[], now = new Date()): ExpectedFilingWindow | null {
  const earnings = events
    .filter((event) => event.primary_event_tag === "earnings_or_financial_results")
    .map((event) => event.accepted_at ?? `${event.filing_date}T00:00:00Z`)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());
  if (earnings.length < 2) return null;
  const intervals = earnings.slice(0, -1).map((date, index) => Math.round((date.getTime() - earnings[index + 1].getTime()) / 86_400_000))
    .filter((days) => days >= 30 && days <= 180)
    .sort((left, right) => left - right);
  if (!intervals.length) return null;
  const medianIntervalDays = intervals[Math.floor(intervals.length / 2)];
  const target = new Date(earnings[0]);
  target.setUTCDate(target.getUTCDate() + medianIntervalDays);
  if (target.getTime() < now.getTime() - 14 * 86_400_000 || target.getTime() > now.getTime() + 200 * 86_400_000) return null;
  const start = new Date(target);
  const end = new Date(target);
  start.setUTCDate(start.getUTCDate() - 10);
  end.setUTCDate(end.getUTCDate() + 10);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    basis: "historical_earnings_cadence",
    observedFilings: earnings.length,
    medianIntervalDays,
  };
}
