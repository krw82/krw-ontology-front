"use client";

import { useEffect, useState } from "react";
import {
  isIOSBrowser,
  isStandaloneDisplayMode,
  isWebPushSupported,
} from "@/lib/filing-notifications/client";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  getReadyServiceWorkerRegistration,
  savePushSubscription,
} from "@/lib/filing-notifications/push-subscription-client";

type Preferences = {
  enabled: boolean;
  notify_8k: boolean;
  notify_6k: boolean;
  notify_form4: boolean;
  notify_market_news: boolean;
  insider_notification_mode: "none" | "reported_p_s" | "all";
  form4_immediate_min_value_usd: number;
  include_amendments: boolean;
  delivery_mode: "important_immediate" | "all_immediate" | "daily_digest";
  daily_digest_at: string;
  timezone: string;
};

const DEFAULT_PREFERENCES: Preferences = {
  enabled: true,
  notify_8k: true,
  notify_6k: true,
  notify_form4: true,
  notify_market_news: true,
  insider_notification_mode: "reported_p_s",
  form4_immediate_min_value_usd: 1_000_000,
  include_amendments: false,
  delivery_mode: "important_immediate",
  daily_digest_at: "08:30",
  timezone: "Asia/Seoul",
};


export default function NotificationSettingsCard() {
  const [supported, setSupported] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [trackedCompanyCount, setTrackedCompanyCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      const webPushSupported = isWebPushSupported();
      if (!active) return;
      setSupported(webPushSupported);
      setIosNeedsInstall(isIOSBrowser() && !isStandaloneDisplayMode());
      setPermission(webPushSupported ? Notification.permission : "unsupported");
      try {
        const [preferencesResponse, subscriptionsResponse] = await Promise.all([
          fetch("/api/filing-notifications/preferences", { cache: "no-store" }),
          fetch("/api/filing-subscriptions", { cache: "no-store" }),
        ]);
        if (!active) return;
        if (preferencesResponse.ok) {
          const payload = (await preferencesResponse.json()) as { preferences?: Preferences };
          if (payload.preferences) setPreferences({ ...DEFAULT_PREFERENCES, ...payload.preferences });
        }
        if (subscriptionsResponse.ok) {
          const payload = await subscriptionsResponse.json() as { subscriptions?: Array<{ enabled?: boolean }> };
          setTrackedCompanyCount((payload.subscriptions ?? []).filter((subscription) => subscription.enabled).length);
        }
        if (webPushSupported) {
          void getReadyServiceWorkerRegistration().then(async (registration) => {
            if (!active || !registration) return;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) await savePushSubscription(subscription);
            if (active) setSubscribed(Boolean(subscription));
          }).catch(() => {
            // Preferences remain usable even when push registration is down.
          });
        }
      } catch {
        if (active) setMessage("알림 설정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function unsubscribe() {
    setSaving(true);
    setMessage(null);
    try {
      const registration = await getReadyServiceWorkerRegistration();
      if (!registration) throw new Error("service_worker_unavailable");
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error("subscription_delete_failed");
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setMessage("브라우저 푸시 알림을 껐습니다.");
    } catch {
      setMessage("알림을 끄지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTestPush() {
    setTesting(true);
    setMessage(null);
    try {
      trackClientEventSilently("test_push_requested", { surface: "filing_notification_settings" });
      const response = await fetch("/api/push/test", { method: "POST" });
      if (!response.ok) throw new Error("push_test_failed");
      setMessage("테스트 알림을 푸시 서비스로 보냈습니다. 기기 알림을 확인해주세요.");
    } catch {
      setMessage("테스트 알림을 보내지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setTesting(false);
    }
  }

  async function updatePreferences(next: Partial<Preferences>) {
    const optimistic = { ...preferences, ...next };
    setPreferences(optimistic);
    try {
      const response = await fetch("/api/filing-notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("preference_save_failed");
      const payload = (await response.json()) as { preferences?: Preferences };
      if (payload.preferences) setPreferences({ ...DEFAULT_PREFERENCES, ...payload.preferences });
    } catch {
      setPreferences(preferences);
      setMessage("알림 설정을 저장하지 못했습니다.");
    }
  }

  if (loading) {
    return <section className="rounded-[10px] border border-hairline bg-canvas p-lg text-sm text-muted">알림 설정을 불러오는 중…</section>;
  }

  return (
    <section className="rounded-[10px] border border-hairline bg-canvas p-lg shadow-sm">
      <div className="flex flex-col gap-sm border-b border-hairline pb-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-black tracking-[-0.03em] text-ink">알림</h1>
          <p className="mt-xs text-sm leading-6 text-muted">관심기업에 중요한 변화가 생기면 알려드려요.</p>
        </div>
        {subscribed ? (
          <button type="button" onClick={() => void unsubscribe()} disabled={saving} className="min-h-11 rounded-[8px] border border-hairline px-base text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:opacity-60">
            이 기기 푸시 끄기
          </button>
        ) : null}
      </div>

      {!supported ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted">이 브라우저에서는 알림을 받을 수 없어요.</p> : null}
      {iosNeedsInstall ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted">iPhone에서는 KRW.O를 홈 화면에 추가한 뒤 알림을 켤 수 있어요.</p> : null}
      {permission === "denied" ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted">이 브라우저의 알림이 꺼져 있어요. 브라우저 설정에서 KRW.O 알림을 켜주세요.</p> : null}
      {message ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted" role="status">{message}</p> : null}
      {trackedCompanyCount < 1 ? <p className="mt-md rounded-[8px] border border-hairline px-sm py-sm text-sm leading-6 text-muted">관심기업을 추가하면 새 소식을 알려드릴게요.</p> : null}
      {subscribed ? <button type="button" onClick={() => void sendTestPush()} disabled={testing || saving} className="mt-md min-h-11 rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:opacity-60">{testing ? "테스트 전송 중…" : "테스트 알림 보내기"}</button> : null}

      <div className="mt-lg space-y-sm">
        <PreferenceToggle label="관심기업 알림" description={preferences.enabled ? "켜짐" : "꺼짐"} checked={preferences.enabled} onChange={(checked) => void updatePreferences({ enabled: checked })} />
        <label className="block rounded-[8px] border border-hairline px-base py-sm"><span className="block text-sm font-extrabold text-ink">언제 알려드릴까요?</span><select value={preferences.delivery_mode} onChange={(event) => { const deliveryMode = event.target.value as Preferences["delivery_mode"]; void updatePreferences({ delivery_mode: deliveryMode }); trackClientEventSilently("filing_delivery_mode_changed", { delivery_mode: deliveryMode }); }} className="mt-sm min-h-11 w-full rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink"><option value="important_immediate">중요한 소식만 바로 (추천)</option><option value="all_immediate">새 소식은 모두 바로</option><option value="daily_digest">하루 한 번 모아서</option></select></label>
        {preferences.delivery_mode === "daily_digest" ? <label className="block rounded-[8px] border border-hairline px-base py-sm"><span className="block text-sm font-extrabold text-ink">받을 시간</span><input type="time" value={preferences.daily_digest_at.slice(0, 5)} onChange={(event) => void updatePreferences({ daily_digest_at: event.target.value })} className="mt-sm min-h-11 rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink" /></label> : null}
      </div>

      <details className="mt-lg border-t border-hairline pt-lg">
        <summary className="cursor-pointer text-sm font-extrabold text-ink marker:hidden">세부 알림 설정</summary>
        <p className="mt-1 text-xs leading-5 text-muted">공시 종류나 내부자 거래 기준을 직접 바꾸고 싶을 때만 열어보세요.</p>
        <div className="mt-md space-y-sm">
          <PreferenceToggle label="8-K 공시" description="미국 기업의 주요 공시" checked={preferences.notify_8k} onChange={(checked) => void updatePreferences({ notify_8k: checked })} />
          <PreferenceToggle label="6-K 공시" description="해외 기업의 주요 공시" checked={preferences.notify_6k} onChange={(checked) => void updatePreferences({ notify_6k: checked })} />
          <PreferenceToggle label="내부자 거래" description="회사 내부자의 매수·매도 신고" checked={preferences.notify_form4} onChange={(checked) => { const nextMode = checked && preferences.insider_notification_mode === "none" ? "reported_p_s" : preferences.insider_notification_mode; void updatePreferences({ notify_form4: checked, ...(checked ? { insider_notification_mode: nextMode } : {}) }); }} />
          <PreferenceToggle label="시장 뉴스" description="검증을 마친 관심기업 뉴스" checked={preferences.notify_market_news} onChange={(checked) => void updatePreferences({ notify_market_news: checked })} />
          {preferences.notify_form4 ? <label className="block rounded-[8px] border border-hairline px-base py-sm"><span className="block text-sm font-extrabold text-ink">내부자 거래 범위</span><select value={preferences.insider_notification_mode === "none" ? "reported_p_s" : preferences.insider_notification_mode} onChange={(event) => { const insiderNotificationMode = event.target.value as Exclude<Preferences["insider_notification_mode"], "none">; void updatePreferences({ insider_notification_mode: insiderNotificationMode }); }} className="mt-sm min-h-11 w-full rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink"><option value="reported_p_s">공개시장 매수·매도만</option><option value="all">모든 신고</option></select></label> : null}
          {preferences.notify_form4 ? <label className="block rounded-[8px] border border-hairline px-base py-sm"><span className="block text-sm font-extrabold text-ink">내부자 거래 푸시 기준</span><span className="mt-0.5 block text-xs leading-5 text-muted">작은 거래는 알림함에만 남겨둘 수 있어요.</span><select value={String(preferences.form4_immediate_min_value_usd)} onChange={(event) => void updatePreferences({ form4_immediate_min_value_usd: Number(event.target.value) })} disabled={preferences.delivery_mode === "all_immediate"} className="mt-sm min-h-11 w-full rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-55"><option value="0">거래 금액과 관계없이 모두</option><option value="100000">US$100k 이상</option><option value="500000">US$500k 이상</option><option value="1000000">US$1m 이상 (기본)</option><option value="5000000">US$5m 이상</option></select>{preferences.delivery_mode === "all_immediate" ? <span className="mt-1 block text-xs leading-5 text-muted">‘새 소식은 모두 바로’를 선택해 이 기준을 적용하지 않아요.</span> : null}</label> : null}
          <PreferenceToggle label="정정 공시" description="수정된 공시도 받아보기" checked={preferences.include_amendments} onChange={(checked) => void updatePreferences({ include_amendments: checked })} />
        </div>
      </details>
    </section>
  );
}


function PreferenceToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-md rounded-[8px] border border-hairline px-base py-sm transition-colors hover:border-primary">
      <span><span className="block text-sm font-extrabold text-ink">{label}</span><span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />
    </label>
  );
}
