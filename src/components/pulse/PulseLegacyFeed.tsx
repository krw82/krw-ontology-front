"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import PulseCard from "@/components/pulse/PulseCard";
import { trackClientEventSilently } from "@/lib/analytics/client";
import type {
  PulseFeedResponse,
  PulseFilter,
  PulseItem,
  PulseMutationAction,
} from "@/types/api-contracts";

interface PulseLegacyFeedProps {
  initialFeed: PulseFeedResponse;
}

const FILTERS: Array<{ value: PulseFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "filing", label: "공시" },
  { value: "checkup", label: "체크업" },
  { value: "question", label: "질문" },
  { value: "resurface", label: "다시 보기" },
  { value: "learning", label: "배우기" },
];

/** One-release client fallback paired with `composeLegacyPulseFeed`. */
export default function PulseLegacyFeed({ initialFeed }: PulseLegacyFeedProps) {
  const router = useRouter();
  const [feed, setFeed] = useState(initialFeed);
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [newItemCount, setNewItemCount] = useState(0);
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const generatedAtRef = useRef(initialFeed.generated_at);
  const feedSessionIdRef = useRef(createFeedSessionId());

  useEffect(() => {
    trackClientEventSilently("pulse_viewed", {
      filter: feed.filter,
      feed_surface: "legacy",
      item_count: feed.items.length,
      degraded_sources: feed.source_statuses
        .filter((source) => source.status === "degraded")
        .map((source) => source.source),
    });
  }, []); // The event is for initial legacy surface entry only.

  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible" || loading) return;
      const params = new URLSearchParams({
        filter: feed.filter,
        limit: "1",
        since: generatedAtRef.current,
      });
      const response = await fetch(`/api/pulse?${params}`, {
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) return;
      const next = (await response.json()) as PulseFeedResponse;
      setNewItemCount(next.new_item_count);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const interval = window.setInterval(() => void poll(), 60_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [feed.filter, loading]);

  const degraded = useMemo(
    () => feed.source_statuses.filter((source) => source.status === "degraded"),
    [feed.source_statuses],
  );

  async function fetchFeed(
    filter: PulseFilter,
    cursor?: string | null,
    append = false,
  ) {
    setLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({ filter, limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/pulse?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("feed_failed");
      const next = (await response.json()) as PulseFeedResponse;
      generatedAtRef.current = next.generated_at;
      setFeed((current) =>
        append ? { ...next, items: [...current.items, ...next.items] } : next,
      );
      setNewItemCount(0);
      return next;
    } catch (error) {
      setErrorMessage(
        "피드를 새로 불러오지 못했습니다. 현재 목록은 그대로 유지됩니다.",
      );
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function selectFilter(filter: PulseFilter) {
    if (filter === feed.filter) return;
    trackClientEventSilently("pulse_filter_changed", {
      from: feed.filter,
      to: filter,
      feed_surface: "legacy",
    });
    router.replace(filter === "all" ? "/pulse" : `/pulse?filter=${filter}`, {
      scroll: false,
    });
    await fetchFeed(filter).catch(() => undefined);
  }

  async function mutate(item: PulseItem, action: PulseMutationAction) {
    setPendingIds((current) => new Set(current).add(item.id));
    const previous = feed.items;
    const timestamp = new Date().toISOString();
    if (action === "dismiss" || action === "snooze") {
      setFeed((current) => ({
        ...current,
        items: current.items.filter((candidate) => candidate.id !== item.id),
      }));
    } else {
      setFeed((current) => ({
        ...current,
        items: current.items.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                reviewed_at:
                  action === "review" || action === "read"
                    ? timestamp
                    : action === "unreview" || action === "unread"
                      ? null
                      : candidate.reviewed_at,
                read_at:
                  action === "review" || action === "read"
                    ? timestamp
                    : action === "unreview" || action === "unread"
                      ? null
                      : candidate.read_at,
                saved_at:
                  action === "save"
                    ? timestamp
                    : action === "unsave"
                      ? null
                      : candidate.saved_at,
              }
            : candidate,
        ),
      }));
    }
    const body: { action: PulseMutationAction; snoozed_until?: string } = {
      action,
    };
    if (action === "snooze")
      body.snoozed_until = new Date(
        Date.now() + 24 * 60 * 60 * 1_000,
      ).toISOString();
    const response = await fetch(
      `/api/pulse/items/${encodeURIComponent(item.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ).catch(() => null);
    if (!response?.ok) setFeed((current) => ({ ...current, items: previous }));
    setPendingIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  async function refreshNewItems() {
    trackClientEventSilently("pulse_new_items_seen", {
      item_count: newItemCount,
      feed_surface: "legacy",
    });
    await fetchFeed(feed.filter).catch(() => undefined);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  return (
    <>
      <header className="relative overflow-hidden border-b border-hairline bg-white">
        <div
          className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary-fixed/55 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto w-full max-w-[860px] px-base pb-xl pt-2xl sm:px-xl sm:pb-2xl sm:pt-3xl">
          <div className="flex items-start justify-between gap-lg">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                Research pulse
              </p>
              <h1 className="mt-sm text-[36px] font-black leading-none tracking-[-0.055em] text-ink sm:text-[52px]">
                오늘
              </h1>
              <p className="mt-sm text-[14px] font-semibold text-muted">
                {feed.date_label}
              </p>
            </div>
            <Link
              href="/pulse/settings"
              className="inline-flex size-10 items-center justify-center rounded-[12px] border border-hairline bg-white text-muted shadow-sm hover:text-ink"
              aria-label="Pulse 설정"
            >
              <span
                className="material-symbols-outlined text-[20px]"
                aria-hidden="true"
              >
                tune
              </span>
            </Link>
          </div>
          <p className="mt-lg max-w-[620px] text-[15px] leading-6 text-body">
            중요 공시와 이어서 볼 질문을 한 번에 정리했습니다.
          </p>
          <nav
            className="mt-xl flex gap-xs overflow-x-auto pb-xs"
            aria-label="피드 종류"
          >
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => void selectFilter(filter.value)}
                aria-pressed={feed.filter === filter.value}
                className={`shrink-0 rounded-full px-base py-[9px] text-[13px] font-extrabold transition-colors ${feed.filter === filter.value ? "bg-ink text-white" : "bg-surface-soft text-muted hover:text-ink"}`}
              >
                {filter.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-[860px] px-base py-xl sm:px-xl sm:py-2xl"
      >
        <div
          aria-live="polite"
          className="sticky top-3 z-20 flex justify-center"
        >
          {newItemCount > 0 ? (
            <button
              type="button"
              onClick={() => void refreshNewItems()}
              className="rounded-full bg-primary px-base py-sm text-[13px] font-extrabold text-white shadow-[0_8px_24px_rgba(0,62,199,0.28)]"
            >
              새 항목 {newItemCount}개
            </button>
          ) : null}
        </div>
        {degraded.length > 0 ? (
          <div
            className="mb-base rounded-[12px] border border-[#f3d8a5] bg-[#fff8e9] px-base py-sm text-[12px] leading-5 text-[#76510e]"
            role="status"
          >
            일부 소스를 잠시 불러오지 못했습니다. 나머지 항목은 정상적으로
            표시됩니다.
          </div>
        ) : null}
        {errorMessage ? (
          <div
            className="mb-base flex items-center justify-between gap-base rounded-[12px] border border-[#f0b9b0] bg-[#fff1ef] px-base py-sm text-[12px] leading-5 text-[#8c2f20]"
            role="alert"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => void fetchFeed(feed.filter).catch(() => undefined)}
              className="shrink-0 font-extrabold underline"
            >
              다시 시도
            </button>
          </div>
        ) : null}

        {feed.items.length > 0 ? (
          <div className="relative space-y-base before:absolute before:bottom-8 before:left-[-13px] before:top-8 before:hidden before:w-px before:bg-hairline sm:before:block">
            {feed.items.map((item, index) => (
              <PulseCard
                key={item.id}
                item={item}
                position={index + 1}
                pending={pendingIds.has(item.id)}
                feedSessionId={feedSessionIdRef.current}
                onMutation={mutate}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[18px] border border-dashed border-hairline bg-white px-xl py-3xl text-center">
            <span
              className="material-symbols-outlined text-[34px] text-muted"
              aria-hidden="true"
            >
              done_all
            </span>
            <h2 className="mt-sm text-lg font-black text-ink">
              지금 확인할 항목이 없습니다
            </h2>
            <p className="mt-xs text-sm leading-6 text-muted">
              새 공시가 도착하거나 다시 볼 질문이 생기면 여기에 표시됩니다.
            </p>
          </div>
        )}

        <div className="py-2xl text-center">
          {feed.has_more && feed.next_cursor ? (
            <button
              type="button"
              disabled={loading}
              onClick={() =>
                void fetchFeed(feed.filter, feed.next_cursor, true)
              }
              className="min-h-11 rounded-[12px] border border-hairline bg-white px-lg text-sm font-extrabold text-ink shadow-sm disabled:opacity-50"
            >
              {loading ? "불러오는 중…" : "이전 항목 더 보기"}
            </button>
          ) : (
            <div>
              <p className="text-[13px] font-extrabold text-ink">
                오늘은 여기까지
              </p>
              <p className="mt-xs text-[12px] text-muted">
                끝없이 넘기지 않아도 됩니다.
              </p>
            </div>
          )}
          <div className="mx-auto mt-xl flex max-w-[360px] items-center justify-center gap-sm border-t border-hairline pt-base">
            {feedback ? (
              <p className="text-[12px] font-semibold text-muted">
                의견을 반영해 피드를 다듬겠습니다.
              </p>
            ) : (
              <>
                <p className="mr-xs text-[12px] font-semibold text-muted">
                  오늘 피드가 도움됐나요?
                </p>
                {(["helpful", "not_helpful"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setFeedback(value);
                      trackClientEventSilently("pulse_feedback_submitted", {
                        feedback: value,
                        surface: "legacy_pulse",
                      });
                    }}
                    className="grid size-9 place-items-center rounded-full border border-hairline bg-white text-muted hover:text-ink"
                    aria-label={
                      value === "helpful" ? "도움됐어요" : "도움되지 않았어요"
                    }
                  >
                    <span
                      className="material-symbols-outlined text-[18px]"
                      aria-hidden="true"
                    >
                      {value === "helpful" ? "thumb_up" : "thumb_down"}
                    </span>
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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000000";
}
