"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  isIOSBrowser,
  isStandaloneDisplayMode,
  isWebPushSupported,
} from "@/lib/filing-notifications/client";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  getReadyServiceWorkerRegistration,
  savePushSubscription,
  subscribeCurrentDevice,
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

type DeviceState = "on" | "off" | "ios_install" | "blocked" | "unsupported";

type Feedback = { tone: "success" | "info" | "error"; text: string } | null;

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

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";

const DEVICE_STATE_LABEL: Record<DeviceState, string> = {
  on: "켜짐",
  off: "꺼짐",
  ios_install: "설치 필요",
  blocked: "차단됨",
  unsupported: "받을 수 없음",
};

export default function NotificationSettingsCard() {
  const [supported, setSupported] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const webPushSupported = isWebPushSupported();
      if (!active) return;
      setSupported(webPushSupported);
      setIosNeedsInstall(isIOSBrowser() && !isStandaloneDisplayMode());
      setPermission(webPushSupported ? Notification.permission : "unsupported");
      try {
        const preferencesResponse = await fetch(
          "/api/filing-notifications/preferences",
          { cache: "no-store" },
        );
        if (!active) return;
        if (preferencesResponse.ok) {
          const payload = (await preferencesResponse.json()) as {
            preferences?: Preferences;
          };
          if (payload.preferences)
            setPreferences({
              ...DEFAULT_PREFERENCES,
              ...payload.preferences,
            });
        }
        if (webPushSupported) {
          void getReadyServiceWorkerRegistration()
            .then(async (registration) => {
              if (!active || !registration) return;
              const subscription =
                await registration.pushManager.getSubscription();
              if (subscription) await savePushSubscription(subscription);
              if (active) setSubscribed(Boolean(subscription));
            })
            .catch(() => {
              // Preferences remain usable even when push registration is down.
            });
        }
      } catch {
        if (active)
          setFeedback({
            tone: "error",
            text: "알림 설정을 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
          });
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const deviceState: DeviceState = !supported
    ? "unsupported"
    : iosNeedsInstall
      ? "ios_install"
      : permission === "denied"
        ? "blocked"
        : subscribed
          ? "on"
          : "off";

  async function subscribeOnThisDevice() {
    setSaving(true);
    setFeedback(null);
    try {
      const nextPermission = await subscribeCurrentDevice(VAPID_PUBLIC_KEY);
      setPermission(nextPermission);
      if (nextPermission === "granted") {
        setSubscribed(true);
        setFeedback({
          tone: "success",
          text: "이 기기에서 알림을 켰어요.",
        });
      } else {
        setFeedback({
          tone: "info",
          text: "알림 권한을 허용하지 않았어요. 브라우저에서 알림을 허용한 뒤 다시 시도해주세요.",
        });
      }
    } catch {
      setFeedback({
        tone: "error",
        text: "알림을 켜지 못했어요. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function unsubscribe() {
    setSaving(true);
    setFeedback(null);
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
      setFeedback({ tone: "info", text: "이 기기에서 알림을 껐어요." });
    } catch {
      setFeedback({
        tone: "error",
        text: "알림을 끄지 못했어요. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function sendTestPush() {
    setTesting(true);
    setFeedback(null);
    try {
      trackClientEventSilently("test_push_requested", {
        surface: "filing_notification_settings",
      });
      const response = await fetch("/api/push/test", { method: "POST" });
      if (!response.ok) throw new Error("push_test_failed");
      setFeedback({
        tone: "success",
        text: "테스트 알림을 보냈어요. 잠시 후 기기 알림을 확인하세요.",
      });
    } catch {
      setFeedback({
        tone: "error",
        text: "테스트 알림을 보내지 못했어요. 잠시 후 다시 시도해주세요.",
      });
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
      if (payload.preferences)
        setPreferences({ ...DEFAULT_PREFERENCES, ...payload.preferences });
    } catch {
      setPreferences(preferences);
      setFeedback({
        tone: "error",
        text: "저장하지 못했어요. 다시 시도해주세요.",
      });
    }
  }

  if (loading) {
    return (
      <section className="rounded-[10px] border border-hairline bg-canvas p-lg shadow-sm">
        <div className="flex items-center gap-sm">
          <span
            aria-hidden="true"
            className="size-2 motion-safe:animate-pulse rounded-full bg-primary"
          />
          <p className="text-sm font-bold text-body">
            알림 설정을 불러오는 중…
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[10px] border border-hairline bg-canvas p-lg shadow-sm">
      <DeviceStatusStrip
        state={deviceState}
        saving={saving}
        testing={testing}
        onSubscribe={() => void subscribeOnThisDevice()}
        onUnsubscribe={() => void unsubscribe()}
        onTestPush={() => void sendTestPush()}
      />

      {feedback ? (
        <p
          role="status"
          className={`mt-sm rounded-[8px] border px-sm py-sm text-[13px] font-bold leading-6 ${
            feedback.tone === "success"
              ? "border-primary-container bg-primary-fixed text-on-primary-fixed"
              : feedback.tone === "error"
                ? "border-error bg-error-container text-on-error-container"
                : "border-hairline bg-surface-soft text-body"
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      <details className="group mt-lg border-t border-hairline pt-lg">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-sm marker:hidden [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-[14px] font-extrabold text-ink">
              세부 설정
            </span>
            <span className="mt-[2px] block text-[12px] font-medium leading-5 text-muted">
              공시 종류와 내부자 거래 기준을 직접 바꿔요.
            </span>
          </span>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[20px] text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
          >
            expand_more
          </span>
        </summary>
        <div className="mt-xs divide-y divide-hairline">
          <SwitchRow
            label="8-K 공시"
            description="미국 기업의 주요 공시"
            checked={preferences.notify_8k}
            onChange={(checked) =>
              void updatePreferences({ notify_8k: checked })
            }
          />
          <SwitchRow
            label="6-K 공시"
            description="해외 기업의 주요 공시"
            checked={preferences.notify_6k}
            onChange={(checked) =>
              void updatePreferences({ notify_6k: checked })
            }
          />
          <SwitchRow
            label="내부자 거래"
            description="회사 내부자의 매수·매도 신고"
            checked={preferences.notify_form4}
            onChange={(checked) => {
              const nextMode =
                checked && preferences.insider_notification_mode === "none"
                  ? "reported_p_s"
                  : preferences.insider_notification_mode;
              void updatePreferences({
                notify_form4: checked,
                ...(checked ? { insider_notification_mode: nextMode } : {}),
              });
            }}
          />
          {preferences.notify_form4 ? (
            <SelectRow label="내부자 거래 범위">
              <select
                value={
                  preferences.insider_notification_mode === "none"
                    ? "reported_p_s"
                    : preferences.insider_notification_mode
                }
                onChange={(event) => {
                  const insiderNotificationMode = event.target.value as Exclude<
                    Preferences["insider_notification_mode"],
                    "none"
                  >;
                  void updatePreferences({
                    insider_notification_mode: insiderNotificationMode,
                  });
                }}
                className={selectClassName}
              >
                <option value="reported_p_s">공개시장 매수·매도만</option>
                <option value="all">모든 신고</option>
              </select>
            </SelectRow>
          ) : null}
          {preferences.notify_form4 ? (
            <SelectRow
              label="내부자 거래 푸시 기준"
              hint="작은 거래는 알림함에만 남겨둘 수 있어요."
            >
              <select
                value={String(preferences.form4_immediate_min_value_usd)}
                onChange={(event) =>
                  void updatePreferences({
                    form4_immediate_min_value_usd: Number(event.target.value),
                  })
                }
                disabled={preferences.delivery_mode === "all_immediate"}
                className={`${selectClassName} disabled:cursor-not-allowed disabled:opacity-55`}
              >
                <option value="0">거래 금액과 관계없이 모두</option>
                <option value="100000">US$100k 이상</option>
                <option value="500000">US$500k 이상</option>
                <option value="1000000">US$1m 이상 (기본)</option>
                <option value="5000000">US$5m 이상</option>
              </select>
              {preferences.delivery_mode === "all_immediate" ? (
                <span className="mt-xs block text-[12px] leading-5 text-muted">
                  받는 시점이 ‘모두 바로’로 되어 있어 이 기준을 적용하지 않아요.
                </span>
              ) : null}
            </SelectRow>
          ) : null}
          <SwitchRow
            label="시장 뉴스"
            description="검증을 마친 관심 기업 뉴스"
            checked={preferences.notify_market_news}
            onChange={(checked) =>
              void updatePreferences({ notify_market_news: checked })
            }
          />
          <SwitchRow
            label="정정 공시"
            description="수정된 공시도 받아보기"
            checked={preferences.include_amendments}
            onChange={(checked) =>
              void updatePreferences({ include_amendments: checked })
            }
          />
        </div>
      </details>
    </section>
  );
}

const selectClassName =
  "mt-sm min-h-11 w-full rounded-[8px] border border-hairline bg-canvas px-sm text-[13px] font-bold text-ink";

function DeviceStatusStrip({
  state,
  saving,
  testing,
  onSubscribe,
  onUnsubscribe,
  onTestPush,
}: {
  state: DeviceState;
  saving: boolean;
  testing: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  onTestPush: () => void;
}) {
  const sentence =
    state === "on"
      ? "이 기기에서 알림을 받고 있어요."
      : state === "off"
        ? "이 기기에서는 아직 알림을 받지 않아요."
        : state === "ios_install"
          ? "iPhone에서는 KRW.O를 홈 화면에 추가한 뒤 알림을 받을 수 있어요. 공유 버튼 → ‘홈 화면에 추가’로 설치해주세요."
          : state === "blocked"
            ? "브라우저에서 KRW.O 알림이 차단돼 있어요. 브라우저 설정에서 알림을 허용해주세요."
            : "이 브라우저에서는 알림을 받을 수 없어요.";

  return (
    <div
      className={`rounded-[10px] border p-base ${
        state === "blocked"
          ? "border-error/35 bg-error-container/35"
          : "border-hairline bg-surface-soft"
      }`}
    >
      <div className="flex items-center justify-between gap-sm">
        <div className="flex items-center gap-sm">
          <span aria-hidden="true" className="relative flex size-2">
            {state === "on" ? (
              <span className="absolute inset-0 motion-safe:animate-pulse rounded-full bg-primary/40" />
            ) : null}
            <span
              className={`relative size-2 rounded-full ${
                state === "on"
                  ? "bg-primary"
                  : state === "blocked"
                    ? "bg-error"
                    : state === "off"
                      ? "bg-muted"
                      : "bg-muted-soft"
              }`}
            />
          </span>
          <p className="text-[13px] font-extrabold text-ink">이 기기 알림</p>
        </div>
        <span className="inline-flex items-center rounded-pill bg-canvas px-sm py-[3px] font-mono text-[11px] font-bold tracking-[0.08em] text-body">
          {DEVICE_STATE_LABEL[state]}
        </span>
      </div>
      <p className="mt-xs text-[13px] font-medium leading-6 text-body">
        {sentence}
      </p>
      {state === "off" ? (
        <div className="mt-sm">
          <button
            type="button"
            onClick={onSubscribe}
            disabled={saving}
            className="min-h-11 rounded-[8px] bg-primary px-base text-[13px] font-extrabold text-on-primary transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60"
          >
            {saving ? "켜는 중…" : "이 기기에서 받기"}
          </button>
        </div>
      ) : null}
      {state === "on" ? (
        <div className="mt-sm flex flex-wrap gap-xs">
          <button
            type="button"
            onClick={onTestPush}
            disabled={testing || saving}
            className="min-h-11 rounded-[8px] bg-primary px-base text-[13px] font-extrabold text-on-primary transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60"
          >
            {testing ? "테스트 전송 중…" : "테스트 알림 보내기"}
          </button>
          <button
            type="button"
            onClick={onUnsubscribe}
            disabled={saving}
            className="min-h-11 rounded-[8px] border border-hairline bg-canvas px-base text-[13px] font-bold text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-60"
          >
            이 기기 끄기
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-sm rounded-[8px] py-sm transition-colors hover:bg-surface-soft">
      <span className="min-w-0">
        <span className="block text-[14px] font-extrabold text-ink">
          {label}
        </span>
        <span className="mt-[2px] block text-[12px] font-medium leading-5 text-muted">
          {description}
        </span>
      </span>
      <span className="relative inline-flex h-[26px] w-[44px] shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-pill border border-hairline bg-surface-strong transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[3px] top-[3px] size-5 rounded-full bg-canvas shadow-sm transition-transform motion-reduce:transition-none peer-checked:translate-x-[18px]"
        />
      </span>
    </label>
  );
}

function SelectRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="py-sm">
      <span className="block text-[13px] font-extrabold text-ink">{label}</span>
      {hint ? (
        <span className="mt-[2px] block text-[12px] font-medium leading-5 text-muted">
          {hint}
        </span>
      ) : null}
      {children}
    </div>
  );
}
