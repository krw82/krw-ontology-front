"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import CompanyFilingTimeline from "@/components/filings/CompanyFilingTimeline";
import { signalPwaInstallEngagement } from "@/components/pwa/lifecycle";
import type { Locale } from "@/i18n/config";

type Subscription = { ticker: string; enabled: boolean };

export default function CompanyFilingSubscriptionControl({
  ticker,
  locale,
  loginHref,
  isAuthenticated,
}: {
  ticker: string;
  locale: Locale;
  loginHref: string;
  isAuthenticated: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(isAuthenticated);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState<number | null>(null);
  const copy = locale === "ko"
    ? {
        login: "로그인하고 이 기업의 새 업데이트 받기",
        loadError: "공시 알림 상태를 불러오지 못했습니다.",
        syncStarted: "최근 공시를 준비하는 중입니다. 이후 새 공시와 검증된 시장 이슈는 업데이트함에 모입니다.",
        synced: (count: number) => `최근 공시 ${count}건을 준비했습니다.`,
        syncPending: "첫 동기화가 진행 중입니다. 공시함에서 다시 확인해주세요.",
        stopped: "이 기업의 새 업데이트 알림을 중지했습니다.",
        saveError: "공시 알림을 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
        title: "관심기업 업데이트",
        description: "새 8-K·6-K·Form 4와 검증된 시장 이슈를 업데이트함에 모읍니다.",
        loading: "확인 중…",
        saving: "저장 중…",
        disable: "알림 끄기",
        enable: "업데이트 받기",
        openRecent: "최근 업데이트 확인하기",
        openInbox: "업데이트함 열기",
        deviceSettings: "이 기기 알림 설정",
      }
    : {
        login: "Sign in to get new updates for this company",
        loadError: "Could not load the filing alert status.",
        syncStarted: "Preparing recent filings. New filings and verified market issues will appear in your inbox.",
        synced: (count: number) => `Prepared ${count} recent filings.`,
        syncPending: "Initial sync is in progress. Check the filing inbox again shortly.",
        stopped: "Updates for this company are now paused.",
        saveError: "Could not update filing alerts. Please try again shortly.",
        title: "Company updates",
        description: "New 8-Ks, 6-Ks, Form 4s, and verified market issues appear in your inbox.",
        loading: "Checking…",
        saving: "Saving…",
        disable: "Stop updates",
        enable: "Get updates",
        openRecent: "View recent updates",
        openInbox: "Open inbox",
        deviceSettings: "Set up this device",
      };

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
        if (active) setMessage(copy.loadError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [copy.loadError, isAuthenticated, locale, ticker]);

  if (!isAuthenticated) {
    return (
      <p className="mt-3 text-[13px] font-semibold leading-5 text-muted">
        <Link href={loginHref} className="inline-flex min-h-11 items-center px-xs text-primary underline underline-offset-4">{copy.login}</Link>
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
        setMessage(copy.syncStarted);
        setRecentCount(null);
        void waitForInitialSync(ticker, (count) => {
          setRecentCount(count);
          setMessage(count ? copy.synced(count) : copy.syncPending);
        });
        trackClientEventSilently("filing_subscription_created", { ticker, surface: "company_hero" });
        signalPwaInstallEngagement(
          "filing_subscription_created",
          "company_hero",
        );
      } else {
        setMessage(copy.stopped);
        setRecentCount(null);
        trackClientEventSilently("filing_subscription_removed", { ticker, surface: "company_hero" });
      }
    } catch {
      setMessage(copy.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-[8px] border border-hairline bg-canvas px-sm py-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div>
          <p className="text-[13px] font-extrabold text-ink">{copy.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted">{copy.description}</p>
        </div>
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => void toggle()}
          aria-pressed={enabled}
          className="min-h-11 rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? copy.loading : saving ? copy.saving : enabled ? copy.disable : copy.enable}
        </button>
      </div>
      {enabled ? <div className="mt-2 flex flex-wrap gap-x-sm gap-y-1"><Link href="/filings" className="inline-flex min-h-11 items-center px-xs text-xs font-bold text-primary underline underline-offset-4">{recentCount ? copy.openRecent : copy.openInbox}</Link><Link href="/settings/notifications" className="inline-flex min-h-11 items-center px-xs text-xs font-bold text-primary underline underline-offset-4">{copy.deviceSettings}</Link></div> : null}
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
