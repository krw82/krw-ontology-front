"use client";

import { useCallback, useEffect, useState } from "react";
import { signalPwaInstallEngagement } from "@/components/pwa/lifecycle";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  isIOSBrowser,
  isStandaloneDisplayMode,
  isWebPushSupported,
} from "@/lib/filing-notifications/client";
import {
  getCurrentDevicePushSubscription,
  subscribeCurrentDevice,
} from "@/lib/filing-notifications/push-subscription-client";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
const SESSION_DISMISS_KEY = "krwo:pulse-push-priming:dismissed";
const EXPOSURE_COUNT_KEY = "krwo:pulse-push-priming:count";
const MAX_EXPOSURES = 3;

type BannerState = "checking" | "visible" | "hidden" | "granted";

function readExposureCount(): number {
  try {
    return Number(window.localStorage.getItem(EXPOSURE_COUNT_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

/**
 * One-line push priming banner for the Pulse feed. Shown only to signed-in
 * users who already follow at least one company (filing subscription) but
 * have not enabled notifications yet. iOS without an installed PWA gets the
 * install guidance instead of the OS permission prompt.
 */
export default function PulsePushPrimingBanner() {
  const [state, setState] = useState<BannerState>("checking");
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;

    async function evaluate() {
      if (!isWebPushSupported() || !VAPID_PUBLIC_KEY) return "hidden" as const;
      if (typeof Notification !== "undefined" && Notification.permission !== "default") {
        return "hidden" as const;
      }
      try {
        if (window.sessionStorage.getItem(SESSION_DISMISS_KEY) === "1") return "hidden" as const;
      } catch {
        // sessionStorage unavailable — keep showing.
      }
      if (readExposureCount() >= MAX_EXPOSURES) return "hidden" as const;

      const [subscriptionResponse, existingSubscription] = await Promise.all([
        fetch("/api/filing-subscriptions", { cache: "no-store" }).catch(() => null),
        getCurrentDevicePushSubscription(),
      ]);
      if (stale) return "hidden" as const;
      if (!subscriptionResponse?.ok) return "hidden" as const;
      const payload = (await subscriptionResponse.json().catch(() => null)) as {
        subscriptions?: { enabled?: boolean }[] | null;
      } | null;
      const enabledCount = (payload?.subscriptions ?? []).filter((item) => item.enabled).length;
      if (enabledCount === 0 || existingSubscription) return "hidden" as const;

      setIosNeedsInstall(isIOSBrowser() && !isStandaloneDisplayMode());
      try {
        window.localStorage.setItem(
          EXPOSURE_COUNT_KEY,
          String(readExposureCount() + 1),
        );
      } catch {
        // Counting is best effort.
      }
      trackClientEventSilently("pulse_push_priming_viewed", {
        surface: "pulse",
        following_count: enabledCount,
      });
      return "visible" as const;
    }

    void evaluate()
      .then((next) => {
        if (!stale) setState(next);
      })
      .catch(() => {
        if (!stale) setState("hidden");
      });
    return () => {
      stale = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      // Best effort.
    }
    setState("hidden");
  }, []);

  const handleEnable = useCallback(async () => {
    if (working) return;
    setWorking(true);
    setMessage(null);

    try {
      if (iosNeedsInstall) {
        signalPwaInstallEngagement("install_requested", "pulse_priming");
        setMessage("공유 버튼 → '홈 화면에 추가' 후 알림을 켤 수 있어요.");
        return;
      }
      trackClientEventSilently("cta_clicked", {
        cta_id: "pulse_push_priming",
        surface: "pulse",
      });
      trackClientEventSilently("push_permission_prompted", {
        surface: "pulse_priming",
      });
      const permission = await subscribeCurrentDevice(VAPID_PUBLIC_KEY);
      if (permission === "granted") {
        trackClientEventSilently("push_subscribed", {
          surface: "pulse_priming",
        });
        setState("granted");
      } else if (permission === "denied") {
        trackClientEventSilently("push_permission_denied", {
          surface: "pulse_priming",
        });
        setMessage("브라우저 설정에서 알림을 허용할 수 있어요.");
      } else {
        dismiss();
      }
    } catch {
      setMessage("알림을 켜지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setWorking(false);
    }
  }, [dismiss, iosNeedsInstall, working]);

  if (state === "checking" || state === "hidden") return null;

  if (state === "granted") {
    return (
      <section
        aria-live="polite"
        className="mb-base flex items-center gap-sm rounded-[12px] border border-primary/25 bg-primary-fixed/45 px-base py-sm"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">
          check_circle
        </span>
        <p className="min-w-0 text-[13px] font-black leading-5 text-ink">
          알림이 켜졌어요. 관심 기업의 새 소식을 이 기기로 보내드릴게요.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="알림 받기 안내"
      className="mb-base flex flex-wrap items-center gap-x-sm gap-y-xs rounded-[12px] border border-primary/25 bg-primary-fixed/45 px-base py-sm"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">
        notifications_active
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-black leading-5 text-ink">
          관심 기업의 새 소식을 폰으로 받아보세요
        </p>
        <p className="text-[12px] font-semibold leading-5 text-muted">
          {message ?? "중요한 공시와 이슈만 보냅니다. 언제든 끌 수 있어요."}
        </p>
      </div>
      <div className="flex items-center gap-xs">
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-[8px] border border-primary bg-primary-fixed px-3 text-[12px] font-extrabold text-on-primary-fixed transition-colors hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
          disabled={working}
          onClick={() => void handleEnable()}
        >
          <span
            aria-hidden="true"
            className={[
              "material-symbols-outlined text-[16px]",
              working ? "animate-spin" : "",
            ].join(" ")}
          >
            {working ? "progress_activity" : "notifications_active"}
          </span>
          {iosNeedsInstall ? "홈 화면에 추가" : "알림 켜기"}
        </button>
        {message ? null : (
          <button
            type="button"
            className="min-h-10 px-xs text-[12px] font-bold text-muted hover:text-ink"
            onClick={dismiss}
          >
            나중에
          </button>
        )}
      </div>
    </section>
  );
}
