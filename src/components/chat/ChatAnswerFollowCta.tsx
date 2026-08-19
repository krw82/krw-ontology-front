"use client";

import Link from "next/link";
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

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
const ANSWER_FOLLOW_CTA_ENABLED =
  process.env.NEXT_PUBLIC_ANSWER_FOLLOW_CTA !== "off";

type CtaState = "checking" | "idle" | "working" | "done" | "failed";
type PushOutcome = "granted" | "denied" | "install" | "skipped" | null;

const DONE_MESSAGE: Record<Exclude<PushOutcome, null>, string> = {
  granted: "팔로우 완료 · 알림 켜짐",
  denied: "팔로우 완료 · 브라우저 설정에서 알림을 허용할 수 있어요",
  install: "팔로우 완료 · 홈 화면에 추가하면 폰으로 알림이 와요",
  skipped: "팔로우 완료",
};

/**
 * Post-answer one-tap retention CTA: follow the company (watchlist mark +
 * filing/news subscriptions) and enable device push in a single action.
 * Rendered only under the latest completed assistant message.
 */
export default function ChatAnswerFollowCta({ ticker }: { ticker: string }) {
  const normalizedTicker = normalizeTicker(ticker);
  const [state, setState] = useState<CtaState>("checking");
  const [followed, setFollowed] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [digestLimited, setDigestLimited] = useState(false);
  const [pushOutcome, setPushOutcome] = useState<PushOutcome>(null);

  useEffect(() => {
    if (!normalizedTicker) return;
    let stale = false;
    const tickerForRequest = normalizedTicker;

    async function loadState() {
      const [coverageResponse, subscription] = await Promise.all([
        fetch(`/api/watchlist/${encodeURIComponent(tickerForRequest)}/coverage-level`, {
          cache: "no-store",
        }).catch(() => null),
        getCurrentDevicePushSubscription(),
      ]);
      if (stale) return;

      if (!coverageResponse || !coverageResponse.ok) {
        // Anonymous or unauthorized visitors never see the CTA.
        setHidden(true);
        setState("idle");
        return;
      }
      const payload = (await coverageResponse.json().catch(() => null)) as {
        mark?: { coverage_level?: string | null } | null;
      } | null;
      const isFollowed = Boolean(payload?.mark?.coverage_level);
      setFollowed(isFollowed);
      setPushReady(Boolean(subscription));
      setHidden(isFollowed && Boolean(subscription));
      setState("idle");
    }

    void loadState();
    return () => {
      stale = true;
    };
  }, [normalizedTicker]);

  const handleFollow = useCallback(async () => {
    if (!normalizedTicker || state === "working" || state === "done") return;

    setState("working");
    trackClientEventSilently("cta_clicked", {
      cta_id: "answer_follow_cta",
      surface: "chat_answer",
      ticker: normalizedTicker,
    });

    try {
      if (!followed) {
        const response = await fetch(
          `/api/watchlist/${encodeURIComponent(normalizedTicker)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ coverage_level: "interest" }),
          },
        );
        if (!response.ok) throw new Error("watchlist_follow_failed");
        trackClientEventSilently("company_followed", {
          surface: "chat_answer",
          ticker: normalizedTicker,
        });
        setFollowed(true);
      }

      // Filing/news alert subscription. Some tickers have no SEC identifier
      // (422) — that only narrows the alerts, the follow itself still counts.
      const subscriptionResponse = await fetch(
        `/api/filing-subscriptions/${encodeURIComponent(normalizedTicker)}`,
        { method: "PUT" },
      ).catch(() => null);
      if (subscriptionResponse?.ok) {
        trackClientEventSilently("filing_subscription_created", {
          surface: "chat_answer",
          ticker: normalizedTicker,
        });
      } else if (subscriptionResponse?.status === 422) {
        setDigestLimited(true);
      }

      // Pulse news feed personalization (best effort).
      await fetch(
        `/api/news/companies/${encodeURIComponent(normalizedTicker)}/follow`,
        { method: "PUT" },
      ).catch(() => null);

      if (pushReady) {
        setPushOutcome("granted");
        setState("done");
        return;
      }

      const iosNeedsInstall = isIOSBrowser() && !isStandaloneDisplayMode();
      if (iosNeedsInstall) {
        signalPwaInstallEngagement("install_requested", "chat_answer_cta");
        setPushOutcome("install");
        setState("done");
        return;
      }
      if (
        !isWebPushSupported() ||
        !VAPID_PUBLIC_KEY ||
        (typeof Notification !== "undefined" &&
          Notification.permission === "denied")
      ) {
        setPushOutcome(
          typeof Notification !== "undefined" &&
            Notification.permission === "denied"
            ? "denied"
            : "skipped",
        );
        setState("done");
        return;
      }

      trackClientEventSilently("push_permission_prompted", {
        surface: "chat_answer",
      });
      const permission = await subscribeCurrentDevice(VAPID_PUBLIC_KEY).catch(
        () => null,
      );
      if (permission === "granted") {
        trackClientEventSilently("push_subscribed", {
          surface: "chat_answer",
        });
        setPushOutcome("granted");
      } else if (permission === "denied") {
        trackClientEventSilently("push_permission_denied", {
          surface: "chat_answer",
        });
        setPushOutcome("denied");
      } else {
        setPushOutcome("skipped");
      }
      setState("done");
    } catch {
      setState("failed");
    }
  }, [followed, normalizedTicker, pushReady, state]);

  if (
    !ANSWER_FOLLOW_CTA_ENABLED ||
    !normalizedTicker ||
    state === "checking" ||
    hidden
  ) {
    return null;
  }

  if (state === "done") {
    return (
      <div
        data-answer-follow-cta="done"
        className="mx-auto mt-xs flex w-full max-w-4xl flex-wrap items-center gap-x-sm gap-y-xs rounded-[10px] border border-hairline bg-surface-soft px-sm py-sm"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px] text-primary"
        >
          check_circle
        </span>
        <p className="min-w-0 flex-1 text-[13px] font-extrabold leading-[1.4] text-ink">
          {DONE_MESSAGE[pushOutcome ?? "skipped"]}
          {digestLimited ? (
            <span className="ml-xs text-[12px] font-medium text-muted">
              · 이 종목은 공시 알림 대상이 아닐 수 있어요
            </span>
          ) : null}
        </p>
        <Link
          href="/settings/notifications"
          className="text-[12px] font-bold text-primary underline-offset-2 hover:underline"
        >
          알림 설정
        </Link>
      </div>
    );
  }

  const isWorking = state === "working";
  return (
    <div
      data-answer-follow-cta={state === "failed" ? "failed" : "active"}
      className="mx-auto mt-xs flex w-full max-w-4xl flex-wrap items-center gap-x-sm gap-y-xs rounded-[10px] border border-hairline bg-surface-soft px-sm py-sm"
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[18px] text-primary"
      >
        notifications_active
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-extrabold leading-[1.4] text-ink">
          {normalizedTicker} 새 소식 받기
        </p>
        <p className="text-[12px] leading-[1.4] text-muted">
          {state === "failed"
            ? "일시적인 문제로 저장하지 못했어요. 다시 시도해주세요."
            : "공시·뉴스가 뜨면 이 기기로 알려드려요. 언제든 끌 수 있어요."}
        </p>
      </div>
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-1.5 rounded-[8px] border border-primary bg-primary-fixed px-3 text-[12px] font-extrabold text-on-primary-fixed transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
        disabled={isWorking}
        onClick={() => void handleFollow()}
      >
        <span
          aria-hidden="true"
          className={[
            "material-symbols-outlined text-[16px]",
            isWorking ? "animate-spin" : "",
          ].join(" ")}
        >
          {isWorking
            ? "progress_activity"
            : state === "failed"
              ? "refresh"
              : "notifications_active"}
        </span>
        <span>
          {isWorking
            ? "설정 중"
            : state === "failed"
              ? "다시 시도"
              : "받기"}
        </span>
      </button>
    </div>
  );
}
