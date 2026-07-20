"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import FilingJudgmentPanel, {
  type FilingJudgmentValue,
} from "@/components/pulse/FilingJudgmentPanel";
import { trackClientEventSilently } from "@/lib/analytics/client";
import {
  persistPulseItemImpression,
  persistPulseItemImpressions,
  pulseImpressionStorageKey,
} from "@/lib/pulse/impression-client";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

interface InsiderTradeStackCardProps {
  items: Array<{ item: PulseItem; position: number }>;
  pending: boolean;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  draftOwnerId: string;
  onJudgmentSaved: (item: PulseItem, judgment: FilingJudgmentValue) => void;
}

const COLLAPSED_ROW_COUNT = 3;

export default function InsiderTradeStackCard({
  items,
  pending,
  feedSessionId,
  rankingVersion,
  draftOwnerId,
  onJudgmentSaved,
}: InsiderTradeStackCardProps) {
  const ref = useRef<HTMLElement>(null);
  const impressionSent = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const completed = items.every(({ item }) => item.state === "reviewed");
  const completedKey = completed
    ? items
        .map(({ item }) => `${item.id}:${item.reviewed_at ?? item.state}`)
        .join(",")
    : null;
  const [expandedCompletedKey, setExpandedCompletedKey] = useState<
    string | null
  >(null);
  const completedExpanded =
    completedKey !== null && expandedCompletedKey === completedKey;
  const summary = useMemo(() => buildSummary(items.map(({ item }) => item)), [items]);
  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_ROW_COUNT);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const first = items[0]?.item;
  const collapsedItemIds = useMemo(
    () => items.slice(0, COLLAPSED_ROW_COUNT).map(({ item }) => item.id),
    [items],
  );
  const collapsedItemIdsKey = collapsedItemIds.join(",");

  useEffect(() => {
    const element = ref.current;
    if (!element || !first) return;
    const sessionKey = pulseImpressionStorageKey(
      feedSessionId,
      `insider-stack:${items.map(({ item }) => item.id).join(",")}`,
    );
    if (window.sessionStorage.getItem(sessionKey) === "1") return;
    const requestController = new AbortController();
    let timer: number | null = null;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      if (!visible && timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!visible || impressionSent.current || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        impressionSent.current = true;
        trackClientEventSilently("pulse_item_impression", {
          item_kind: "filing",
          action: "insider_stack",
          item_state: first.state,
          phase: first.phase,
          priority: first.priority,
          item_count: items.length,
          top_ticker: first.ticker,
          has_urgent_item: items.some(({ item }) => item.priority === "urgent"),
          feed_session_id: feedSessionId,
          ranking_version: rankingVersion,
        });
        // The three visible rows form the collapsed stack exposure. Persist
        // them atomically; hidden rows are recorded only if they later enter
        // the viewport after expansion.
        void persistPulseItemImpressions({
          itemIds: collapsedItemIds,
          feedSessionId,
          signal: requestController.signal,
        }).then((persisted) => {
          if (!persisted) {
            impressionSent.current = false;
            return;
          }
          for (const itemId of collapsedItemIds) {
            window.sessionStorage.setItem(
              pulseImpressionStorageKey(feedSessionId, itemId),
              "1",
            );
          }
          window.sessionStorage.setItem(sessionKey, "1");
          observer.disconnect();
        });
      }, 1_000);
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      requestController.abort();
      observer.disconnect();
    };
  }, [collapsedItemIds, collapsedItemIdsKey, feedSessionId, first, items, rankingVersion]);

  if (!first) return null;

  if (completed && !completedExpanded) {
    return (
      <article ref={ref} className="relative overflow-hidden rounded-[14px] border border-hairline bg-surface-soft px-base py-sm" data-pulse-kind="filing" data-pulse-state="reviewed-collapsed">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary opacity-55" aria-hidden="true" />
        <div className="flex min-w-0 items-center gap-sm pl-xs">
          <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">task_alt</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">검토 완료 · 내부자 거래</p>
            <p className="mt-0.5 truncate text-[13px] font-extrabold text-body">{items.length}건의 Form 4 묶음</p>
          </div>
          <button type="button" onClick={() => setExpandedCompletedKey(completedKey)} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[9px] px-sm text-[12px] font-extrabold text-muted hover:bg-white hover:text-ink" aria-expanded={false}>
            다시 보기
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">expand_more</span>
          </button>
        </div>
      </article>
    );
  }

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      if (next) {
        trackClientEventSilently("pulse_item_opened", {
          item_kind: "filing",
          action: "insider_stack_expand",
          item_state: first.state,
          phase: first.phase,
          reason_code: first.reason_code,
          item_count: items.length,
          feed_session_id: feedSessionId,
          ranking_version: rankingVersion,
        });
      }
      return next;
    });
  }

  return (
    <div className="relative pb-3" data-pulse-kind="filing" data-pulse-variant="insider-stack">
      <div aria-hidden="true" className="absolute inset-x-3 bottom-1 top-4 rounded-[18px] border border-primary/15 bg-primary-fixed/35" />
      <div aria-hidden="true" className="absolute inset-x-1.5 bottom-2 top-2 rounded-[18px] border border-primary/20 bg-white shadow-[0_10px_28px_rgba(0,62,199,0.08)]" />
      <article
        ref={ref}
        className="relative z-10 overflow-hidden rounded-[18px] border border-hairline bg-white shadow-[0_12px_36px_rgba(16,24,40,0.055)]"
        aria-label={`내부자 거래 ${items.length}건`}
      >
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
        <div className="p-lg pl-[22px] sm:p-xl sm:pl-[26px]">
          <div className="flex items-start justify-between gap-base">
            <div className="flex min-w-0 items-center">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.13em] text-muted">내부자 거래</p>
                <p className="mt-0.5 text-[12px] font-extrabold text-primary">오늘 확인할 묶음</p>
              </div>
            </div>
            <time className="shrink-0 text-[11px] font-semibold text-muted" dateTime={first.occurred_at}>
              {formatRelativeTime(first.occurred_at)}
            </time>
          </div>

          <div className="mt-base flex flex-wrap items-end justify-between gap-sm">
            <div>
              <h2 className="text-[22px] font-black leading-[1.25] tracking-[-0.035em] text-ink sm:text-[25px]">오늘의 내부자 거래</h2>
              <p className="mt-xs text-[14px] font-semibold leading-6 text-body">{items.length}건 · {summary.purchaseCount > 0 ? `매수 ${summary.purchaseCount}` : "매수 없음"} · {summary.saleCount > 0 ? `매도 ${summary.saleCount}` : "매도 없음"}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-xs">
              {summary.urgentCount > 0 ? <span className="rounded-full bg-[#fff0ed] px-sm py-xs text-[11px] font-black text-[#c43c22]">긴급 {summary.urgentCount}</span> : null}
              {summary.holdingCount > 0 ? <span className="rounded-full bg-primary-fixed/60 px-sm py-xs text-[11px] font-black text-primary">보유 {summary.holdingCount}</span> : null}
              {summary.researchCount > 0 ? <span className="rounded-full bg-[#f3f0ff] px-sm py-xs text-[11px] font-black text-[#5c43ca]">최근 리서치 {summary.researchCount}</span> : null}
            </div>
          </div>

          <p className="mt-sm text-[13px] leading-6 text-muted">SEC Form 4에 보고된 공개시장 매수·매도만 금액으로 표시합니다. 금액이 없는 거래는 추정하지 않습니다.</p>

          <div className="mt-base space-y-xs" aria-label={expanded ? "모든 내부자 거래" : "중요 내부자 거래"}>
            {visibleItems.map(({ item, position }, index) => (
              <InsiderTradeRow
                key={item.id}
                item={item}
                position={position}
                expanded={expanded}
                feedSessionId={feedSessionId}
                rankingVersion={rankingVersion}
                draftOwnerId={draftOwnerId}
                onJudgmentSaved={onJudgmentSaved}
                trackImpression={expanded && index >= COLLAPSED_ROW_COUNT}
              />
            ))}
          </div>

          {hiddenCount > 0 ? (
            <p className="mt-sm text-[12px] font-semibold text-muted">+ {hiddenCount}건의 거래가 더 있습니다</p>
          ) : null}

          <div className="mt-lg flex flex-wrap items-center gap-sm">
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={expanded}
              disabled={pending}
              className="inline-flex min-h-11 items-center gap-xs rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white transition-colors hover:bg-primary disabled:opacity-50"
            >
              {expanded ? "거래 접기" : `거래 ${items.length}건 모두 보기`}
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{expanded ? "expand_less" : "expand_more"}</span>
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function InsiderTradeRow({
  item,
  position,
  expanded,
  feedSessionId,
  rankingVersion,
  draftOwnerId,
  onJudgmentSaved,
  trackImpression,
}: {
  item: PulseItem;
  position: number;
  expanded: boolean;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  draftOwnerId: string;
  onJudgmentSaved: (item: PulseItem, judgment: FilingJudgmentValue) => void;
  trackImpression: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const detail = transactionDetail(item);
  const relationship = relationshipLabel(item);
  const primary = item.primary_action;
  const questionAction = item.secondary_actions.find(
    (action) =>
      action.type === "link" &&
      action.analytics_name === "pulse_answer_prefilled",
  );

  useEffect(() => {
    const element = rowRef.current;
    if (!trackImpression || !element) return;
    const storageKey = pulseImpressionStorageKey(feedSessionId, item.id);
    if (window.sessionStorage.getItem(storageKey) === "1") return;
    const controller = new AbortController();
    let timer: number | null = null;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) =>
        entry.isIntersecting && entry.intersectionRatio >= 0.5);
      if (!visible && timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!visible || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void persistPulseItemImpression({
          itemId: item.id,
          feedSessionId,
          signal: controller.signal,
        }).then((persisted) => {
          if (!persisted) return;
          window.sessionStorage.setItem(storageKey, "1");
          observer.disconnect();
        });
      }, 1_000);
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      controller.abort();
      observer.disconnect();
    };
  }, [feedSessionId, item.id, trackImpression]);

  const content = (
    <>
      <div className="flex min-w-0 items-start gap-sm">
        <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-[8px] ${detail.tone}`} aria-hidden="true">
          <span className="material-symbols-outlined text-[15px]">{detail.icon}</span>
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-sm gap-y-0.5">
            <span className="font-black text-ink">{item.ticker ?? "SEC"}</span>
            <span className={`text-[12px] font-extrabold ${detail.textTone}`}>{detail.label}</span>
            {item.priority === "urgent" ? <span className="text-[11px] font-black text-[#c43c22]">긴급</span> : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] font-semibold leading-5 text-body">{detail.amountLabel}</p>
          <p className="mt-0.5 truncate text-[11px] font-semibold leading-5 text-muted">{[relationship, planLabel(item)].filter(Boolean).join(" · ") || "SEC Form 4"}</p>
        </div>
      </div>
      <span className="material-symbols-outlined shrink-0 text-[18px] text-muted" aria-hidden="true">arrow_forward</span>
    </>
  );

  return (
    <div ref={rowRef} className="rounded-[12px] border border-hairline bg-canvas p-sm transition-colors hover:border-primary/30">
      <div className="flex items-center gap-xs">
        {primary.type === "link" ? (
          <Link
            href={primary.href}
            className="flex min-h-11 min-w-0 flex-1 items-start justify-between gap-sm text-left"
            onClick={() => trackClientEventSilently("pulse_item_opened", {
              item_kind: item.kind,
              action: "insider_stack_row",
              item_state: item.state,
              phase: item.phase,
              position,
              feed_session_id: feedSessionId,
              ranking_version: rankingVersion,
              reason_code: item.reason_code,
            })}
          >
            {content}
          </Link>
        ) : null}
        {expanded ? (
          <span className="shrink-0 rounded-full bg-surface-soft px-xs py-1 text-[10px] font-black text-muted">
            {item.judgment ? "판단 저장됨" : "판단 필요"}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <FilingJudgmentPanel
          item={item}
          questionHref={
            questionAction?.type === "link" ? questionAction.href : null
          }
          draftOwnerId={draftOwnerId}
          onSaved={onJudgmentSaved}
        />
      ) : null}
    </div>
  );
}

function buildSummary(items: PulseItem[]) {
  return items.reduce((summary, item) => {
    const purchase = numberMetadata(item, "form4_reported_purchase_value");
    const sale = numberMetadata(item, "form4_reported_sale_value");
    if (purchase > 0) summary.purchaseCount += 1;
    if (sale > 0) summary.saleCount += 1;
    if (item.priority === "urgent") summary.urgentCount += 1;
    if (coverageLevel(item) === "holding") summary.holdingCount += 1;
    if (item.metadata.has_recent_research === true) summary.researchCount += 1;
    return summary;
  }, { purchaseCount: 0, saleCount: 0, urgentCount: 0, holdingCount: 0, researchCount: 0 });
}

function transactionDetail(item: PulseItem) {
  const purchase = numberMetadata(item, "form4_reported_purchase_value");
  const sale = numberMetadata(item, "form4_reported_sale_value");
  if (purchase > 0 && sale > 0) {
    return { label: "매수·매도", amountLabel: `매수 ${formatUsd(purchase)} · 매도 ${formatUsd(sale)}`, icon: "swap_horiz", tone: "bg-[#fff7e8] text-[#8a5a00]", textTone: "text-[#8a5a00]" };
  }
  if (purchase > 0) {
    return { label: "매수", amountLabel: `매수 ${formatUsd(purchase)}`, icon: "north_east", tone: "bg-[#eaf8f3] text-[#137357]", textTone: "text-[#137357]" };
  }
  if (sale > 0) {
    return { label: "매도", amountLabel: `매도 ${formatUsd(sale)}`, icon: "south_east", tone: "bg-[#fff0ed] text-[#b83b25]", textTone: "text-[#b83b25]" };
  }
  return { label: "거래 신고", amountLabel: "공개시장 거래 금액 정보 없음", icon: "description", tone: "bg-surface-soft text-muted", textTone: "text-muted" };
}

function relationshipLabel(item: PulseItem): string | null {
  const level = coverageLevel(item);
  if (level === "holding") return "보유 중";
  if (level === "interest") return "관심";
  if (item.metadata.has_recent_research === true) return "최근 리서치";
  return null;
}

function coverageLevel(
  item: PulseItem,
): "interest" | "holding" | null {
  const value = (item as PulseItem & { coverage_level?: unknown }).coverage_level;
  return value === "interest" || value === "holding"
    ? value
    : null;
}

function planLabel(item: PulseItem): string | null {
  const status = String(item.metadata.form4_tenb5_one_status ?? "");
  if (status === "yes") return "10b5-1 표시";
  if (status === "no") return "10b5-1 미표시";
  return null;
}

function numberMetadata(item: PulseItem, key: string): number {
  const value = item.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
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
