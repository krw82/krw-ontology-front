"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  persistPulseItemImpression,
  pulseImpressionStorageKey,
} from "@/lib/pulse/impression-client";
import CompanyLogo from "@/components/CompanyLogo";
import FilingJudgmentPanel, {
  type FilingJudgmentValue,
} from "@/components/pulse/FilingJudgmentPanel";
import type { PulseFeedResponse, PulseItem, PulseMutationAction } from "@/types/api-contracts";

interface PulseCardProps {
  item: PulseItem;
  position: number;
  pending: boolean;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  draftOwnerId: string;
  onMutation: (item: PulseItem, action: PulseMutationAction) => void;
  onJudgmentSaved: (item: PulseItem, judgment: FilingJudgmentValue) => void;
}

const KIND_STYLES = {
  filing: { icon: "description", rail: "bg-primary", wash: "bg-primary-fixed/50" },
  analysis: { icon: "manage_search", rail: "bg-[#4f46e5]", wash: "bg-[#eef0ff]" },
  checkup: { icon: "fact_check", rail: "bg-[#ff6b4a]", wash: "bg-[#fff1ed]" },
  question: { icon: "help", rail: "bg-[#7259d9]", wash: "bg-[#f3f0ff]" },
  resurface: { icon: "history", rail: "bg-[#a56a14]", wash: "bg-[#fff7e8]" },
  learning: { icon: "school", rail: "bg-[#178768]", wash: "bg-[#eaf8f3]" },
} as const;

