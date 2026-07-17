"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import CompanyFilingTimeline from "@/components/filings/CompanyFilingTimeline";

type Subscription = { ticker: string; enabled: boolean };

export default function CompanyFilingSubscriptionControl({
  ticker,
  loginHref,
  isAuthenticated,
}: {
  ticker: string;
  loginHref: string;
  isAuthenticated: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(isAuthenticated);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    void fetch("/api/filing-subscriptions", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("subscriptions_unavailable");
        return response.json() as Promise<{ subscriptions?: Subscription[] }>;
      })
      .then((payload) => {
        if (!active) return;
        setEnabled(Boolean(payload.subscriptions?.find((subscription) => subscription.ticker === ticker)?.enabled));
      })
      .catch(() => {
        if (active) setMessage("공시 알림 상태를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isAuthenticated, ticker]);

  if (!isAuthenticated) {
    return (
      <p className="mt-3 text-[13px] font-semibold leading-5 text-muted">
        <Link href={loginHref} className="text-primary underline underline-offset-4">로그인하고 새 8-K·6-K·Form 4 공시 알림 받기</Link>
      </p>
    );
  }

  async function toggle() {
    if (saving || loading) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/filing-subscriptions/${encodeURIComponent(ticker)}`, {
        method: enabled ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("subscription_update_failed");
      const nextEnabled = !enabled;
      setEnabled(nextEnabled);
      if (nextEnabled) {
        setMessage("최근 공시를 불러오는 중입니다. 잠시 후 공시함에서 확인하세요.");
        setRecentCount(null);
        void waitForInitialSync(ticker, (count) => {
          setRecentCount(count);
          setMessage(count ? `최근 공시 ${count}건을 준비했습니다.` : "첫 동기화가 진행 중입니다. 공시함에서 다시 확인해주세요.");
        });
        trackClientEventSilently("filing_subscription_created", { ticker, surface: "company_hero" });
      } else {
        setMessage("이 기업의 새 공시 알림을 중지했습니다.");
        setRecentCount(null);
        trackClientEventSilently("filing_subscription_removed", { ticker, surface: "company_hero" });
      }
    } catch {
      setMessage("공시 알림을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-[8px] border border-hairline bg-canvas px-sm py-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div>
          <p className="text-[13px] font-extrabold text-ink">새 SEC 공시 알림</p>
          <p className="mt-0.5 text-xs leading-5 text-muted">이 기업의 8-K·6-K·Form 4가 제출되면 알려드립니다.</p>
        </div>
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => void toggle()}
          aria-pressed={enabled}
          className="min-h-9 rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "확인 중…" : saving ? "저장 중…" : enabled ? "알림 끄기" : "알림 받기"}
        </button>
      </div>
      {enabled ? <div className="mt-2 flex flex-wrap gap-x-sm gap-y-1"><Link href="/filings" className="inline-flex text-xs font-bold text-primary underline underline-offset-4">{recentCount ? "최근 공시 확인하기" : "공시함 열기"}</Link><Link href="/settings/notifications" className="inline-flex text-xs font-bold text-primary underline underline-offset-4">알림 설치·테스트</Link></div> : null}
      {message ? <p className="mt-2 text-xs leading-5 text-muted" role="status">{message}</p> : null}
      {enabled ? <CompanyFilingTimeline ticker={ticker} /> : null}
    </div>
  );
}

async function waitForInitialSync(ticker: string, done: (count: number) => void) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 3_000));
    try {
      const response = await fetch(`/api/filings/recent?ticker=${encodeURIComponent(ticker)}&limit=3`, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json() as { filings?: unknown[] };
      if (payload.filings?.length) {
        done(payload.filings.length);
        return;
      }
    } catch {
      // The visible status remains actionable while the worker retries.
    }
  }
  done(0);
}
