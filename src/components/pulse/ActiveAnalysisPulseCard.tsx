"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
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

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const sessionKey = `pulse-impression:${item.id}`;
    if (window.sessionStorage.getItem(sessionKey) === "1") return;

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
        impressionSent.current = true;
        window.sessionStorage.setItem(sessionKey, "1");
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
        void fetch(`/api/pulse/items/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "impression",
            feed_session_id: feedSessionId,
          }),
        }).catch(() => undefined);
        observer.disconnect();
      }, 1_000);
    }, { threshold: [0.5] });

    observer.observe(element);
    return () => {
      if (impressionTimer !== null) window.clearTimeout(impressionTimer);
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
            {analysisStatusLabel(item)}
          </span>
        </div>

        <h2 className="mt-base text-[19px] font-black leading-[1.35] tracking-[-0.025em] text-ink sm:text-[21px]">
          {item.title}
        </h2>
        <p className="mt-sm text-[14px] leading-6 text-body">{item.body}</p>

        <Link
          href={item.primary_action.href}
          className="mt-lg inline-flex min-h-10 items-center gap-xs rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white transition-colors hover:bg-primary"
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
          대화로 돌아가기
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            arrow_forward
          </span>
        </Link>
      </div>
    </article>
  );
}

function analysisStatusLabel(item: PulseItem): string {
  const status = String(item.metadata.run_status ?? "");
  if (status === "pending" || status === "queued") return "대기 중";
  return "근거 확인 중";
}
