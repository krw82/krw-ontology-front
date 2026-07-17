"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActiveAnalysisPulseCard from "@/components/pulse/ActiveAnalysisPulseCard";
import InsiderTradeStackCard from "@/components/pulse/InsiderTradeStackCard";
import PulseCard from "@/components/pulse/PulseCard";
import PulseSummaryBar from "@/components/pulse/PulseSummaryBar";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { buildPulseFeedDisplayEntries } from "@/lib/pulse/insider-trade-stack";
import type {
  PulseFeedResponse,
  PulseFeedStatusResponse,
  PulseItem,
  PulseMutationAction,
} from "@/types/api-contracts";

interface PulseFeedProps {
  initialFeed: PulseFeedResponse;
}

const PAGE_SIZE = 20;
const MAX_DUPLICATE_FILL_ATTEMPTS = 3;

export default function PulseFeed({ initialFeed }: PulseFeedProps) {
  const [feed, setFeed] = useState(initialFeed);
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [newItemCount, setNewItemCount] = useState(0);
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedSessionId] = useState(createFeedSessionId);
  const [activeAnalysisCount, setActiveAnalysisCount] = useState(initialFeed.summary.active_analysis_count);
  const generatedAtRef = useRef(initialFeed.generated_at);
  const requestInFlightRef = useRef(false);

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

  const fetchFirstPage = useCallback(async () => {
    if (requestInFlightRef.current) return null;
    requestInFlightRef.current = true;
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/pulse?${new URLSearchParams({ filter: "all", limit: String(PAGE_SIZE) })}`, { cache: "no-store" });
      if (!response.ok) throw new Error("feed_failed");
      const next = await response.json() as PulseFeedResponse;
      generatedAtRef.current = next.generated_at;
      setFeed(next);
      setActiveAnalysisCount(next.summary.active_analysis_count);
      setNewItemCount(0);
      return next;
    } catch {
      setErrorMessage("피드를 새로 불러오지 못했습니다. 현재 목록은 그대로 유지됩니다.");
      return null;
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (requestInFlightRef.current || !feed.next_cursor) return;
    requestInFlightRef.current = true;
    setLoading(true);
    setErrorMessage(null);
    try {
      let cursor: string | null = feed.next_cursor;
      let nextFeed: PulseFeedResponse | null = null;
      const existingIds = new Set(feed.items.map((item) => item.id));
      const additions: PulseItem[] = [];

      for (let attempt = 0; cursor && attempt < MAX_DUPLICATE_FILL_ATTEMPTS && additions.length < PAGE_SIZE; attempt += 1) {
        const params = new URLSearchParams({ filter: "all", limit: String(PAGE_SIZE), cursor });
        const response = await fetch(`/api/pulse?${params}`, { cache: "no-store" });
        if (response.status === 409) {
          requestInFlightRef.current = false;
          setLoading(false);
          await fetchFirstPage();
          return;
        }
        if (!response.ok) throw new Error("feed_failed");
        const page = await response.json() as PulseFeedResponse;
        nextFeed = page;
        for (const item of page.items) {
          if (!existingIds.has(item.id)) {
            existingIds.add(item.id);
            additions.push(item);
          }
        }
        cursor = page.next_cursor;
      }

      if (nextFeed) {
        setActiveAnalysisCount(nextFeed.summary.active_analysis_count);
        setFeed((current) => ({
          ...nextFeed,
          items: [...current.items, ...additions],
        }));
      }
    } catch {
      setErrorMessage("이전 활동을 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  }, [feed.items, feed.next_cursor, fetchFirstPage]);

  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible" || requestInFlightRef.current) return;
      const params = new URLSearchParams({ since: generatedAtRef.current });
      const response = await fetch(`/api/pulse/status?${params}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const next = await response.json() as PulseFeedStatusResponse;
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
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const interval = window.setInterval(() => void poll(), hasActiveAnalysis ? 30_000 : 120_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasActiveAnalysis]);

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
    setPendingIds((current) => new Set(current).add(item.id));
    const previous = feed;
    const previousActiveAnalysisCount = activeAnalysisCount;
    const timestamp = new Date().toISOString();
    if (action === "dismiss" || action === "snooze") {
      setFeed((current) => ({
        ...current,
        items: current.items.filter((candidate) => candidate.id !== item.id),
        active_analysis_items: current.active_analysis_items.filter((candidate) => candidate.id !== item.id),
        summary: action === "dismiss" || item.actionable
          ? decrementSummary(current, item)
          : current.summary,
      }));
    } else {
      setFeed((current) => ({
        ...current,
        items: current.items.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          reviewed_at: action === "review" ? timestamp : action === "unreview" ? null : candidate.reviewed_at,
          read_at: action === "review" ? timestamp : action === "unreview" ? null : candidate.read_at,
          state: action === "review" ? "reviewed" : action === "unreview" ? "seen" : candidate.state,
          actionable: action === "review" ? false : action === "unreview" ? isItemActionable(candidate) : candidate.actionable,
          saved_at: action === "save" ? timestamp : action === "unsave" ? null : candidate.saved_at,
        } : candidate),
        active_analysis_items: current.active_analysis_items.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          reviewed_at: action === "review" ? timestamp : action === "unreview" ? null : candidate.reviewed_at,
          read_at: action === "review" ? timestamp : action === "unreview" ? null : candidate.read_at,
          state: action === "review" ? "reviewed" : action === "unreview" ? "seen" : candidate.state,
          actionable: action === "review" ? false : action === "unreview" ? isItemActionable(candidate) : candidate.actionable,
          saved_at: action === "save" ? timestamp : action === "unsave" ? null : candidate.saved_at,
        } : candidate),
        summary: action === "review" ? decrementSummary(current, item) : action === "unreview" ? incrementSummary(current, item) : current.summary,
      }));
    }

    const body: { action: PulseMutationAction; snoozed_until?: string } = { action };
    if (action === "snooze") body.snoozed_until = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const response = await fetch(`/api/pulse/items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response?.ok) {
      setFeed(previous);
      setActiveAnalysisCount(previousActiveAnalysisCount);
    }
    setPendingIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
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
            <Link href="/pulse/settings" className="inline-flex size-10 items-center justify-center rounded-[12px] border border-hairline bg-white text-muted shadow-sm hover:text-ink" aria-label="피드 설정">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">tune</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[760px] px-base py-lg sm:px-xl sm:py-xl">
        <div aria-live="polite" className="sticky top-3 z-20 flex justify-center">
          {newItemCount > 0 ? (
            <button type="button" onClick={() => void refreshNewItems()} className="rounded-full bg-primary px-base py-sm text-[13px] font-extrabold text-white shadow-[0_8px_24px_rgba(0,62,199,0.28)]">
              새로 들어온 {newItemCount}개
            </button>
          ) : null}
        </div>

        {degraded.length > 0 ? (
          <div className="mb-base flex items-center justify-between gap-base rounded-[12px] border border-[#f3d8a5] bg-[#fff8e9] px-base py-sm text-[12px] leading-5 text-[#76510e]" role="status">
            <span>일부 리서치 항목을 아직 불러오지 못했습니다. 현재 목록은 보존되며 다시 시도할 수 있습니다.</span>
            <button type="button" onClick={() => void fetchFirstPage()} className="shrink-0 font-extrabold underline">다시 시도</button>
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-base flex items-center justify-between gap-base rounded-[12px] border border-[#f0b9b0] bg-[#fff1ef] px-base py-sm text-[12px] leading-5 text-[#8c2f20]" role="alert">
            <span>{errorMessage}</span>
            <button type="button" onClick={() => void fetchFirstPage()} className="shrink-0 font-extrabold underline">다시 시도</button>
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
                type="button"
                onClick={() => void fetchFirstPage()}
                className="flex w-full items-center justify-between gap-base rounded-[14px] border border-[#d9d7ff] bg-[#fbfbff] px-base py-base text-left text-[13px] font-extrabold text-[#4338ca]"
              >
                <span>진행 중인 분석 {activeAnalysisCount}개를 불러오기</span>
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
                <div key={entry.id}>
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
                      onMutation={mutate}
                    />
                  ) : (
                    <PulseCard item={entry.item} position={entry.position} pending={pendingIds.has(entry.item.id)} feedSessionId={feedSessionId} rankingVersion={feed.ranking_version} onMutation={mutate} />
                  )}
                </div>
              );
            })}
          </div>
        ) : visibleActiveAnalysisItems.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-hairline bg-white px-xl py-3xl text-center">
            <span className="material-symbols-outlined text-[34px] text-muted" aria-hidden="true">done_all</span>
            <h2 className="mt-sm text-lg font-black text-ink">{degraded.length > 0 ? "신호를 준비하는 중입니다" : "지금 확인할 신호가 없습니다"}</h2>
            <p className="mt-xs text-sm leading-6 text-muted">{degraded.length > 0 ? "잠시 후 다시 시도하면 최신 공시와 분석 상태를 불러옵니다." : "새 공시나 내가 시작한 분석 상태가 생기면 여기에 표시됩니다."}</p>
            <div className="mt-lg flex flex-wrap justify-center gap-sm">
              <Link href="/filings" className="rounded-[10px] bg-ink px-base py-sm text-[13px] font-extrabold text-white">공시 알림 기업 추가</Link>
              <Link href="/watchlist" className="rounded-[10px] px-base py-sm text-[13px] font-extrabold text-primary hover:bg-primary-fixed/60">리서치 노트북 열기</Link>
            </div>
          </div>
        ) : null}

        <div className="py-2xl text-center" aria-live="polite">
          {feed.has_more && feed.next_cursor ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadMore()}
              className="min-h-11 rounded-[12px] border border-hairline bg-white px-lg text-sm font-extrabold text-ink shadow-sm disabled:opacity-50"
            >
              {loading ? "불러오는 중…" : "이전 활동 더 보기"}
            </button>
          ) : (
            <div>
              <p className="text-[13px] font-extrabold text-ink">확인한 활동은 여기까지입니다</p>
              <p className="mt-xs text-[12px] text-muted">새 공시나 내가 시작한 분석이 생기면 위에 추가됩니다.</p>
            </div>
          )}
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
                    className="grid size-9 place-items-center rounded-full border border-hairline bg-white text-muted hover:text-ink"
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

function decrementSummary(current: PulseFeedResponse, item: PulseItem): PulseFeedResponse["summary"] {
  if (!item.actionable) return current.summary;
  const counts = { ...current.summary.counts };
  if (item.kind === "filing") counts.filing = Math.max(0, counts.filing - 1);
  if (item.kind === "analysis" && item.phase !== "active") counts.analysis = Math.max(0, counts.analysis - 1);
  if (item.kind === "question") counts.question = Math.max(0, counts.question - 1);
  if (item.kind === "resurface") counts.resurface = Math.max(0, counts.resurface - 1);
  return { ...current.summary, counts, actionable_count: Math.max(0, current.summary.actionable_count - 1) };
}

function incrementSummary(current: PulseFeedResponse, item: PulseItem): PulseFeedResponse["summary"] {
  if (!isItemActionable(item)) return current.summary;
  const counts = { ...current.summary.counts };
  if (item.kind === "filing") counts.filing += 1;
  if (item.kind === "analysis" && item.phase !== "active") counts.analysis += 1;
  if (item.kind === "question") counts.question += 1;
  if (item.kind === "resurface") counts.resurface += 1;
  return { ...current.summary, counts, actionable_count: current.summary.actionable_count + 1 };
}
