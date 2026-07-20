"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  persistPulseItemImpression,
  pulseImpressionStorageKey,
} from "@/lib/pulse/impression-client";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

interface ActiveAnalysisPulseCardProps {
  item: PulseItem;
  position: number;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
}

export default function ActiveAnalysisPulseCard({
  item,
  position,
  feedSessionId,
  rankingVersion,
}: ActiveAnalysisPulseCardProps) {
  const ref = useRef<HTMLElement>(null);
  const impressionSent = useRef(false);
  const progress = analysisProgress(item);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const sessionKey = pulseImpressionStorageKey(feedSessionId, item.id);
    if (window.sessionStorage.getItem(sessionKey) === "1") return;
    const requestController = new AbortController();

    let impressionTimer: number | null = null;
    const observer = new IntersectionObserver((entries) => {
      const sufficientlyVisible = entries.some(
        (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5,
      );
      if (!sufficientlyVisible && impressionTimer !== null) {
        window.clearTimeout(impressionTimer);
        impressionTimer = null;
      }
      if (!sufficientlyVisible || impressionSent.current || impressionTimer !== null)
        return;

      impressionTimer = window.setTimeout(() => {
        impressionTimer = null;
        impressionSent.current = true;
        trackClientEventSilently("pulse_item_impression", {
          item_kind: item.kind,
          position,
          priority: item.priority,
          item_state: item.state,
          phase: item.phase,
          has_ticker: Boolean(item.ticker),
          visible_ms: 1000,
          surface: "active_analysis",
          feed_session_id: feedSessionId,
          ranking_version: rankingVersion,
          reason_code: item.reason_code,
        });
        void persistPulseItemImpression({
          itemId: item.id,
          feedSessionId,
          signal: requestController.signal,
        }).then((persisted) => {
          if (!persisted) {
            impressionSent.current = false;
            return;
          }
          window.sessionStorage.setItem(sessionKey, "1");
          observer.disconnect();
        });
      }, 1_000);
    }, { threshold: [0.5] });

    observer.observe(element);
    return () => {
      if (impressionTimer !== null) window.clearTimeout(impressionTimer);
      requestController.abort();
      observer.disconnect();
    };
  }, [feedSessionId, item.id, item.kind, item.phase, item.priority, item.reason_code, item.state, item.ticker, position, rankingVersion]);

  if (item.primary_action.type !== "link") return null;

  return (
    <article
      ref={ref}
      className="relative overflow-hidden rounded-[18px] border border-[#d9d7ff] bg-[#fbfbff] shadow-[0_12px_36px_rgba(79,70,229,0.08)]"
      data-pulse-kind="analysis"
      data-pulse-phase="active"
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-[#4f46e5]" aria-hidden="true" />
      <div className="p-lg pl-[22px] sm:p-xl sm:pl-[26px]">
        <div className="flex items-start justify-between gap-base">
          <div className="min-w-0">
            <p className="flex items-center gap-xs text-[11px] font-black uppercase tracking-[0.13em] text-[#4f46e5]" role="status">
              <span className="relative flex size-2.5" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#675dff] opacity-70 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2.5 rounded-full bg-[#5146e5]" />
              </span>
              분석 진행 중
            </p>
            {item.ticker ? (
              <p className="mt-xs text-[13px] font-black text-primary">{item.ticker}</p>
            ) : null}
          </div>
          <span className="shrink-0 text-[11px] font-semibold text-muted">
            {progress.statusLabel}
          </span>
        </div>

        <h2 className="mt-base text-[19px] font-black leading-[1.35] tracking-[-0.025em] text-ink sm:text-[21px]">
          {item.ticker ? `${item.ticker} 분석을 진행하고 있습니다` : "분석을 진행하고 있습니다"}
        </h2>
        <p className="mt-xs line-clamp-2 text-[13px] font-semibold leading-5 text-muted">
          요청 · {item.title}
        </p>

        <ol className="mt-base grid grid-cols-3 gap-xs" aria-label="분석 진행 단계">
          {progress.steps.map((step, index) => (
            <li
              key={step}
              className={[
                "rounded-[9px] border px-xs py-xs text-center text-[11px] font-extrabold",
                index < progress.activeStep
                  ? "border-primary/15 bg-primary-fixed/45 text-primary"
                  : index === progress.activeStep
                    ? "border-[#8b83ff]/35 bg-[#eef0ff] text-[#4338ca]"
                    : "border-hairline bg-white text-muted",
              ].join(" ")}
            >
              {index === progress.activeStep ? (
                <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
              {step}
            </li>
          ))}
        </ol>

        <Link
          href={item.primary_action.href}
          className="mt-lg inline-flex min-h-11 items-center gap-xs rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white transition-colors hover:bg-primary"
          onClick={() =>
            trackClientEventSilently("pulse_item_opened", {
              item_kind: item.kind,
              action: "return_to_chat",
              item_state: item.state,
              phase: item.phase,
              surface: "active_analysis",
              feed_session_id: feedSessionId,
              ranking_version: rankingVersion,
              reason_code: item.reason_code,
            })
          }
        >
          분석 화면 열기
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            arrow_forward
          </span>
        </Link>
      </div>
    </article>
  );
}

function analysisProgress(item: PulseItem): {
  statusLabel: string;
  activeStep: number;
  steps: [string, string, string];
} {
  const status = String(item.metadata.run_status ?? "");
  if (status === "pending" || status === "queued") {
    return {
      statusLabel: "대기 중",
      activeStep: 0,
      steps: ["요청 확인", "근거 검증", "답변 정리"],
    };
  }
  if (status === "answering" || status === "composing") {
    return {
      statusLabel: "답변 정리 중",
      activeStep: 2,
      steps: ["요청 확인", "근거 검증", "답변 정리"],
    };
  }
  return {
    statusLabel: "근거 확인 중",
    activeStep: 1,
    steps: ["요청 확인", "근거 검증", "답변 정리"],
  };
}
