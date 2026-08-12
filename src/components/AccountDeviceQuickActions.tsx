"use client";

import { useEffect, useState } from "react";
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
import type { Locale } from "@/i18n/config";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
const PWA_INSTALLED_AT_KEY = "krwo:pwa-install:installed-at:v1";

export default function AccountDeviceQuickActions({
  locale,
  open,
  onComplete,
}: {
  locale: Locale;
  open: boolean;
  onComplete: () => void;
}) {
  const [showNotificationAction, setShowNotificationAction] = useState(false);
  const [showInstallAction, setShowInstallAction] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isKorean = locale === "ko";

  useEffect(() => {
    if (!open) return;

    let active = true;
    async function loadActions() {
      const standalone = isStandaloneDisplayMode();
      const installed = readInstalledMarker();
      const supported = isWebPushSupported();
      const iosNeedsInstall = isIOSBrowser() && !standalone;
      const deviceSubscription = await getCurrentDevicePushSubscription();
      if (!active) return;

      const permission = supported ? Notification.permission : "denied";

      setShowNotificationAction(
        supported &&
          !iosNeedsInstall &&
          Boolean(VAPID_PUBLIC_KEY) &&
          permission !== "denied" &&
          !deviceSubscription,
      );
      setShowInstallAction(!standalone && !installed);
    }

    void loadActions().catch(() => {
      if (active) {
        setShowNotificationAction(false);
        setShowInstallAction(false);
      }
    });

    return () => {
      active = false;
    };
  }, [open]);

  async function enableNotifications() {
    if (working || !VAPID_PUBLIC_KEY) return;

    setWorking(true);
    setMessage(null);
    try {
      trackClientEventSilently("push_permission_prompted", {
        surface: "account_menu",
      });
      const permission = await subscribeCurrentDevice(VAPID_PUBLIC_KEY);
      if (permission !== "granted") {
        trackClientEventSilently("push_permission_denied", {
          surface: "account_menu",
        });
        setMessage(
          isKorean
            ? "브라우저 설정에서 알림을 허용하면 새 업데이트를 알려드릴 수 있습니다."
            : "Allow notifications in the browser to receive new updates.",
        );
        return;
      }
      trackClientEventSilently("push_subscribed", { surface: "account_menu" });
      setShowNotificationAction(false);
      onComplete();
    } catch {
      setMessage(
        isKorean
          ? "알림을 켜지 못했습니다. 브라우저 설정을 확인한 뒤 다시 시도해주세요."
          : "Could not enable notifications. Check the browser settings and try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  function requestInstall() {
    signalPwaInstallEngagement("install_requested", "account_menu");
    onComplete();
  }

  if (!showNotificationAction && !showInstallAction && !message) return null;

  return (
    <div className="mt-xs border-b border-hairline pb-xs">
      {showNotificationAction ? (
        <button
          type="button"
          disabled={working}
          onClick={() => void enableNotifications()}
          className="flex w-full items-center justify-between rounded-[8px] px-sm py-sm text-left text-[14px] font-semibold leading-[1.3] text-body transition-colors hover:bg-surface-soft hover:text-primary disabled:cursor-wait disabled:opacity-55"
          role="menuitem"
        >
          <span>{isKorean ? "이 기기 알림 켜기" : "Enable notifications"}</span>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[18px]"
          >
            notifications_active
          </span>
        </button>
      ) : null}
      {showInstallAction ? (
        <button
          type="button"
          onClick={requestInstall}
          className="flex w-full items-center justify-between rounded-[8px] px-sm py-sm text-left text-[14px] font-semibold leading-[1.3] text-body transition-colors hover:bg-surface-soft hover:text-primary"
          role="menuitem"
        >
          <span>{isKorean ? "앱 설치" : "Install app"}</span>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[18px]"
          >
            install_mobile
          </span>
        </button>
      ) : null}
      {message ? (
        <p className="px-sm py-xs text-[12px] font-medium leading-5 text-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function readInstalledMarker(): boolean {
  try {
    return Boolean(window.localStorage.getItem(PWA_INSTALLED_AT_KEY));
  } catch {
    return false;
  }
}
