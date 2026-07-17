"use client";

import { useEffect, useState } from "react";
import {
  isIOSBrowser,
  isStandaloneDisplayMode,
  isWebPushSupported,
  serializePushSubscription,
  urlBase64ToUint8Array,
} from "@/lib/filing-notifications/client";
import { trackClientEventSilently } from "@/lib/analytics/client";
import FilingSubscriptionList from "@/components/filings/FilingSubscriptionList";
import FilingKeywordRules from "@/components/filings/FilingKeywordRules";
import FilingMonitoringStatus from "@/components/filings/FilingMonitoringStatus";
import FilingFeedControls from "@/components/filings/FilingFeedControls";

type Preferences = {
  enabled: boolean;
  notify_8k: boolean;
  notify_6k: boolean;
  notify_form4: boolean;
  insider_notification_mode: "none" | "reported_p_s" | "all";
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
  insider_notification_mode: "reported_p_s",
  include_amendments: false,
  delivery_mode: "important_immediate",
  daily_digest_at: "08:30",
  timezone: "Asia/Seoul",
};

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";

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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
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
        const [preferencesResponse, subscriptionsResponse, registration] = await Promise.all([
          fetch("/api/filing-notifications/preferences", { cache: "no-store" }),
          fetch("/api/filing-subscriptions", { cache: "no-store" }),
          webPushSupported
            ? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
            : Promise.resolve(null),
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
        if (registration) {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) await savePushSubscription(subscription);
          setSubscribed(Boolean(subscription));
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

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      trackClientEventSilently("pwa_install_prompt_seen", { surface: "filing_notification_settings" });
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      trackClientEventSilently("pwa_installed", { surface: "filing_notification_settings" });
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function subscribe() {
    if (!supported) return;
    if (trackedCompanyCount < 3) {
      setMessage(`알림 권한은 공시를 추적할 기업 3개를 등록한 뒤 요청합니다. 현재 ${trackedCompanyCount}/3개입니다.`);
      return;
    }
    if (iosNeedsInstall) {
      setMessage("iPhone/iPad에서는 Safari 공유 메뉴에서 ‘홈 화면에 추가’한 뒤 알림을 켤 수 있습니다.");
      return;
    }
    if (!VAPID_PUBLIC_KEY) {
      setMessage("알림 서버 키가 아직 설정되지 않았습니다.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      trackClientEventSilently("push_permission_prompted", { surface: "filing_notification_settings" });
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        trackClientEventSilently("push_permission_denied", { surface: "filing_notification_settings" });
        setMessage("브라우저 설정에서 알림을 허용하면 새 공시를 알려드릴 수 있습니다.");
        return;
      }
      trackClientEventSilently("push_permission_granted", { surface: "filing_notification_settings" });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await savePushSubscription(subscription);
      setSubscribed(true);
      trackClientEventSilently("push_subscribed", { surface: "filing_notification_settings" });
      setMessage("새 8-K·6-K·Form 4 공시 알림이 켜졌습니다.");
    } catch {
      setMessage("알림을 켜지 못했습니다. 브라우저 설정을 확인한 뒤 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function unsubscribe() {
    setSaving(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
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

  async function promptInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") trackClientEventSilently("pwa_installed", { surface: "filing_notification_settings", method: "browser_prompt" });
    setInstallPrompt(null);
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
          <h1 className="text-xl font-black tracking-[-0.03em] text-ink">공시 알림</h1>
          <p className="mt-xs text-sm leading-6 text-muted">관심 기업의 새 8-K·6-K·Form 4를 공시함과 이 기기 알림으로 받습니다.</p>
          <p className="mt-1 text-xs leading-5 text-muted">카탈로그 피드에는 현재 커버 기업의 공시가 별도로 보이며, 이 설정은 내 관심 기업 알림만 바꿉니다.</p>
          <p className="mt-1 text-xs leading-5 text-muted">첫 설정 순서 · 관심기업 3개 → 최근 공시 확인 → 홈 화면 설치 → 테스트 알림</p>
        </div>
        {subscribed ? (
          <button type="button" onClick={() => void unsubscribe()} disabled={saving} className="min-h-10 rounded-[8px] border border-hairline px-base text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:opacity-60">
            이 기기 푸시 끄기
          </button>
        ) : (
          <button type="button" onClick={() => void subscribe()} disabled={saving || !supported || permission === "denied"} className="min-h-10 rounded-[8px] bg-primary px-base text-sm font-extrabold text-on-primary transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-60">
            {trackedCompanyCount < 3 ? `기업 ${trackedCompanyCount}/3개 등록` : "새 공시 알림 켜기"}
          </button>
        )}
      </div>

      {!supported ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted">이 브라우저에서는 푸시 알림을 지원하지 않습니다.</p> : null}
      {iosNeedsInstall ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted">iPhone/iPad에서는 Safari 공유 메뉴에서 ‘홈 화면에 추가’한 뒤 이 화면에서 알림을 켤 수 있습니다.</p> : null}
      {!isStandaloneDisplayMode() && installPrompt ? <button type="button" onClick={() => void promptInstall()} className="mt-md inline-flex min-h-9 items-center rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary">홈 화면에 KRW.O 설치하기<span aria-hidden="true" className="material-symbols-outlined ml-1 text-[16px]">install_mobile</span></button> : null}
      {permission === "denied" ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted">브라우저에서 알림을 차단했습니다. 브라우저 사이트 설정에서 KRW.O 알림을 허용해주세요.</p> : null}
      {message ? <p className="mt-md rounded-[8px] bg-surface-soft p-sm text-sm leading-6 text-muted" role="status">{message}</p> : null}
      {trackedCompanyCount < 3 ? <p className="mt-md rounded-[8px] border border-hairline px-sm py-sm text-xs leading-5 text-muted">최근 공시 예시를 먼저 본 뒤 권한을 요청하기 위해, 추적 기업을 {3 - trackedCompanyCount}개 더 등록해주세요.</p> : null}
      <FilingMonitoringStatus />
      {subscribed ? <button type="button" onClick={() => void sendTestPush()} disabled={testing || saving} className="mt-md min-h-9 rounded-[7px] border border-hairline px-sm text-sm font-extrabold text-ink transition-colors hover:border-primary hover:text-primary disabled:opacity-60">{testing ? "테스트 전송 중…" : "테스트 알림 보내기"}</button> : null}

      <div className="mt-lg space-y-sm">
        <label className="block rounded-[8px] border border-hairline px-base py-sm"><span className="block text-sm font-extrabold text-ink">알림 전달 방식</span><span className="mt-0.5 block text-xs leading-5 text-muted">긴급·주요 공시는 바로, 나머지는 공시함 또는 하루 한 번 리캡으로 받습니다.</span><select value={preferences.delivery_mode} onChange={(event) => { const deliveryMode = event.target.value as Preferences["delivery_mode"]; void updatePreferences({ delivery_mode: deliveryMode }); trackClientEventSilently("filing_delivery_mode_changed", { delivery_mode: deliveryMode }); }} className="mt-sm min-h-9 w-full rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink"><option value="important_immediate">중요 공시만 즉시</option><option value="all_immediate">모든 공시 즉시</option><option value="daily_digest">하루 한 번 모아보기</option></select></label>
        {preferences.delivery_mode === "daily_digest" ? <label className="block rounded-[8px] border border-hairline px-base py-sm"><span className="block text-sm font-extrabold text-ink">리캡 시각</span><span className="mt-0.5 block text-xs leading-5 text-muted">새 공시나 읽지 않은 공시가 있을 때만 한국 시간 기준으로 보냅니다.</span><input type="time" value={preferences.daily_digest_at.slice(0, 5)} onChange={(event) => void updatePreferences({ daily_digest_at: event.target.value })} className="mt-sm min-h-9 rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink" /></label> : null}
        <PreferenceToggle label="새 공시 알림 생성" description="구독한 기업의 새 공시를 공시함과 푸시 대상으로 만듭니다." checked={preferences.enabled} onChange={(checked) => void updatePreferences({ enabled: checked })} />
        <PreferenceToggle label="8-K 알림" description="미국 기업의 주요 수시 공시" checked={preferences.notify_8k} onChange={(checked) => void updatePreferences({ notify_8k: checked })} />
        <PreferenceToggle label="6-K 알림" description="해외 발행인의 수시 공시" checked={preferences.notify_6k} onChange={(checked) => void updatePreferences({ notify_6k: checked })} />
        <PreferenceToggle label="Form 4 알림" description="내부자 거래 신고입니다. 기본값은 보고된 공개시장 매수·매도(P/S)만 알립니다." checked={preferences.notify_form4} onChange={(checked) => { const nextMode = checked && preferences.insider_notification_mode === "none" ? "reported_p_s" : preferences.insider_notification_mode; void updatePreferences({ notify_form4: checked, ...(checked ? { insider_notification_mode: nextMode } : {}) }); }} />
        {preferences.notify_form4 ? <label className="block rounded-[8px] border border-hairline px-base py-sm"><span className="block text-sm font-extrabold text-ink">Form 4 알림 범위</span><span className="mt-0.5 block text-xs leading-5 text-muted">금액은 SEC에 P/S로 보고된 공개시장 거래만 표시하며, 추정하지 않습니다.</span><select value={preferences.insider_notification_mode === "none" ? "reported_p_s" : preferences.insider_notification_mode} onChange={(event) => { const insiderNotificationMode = event.target.value as Exclude<Preferences["insider_notification_mode"], "none">; void updatePreferences({ insider_notification_mode: insiderNotificationMode }); }} className="mt-sm min-h-9 w-full rounded-[7px] border border-hairline bg-canvas px-sm text-sm font-bold text-ink"><option value="reported_p_s">보고된 공개시장 매수·매도만</option><option value="all">모든 Form 4</option></select></label> : null}
        <PreferenceToggle label="정정 공시도 받기" description="8-K/A·6-K/A를 포함합니다." checked={preferences.include_amendments} onChange={(checked) => void updatePreferences({ include_amendments: checked })} />
      </div>
      <FilingSubscriptionList />
      <FilingKeywordRules />
      <FilingFeedControls />
    </section>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

async function savePushSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializePushSubscription(subscription)),
  });
  if (!response.ok) throw new Error("subscription_save_failed");
}

function PreferenceToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-md rounded-[8px] border border-hairline px-base py-sm transition-colors hover:border-primary">
      <span><span className="block text-sm font-extrabold text-ink">{label}</span><span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />
    </label>
  );
}
