import type { SecFilingEventRow } from "@/types/database";
import type { ExpectedFilingWindow } from "@/lib/filing-notifications/filing-timeline";

export function buildPrivateFilingRss(params: { origin: string; events: Array<SecFilingEventRow & { display_ticker: string }> }): string {
  const updated = params.events[0]?.accepted_at ?? params.events[0]?.created_at ?? new Date().toISOString();
  const items = params.events.map((event) => {
    const label = event.primary_event_tag ? ` · ${event.primary_event_tag.replaceAll("_", " ")}` : "";
    const title = `${event.display_ticker} · ${event.form_type}${label}`;
    const published = event.accepted_at ?? `${event.filing_date}T00:00:00Z`;
    return `<item><guid isPermaLink="false">${escapeXml(event.id)}</guid><title>${escapeXml(title)}</title><link>${escapeXml(`${params.origin}/filings/${event.id}`)}</link><pubDate>${new Date(published).toUTCString()}</pubDate><description>${escapeXml(`SEC ${event.form_type} · ${event.filing_date}`)}</description></item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>KRW.O 내 관심기업 공시</title><link>${escapeXml(`${params.origin}/filings`)}</link><description>개인 관심기업의 최근 8-K·6-K 공시</description><lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>${items}</channel></rss>`;
}

export function buildExpectedFilingIcs(params: { origin: string; windows: Array<{ ticker: string; window: ExpectedFilingWindow }> }): string {
  const events = params.windows.map(({ ticker, window }) => {
    const until = addDays(window.endDate, 1);
    const url = `${params.origin}/companies/${encodeURIComponent(ticker)}`;
    return [
      "BEGIN:VEVENT",
      `UID:krwo-${escapeIcs(ticker)}-${window.startDate}@filings`,
      `DTSTAMP:${icsTimestamp(new Date())}`,
      `DTSTART;VALUE=DATE:${window.startDate.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${until.replaceAll("-", "")}`,
      `SUMMARY:${escapeIcs(`${ticker} 실적성 공시 예상 창`)}`,
      `DESCRIPTION:${escapeIcs(`과거 ${window.observedFilings}건의 실적성 SEC 공시 주기 기반 예상 창입니다. 확정 일정이 아닙니다. ${url}`)}`,
      `URL:${escapeIcs(url)}`,
      "END:VEVENT",
    ].join("\r\n");
  }).join("\r\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KRW.O//Private Filing Calendar//KO", "CALSCALE:GREGORIAN", events, "END:VCALENDAR", ""].join("\r\n");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function escapeIcs(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n");
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function icsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
