"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { type PulseDeviceSignal } from "@/lib/pulse/device-ranking";
import { PULSE_INSIDER_FEATURED_ITEM_COUNT } from "@/lib/pulse/insider-trade-stack";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

interface InsiderTradeStackCardProps {
  items: Array<{ item: PulseItem; position: number }>;
  feedSlot: "signal" | "discovery";
  timezone: string;
  pending: boolean;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  onDeviceSignal: (item: PulseItem, signal: PulseDeviceSignal) => void;
}

const COLLAPSED_ROW_COUNT = PULSE_INSIDER_FEATURED_ITEM_COUNT;

function pulseImpressionStorageKey(feedSessionId: string, itemId: string): string {
  return `pulse-impression:${feedSessionId}:${itemId}`;
}

export default function InsiderTradeStackCard({
  items,
  feedSlot,
  timezone,
  pending,
  feedSessionId,
  rankingVersion,
  onDeviceSignal,
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
  const collapsedHiddenCount = Math.max(0, items.length - COLLAPSED_ROW_COUNT);
  const first = items[0]?.item;
  const latestAvailableAt = useMemo(() => latestAvailableAtFor(items), [items]);
  const summaryTimeLabel = useMemo(
    () => formatInsiderSummaryTime(latestAvailableAt, timezone),
    [latestAvailableAt, timezone],
  );
  const title = isToday(latestAvailableAt, timezone) ? "오늘의 내부자 거래" : "새 내부자 거래";
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
          feed_slot: feedSlot,
          top_ticker: first.ticker,
          has_urgent_item: items.some(({ item }) => item.priority === "urgent"),
          feed_session_id: feedSessionId,
          ranking_version: rankingVersion,
        });
        for (const { item } of items.slice(0, COLLAPSED_ROW_COUNT)) {
          onDeviceSignal(item, "view");
          window.sessionStorage.setItem(pulseImpressionStorageKey(feedSessionId, item.id), "1");
        }
        window.sessionStorage.setItem(sessionKey, "1");
        observer.disconnect();
      }, 1_000);
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [collapsedItemIds, collapsedItemIdsKey, feedSessionId, feedSlot, first, items, onDeviceSignal, rankingVersion]);

  if (!first) return null;

  if (completed && !completedExpanded) {
    return (
      <article ref={ref} className="border-b border-hairline py-base" data-pulse-kind="filing" data-pulse-state="reviewed-collapsed">
        <div className="flex min-w-0 items-center gap-sm">
          <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">task_alt</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-muted">내부자 거래 · 검토함</p>
            <p className="mt-0.5 truncate text-[13px] font-bold text-body">{items.length}건의 내부자 거래 요약</p>
          </div>
          <button type="button" onClick={() => setExpandedCompletedKey(completedKey)} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[12px] font-bold text-primary hover:text-ink" aria-expanded={false}>
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
          feed_slot: feedSlot,
          feed_session_id: feedSessionId,
          ranking_version: rankingVersion,
        });
      }
      return next;
    });
  }

  return (
    <article
      ref={ref}
      className="border-b border-hairline py-lg sm:py-xl"
      data-pulse-kind="filing"
      data-pulse-variant="insider-stack"
      aria-label={`내부자 거래 ${items.length}건`}
    >
      <div className="flex items-start gap-sm">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-hairline bg-white text-[12px] font-black text-primary" aria-hidden="true">4</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-sm">
            <p className="text-[12px] font-semibold leading-5 text-muted">SEC Form 4 · 내부자 거래</p>
            <time className="shrink-0 pt-0.5 text-[11px] font-medium text-muted" dateTime={latestAvailableAt}>
              {summaryTimeLabel}
            </time>
          </div>

          <h2 className="mt-xs text-[17px] font-bold leading-[1.45] tracking-[-0.02em] text-ink sm:text-[19px]">{title}</h2>
          <p className="mt-xs text-[14px] leading-6 text-body">
            총 {items.length}건 · {summary.purchaseCount > 0 ? `매수 ${summary.purchaseCount}` : "매수 없음"} · {summary.saleCount > 0 ? `매도 ${summary.saleCount}` : "매도 없음"}
            {summary.researchCount > 0 ? ` · 최근 리서치 ${summary.researchCount}개` : ""}
          </p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">
            SEC Form 4에 보고된 공개시장 거래입니다.
            {collapsedHiddenCount > 0 ? ` 중요도 순으로 ${COLLAPSED_ROW_COUNT}건을 먼저 보여줍니다.` : null}
          </p>

          <div className="mt-sm border-y border-hairline" aria-label={expanded ? "모든 내부자 거래" : "중요 내부자 거래"}>
            {visibleItems.map(({ item, position }, index) => (
              <InsiderTradeRow
                key={item.id}
                item={item}
                position={position}
                feedSessionId={feedSessionId}
                rankingVersion={rankingVersion}
                trackImpression={expanded && index >= COLLAPSED_ROW_COUNT}
                onDeviceSignal={onDeviceSignal}
              />
            ))}
          </div>

          {hiddenCount > 0 ? (
            <p className="mt-xs text-[12px] font-medium text-muted">+ {hiddenCount}건의 거래가 더 있습니다</p>
          ) : null}

          {items.length > COLLAPSED_ROW_COUNT ? (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={expanded}
              disabled={pending}
              className="mt-xs inline-flex min-h-11 items-center gap-1 text-[13px] font-bold text-primary hover:text-ink disabled:opacity-50"
            >
              {expanded ? "거래 접기" : `나머지 ${collapsedHiddenCount}건 보기`}
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{expanded ? "expand_less" : "expand_more"}</span>
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function InsiderTradeRow({
  item,
  position,
  feedSessionId,
  rankingVersion,
  trackImpression,
  onDeviceSignal,
}: {
  item: PulseItem;
  position: number;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  trackImpression: boolean;
  onDeviceSignal: (item: PulseItem, signal: PulseDeviceSignal) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const detail = transactionDetail(item);
  const relationship = relationshipLabel(item);
  const primary = item.primary_action;

  useEffect(() => {
    const element = rowRef.current;
    if (!trackImpression || !element) return;
    const storageKey = pulseImpressionStorageKey(feedSessionId, item.id);
    if (window.sessionStorage.getItem(storageKey) === "1") return;
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
        onDeviceSignal(item, "view");
        window.sessionStorage.setItem(storageKey, "1");
        observer.disconnect();
      }, 1_000);
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [feedSessionId, item, item.id, onDeviceSignal, trackImpression]);

  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-sm gap-y-0.5">
          <span className="font-bold text-ink">{item.ticker ?? "SEC"}</span>
          <span className={`text-[12px] font-bold ${detail.textTone}`}>{detail.label}</span>
          {item.priority === "urgent" ? <span className="text-[11px] font-bold text-[#c43c22]">우선 확인</span> : null}
        </div>
        <p className="mt-0.5 truncate text-[12px] font-medium leading-5 text-body">{detail.amountLabel}</p>
        <p className="mt-0.5 truncate text-[11px] font-medium leading-5 text-muted">{[relationship, planLabel(item)].filter(Boolean).join(" · ") || "SEC Form 4"}</p>
      </div>
      <span className="material-symbols-outlined shrink-0 text-[18px] text-muted" aria-hidden="true">arrow_forward</span>
    </>
  );

  return (
    <div ref={rowRef} className="border-b border-hairline last:border-b-0">
      {primary.type === "link" ? (
        <Link
          href={primary.href}
          className="flex min-h-14 min-w-0 items-center justify-between gap-sm py-sm text-left transition-colors hover:bg-surface-soft"
          onClick={() => {
            onDeviceSignal(item, "open");
            trackClientEventSilently("pulse_item_opened", {
              item_kind: item.kind,
              action: "insider_stack_row",
              item_state: item.state,
              phase: item.phase,
              position,
              feed_session_id: feedSessionId,
              ranking_version: rankingVersion,
              reason_code: item.reason_code,
            });
          }}
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-h-14 min-w-0 items-center justify-between gap-sm py-sm">{content}</div>
      )}
    </div>
  );
}

function buildSummary(items: PulseItem[]) {
  return items.reduce((summary, item) => {
    const purchase = numberMetadata(item, "form4_reported_purchase_value");
    const sale = numberMetadata(item, "form4_reported_sale_value");
    if (purchase > 0) summary.purchaseCount += 1;
    if (sale > 0) summary.saleCount += 1;
    if (item.metadata.has_recent_research === true) summary.researchCount += 1;
    return summary;
  }, { purchaseCount: 0, saleCount: 0, researchCount: 0 });
}

function transactionDetail(item: PulseItem) {
  const purchase = numberMetadata(item, "form4_reported_purchase_value");
  const sale = numberMetadata(item, "form4_reported_sale_value");
  if (purchase > 0 && sale > 0) {
    return { label: "매수·매도", amountLabel: `매수 ${formatUsd(purchase)} · 매도 ${formatUsd(sale)}`, textTone: "text-[#8a5a00]" };
  }
  if (purchase > 0) {
    return { label: "매수", amountLabel: `매수 ${formatUsd(purchase)}`, textTone: "text-[#137357]" };
  }
  if (sale > 0) {
    return { label: "매도", amountLabel: `매도 ${formatUsd(sale)}`, textTone: "text-[#b83b25]" };
  }
  return { label: "거래 신고", amountLabel: "공개시장 거래 금액 정보 없음", textTone: "text-muted" };
}

function relationshipLabel(item: PulseItem): string | null {
  const level = coverageLevel(item);
  if (level === "interest") return "관심";
  if (item.metadata.has_recent_research === true) return "최근 리서치";
  return null;
}

function coverageLevel(
  item: PulseItem,
): "interest" | null {
  const value = (item as PulseItem & { coverage_level?: unknown }).coverage_level;
  return value === "interest" ? value : null;
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

function latestAvailableAtFor(items: Array<{ item: PulseItem }>): string {
  return items.reduce((latest, { item }) => (
    Date.parse(item.available_at) > Date.parse(latest) ? item.available_at : latest
  ), items[0]?.item.available_at ?? new Date().toISOString());
}

function formatInsiderSummaryTime(iso: string, timezone: string): string {
  return isToday(iso, timezone) ? "오늘 새로 확인" : `최근 확인 · ${formatRelativeTime(iso)}`;
}

function isToday(iso: string, timezone: string): boolean {
  return localDateKey(iso, timezone) === localDateKey(new Date().toISOString(), timezone);
}

function localDateKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
