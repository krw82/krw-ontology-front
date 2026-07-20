"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { filingEventTagLabel } from "@/lib/filing-notifications/classification";
import { trackClientEventSilently } from "@/lib/analytics/client";

type Timeline = {
  last_filing_at: string | null;
  filings_last_90_days: number;
  event_type_counts: Array<{ tag: string; count: number }>;
  unread_count: number;
  recent_amendments: Array<{ id: string; form_type: string; filing_date: string; primary_event_tag: string | null }>;
  expected_window: { startDate: string; endDate: string; observedFilings: number } | null;
};

export default function CompanyFilingTimeline({ ticker }: { ticker: string }) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/filings/timeline?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<Timeline> : null)
      .then((payload) => {
        if (!active || !payload) return;
        setTimeline(payload);
        trackClientEventSilently("company_filing_timeline_viewed", { ticker, filings_last_90_days: payload.filings_last_90_days });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [ticker]);

  if (!timeline) return null;
  return <section className="mt-md rounded-[8px] bg-surface-soft px-sm py-sm">
    <div className="flex items-center justify-between gap-sm"><p className="text-xs font-extrabold text-ink">공시 타임라인</p>{timeline.unread_count ? <Link href="/filings" className="inline-flex min-h-11 items-center px-xs text-xs font-bold text-primary underline underline-offset-4">읽지 않음 {timeline.unread_count}건</Link> : null}</div>
    <p className="mt-1 text-xs leading-5 text-muted">최근 90일 {timeline.filings_last_90_days}건{timeline.last_filing_at ? ` · 마지막 ${formatDateTime(timeline.last_filing_at)}` : ""}</p>
    {timeline.event_type_counts.length ? <p className="mt-1 text-xs leading-5 text-muted">{timeline.event_type_counts.slice(0, 3).map(({ tag, count }) => `${filingEventTagLabel(tag) ?? "기타"} ${count}`).join(" · ")}</p> : null}
    {timeline.expected_window ? <p className="mt-2 rounded-[5px] border border-primary/20 bg-canvas px-2 py-1 text-xs leading-5 text-muted"><span className="font-extrabold text-ink">다음 실적성 공시 예상 창</span> · {formatDate(timeline.expected_window.startDate)}–{formatDate(timeline.expected_window.endDate)} <span className="text-muted">(과거 {timeline.expected_window.observedFilings}건 주기 기반)</span></p> : null}
    {timeline.recent_amendments.length ? <div className="mt-2 flex flex-wrap gap-2">{timeline.recent_amendments.map((filing) => <Link key={filing.id} href={`/filings/${encodeURIComponent(filing.id)}`} className="inline-flex min-h-11 items-center px-xs text-xs font-bold text-primary underline underline-offset-4">정정 {filing.form_type} · {formatDate(filing.filing_date)}</Link>)}</div> : null}
  </section>;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date);
}
