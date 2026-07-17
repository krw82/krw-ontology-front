"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";

type FilingSubscription = {
  ticker: string;
  company_name: string | null;
  enabled: boolean;
};

export default function FilingSubscriptionList() {
  const [subscriptions, setSubscriptions] = useState<FilingSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingTicker, setPendingTicker] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/filing-subscriptions", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("subscriptions_unavailable");
        return response.json() as Promise<{ subscriptions?: FilingSubscription[] }>;
      })
      .then((payload) => {
        if (active) setSubscriptions((payload.subscriptions ?? []).filter((subscription) => subscription.enabled));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function remove(ticker: string) {
    if (pendingTicker) return;
    setPendingTicker(ticker);
    try {
      const response = await fetch(`/api/filing-subscriptions/${encodeURIComponent(ticker)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("subscription_remove_failed");
      setSubscriptions((current) => current.filter((subscription) => subscription.ticker !== ticker));
      trackClientEventSilently("filing_subscription_removed", { ticker, surface: "notification_settings" });
    } catch {
      // Keep the current row so the user can retry.
    } finally {
      setPendingTicker(null);
    }
  }

  return (
    <section className="mt-lg border-t border-hairline pt-lg">
      <h2 className="text-sm font-extrabold text-ink">공시를 추적 중인 기업</h2>
      {loading ? <p className="mt-sm text-sm text-muted">추적 기업을 불러오는 중…</p> : null}
      {!loading && !subscriptions.length ? <p className="mt-sm text-sm leading-6 text-muted">아직 공시를 추적 중인 기업이 없습니다. 회사 페이지에서 새 8-K·6-K·Form 4 알림을 켜보세요.</p> : null}
      <ul className="mt-sm divide-y divide-hairline rounded-[8px] border border-hairline">
        {subscriptions.map((subscription) => (
          <li key={subscription.ticker} className="flex items-center justify-between gap-sm px-base py-sm">
            <span className="min-w-0"><span className="block text-sm font-extrabold text-ink">{subscription.ticker}</span>{subscription.company_name ? <span className="block truncate text-xs text-muted">{subscription.company_name}</span> : null}</span>
            <button type="button" disabled={pendingTicker === subscription.ticker} onClick={() => void remove(subscription.ticker)} className="min-h-9 shrink-0 rounded-[7px] px-sm text-xs font-extrabold text-muted hover:text-error disabled:opacity-60">{pendingTicker === subscription.ticker ? "해제 중…" : "추적 해제"}</button>
          </li>
        ))}
      </ul>
      <Link href="/filings" className="mt-sm inline-flex text-xs font-bold text-primary underline underline-offset-4">공시함 열기</Link>
    </section>
  );
}
