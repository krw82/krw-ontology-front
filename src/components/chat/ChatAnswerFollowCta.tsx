"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { getCurrentDevicePushSubscription } from "@/lib/filing-notifications/push-subscription-client";
import {
  useCompanyFollow,
  type PushPlan,
} from "@/lib/follow/use-company-follow";
import { normalizeTicker } from "@/lib/ontology/ticker";

const ANSWER_FOLLOW_CTA_ENABLED =
  process.env.NEXT_PUBLIC_ANSWER_FOLLOW_CTA !== "off";

type CtaState = "idle" | "working" | "done" | "failed";

const DONE_MESSAGE: Record<PushPlan, string> = {
  already: "관심 추가 완료 · 알림 켜짐",
  prompt: "관심 추가 완료 · 알림 켜짐",
  install: "관심 추가 완료 · 홈 화면에 추가하면 폰으로 알림이 와요",
  denied: "관심 추가 완료 · 브라우저 설정에서 알림을 허용할 수 있어요",
  skipped: "관심 추가 완료",
};

/**
 * Post-answer one-tap retention CTA: follow the company (watchlist mark +
 * filing/news subscriptions) and enable device push in a single action.
 * Rendered only under the latest completed assistant message.
 */
export default function ChatAnswerFollowCta({ ticker }: { ticker: string }) {
  const normalizedTicker = normalizeTicker(ticker);
  const followState = useCompanyFollow(ticker, {
    surface: "chat_answer",
  });
  const [state, setState] = useState<CtaState>("idle");
  const [pushReady, setPushReady] = useState(false);
  const [digestLimited, setDigestLimited] = useState(false);
  const [pushPlan, setPushPlan] = useState<PushPlan | null>(null);

  useEffect(() => {
    if (!normalizedTicker) return;
    let stale = false;
    void getCurrentDevicePushSubscription()
      .then((subscription) => {
        if (!stale) setPushReady(Boolean(subscription));
      })
      .catch(() => null);
    return () => {
      stale = true;
    };
  }, [normalizedTicker]);

  // Anonymous or unauthorized visitors never see the CTA.
  const hidden = followState.unavailable || (followState.following && pushReady);

  // 헤더 등 다른 버튼이 관심을 해제하면 완료 상태를 제안 상태로 되돌린다.
  const viewState: CtaState =
    state === "done" && !followState.following ? "idle" : state;

  const handleFollow = useCallback(async () => {
    if (
      !normalizedTicker ||
      state === "working" ||
      (state === "done" && followState.following)
    )
      return;

    setState("working");
    trackClientEventSilently("cta_clicked", {
      cta_id: "answer_follow_cta",
      surface: "chat_answer",
      ticker: normalizedTicker,
    });

    const result = await followState.follow();
    if (result.ok) {
      setDigestLimited(result.alerts === "no_sec_id");
      setPushPlan(result.pushPlan);
      setState("done");
      return;
    }
    setState(result.reason === "limit" ? "idle" : "failed");
  }, [followState, normalizedTicker, state]);

  if (
    !ANSWER_FOLLOW_CTA_ENABLED ||
    !normalizedTicker ||
    followState.loading ||
    hidden
  ) {
    return null;
  }

  if (followState.limitReached && viewState !== "working" && viewState !== "done") {
    return (
      <div
        data-answer-follow-cta="limit"
        className="mx-auto mt-xs flex w-full max-w-4xl flex-wrap items-center gap-x-sm gap-y-xs rounded-[10px] border border-hairline bg-surface-soft px-sm py-sm"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px] text-primary"
        >
          lock
        </span>
        <p className="min-w-0 flex-1 text-[13px] font-extrabold leading-[1.4] text-ink">
          관심 기업이 가득 찼어요 · 무료 플랜은 3개까지
          <span className="ml-xs text-[12px] font-medium text-muted">
            무제한 관심·알림은 유료 플랜
          </span>
        </p>
        <Link
          href="/pricing"
          className="text-[12px] font-bold text-primary underline-offset-2 hover:underline"
        >
          플랜 보기
        </Link>
        <Link
          href="/settings/companies"
          className="text-[12px] font-bold text-primary underline-offset-2 hover:underline"
        >
          관심 기업 관리
        </Link>
      </div>
    );
  }

  if (viewState === "done") {
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
          {DONE_MESSAGE[pushPlan ?? "skipped"]}
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
      data-answer-follow-cta={viewState === "failed" ? "failed" : "active"}
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
          {normalizedTicker} 관심 추가 · 새 소식 알림
        </p>
        <p className="text-[12px] leading-[1.4] text-muted">
          {viewState === "failed"
            ? "일시적인 문제로 저장하지 못했어요. 다시 시도해주세요."
            : "관심으로 추가하면 공시·뉴스가 뜰 때 이 기기로 알려드려요. 언제든 끌 수 있어요."}
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
            : viewState === "failed"
              ? "refresh"
              : "bookmark_add"}
        </span>
        <span>
          {isWorking
            ? "추가 중"
            : viewState === "failed"
              ? "다시 시도"
              : "관심 추가"}
        </span>
      </button>
    </div>
  );
}
