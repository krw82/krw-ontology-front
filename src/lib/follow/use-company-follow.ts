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
import { normalizeTicker } from "@/lib/ontology/ticker";

export type PushPlan = "already" | "prompt" | "install" | "denied" | "skipped";

/**
 * 관심 ON 직후의 푸시 권한 사다리. 기기에 이미 구독이 있으면 아무것도
 * 하지 않고, iOS 비설치는 홈 화면 추가로, 거부 이력은 조용히 넘긴다.
 * 프롬프트는 브라우저당 실질 1회다.
 */
export function planPushEnable(input: {
  pushReady: boolean;
  webPushSupported: boolean;
  vapidKey: string;
  permission: NotificationPermission | "unsupported";
  iOS: boolean;
  standalone: boolean;
}): PushPlan {
  if (input.pushReady) return "already";
  if (input.iOS && !input.standalone) return "install";
  if (input.permission === "denied") return "denied";
  if (!input.webPushSupported || !input.vapidKey || input.permission === "unsupported") {
    return "skipped";
  }
  return "prompt";
}

async function ensureDevicePush(surface: string): Promise<PushPlan> {
  const subscription = await getCurrentDevicePushSubscription().catch(() => null);
  const permission: NotificationPermission | "unsupported" =
    typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const plan = planPushEnable({
    pushReady: Boolean(subscription),
    webPushSupported: isWebPushSupported(),
    vapidKey,
    permission,
    iOS: isIOSBrowser(),
    standalone: isStandaloneDisplayMode(),
  });
  if (plan === "install") {
    signalPwaInstallEngagement("install_requested", surface);
    return plan;
  }
  if (plan !== "prompt") return plan;
  trackClientEventSilently("push_permission_prompted", { surface });
  const outcome = await subscribeCurrentDevice(vapidKey).catch(() => null);
  trackClientEventSilently(
    outcome === "granted" ? "push_subscribed" : "push_permission_denied",
    { surface },
  );
  if (outcome === "granted") return "already";
  if (outcome === "denied") return "denied";
  return "skipped";
}

export type CompanyFollowState = {
  loading: boolean;
  following: boolean;
  alerts: "on" | "no_sec_id" | null;
  limitReached: boolean;
  error: boolean;
  follow: () => Promise<{ ok: boolean; pushPlan: PushPlan | null }>;
  unfollow: () => Promise<{ ok: boolean }>;
  reload: () => Promise<void>;
};

/** 관심 = 알림. 토글 하나가 관심종목 + 공시 구독 + 뉴스 팔로우를 함께 처리한다. */
export function useCompanyFollow(
  ticker: string,
  options?: { surface?: string },
): CompanyFollowState {
  const normalizedTicker = normalizeTicker(ticker);
  const surface = options?.surface ?? "company_follow";
  const [loading, setLoading] = useState(Boolean(normalizedTicker));
  const [following, setFollowing] = useState(false);
  const [alerts, setAlerts] = useState<"on" | "no_sec_id" | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!normalizedTicker) return;
    try {
      const response = await fetch(
        `/api/watchlist/${encodeURIComponent(normalizedTicker)}/coverage-level`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        mark?: { coverage_level?: string | null } | null;
      };
      setFollowing(Boolean(payload.mark?.coverage_level));
    } catch {
      // 조회 실패는 조용히 둔다. 각 표면이 안내를 담당한다.
    } finally {
      setLoading(false);
    }
  }, [normalizedTicker]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const follow = useCallback(async () => {
    if (!normalizedTicker) return { ok: false, pushPlan: null };
    setError(false);
    setLimitReached(false);
    try {
      const response = await fetch(
        `/api/companies/${encodeURIComponent(normalizedTicker)}/follow`,
        { method: "PUT" },
      );
      if (response.status === 409) {
        setLimitReached(true);
        return { ok: false, pushPlan: null };
      }
      if (!response.ok) throw new Error("follow_failed");
      const payload = (await response.json()) as {
        alerts?: "on" | "no_sec_id";
      };
      setFollowing(true);
      setAlerts(payload.alerts ?? null);
      trackClientEventSilently("company_followed", {
        surface,
        ticker: normalizedTicker,
      });
      if (payload.alerts !== "no_sec_id") {
        trackClientEventSilently("filing_subscription_created", {
          surface,
          ticker: normalizedTicker,
        });
      }
      const pushPlan = await ensureDevicePush(surface);
      return { ok: true, pushPlan };
    } catch {
      setError(true);
      return { ok: false, pushPlan: null };
    }
  }, [normalizedTicker, surface]);

  const unfollow = useCallback(async () => {
    if (!normalizedTicker) return { ok: false };
    setError(false);
    try {
      const response = await fetch(
        `/api/companies/${encodeURIComponent(normalizedTicker)}/follow`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("unfollow_failed");
      setFollowing(false);
      setAlerts(null);
      trackClientEventSilently("company_unfollowed", {
        surface,
        ticker: normalizedTicker,
      });
      trackClientEventSilently("filing_subscription_removed", {
        surface,
        ticker: normalizedTicker,
      });
      return { ok: true };
    } catch {
      setError(true);
      return { ok: false };
    }
  }, [normalizedTicker, surface]);

  return {
    loading,
    following,
    alerts,
    limitReached,
    error,
    follow,
    unfollow,
    reload,
  };
}
