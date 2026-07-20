"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetStateAction } from "react";
import ActiveAnalysisPulseCard from "@/components/pulse/ActiveAnalysisPulseCard";
import InsiderTradeStackCard from "@/components/pulse/InsiderTradeStackCard";
import PulseCard from "@/components/pulse/PulseCard";
import PulseDayCloseCard from "@/components/pulse/PulseDayCloseCard";
import type { FilingJudgmentValue } from "@/components/pulse/FilingJudgmentPanel";
import PulseSummaryBar from "@/components/pulse/PulseSummaryBar";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { buildPulseFeedDisplayEntries } from "@/lib/pulse/insider-trade-stack";
import { saveOfflinePulseSnapshot } from "@/lib/pwa/offline-read-model";
import type {
  PulseFeedResponse,
  PulseFeedStatusResponse,
  PulseItem,
  PulseMutationAction,
} from "@/types/api-contracts";

interface PulseFeedProps {
  initialFeed: PulseFeedResponse;
  draftOwnerId: string;
}

const PAGE_SIZE = 20;

export default function PulseFeed({ initialFeed, draftOwnerId }: PulseFeedProps) {
  const [feed, setFeedState] = useState(initialFeed);
  const feedRef = useRef(initialFeed);
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [newItemCount, setNewItemCount] = useState(0);
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedSessionId] = useState(createFeedSessionId);
  const [activeAnalysisCount, setActiveAnalysisCount] = useState(initialFeed.summary.active_analysis_count);
  const generatedAtRef = useRef(initialFeed.generated_at);
  const mountedRef = useRef(true);
  const firstPageControllerRef = useRef<AbortController | null>(null);
  const statusControllerRef = useRef<AbortController | null>(null);
  const firstPageRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const pendingMutationIdsRef = useRef<Set<string>>(new Set());

  const setFeed = useCallback((nextState: SetStateAction<PulseFeedResponse>) => {
    const nextFeed =
      typeof nextState === "function"
        ? nextState(feedRef.current)
        : nextState;
    feedRef.current = nextFeed;
    setFeedState(nextFeed);
  }, []);

  const cancelStatusRequest = useCallback(() => {
    statusRequestIdRef.current += 1;
    statusControllerRef.current?.abort();
    statusControllerRef.current = null;
  }, []);

  const hasActiveAnalysis = activeAnalysisCount > 0;
  const activeAnalysisItems = feed.active_analysis_items;
  const visibleActiveAnalysisItems = activeAnalysisItems.slice(0, 2);
  const feedItems = feed.items;
  const displayEntries = useMemo(
    () => buildPulseFeedDisplayEntries(feedItems, feed.timezone),
    [feedItems, feed.timezone],
  );
  const hiddenActiveAnalysisCount = Math.max(
    0,
    activeAnalysisCount - visibleActiveAnalysisItems.length,
  );
  const degraded = useMemo(
    () => feed.source_statuses.filter((source) => source.status === "degraded"),
    [feed.source_statuses],
  );
  const feedBusy = loading || pendingIds.size > 0;

  useEffect(() => {
    trackClientEventSilently("pulse_viewed", {
      feed_session_id: feedSessionId,
      item_count: feed.items.length + feed.active_analysis_items.length,
      actionable_count: feed.summary.actionable_count,
      active_analysis_count: feed.summary.active_analysis_count,
      ranking_version: feed.ranking_version,
      degraded_sources: feed.source_statuses.filter((source) => source.status === "degraded").map((source) => source.source),
    });
    for (const source of feed.source_statuses.filter((item) => item.status === "degraded")) {
      trackClientEventSilently("pulse_source_degraded", { source: source.source });
    }
    // This event intentionally describes the initial page view only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void saveOfflinePulseSnapshot(feed).catch(() => undefined);
  }, [feed]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      firstPageRequestIdRef.current += 1;
      firstPageControllerRef.current?.abort();
      cancelStatusRequest();
      firstPageControllerRef.current = null;
    };
  }, [cancelStatusRequest]);

  const fetchFirstPage = useCallback(async () => {
    if (
      firstPageControllerRef.current ||
      pendingMutationIdsRef.current.size > 0
    ) {
      return null;
    }

    cancelStatusRequest();
    const controller = new AbortController();
    const requestId = firstPageRequestIdRef.current + 1;
    firstPageRequestIdRef.current = requestId;
    firstPageControllerRef.current = controller;
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/pulse?${new URLSearchParams({ filter: "all", limit: String(PAGE_SIZE) })}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error("feed_failed");
      const next = await response.json() as PulseFeedResponse;
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== firstPageRequestIdRef.current
      ) {
        return null;
      }
      generatedAtRef.current = next.generated_at;
      setFeed(next);
      setActiveAnalysisCount(next.summary.active_analysis_count);
      setNewItemCount(0);
      return next;
    } catch (error) {
      if (
        isAbortError(error) ||
        !mountedRef.current ||
        requestId !== firstPageRequestIdRef.current
      ) {
        return null;
      }
      setErrorMessage(
        navigator.onLine
          ? "피드를 새로 불러오지 못했습니다. 현재 목록은 그대로 유지됩니다."
          : "오프라인 상태입니다. 연결되면 다시 시도해주세요.",
      );
      return null;
    } finally {
      if (firstPageControllerRef.current === controller) {
        firstPageControllerRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [cancelStatusRequest, setFeed]);

  const pollStatus = useCallback(async () => {
    if (
      document.visibilityState !== "visible" ||
      !navigator.onLine ||
      firstPageControllerRef.current
    ) {
      return;
    }

    cancelStatusRequest();
    const controller = new AbortController();
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    statusControllerRef.current = controller;
    try {
      const params = new URLSearchParams({ since: generatedAtRef.current });
      const response = await fetch(`/api/pulse/status?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const next = await response.json() as PulseFeedStatusResponse;
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== statusRequestIdRef.current
      ) {
        return;
      }
      setNewItemCount(next.new_item_count);
      setActiveAnalysisCount(next.active_analysis_count);
      const activeSessionIds = new Set(next.active_analysis_session_ids);
      setFeed((current) => ({
        ...current,
        active_analysis_items: current.active_analysis_items.filter((item) => {
          const sessionId = typeof item.metadata.session_id === "string" ? item.metadata.session_id : null;
          return !sessionId || activeSessionIds.has(sessionId);
        }),
      }));
    } catch (error) {
      if (!isAbortError(error)) {
        // Background status refreshes stay silent. User-initiated requests surface errors.
      }
    } finally {
      if (statusControllerRef.current === controller) {
        statusControllerRef.current = null;
      }
    }
  }, [cancelStatusRequest, setFeed]);

  useEffect(() => {
    let interval: number | null = null;

    const stopPolling = () => {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const startPolling = () => {
      if (
        interval !== null ||
        document.visibilityState !== "visible" ||
        !navigator.onLine
      ) {
        return;
      }
      interval = window.setInterval(
        () => void pollStatus(),
        hasActiveAnalysis ? 30_000 : 120_000,
      );
    };
    const refreshWhenAvailable = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      startPolling();
      void pollStatus();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshWhenAvailable();
      } else {
        stopPolling();
        cancelStatusRequest();
      }
    };
    const onOffline = () => {
      stopPolling();
      cancelStatusRequest();
    };
    const onOnline = () => refreshWhenAvailable();

    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      stopPolling();
      cancelStatusRequest();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [cancelStatusRequest, hasActiveAnalysis, pollStatus]);

  async function refreshNewItems() {
    trackClientEventSilently("pulse_new_items_seen", {
      feed_session_id: feedSessionId,
      item_count: newItemCount,
    });
    const refreshed = await fetchFirstPage();
    if (!refreshed) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  async function mutate(item: PulseItem, action: PulseMutationAction) {
    if (pendingMutationIdsRef.current.has(item.id)) return;
    const snapshot = capturePulseItemSnapshot(feedRef.current, item.id);
    if (!snapshot) return;

    firstPageControllerRef.current?.abort();
    pendingMutationIdsRef.current.add(item.id);
    setPendingIds((current) => new Set(current).add(item.id));
    setErrorMessage(null);
    const timestamp = new Date().toISOString();
    setFeed((current) =>
      applyPulseItemMutation(current, snapshot.item, action, timestamp),
    );

    const body: { action: PulseMutationAction; snoozed_until?: string } = { action };
    if (action === "snooze") body.snoozed_until = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    try {
      const response = await fetch(`/api/pulse/items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("pulse_mutation_failed");
    } catch {
      setFeed((current) =>
        rollbackPulseItemMutation(current, snapshot, action, timestamp),
      );
      if (mountedRef.current) {
        setErrorMessage(
          navigator.onLine
            ? "항목 상태를 저장하지 못해 원래 상태로 되돌렸습니다."
            : "오프라인 상태라 변경을 저장하지 못했습니다. 항목을 원래 상태로 되돌렸습니다.",
        );
      }
    } finally {
      pendingMutationIdsRef.current.delete(item.id);
      if (!mountedRef.current) return;
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  function handleJudgmentSaved(
    item: PulseItem,
    judgment: FilingJudgmentValue,
  ) {
    setFeed((current) =>
      applyPulseJudgment(
        current,
        item.id,
        judgment,
        judgment.updated_at ?? new Date().toISOString(),
      ),
    );
  }

  return (
    <>
      <header className="relative overflow-hidden border-b border-hairline bg-white">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary-fixed/55 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[760px] px-base py-lg sm:px-xl sm:py-xl">
          <div className="flex items-center justify-between gap-lg">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Research feed</p>
              <h1 className="mt-xs text-[32px] font-black leading-none tracking-[-0.05em] text-ink sm:text-[40px]">피드</h1>
              <p className="mt-sm text-[13px] font-semibold text-muted">
                {feed.date_label} · {feed.summary.actionable_count > 0 ? `미검토 ${feed.summary.actionable_count}개` : "미검토 항목 없음"}
              </p>
            </div>
            <Link href="/pulse/settings" className="inline-flex size-11 items-center justify-center rounded-[12px] border border-hairline bg-white text-muted shadow-sm hover:text-ink" aria-label="피드 설정">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">tune</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[760px] px-base py-lg sm:px-xl sm:py-xl">
        <p aria-live="polite" className="sr-only" role="status">
          {loading
            ? "피드를 불러오는 중입니다."
            : pendingIds.size > 0
              ? `${pendingIds.size}개 항목의 변경을 저장하는 중입니다.`
              : ""}
        </p>
        <div aria-live="polite" className="sticky top-3 z-20 flex justify-center">
          {newItemCount > 0 ? (
            <button
              aria-busy={feedBusy}
              className="min-h-11 rounded-full bg-primary px-base text-[13px] font-extrabold text-white shadow-[0_8px_24px_rgba(0,62,199,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={feedBusy}
              onClick={() => void refreshNewItems()}
              type="button"
            >
              {loading ? "새 항목 불러오는 중…" : pendingIds.size > 0 ? "변경 저장 중…" : `새로 들어온 ${newItemCount}개`}
            </button>
          ) : null}
        </div>

        {degraded.length > 0 ? (
          <div className="mb-base flex items-center justify-between gap-base rounded-[12px] border border-[#f3d8a5] bg-[#fff8e9] px-base py-sm text-[12px] leading-5 text-[#76510e]" role="status">
            <span>일부 리서치 항목을 아직 불러오지 못했습니다. 현재 목록은 보존되며 다시 시도할 수 있습니다.</span>
            <button aria-busy={feedBusy} className="inline-flex min-h-11 shrink-0 items-center px-xs font-extrabold underline disabled:cursor-not-allowed disabled:opacity-60" disabled={feedBusy} type="button" onClick={() => void fetchFirstPage()}>{loading ? "불러오는 중…" : "다시 시도"}</button>
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-base flex items-center justify-between gap-base rounded-[12px] border border-[#f0b9b0] bg-[#fff1ef] px-base py-sm text-[12px] leading-5 text-[#8c2f20]" role="alert">
            <span>{errorMessage}</span>
            <button aria-busy={feedBusy} className="inline-flex min-h-11 shrink-0 items-center px-xs font-extrabold underline disabled:cursor-not-allowed disabled:opacity-60" disabled={feedBusy} type="button" onClick={() => void fetchFirstPage()}>{loading ? "불러오는 중…" : "다시 시도"}</button>
          </div>
        ) : null}

        <PulseSummaryBar summary={feed.summary} />

        {hasActiveAnalysis ? (
          <section className="mb-xl" aria-label="진행 중인 분석">
            <div className="mb-sm flex items-center justify-between gap-base">
              <h2 className="text-[14px] font-black text-ink">진행 중인 분석</h2>
              {visibleActiveAnalysisItems.length > 0 && hiddenActiveAnalysisCount > 0 ? (
                <p className="text-[12px] font-semibold text-muted">
                  추가 {hiddenActiveAnalysisCount}개 진행 중
                </p>
              ) : null}
            </div>
            {visibleActiveAnalysisItems.length > 0 ? (
              <div className="space-y-base">
                {visibleActiveAnalysisItems.map((item, index) => (
                  <ActiveAnalysisPulseCard
                    key={item.id}
                    item={item}
                    position={index + 1}
                    feedSessionId={feedSessionId}
                    rankingVersion={feed.ranking_version}
                  />
                ))}
              </div>
            ) : (
              <button
                aria-busy={feedBusy}
                type="button"
                disabled={feedBusy}
                onClick={() => void fetchFirstPage()}
                className="flex min-h-11 w-full items-center justify-between gap-base rounded-[14px] border border-[#d9d7ff] bg-[#fbfbff] px-base py-base text-left text-[13px] font-extrabold text-[#4338ca] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{loading ? "진행 중인 분석 불러오는 중…" : pendingIds.size > 0 ? "변경 저장 중…" : `진행 중인 분석 ${activeAnalysisCount}개를 불러오기`}</span>
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>
              </button>
            )}
          </section>
        ) : null}

        {displayEntries.length > 0 ? (
          <div className="relative space-y-base before:absolute before:bottom-8 before:left-[-13px] before:top-8 before:hidden before:w-px before:bg-hairline sm:before:block">
            {displayEntries.map((entry, index) => {
              const showReviewedDivider = entry.state === "reviewed" && (index === 0 || displayEntries[index - 1]?.state !== "reviewed");
              return (
                <div
                  key={entry.id}
                  data-workspace-scroll-anchor={entry.id}
                >
                  {showReviewedDivider ? (
                    <div className="mb-base flex items-center gap-sm" role="separator" aria-label="이전에 검토한 항목">
                      <span className="h-px flex-1 bg-hairline" />
                      <span className="text-[11px] font-extrabold text-muted">이전에 검토한 항목</span>
                      <span className="h-px flex-1 bg-hairline" />
                    </div>
                  ) : null}
                  {entry.type === "insider_trade_stack" ? (
                    <InsiderTradeStackCard
                      items={entry.items}
                      pending={entry.items.some(({ item }) => pendingIds.has(item.id))}
                      feedSessionId={feedSessionId}
                      rankingVersion={feed.ranking_version}
                      draftOwnerId={draftOwnerId}
                      onJudgmentSaved={handleJudgmentSaved}
                    />
                  ) : (
                    <PulseCard
                      item={entry.item}
                      position={entry.position}
                      pending={pendingIds.has(entry.item.id)}
                      feedSessionId={feedSessionId}
                      rankingVersion={feed.ranking_version}
                      draftOwnerId={draftOwnerId}
                      onMutation={mutate}
                      onJudgmentSaved={handleJudgmentSaved}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : visibleActiveAnalysisItems.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-hairline bg-white px-xl py-3xl text-center">
            <span className="material-symbols-outlined text-[34px] text-muted" aria-hidden="true">done_all</span>
            <h2 className="mt-sm text-lg font-black text-ink">{degraded.length > 0 ? "신호를 준비하는 중입니다" : "지금 확인할 신호가 없습니다"}</h2>
            <p className="mt-xs text-sm leading-6 text-muted">{degraded.length > 0 ? "잠시 후 다시 시도하면 최신 공시와 분석 상태를 불러옵니다." : "임의의 추천을 더 붙이지 않습니다. 아래 오늘 정리에서 세션을 마무리할 수 있습니다."}</p>
          </div>
        ) : null}

        <div className="py-2xl text-center" aria-live="polite">
          <PulseDayCloseCard
            feed={feed}
            feedSessionId={feedSessionId}
            busy={feedBusy}
          />
          <div className="mx-auto mt-xl flex max-w-[360px] items-center justify-center gap-sm border-t border-hairline pt-base">
            {feedback ? (
              <p className="text-[12px] font-semibold text-muted">의견을 반영해 피드를 다듬겠습니다.</p>
            ) : (
              <>
                <p className="mr-xs text-[12px] font-semibold text-muted">오늘 피드가 도움됐나요?</p>
                {(["helpful", "not_helpful"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setFeedback(value);
                      trackClientEventSilently("pulse_feedback_submitted", { feedback: value, surface: "pulse" });
                    }}
                    className="grid size-11 place-items-center rounded-full border border-hairline bg-white text-muted hover:text-ink"
                    aria-label={value === "helpful" ? "도움됐어요" : "도움되지 않았어요"}
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{value === "helpful" ? "thumb_up" : "thumb_down"}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function createFeedSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000000";
}

function isItemActionable(item: PulseItem): boolean {
  return item.kind === "filing"
    || item.kind === "question"
    || item.kind === "resurface"
    || (item.kind === "analysis" && item.phase !== "active");
}

export interface PulseItemMutationSnapshot {
  item: PulseItem;
  itemIndex: number;
  activeAnalysisItem: PulseItem | null;
  activeAnalysisIndex: number;
}

export function capturePulseItemSnapshot(
  feed: PulseFeedResponse,
  itemId: string,
): PulseItemMutationSnapshot | null {
  const itemIndex = feed.items.findIndex((item) => item.id === itemId);
  const activeAnalysisIndex = feed.active_analysis_items.findIndex(
    (item) => item.id === itemId,
  );
  const item = itemIndex >= 0
    ? feed.items[itemIndex]
    : feed.active_analysis_items[activeAnalysisIndex];
  if (!item) return null;
  return {
    item,
    itemIndex,
    activeAnalysisItem:
      activeAnalysisIndex >= 0
        ? feed.active_analysis_items[activeAnalysisIndex]
        : null,
    activeAnalysisIndex,
  };
}

export function applyPulseItemMutation(
  feed: PulseFeedResponse,
  item: PulseItem,
  action: PulseMutationAction,
  timestamp: string,
): PulseFeedResponse {
  const exists =
    feed.items.some((candidate) => candidate.id === item.id) ||
    feed.active_analysis_items.some((candidate) => candidate.id === item.id);
  if (!exists) return feed;

  const summaryDelta = pulseMutationSummaryDelta(item, action);
  if (action === "dismiss" || action === "snooze") {
    return {
      ...feed,
      items: feed.items.filter((candidate) => candidate.id !== item.id),
      active_analysis_items: feed.active_analysis_items.filter(
        (candidate) => candidate.id !== item.id,
      ),
      summary: adjustPulseSummary(feed.summary, item, summaryDelta),
    };
  }

  return {
    ...feed,
    items: feed.items.map((candidate) =>
      candidate.id === item.id
        ? applyPulseItemState(candidate, action, timestamp)
        : candidate,
    ),
    active_analysis_items: feed.active_analysis_items.map((candidate) =>
      candidate.id === item.id
        ? applyPulseItemState(candidate, action, timestamp)
        : candidate,
    ),
    summary: adjustPulseSummary(feed.summary, item, summaryDelta),
  };
}

export function applyPulseJudgment(
  feed: PulseFeedResponse,
  itemId: string,
  judgment: FilingJudgmentValue,
  timestamp: string,
): PulseFeedResponse {
  const completedItem =
    feed.items.find((item) => item.id === itemId) ??
    feed.active_analysis_items.find((item) => item.id === itemId);
  if (!completedItem) return feed;

  const complete = (item: PulseItem): PulseItem => {
    if (item.id !== itemId) return item;
    return {
      ...item,
      judgment,
      reviewed_at: timestamp,
      state: "reviewed",
      actionable: false,
    };
  };
  const items = feed.items.map(complete);
  const activeAnalysisItems = feed.active_analysis_items.map(complete);

  const delta = completedItem.actionable ? -1 : 0;
  return {
    ...feed,
    items,
    active_analysis_items: activeAnalysisItems,
    summary: adjustPulseSummary(feed.summary, completedItem, delta),
  };
}

export function rollbackPulseItemMutation(
  feed: PulseFeedResponse,
  snapshot: PulseItemMutationSnapshot,
  action: PulseMutationAction,
  timestamp: string,
): PulseFeedResponse {
  const summaryDelta = pulseMutationSummaryDelta(snapshot.item, action);
  if (action === "dismiss" || action === "snooze") {
    const itemAlreadyPresent =
      feed.items.some((item) => item.id === snapshot.item.id) ||
      feed.active_analysis_items.some((item) => item.id === snapshot.item.id);
    let restored = false;
    let items = feed.items;
    let activeAnalysisItems = feed.active_analysis_items;

    if (
      snapshot.itemIndex >= 0 &&
      !items.some((item) => item.id === snapshot.item.id)
    ) {
      items = insertAt(items, snapshot.itemIndex, snapshot.item);
      restored = true;
    }
    if (
      snapshot.activeAnalysisItem &&
      snapshot.activeAnalysisIndex >= 0 &&
      !activeAnalysisItems.some((item) => item.id === snapshot.item.id)
    ) {
      activeAnalysisItems = insertAt(
        activeAnalysisItems,
        snapshot.activeAnalysisIndex,
        snapshot.activeAnalysisItem,
      );
      restored = true;
    }

    if (!restored) return feed;
    return {
      ...feed,
      items,
      active_analysis_items: activeAnalysisItems,
      summary: itemAlreadyPresent
        ? feed.summary
        : adjustPulseSummary(feed.summary, snapshot.item, -summaryDelta),
    };
  }

  let restored = false;
  const restoreItem = (candidate: PulseItem) => {
    if (candidate.id !== snapshot.item.id) return candidate;
    const result = rollbackPulseItemState(
      candidate,
      snapshot.item,
      action,
      timestamp,
    );
    if (result !== candidate) restored = true;
    return result;
  };
  const items = feed.items.map(restoreItem);
  const activeAnalysisItems = feed.active_analysis_items.map(restoreItem);
  if (!restored) return feed;
  return {
    ...feed,
    items,
    active_analysis_items: activeAnalysisItems,
    summary: adjustPulseSummary(feed.summary, snapshot.item, -summaryDelta),
  };
}

function applyPulseItemState(
  item: PulseItem,
  action: PulseMutationAction,
  timestamp: string,
): PulseItem {
  if (action === "review") {
    return {
      ...item,
      reviewed_at: timestamp,
      state: "reviewed",
      actionable: false,
    };
  }
  if (action === "unreview") {
    return {
      ...item,
      reviewed_at: null,
      state: "seen",
      actionable: isItemActionable(item),
    };
  }
  if (action === "save") return { ...item, saved_at: timestamp };
  if (action === "unsave") return { ...item, saved_at: null };
  return item;
}

function rollbackPulseItemState(
  current: PulseItem,
  previous: PulseItem,
  action: PulseMutationAction,
  timestamp: string,
): PulseItem {
  if (action === "review") {
    if (
      current.reviewed_at !== timestamp ||
      current.state !== "reviewed" ||
      current.actionable
    ) {
      return current;
    }
    return {
      ...current,
      reviewed_at: previous.reviewed_at,
      state: previous.state,
      actionable: previous.actionable,
    };
  }
  if (action === "unreview") {
    if (
      current.reviewed_at !== null ||
      current.state !== "seen" ||
      current.actionable !== isItemActionable(previous)
    ) {
      return current;
    }
    return {
      ...current,
      reviewed_at: previous.reviewed_at,
      state: previous.state,
      actionable: previous.actionable,
    };
  }
  if (action === "save" && current.saved_at === timestamp) {
    return { ...current, saved_at: previous.saved_at };
  }
  if (action === "unsave" && current.saved_at === null) {
    return { ...current, saved_at: previous.saved_at };
  }
  return current;
}

function pulseMutationSummaryDelta(
  item: PulseItem,
  action: PulseMutationAction,
): number {
  if (action === "review" || action === "dismiss" || action === "snooze") {
    return item.actionable ? -1 : 0;
  }
  if (action === "unreview") return isItemActionable(item) ? 1 : 0;
  return 0;
}

function adjustPulseSummary(
  summary: PulseFeedResponse["summary"],
  item: PulseItem,
  delta: number,
): PulseFeedResponse["summary"] {
  if (delta === 0) return summary;
  const counts = { ...summary.counts };
  if (item.kind === "filing") counts.filing = Math.max(0, counts.filing + delta);
  if (item.kind === "analysis" && item.phase !== "active") counts.analysis = Math.max(0, counts.analysis + delta);
  if (item.kind === "question") counts.question = Math.max(0, counts.question + delta);
  if (item.kind === "resurface") counts.resurface = Math.max(0, counts.resurface + delta);
  return {
    ...summary,
    counts,
    actionable_count: Math.max(0, summary.actionable_count + delta),
  };
}

function insertAt(items: PulseItem[], index: number, item: PulseItem) {
  const next = [...items];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