export default function PulseCard({
  item,
  position,
  pending,
  feedSessionId,
  rankingVersion,
  draftOwnerId,
  onMutation,
  onJudgmentSaved,
}: PulseCardProps) {
  const ref = useRef<HTMLElement>(null);
  const impressionSent = useRef(false);
  const style = KIND_STYLES[item.kind];
  const isDevelopmentShowcase = item.metadata.development_showcase === true;
  const showsCompanyLogo = item.kind === "question" && Boolean(item.ticker);
  const hasSourceGroundedBrief = item.kind === "filing" && item.metadata.filing_brief_ready === true;
  const [expandedReviewedItemId, setExpandedReviewedItemId] = useState<
    string | null
  >(null);
  const reviewedAndCollapsed =
    item.state === "reviewed" && expandedReviewedItemId !== item.id;

  useEffect(() => {
    if (isDevelopmentShowcase) return;
    const element = ref.current;
    if (!element) return;
    const sessionKey = pulseImpressionStorageKey(feedSessionId, item.id);
    if (window.sessionStorage.getItem(sessionKey) === "1") return;
    const requestController = new AbortController();
    let impressionTimer: number | null = null;
    const observer = new IntersectionObserver((entries) => {
      const sufficientlyVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      if (!sufficientlyVisible && impressionTimer !== null) {
        window.clearTimeout(impressionTimer);
        impressionTimer = null;
      }
      if (!sufficientlyVisible || impressionSent.current || impressionTimer !== null) return;
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
          feed_session_id: feedSessionId,
          ranking_version: rankingVersion,
          reason_code: item.reason_code,
          has_source_grounded_brief: hasSourceGroundedBrief,
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
  }, [feedSessionId, hasSourceGroundedBrief, isDevelopmentShowcase, item.id, item.kind, item.phase, item.priority, item.reason_code, item.state, item.ticker, position, rankingVersion]);

  const primary = item.primary_action;
  const analysisStatus = item.kind === "analysis" ? String(item.metadata.run_status ?? "") : null;
  const analysisActive = item.kind === "analysis" && item.phase === "active";
  const questionHref = item.secondary_actions.find(
    (action) => action.type === "link" && action.analytics_name === "pulse_answer_prefilled",
  );

  if (reviewedAndCollapsed) {
    return (
      <article
        ref={ref}
        className="relative overflow-hidden rounded-[14px] border border-hairline bg-surface-soft px-base py-sm"
        data-pulse-kind={item.kind}
        data-pulse-state="reviewed-collapsed"
      >
        <div className={`absolute inset-y-0 left-0 w-1 opacity-55 ${style.rail}`} aria-hidden="true" />
        <div className="flex min-w-0 items-center gap-sm pl-xs">
          <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">
            task_alt
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">
              검토 완료{item.ticker ? ` · ${item.ticker}` : ""}
            </p>
            <p className="mt-0.5 truncate text-[13px] font-extrabold text-body">
              {item.title}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpandedReviewedItemId(item.id)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[9px] px-sm text-[12px] font-extrabold text-muted hover:bg-white hover:text-ink"
            aria-expanded={false}
          >
            다시 보기
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">expand_more</span>
          </button>
        </div>
      </article>
    );
  }

  return (
    <article
      ref={ref}
      className="group relative overflow-hidden rounded-[18px] border border-hairline bg-white shadow-[0_12px_36px_rgba(16,24,40,0.055)] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"
      data-pulse-kind={item.kind}
      data-pulse-state={item.state}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${style.rail}`} aria-hidden="true" />
      <div className="p-lg pl-[22px] sm:p-xl sm:pl-[26px]">
        <div className="flex items-start justify-between gap-base">
          <div className="flex min-w-0 items-center gap-sm">
            <span className={`grid size-9 shrink-0 place-items-center rounded-[11px] ${style.wash}`} aria-hidden="true">
              {showsCompanyLogo && item.ticker ? (
                <CompanyLogo
                  ticker={item.ticker}
                  companyName={item.ticker}
                  className="size-7 text-[10px] text-ink"
                  imageSize={48}
                />
              ) : (
                <span className="material-symbols-outlined text-[19px] text-ink">{style.icon}</span>
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-black uppercase tracking-[0.13em] text-muted">{item.eyebrow}</p>
              {item.priority === "urgent" ? <p className="mt-0.5 text-[11px] font-black text-[#c43c22]">긴급 · 먼저 확인</p> : null}
              {item.state === "reviewed" ? <p className="mt-0.5 text-[11px] font-black text-muted">이전에 검토함</p> : null}
              {item.ticker ? <p className="mt-0.5 text-[12px] font-extrabold text-primary">{item.ticker}</p> : null}
            </div>
          </div>
          <time className="shrink-0 text-[11px] font-semibold text-muted" dateTime={item.occurred_at}>
            {formatRelativeTime(item.occurred_at)}
          </time>
        </div>

        {item.kind === "filing" ? (
          <FilingChangeBrief item={item} />
        ) : (
          <>
            <h2 className="mt-base text-[19px] font-black leading-[1.35] tracking-[-0.025em] text-ink sm:text-[21px]">
              {item.kind === "analysis" && item.phase === "completed"
                ? "분석 결과가 준비됐습니다"
                : item.title}
            </h2>
            {item.kind === "analysis" && item.phase === "completed" ? (
              <p className="mt-xs line-clamp-2 text-[13px] font-semibold leading-5 text-muted">
                {item.title}
              </p>
            ) : null}
          </>
        )}
        {analysisActive ? (
          <div className="mt-sm inline-flex items-center gap-xs rounded-full bg-[#eef0ff] px-sm py-xs text-[12px] font-extrabold text-[#4338ca]" role="status">
            <span className="material-symbols-outlined animate-spin text-[16px]" aria-hidden="true">progress_activity</span>
            {analysisStatus === "running" ? "근거 확인 중" : "분석 대기 중"}
          </div>
        ) : null}
        {item.kind === "learning" && item.metadata.learning_kind === "four_panel" ? (
          <div className="mt-base grid grid-cols-2 gap-xs" aria-label="공시 알림 4컷">
            {[1, 2, 3, 4].map((panel) => (
              <div key={panel} className="min-h-24 whitespace-pre-line rounded-[11px] border border-[#cfe8df] bg-[#f3fbf8] p-sm text-[12px] font-bold leading-5 text-body">
                {String(item.metadata[`panel_${panel}`] ?? "")}
              </div>
            ))}
          </div>
        ) : null}
        {item.kind !== "filing" ? (
          <p className="mt-sm text-[14px] leading-6 text-body">{item.body}</p>
        ) : null}

        {item.kind === "filing" ? (
          <>
            <FilingSourceStrip item={item} />
            <p className="mt-sm flex items-start gap-xs rounded-[10px] bg-surface-soft px-sm py-xs text-[12px] font-semibold leading-5 text-muted">
              <span className="material-symbols-outlined mt-0.5 text-[15px]" aria-hidden="true">filter_alt</span>
              <span><strong className="font-extrabold text-body">표시 이유</strong> · {item.reason_label}</span>
            </p>
            <FilingJudgmentPanel
              item={item}
              questionHref={questionHref?.type === "link" ? questionHref.href : null}
              draftOwnerId={draftOwnerId}
              onSaved={onJudgmentSaved}
            />
          </>
        ) : (
        <div className="mt-lg flex flex-wrap items-center gap-sm">
          {primary.type === "link" ? (
            <Link
              href={primary.href}
              className="inline-flex min-h-11 items-center gap-xs rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white transition-colors hover:bg-primary"
              onClick={() => trackClientEventSilently("pulse_item_opened", { item_kind: item.kind, action: "primary", item_state: item.state, phase: item.phase, feed_session_id: feedSessionId, ranking_version: rankingVersion, reason_code: item.reason_code, has_source_grounded_brief: hasSourceGroundedBrief })}
            >
              {primary.label}<span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span>
            </Link>
          ) : (
            <button type="button" disabled={pending} onClick={() => onMutation(item, primary.action)} className="inline-flex min-h-11 items-center rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white disabled:opacity-50">
              {primary.label}
            </button>
          )}
          {item.secondary_actions.map((action) => action.type === "link" ? (
            <Link
              key={`${action.type}-${action.label}`}
              href={action.href}
              className="inline-flex min-h-11 items-center rounded-[10px] px-sm text-[13px] font-bold text-primary hover:bg-primary-fixed/60"
              onClick={() => trackClientEventSilently(action.analytics_name === "pulse_answer_prefilled" ? "pulse_answer_prefilled" : "pulse_item_opened", { item_kind: item.kind, action: action.label, item_state: item.state, phase: item.phase, feed_session_id: feedSessionId, ranking_version: rankingVersion, reason_code: item.reason_code, has_source_grounded_brief: hasSourceGroundedBrief })}
            >
              {action.label}
            </Link>
          ) : (() => {
            const effectiveAction = action.action === "save" && item.saved_at ? "unsave" : action.action;
            const reviewAction = effectiveAction === "review" && item.reviewed_at ? "unreview" : effectiveAction;
            const label = action.action === "save" && item.saved_at
              ? "저장됨"
              : effectiveAction === "review" && item.reviewed_at ? "다시 미검토" : action.label;
            return (
            <button
              key={`${action.type}-${action.action}`}
              type="button"
              disabled={pending}
              onClick={() => onMutation(item, reviewAction)}
              className="inline-flex min-h-11 items-center rounded-[10px] px-sm text-[13px] font-bold text-muted transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-45"
            >
              {label}
            </button>
            );
          })())}
        </div>
        )}

        {item.kind !== "filing" ? (
          <p className="mt-base flex min-h-11 items-center border-t border-hairline pt-sm text-[12px] font-semibold leading-5 text-muted">
            <span><strong className="font-bold text-body">{triggerLabel(item.trigger)}</strong> · {item.reason_label}</span>
          </p>
        ) : null}

        {item.state === "reviewed" ? (
          <button
            type="button"
            onClick={() => setExpandedReviewedItemId(null)}
            className="mt-sm inline-flex min-h-11 items-center gap-1 text-[12px] font-extrabold text-muted hover:text-ink"
            aria-expanded={true}
          >
            완료 항목 접기
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">expand_less</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}

function FilingChangeBrief({ item }: { item: PulseItem }) {
  const changes = filingChanges(item.body);
  return (
    <section className="mt-base" aria-label="이번 공시에서 바뀐 것">
      <p className="text-[11px] font-black uppercase tracking-[0.13em] text-primary">
        이번 공시에서 바뀐 것
      </p>
      <h2 className="mt-xs text-[19px] font-black leading-[1.35] tracking-[-0.025em] text-ink sm:text-[21px]">
        {item.title}
      </h2>
      {changes.length > 0 ? (
        <ul className="mt-sm grid gap-xs">
          {changes.map((change, index) => (
            <li key={`${change}-${index}`} className="flex items-start gap-sm text-[14px] leading-6 text-body">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <span>{change}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FilingSourceStrip({ item }: { item: PulseItem }) {
  const formType = stringMetadata(item, "form_type") ?? "SEC";
  const factCount = numberMetadata(item, "filing_brief_fact_count");
  const sourceAction = item.primary_action.type === "link" ? item.primary_action : null;
  return (
    <div className="mt-base flex flex-wrap items-center justify-between gap-xs rounded-[10px] border border-primary/15 bg-[#f7faff] px-sm py-xs">
      <p className="flex min-h-8 items-center gap-xs text-[12px] font-extrabold text-body">
        <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">verified</span>
        SEC {formType}
        <span className="font-semibold text-muted">
          {factCount > 0 ? `· 원문 근거 ${factCount}개` : "· 제출 원문"}
        </span>
      </p>
      {sourceAction ? (
        <Link
          href={sourceAction.href}
          className="inline-flex min-h-11 items-center gap-1 rounded-[9px] px-sm text-[12px] font-extrabold text-primary hover:bg-white"
          onClick={() => trackClientEventSilently("pulse_item_opened", {
            item_kind: item.kind,
            action: "source",
            reason_code: item.reason_code,
          })}
        >
          출처 보기
          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">arrow_forward</span>
        </Link>
      ) : null}
    </div>
  );
}

export function filingChanges(body: string): string[] {
  return body
    .split(/(?<=[.!?。])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function stringMetadata(item: PulseItem, key: string): string | null {
  const value = item.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberMetadata(item: PulseItem, key: string): number {
  const value = item.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function triggerLabel(trigger: PulseItem["trigger"]): string {
  if (trigger === "event") return "새 사건 감지";
  if (trigger === "schedule") return "예약된 체크";
  if (trigger === "editorial") return "주간 편집 콘텐츠";
  return "내 활동 상태 변화";
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
