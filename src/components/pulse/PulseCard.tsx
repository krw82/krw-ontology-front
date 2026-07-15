"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import type { PulseItem, PulseMutationAction } from "@/types/api-contracts";

interface PulseCardProps {
  item: PulseItem;
  position: number;
  pending: boolean;
  onMutation: (item: PulseItem, action: PulseMutationAction) => void;
}

const KIND_STYLES = {
  filing: { icon: "description", rail: "bg-primary", wash: "bg-primary-fixed/50" },
  checkup: { icon: "fact_check", rail: "bg-[#ff6b4a]", wash: "bg-[#fff1ed]" },
  question: { icon: "help", rail: "bg-[#7259d9]", wash: "bg-[#f3f0ff]" },
  resurface: { icon: "history", rail: "bg-[#a56a14]", wash: "bg-[#fff7e8]" },
  learning: { icon: "school", rail: "bg-[#178768]", wash: "bg-[#eaf8f3]" },
} as const;

export default function PulseCard({ item, position, pending, onMutation }: PulseCardProps) {
  const ref = useRef<HTMLElement>(null);
  const impressionSent = useRef(false);
  const style = KIND_STYLES[item.kind];

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const sessionKey = `pulse-impression:${item.id}`;
    if (window.sessionStorage.getItem(sessionKey) === "1") return;
    let impressionTimer: number | null = null;
    const observer = new IntersectionObserver((entries) => {
      const sufficientlyVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      if (!sufficientlyVisible && impressionTimer !== null) {
        window.clearTimeout(impressionTimer);
        impressionTimer = null;
      }
      if (!sufficientlyVisible || impressionSent.current || impressionTimer !== null) return;
      impressionTimer = window.setTimeout(() => {
        impressionSent.current = true;
        window.sessionStorage.setItem(sessionKey, "1");
        trackClientEventSilently("pulse_item_impression", {
          item_kind: item.kind,
          position,
          priority: item.priority,
          has_ticker: Boolean(item.ticker),
          visible_ms: 1000,
        });
        void fetch(`/api/pulse/items/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "impression" }),
        }).catch(() => undefined);
        observer.disconnect();
      }, 1_000);
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => {
      if (impressionTimer !== null) window.clearTimeout(impressionTimer);
      observer.disconnect();
    };
  }, [item.id, item.kind, item.priority, item.ticker, position]);

  const primary = item.primary_action;
  return (
    <article
      ref={ref}
      className="group relative overflow-hidden rounded-[18px] border border-hairline bg-white shadow-[0_12px_36px_rgba(16,24,40,0.055)] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"
      data-pulse-kind={item.kind}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${style.rail}`} aria-hidden="true" />
      <div className="p-lg pl-[22px] sm:p-xl sm:pl-[26px]">
        <div className="flex items-start justify-between gap-base">
          <div className="flex min-w-0 items-center gap-sm">
            <span className={`grid size-9 shrink-0 place-items-center rounded-[11px] ${style.wash}`} aria-hidden="true">
              <span className="material-symbols-outlined text-[19px] text-ink">{style.icon}</span>
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-black uppercase tracking-[0.13em] text-muted">{item.eyebrow}</p>
              {item.priority === "urgent" ? <p className="mt-0.5 text-[11px] font-black text-[#c43c22]">긴급 · 먼저 확인</p> : null}
              {item.ticker ? <p className="mt-0.5 text-[12px] font-extrabold text-primary">{item.ticker}</p> : null}
            </div>
          </div>
          <time className="shrink-0 text-[11px] font-semibold text-muted" dateTime={item.occurred_at}>
            {formatRelativeTime(item.occurred_at)}
          </time>
        </div>

        <h2 className="mt-base text-[19px] font-black leading-[1.35] tracking-[-0.025em] text-ink sm:text-[21px]">{item.title}</h2>
        {item.kind === "learning" && item.metadata.learning_kind === "four_panel" ? (
          <div className="mt-base grid grid-cols-2 gap-xs" aria-label="공시 알림 4컷">
            {[1, 2, 3, 4].map((panel) => (
              <div key={panel} className="min-h-24 whitespace-pre-line rounded-[11px] border border-[#cfe8df] bg-[#f3fbf8] p-sm text-[12px] font-bold leading-5 text-body">
                {String(item.metadata[`panel_${panel}`] ?? "")}
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-sm text-[14px] leading-6 text-body">{item.body}</p>

        <div className="mt-lg flex flex-wrap items-center gap-sm">
          {primary.type === "link" ? (
            <Link
              href={primary.href}
              className="inline-flex min-h-10 items-center gap-xs rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white transition-colors hover:bg-primary"
              onClick={() => trackClientEventSilently("pulse_item_opened", { item_kind: item.kind, action: "primary" })}
            >
              {primary.label}<span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span>
            </Link>
          ) : (
            <button type="button" disabled={pending} onClick={() => onMutation(item, primary.action)} className="inline-flex min-h-10 items-center rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white disabled:opacity-50">
              {primary.label}
            </button>
          )}
          {item.secondary_actions.map((action) => action.type === "link" ? (
            <Link
              key={`${action.type}-${action.label}`}
              href={action.href}
              className="inline-flex min-h-10 items-center rounded-[10px] px-sm text-[13px] font-bold text-primary hover:bg-primary-fixed/60"
              onClick={() => trackClientEventSilently(action.analytics_name === "pulse_answer_prefilled" ? "pulse_answer_prefilled" : "pulse_item_opened", { item_kind: item.kind, action: action.label })}
            >
              {action.label}
            </Link>
          ) : (() => {
            const effectiveAction = action.action === "save" && item.saved_at ? "unsave" : action.action;
            const label = action.action === "save" && item.saved_at ? "저장됨" : action.label;
            return (
            <button
              key={`${action.type}-${action.action}`}
              type="button"
              disabled={pending}
              onClick={() => onMutation(item, effectiveAction)}
              className="inline-flex min-h-10 items-center rounded-[10px] px-sm text-[13px] font-bold text-muted transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-45"
            >
              {label}
            </button>
            );
          })())}
        </div>

        <details className="mt-base border-t border-hairline pt-sm text-[12px] text-muted">
          <summary className="cursor-pointer select-none font-semibold hover:text-body">왜 이 항목이 보이나요?</summary>
          <p className="mt-xs leading-5"><span className="font-bold text-body">{triggerLabel(item.trigger)}</span> · {item.reason_label}</p>
        </details>
      </div>
    </article>
  );
}

function triggerLabel(trigger: PulseItem["trigger"]): string {
  if (trigger === "event") return "새 사건 감지";
  if (trigger === "schedule") return "예약된 체크";
  if (trigger === "editorial") return "주간 편집 콘텐츠";
  return "저장 상태 변화";
}

function formatRelativeTime(iso: string): string {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (diffMinutes < 1) return "방금";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(iso));
}
