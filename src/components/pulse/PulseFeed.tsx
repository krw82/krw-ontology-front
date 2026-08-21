"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetStateAction, TouchEvent } from "react";
import CompanyLogo from "@/components/CompanyLogo";
import InsiderTradeStackCard from "@/components/pulse/InsiderTradeStackCard";
import PulseCard from "@/components/pulse/PulseCard";
import PulsePushPrimingBanner from "@/components/pulse/PulsePushPrimingBanner";
import WatchlistStoryTray from "@/components/pulse/WatchlistStoryTray";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { easeOutExpo } from "@/lib/animation";
import { anonymousResearchLoginHref } from "@/lib/pulse/anonymous-research-login";
import { pulseCompanyHref, pulseCompanyName } from "@/lib/pulse/company-display";
import {
  advancePulseDeviceRefresh,
  applyPulseDeviceSignal,
  bindPulseDeviceProfileToDevice,
  createPulseDeviceProfile,
  selectDevicePulseSlate,
  type PulseDeviceProfile,
  type PulseDeviceSignal,
} from "@/lib/pulse/device-ranking";
import { getOrCreatePulseDeviceId } from "@/lib/pulse/device-identity";
import {
  buildPulseFeedViewMetrics,
  pulseViewProperties,
} from "@/lib/pulse/feed-metrics";
import { buildPulseFeedDisplayEntries } from "@/lib/pulse/insider-trade-stack";
import type { FirstValueIntent } from "@/lib/onboarding/first-value";
import { saveOfflinePulseSnapshot } from "@/lib/pwa/offline-read-model";
import {
  readDevicePulseSnapshot,
  readDevicePulseProfile,
  saveDevicePulseSnapshot,
  saveDevicePulseProfile,
} from "@/lib/pwa/device-cache";
import type {
  PulseFeedDeltaResponse,
  PulseFeedResponse,
  PulseFeedRefreshSummary,
  PulseFeedStatusResponse,
  PulseItem,
  PulseMutationAction,
} from "@/types/api-contracts";

interface PulseFeedProps {
  initialFeed: PulseFeedResponse;
  draftOwnerId: string;
  loadInitialFeed?: boolean;
  firstValueEntry?: boolean;
  onboardingIntent?: FirstValueIntent | null;
}

const PAGE_SIZE = 48;
const PULL_REFRESH_TRIGGER = 64;
const PULL_DISTANCE_MAX = 96;
const EMPTY_REFRESH_SUMMARY: PulseFeedRefreshSummary = {
  added_candidate_count: 0,
  updated_item_count: 0,
  removed_item_count: 0,
};

type PulseRefreshOrigin = "manual" | "pull" | "recovery";

interface PulseRefreshResult {
  changed: boolean;
  generatedAt: string;
  mode: "delta" | "full";
  summary: PulseFeedRefreshSummary;
}

function isUnavailablePulseFeed(feed: PulseFeedResponse): boolean {
  return (
    feed.revision === "unavailable" &&
    feed.candidate_items.length === 0 &&
    feed.active_analysis_items.length === 0 &&
    feed.source_statuses.some((source) => source.status === "degraded")
  );
}

function needsFullPulseRefresh(feed: PulseFeedResponse): boolean {
  return isUnavailablePulseFeed(feed)
    || feed.source_statuses.some((source) => source.status === "degraded");
}

export default function PulseFeed({
  initialFeed,
  draftOwnerId,
  loadInitialFeed = false,
  firstValueEntry = false,
  onboardingIntent = null,
}: PulseFeedProps) {
  const reducedMotion = useReducedMotion();
  const [feed, setFeedState] = useState(initialFeed);
  const feedRef = useRef(initialFeed);
  const [deviceProfile, setDeviceProfile] = useState<PulseDeviceProfile>(() =>
    createPulseDeviceProfile(),
  );
  const deviceProfileRef = useRef(deviceProfile);
  const [loading, setLoading] = useState(false);
  const [initialFeedLoading, setInitialFeedLoading] = useState(
    () => loadInitialFeed && isUnavailablePulseFeed(initialFeed),
  );
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [feedSessionId] = useState(createFeedSessionId);
  const mountedRef = useRef(true);
  const firstPageControllerRef = useRef<AbortController | null>(null);
  const statusControllerRef = useRef<AbortController | null>(null);
  const firstPageRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const pendingMutationIdsRef = useRef<Set<string>>(new Set());
  const pulseViewTrackedRef = useRef(false);
  const degradedSourcesTrackedRef = useRef<Set<string>>(new Set());
  const researchActivityFocusConsumedRef = useRef(false);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const [researchActivityFocused, setResearchActivityFocused] = useState(false);
  const [researchActivityFocusRequested, setResearchActivityFocusRequested] = useState(false);
  const [researchPendingIds, setResearchPendingIds] = useState<Set<string>>(new Set());
  const researchPendingIdsRef = useRef<Set<string>>(new Set());

  const setFeed = useCallback((nextState: SetStateAction<PulseFeedResponse>) => {
    const nextFeed =
      typeof nextState === "function"
        ? nextState(feedRef.current)
        : nextState;
    feedRef.current = nextFeed;
    setFeedState(nextFeed);
  }, []);

  const setLocalProfile = useCallback((next: PulseDeviceProfile) => {
    deviceProfileRef.current = next;
    setDeviceProfile(next);
  }, []);

  const recordDeviceSignal = useCallback((item: PulseItem, signal: PulseDeviceSignal) => {
    const next = applyPulseDeviceSignal(deviceProfileRef.current, item, signal);
    setLocalProfile(next);
    void saveDevicePulseProfile(draftOwnerId, next).catch(() => undefined);
  }, [draftOwnerId, setLocalProfile]);

  const advanceDeviceRefresh = useCallback((visibleItemIds: readonly string[]) => {
    const current = deviceProfileRef.current;
    const next = advancePulseDeviceRefresh(current, visibleItemIds);
    if (next.refresh_generation === current.refresh_generation) return null;
    setLocalProfile(next);
    void saveDevicePulseProfile(draftOwnerId, next).catch(() => undefined);
    return next;
  }, [draftOwnerId, setLocalProfile]);

  const cancelStatusRequest = useCallback(() => {
    statusRequestIdRef.current += 1;
    statusControllerRef.current?.abort();
    statusControllerRef.current = null;
  }, []);

  const slate = useMemo(
    () => selectDevicePulseSlate(feed, deviceProfile),
    [deviceProfile, feed],
  );
  const activeResearchItems = useMemo(
    () => feed.active_analysis_items.filter(
      (item) => item.kind === "analysis" && item.phase === "active",
    ),
    [feed.active_analysis_items],
  );
  const completedAnalysisItems = useMemo(
    () => (feed.completed_analysis_items ?? []).filter(
      (item) => item.kind === "analysis" && item.phase === "completed",
    ),
    [feed.completed_analysis_items],
  );
  const activeResearchIds = useMemo(
    () => new Set(activeResearchItems.map((item) => item.id)),
    [activeResearchItems],
  );
  const completedAnalysisIds = useMemo(
    () => new Set(completedAnalysisItems.map((item) => item.id)),
    [completedAnalysisItems],
  );
  const hasActiveAnalysis = activeResearchItems.length > 0;
  const hasCompletedAnalysis = completedAnalysisItems.length > 0;
  const feedItems = useMemo(
    () => slate.items.filter(
      (item) => !activeResearchIds.has(item.id) && !completedAnalysisIds.has(item.id),
    ),
    [activeResearchIds, completedAnalysisIds, slate.items],
  );
  const displayEntries = useMemo(
    () => buildPulseFeedDisplayEntries(feedItems, feed.timezone, feed.visible_limit),
    [feed.visible_limit, feedItems, feed.timezone],
  );
  const displayMetrics = useMemo(
    () => buildPulseFeedViewMetrics(displayEntries, feedItems),
    [displayEntries, feedItems],
  );
  const degraded = useMemo(
    () => feed.source_statuses.filter((source) => source.status === "degraded"),
    [feed.source_statuses],
  );
  const feedBusy = loading || pendingIds.size > 0;
  const feedUnavailable = isUnavailablePulseFeed(feed);
  const showDegradedNotice = !initialFeedLoading && !feedUnavailable && degraded.length > 0;
  const showInitialLoadFailure = !initialFeedLoading && feedUnavailable && errorMessage !== null;
  const showSyncIndicator = loading && !initialFeedLoading && !feedUnavailable;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasHashFocusRequest = window.location.hash === "#research-activity";
    if (
      (hasHashFocusRequest && researchActivityFocusConsumedRef.current)
      || (!hasHashFocusRequest && !researchActivityFocusRequested)
      || (!hasActiveAnalysis && !hasCompletedAnalysis)
    ) {
      return;
    }
    const target = document.getElementById("research-activity");
    if (!target) return;

    if (hasHashFocusRequest) researchActivityFocusConsumedRef.current = true;
    let focusResetTimer: number | null = null;
    const focusTimer = window.setTimeout(() => {
      target.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
      setResearchActivityFocused(true);
      if (!hasHashFocusRequest) setResearchActivityFocusRequested(false);
      focusResetTimer = window.setTimeout(
        () => setResearchActivityFocused(false),
        reducedMotion ? 0 : 1_400,
      );
      if (hasHashFocusRequest) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      if (focusResetTimer !== null) window.clearTimeout(focusResetTimer);
    };
  }, [hasActiveAnalysis, hasCompletedAnalysis, reducedMotion, researchActivityFocusRequested]);

  useEffect(() => {
    // The server intentionally renders an unavailable shell and the first
    // usable slate arrives asynchronously. Do not record that empty shell as
    // a viewed feed; it made production `item_count` appear as zero.
    if (initialFeedLoading || feedUnavailable || pulseViewTrackedRef.current) return;
    const degradedSources = feed.source_statuses
      .filter((source) => source.status === "degraded")
      .map((source) => source.source);
    trackClientEventSilently("pulse_viewed", pulseViewProperties(feed, displayMetrics, {
      feedSessionId,
      entry: firstValueEntry ? "first_value" : null,
      onboardingIntent,
      degradedSources,
      storyContext: slate.story_context,
    }));
    pulseViewTrackedRef.current = true;

    for (const source of degradedSources) {
      if (degradedSourcesTrackedRef.current.has(source)) continue;
      degradedSourcesTrackedRef.current.add(source);
      trackClientEventSilently("pulse_source_degraded", { source });
    }
  }, [displayMetrics, feed, feedSessionId, feedUnavailable, firstValueEntry, initialFeedLoading, onboardingIntent, slate.story_context]);

  useEffect(() => {
    void saveOfflinePulseSnapshot(feed).catch(() => undefined);
    void saveDevicePulseSnapshot(draftOwnerId, feed).catch(() => undefined);
  }, [draftOwnerId, feed]);

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
      const current = feedRef.current;
      const response = await fetch(
        `/api/pulse?${new URLSearchParams({ filter: "all", limit: String(PAGE_SIZE) })}`,
        {
          cache: "no-store",
          signal: controller.signal,
          headers: needsFullPulseRefresh(current)
            ? undefined
            : { "If-None-Match": `"${current.revision}"` },
        },
      );
      if (response.status === 304) {
        return {
          changed: false,
          generatedAt: current.generated_at,
          mode: "full" as const,
          summary: EMPTY_REFRESH_SUMMARY,
        };
      }
      if (!response.ok) throw new Error("feed_failed");
      const next = await response.json() as PulseFeedResponse;
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== firstPageRequestIdRef.current
      ) {
        return null;
      }
      setFeed(next);
      return {
        changed: true,
        generatedAt: next.generated_at,
        mode: "full" as const,
        summary: buildFullPulseRefreshSummary(current, next),
      };
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

  const fetchDelta = useCallback(async () => {
    if (firstPageControllerRef.current || pendingMutationIdsRef.current.size > 0) {
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
      const current = feedRef.current;
      const response = await fetch("/api/pulse/delta", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: current.revision,
          item_versions: current.item_versions,
        }),
      });
      if (!response.ok) throw new Error("pulse_delta_failed");
      const delta = await response.json() as PulseFeedDeltaResponse;
      if (
        !mountedRef.current
        || controller.signal.aborted
        || requestId !== firstPageRequestIdRef.current
      ) return null;
      setFeed((existing) => applyPulseFeedDelta(existing, delta));
      return {
        changed: delta.changed,
        generatedAt: delta.generated_at,
        mode: "delta" as const,
        // A stale cached client can briefly meet a server from the prior
        // release during a rolling deploy. The sync itself is still valid.
        summary: delta.refresh_summary ?? EMPTY_REFRESH_SUMMARY,
      };
    } catch (error) {
      if (isAbortError(error) || !mountedRef.current || requestId !== firstPageRequestIdRef.current) {
        return null;
      }
      setErrorMessage(
        navigator.onLine
          ? "피드 변경사항을 불러오지 못했습니다. 현재 목록은 그대로 유지됩니다."
          : "오프라인 상태입니다. 연결되면 다시 동기화합니다.",
      );
      return null;
    } finally {
      if (firstPageControllerRef.current === controller) {
        firstPageControllerRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [cancelStatusRequest, setFeed]);

  const startResearch = useCallback(async (item: PulseItem) => {
    if (!item.ticker || researchPendingIdsRef.current.has(item.id)) return;

    researchPendingIdsRef.current.add(item.id);
    setResearchPendingIds((current) => new Set(current).add(item.id));

    try {
      const response = await fetch("/api/chat/run", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          "X-KRW-Locale": "ko-KR",
        },
        body: JSON.stringify({
          content: `${item.ticker} ${item.title}의 투자 관점과 근거를 확인해줘`,
          request_id: createFeedSessionId(),
          research_mode: "standard",
          analysis_mode: "standard",
          run_kind: "company_research",
          scope_type: "company",
          default_tickers: [item.ticker],
          default_document_types: [],
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href
            = anonymousResearchLoginHref(item)
              ?? `/login?next=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        throw new Error(`research request failed: ${response.status}`);
      }

      await response.body?.cancel();
      setResearchActivityFocusRequested(true);
      void fetchDelta();
      window.setTimeout(() => void fetchDelta(), 600);
      window.setTimeout(() => void fetchDelta(), 1_600);
      window.setTimeout(() => {
        researchPendingIdsRef.current.delete(item.id);
        setResearchPendingIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }, 1_800);
    } catch {
      researchPendingIdsRef.current.delete(item.id);
      setResearchPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setErrorMessage("리서치를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  }, [fetchDelta]);

  const refreshFeed = useCallback(async (
    origin: PulseRefreshOrigin,
    options: { scrollToTop?: boolean } = {},
  ): Promise<PulseRefreshResult | null> => {
    if (feedBusy || pullRefreshing || initialFeedLoading) return null;

    const userInitiated = isUserInitiatedPulseRefresh(origin);
    // Capture the rendered ordinary cards before the request. A successful
    // manual refresh records this local window and then chooses up to three
    // replacements from the server-authorized reservoir.
    const previousSlate = slate;
    const startedAt = performance.now();
    if (origin === "pull") setPullRefreshing(true);
    if (userInitiated) {
      trackClientEventSilently("pulse_refresh_requested", {
        origin,
        online: navigator.onLine,
        ranking_version: feedRef.current.ranking_version,
        story_context: previousSlate.story_context,
      });
    }

    try {
      const result = needsFullPulseRefresh(feedRef.current)
        ? await fetchFirstPage()
        : await fetchDelta();
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (!result) {
        if (userInitiated) {
          trackClientEventSilently("pulse_refresh_failed", {
            origin,
            error_category: navigator.onLine ? "request_failed" : "offline",
            ranking_version: feedRef.current.ranking_version,
            duration_ms: durationMs,
          });
        }
        return null;
      }

      if (userInitiated) {
        const previousGeneration = deviceProfileRef.current.refresh_generation;
        const nextProfile = advanceDeviceRefresh(previousSlate.refreshable_item_ids);
        const nextSlate = nextProfile
          ? selectDevicePulseSlate(feedRef.current, nextProfile)
          : null;
        trackClientEventSilently("pulse_refresh_completed", {
          origin,
          outcome: result.changed ? "changed" : "unchanged",
          mode: result.mode,
          added_candidate_count: result.summary.added_candidate_count,
          updated_item_count: result.summary.updated_item_count,
          removed_item_count: result.summary.removed_item_count,
          ranking_version: feedRef.current.ranking_version,
          refresh_generation_before: previousGeneration,
          refresh_generation_after: nextProfile?.refresh_generation ?? previousGeneration,
          ordinary_visible_count: nextSlate?.refresh.ordinary_visible_count ?? 0,
          retained_ordinary_count: nextSlate?.refresh.retained_ordinary_count ?? 0,
          replacement_ordinary_count: nextSlate?.refresh.replacement_ordinary_count ?? 0,
          cooldown_relaxed_count: nextSlate?.refresh.cooldown_relaxed_count ?? 0,
          refresh_mode: nextSlate?.refresh.mode ?? "none",
          anchor_rebased: nextSlate?.refresh.anchor_rebased ?? false,
          story_context: nextSlate?.story_context ?? "none",
          duration_ms: durationMs,
        });
        // Passive polling and ordinary card impressions never reflow the
        // slate underneath the user. A viewed story may still release its
        // anchor on this explicit generation boundary.
      }
      if (options.scrollToTop && result.changed) {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      }
      return result;
    } finally {
      if (origin === "pull" && mountedRef.current) setPullRefreshing(false);
    }
  }, [advanceDeviceRefresh, feedBusy, fetchDelta, fetchFirstPage, initialFeedLoading, pullRefreshing, slate]);

  const refreshFromPull = useCallback(async () => {
    await refreshFeed("pull");
  }, [refreshFeed]);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    if (feedBusy || pullRefreshing || initialFeedLoading || window.scrollY > 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button,a,input,textarea,select")) return;
    const touch = event.touches[0];
    if (!touch) return;
    pullStartYRef.current = touch.clientY;
    pullDistanceRef.current = 0;
  }, [feedBusy, initialFeedLoading, pullRefreshing]);

  const handleTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const startY = pullStartYRef.current;
    if (startY === null) return;
    if (window.scrollY > 0) {
      pullStartYRef.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    const delta = touch.clientY - startY;
    if (delta <= 0) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }
    const distance = Math.min(PULL_DISTANCE_MAX, delta * 0.45);
    pullDistanceRef.current = distance;
    setPullDistance(distance);
  }, []);

  const resetPullGesture = useCallback(() => {
    pullStartYRef.current = null;
    pullDistanceRef.current = 0;
    setPullDistance(0);
  }, []);

  const handleTouchEnd = useCallback(() => {
    const shouldRefresh = pullDistanceRef.current >= PULL_REFRESH_TRIGGER;
    resetPullGesture();
    if (shouldRefresh) void refreshFromPull();
  }, [refreshFromPull, resetPullGesture]);

  const handleTouchCancel = useCallback(() => {
    resetPullGesture();
  }, [resetPullGesture]);

  const pollStatus = useCallback(async () => {
    if (
      document.visibilityState !== "visible" ||
      !navigator.onLine ||
      firstPageControllerRef.current ||
      isUnavailablePulseFeed(feedRef.current)
    ) {
      return;
    }

    cancelStatusRequest();
    const controller = new AbortController();
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    statusControllerRef.current = controller;
    try {
      const params = new URLSearchParams({ revision: feedRef.current.revision });
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
      if (next.changed) {
        // A status result only says that the private feed revision changed.
        // Reconcile it immediately so research completion moves from the active
        // rail to the completed rail without a separate user confirmation.
        if (needsFullPulseRefresh(feedRef.current)) {
          await fetchFirstPage();
        } else {
          await fetchDelta();
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        // Background status refreshes stay silent. User-initiated requests surface errors.
      }
    } finally {
      if (statusControllerRef.current === controller) {
        statusControllerRef.current = null;
      }
    }
  }, [cancelStatusRequest, fetchDelta, fetchFirstPage]);

  useEffect(() => {
    if (!loadInitialFeed) return;
    let active = true;
    void (async () => {
      const deviceId = getOrCreatePulseDeviceId();
      const [snapshot, profile] = await Promise.all([
        readDevicePulseSnapshot(draftOwnerId).catch(() => null),
        readDevicePulseProfile(draftOwnerId).catch(() => createPulseDeviceProfile()),
      ]);
      if (!active) return;
      const boundProfile = bindPulseDeviceProfileToDevice(profile, deviceId);
      setLocalProfile(boundProfile);
      void saveDevicePulseProfile(draftOwnerId, boundProfile).catch(() => undefined);
      if (snapshot && isUnavailablePulseFeed(feedRef.current)) {
        setFeed(snapshot.feed);
        // Cached cards are useful immediately. Keep them visible while the
        // following revision check fetches only any changed cards.
        setInitialFeedLoading(false);
      }
      if (!active) return;
      if (needsFullPulseRefresh(feedRef.current)) {
        await fetchFirstPage();
      } else {
        await pollStatus();
      }
      if (active) setInitialFeedLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [draftOwnerId, fetchFirstPage, loadInitialFeed, pollStatus, setFeed, setLocalProfile]);

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
    let saved = false;
    try {
      const response = await fetch(`/api/pulse/items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("pulse_mutation_failed");
      saved = true;
      recordDeviceSignal(item, action);
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
      // The optimistic card is already correct for the action the user took,
      // but the database revision has advanced. Reconcile it immediately so
      // the device snapshot and the next status check share one revision.
      if (saved) void fetchDelta();
    }
  }

  return (
    <>
      <header className="relative overflow-hidden border-b border-hairline bg-white">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary-fixed/55 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[760px] px-base py-base sm:px-xl sm:py-lg">
          <div className="flex items-center justify-between gap-lg">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Research feed</p>
              <h1 className="mt-xs text-[32px] font-black leading-none tracking-[-0.05em] text-ink sm:text-[40px]">피드</h1>
            </div>
            <div className="flex items-center gap-xs">
              <button
                aria-busy={feedBusy || pullRefreshing}
                aria-label="피드 새로고침"
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-[12px] border border-hairline bg-white px-sm text-[13px] font-extrabold text-muted shadow-sm transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                disabled={feedBusy || pullRefreshing || initialFeedLoading}
                onClick={() => void refreshFeed("manual")}
                title="피드 새로고침"
                type="button"
              >
                <span className={`material-symbols-outlined text-[20px] ${loading || pullRefreshing ? "pulse-refresh-turn" : ""}`} aria-hidden="true">refresh</span>
                <span className="hidden sm:inline">새로고침</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-[760px] px-base py-lg sm:px-xl sm:py-xl"
        onTouchCancel={handleTouchCancel}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
      >
        <p aria-live="polite" className="sr-only" role="status">
          {loading
            ? "피드를 불러오는 중입니다."
            : pendingIds.size > 0
              ? `${pendingIds.size}개 항목의 변경을 저장하는 중입니다.`
              : ""}
        </p>
        {hasActiveAnalysis || hasCompletedAnalysis ? (
          <ResearchActivityRail
            activeItems={activeResearchItems}
            completedItems={completedAnalysisItems}
            focused={researchActivityFocused}
            feedSessionId={feedSessionId}
            rankingVersion={feed.ranking_version}
            onMutation={mutate}
            onDeviceSignal={recordDeviceSignal}
            reducedMotion={reducedMotion}
          />
        ) : null}
        {firstValueEntry ? (
          <FirstValuePulseContext intent={onboardingIntent} />
        ) : null}
        <WatchlistStoryTray />
        <PulsePushPrimingBanner />
        <div
          aria-hidden={pullDistance === 0 && !pullRefreshing}
          aria-live="polite"
          className="pointer-events-none flex items-center justify-center gap-xs overflow-hidden text-[12px] font-semibold text-muted transition-[height,opacity] duration-150"
          role="status"
          style={{
            height: pullRefreshing ? 40 : pullDistance,
            opacity: pullRefreshing || pullDistance > 0 ? 1 : 0,
          }}
        >
          <span className={`material-symbols-outlined text-[16px] ${pullRefreshing ? "pulse-refresh-turn" : ""}`} aria-hidden="true">
            {pullRefreshing ? "progress_activity" : pullDistance >= PULL_REFRESH_TRIGGER ? "refresh" : "south"}
          </span>
          {pullRefreshing
            ? "최신 내용 확인 중"
            : pullDistance >= PULL_REFRESH_TRIGGER
              ? "놓으면 새로고침"
              : "당겨서 새로고침"}
        </div>
        {initialFeedLoading ? (
          <PulseFeedLoadingSkeleton />
        ) : (
          <>
            {showDegradedNotice || showInitialLoadFailure ? (
              <div className="mb-base flex items-center justify-between gap-base rounded-[12px] border border-[#f3d8a5] bg-[#fff8e9] px-base py-sm text-[12px] leading-5 text-[#76510e]" role="alert">
                <span>{showInitialLoadFailure ? errorMessage : "일부 리서치 항목을 아직 불러오지 못했습니다. 현재 목록은 보존되며 다시 시도할 수 있습니다."}</span>
                <button aria-busy={feedBusy} className="inline-flex min-h-11 shrink-0 items-center px-xs font-extrabold underline disabled:cursor-not-allowed disabled:opacity-60" disabled={feedBusy} type="button" onClick={() => void refreshFeed("recovery")}>{loading ? "불러오는 중…" : "다시 시도"}</button>
              </div>
            ) : null}
            {errorMessage && !showInitialLoadFailure ? (
              <div className="mb-base flex items-center justify-between gap-base rounded-[12px] border border-[#f0b9b0] bg-[#fff1ef] px-base py-sm text-[12px] leading-5 text-[#8c2f20]" role="alert">
                <span>{errorMessage}</span>
                <button aria-busy={feedBusy} className="inline-flex min-h-11 shrink-0 items-center px-xs font-extrabold underline disabled:cursor-not-allowed disabled:opacity-60" disabled={feedBusy} type="button" onClick={() => void refreshFeed("recovery")}>{loading ? "불러오는 중…" : "다시 시도"}</button>
              </div>
            ) : null}

            {showSyncIndicator && !pullRefreshing ? (
              <div className="mb-base flex items-center justify-center gap-xs text-[12px] font-semibold text-muted" role="status">
                <span className="material-symbols-outlined pulse-refresh-turn text-[15px]" aria-hidden="true">progress_activity</span>
                최신 내용 확인 중
              </div>
            ) : null}

            {displayEntries.length > 0 ? (
          <div className="border-t border-hairline" data-onboarding-target="pulse-feed-list">
            <AnimatePresence initial={false}>
              {displayEntries.map((entry) => {
                return (
                  <motion.div
                    key={entry.id}
                    layout="position"
                    initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? undefined : { opacity: 0, y: -6, height: 0 }}
                    transition={{ duration: reducedMotion ? 0 : 0.2, ease: easeOutExpo }}
                    style={{ overflow: "hidden" }}
                    data-workspace-scroll-anchor={entry.id}
                  >
                    {entry.type === "insider_trade_stack" ? (
                      <InsiderTradeStackCard
                        items={entry.items}
                        feedSlot={entry.feed_slot}
                        timezone={feed.timezone}
                        pending={entry.items.some(({ item }) => pendingIds.has(item.id))}
                        feedSessionId={feedSessionId}
                        rankingVersion={feed.ranking_version}
                        onDeviceSignal={recordDeviceSignal}
                      />
                    ) : (
                      <PulseCard
                        item={entry.item}
                        position={entry.position}
                        pending={pendingIds.has(entry.item.id)}
                        researchPending={researchPendingIds.has(entry.item.id)}
                        feedSessionId={feedSessionId}
                        rankingVersion={feed.ranking_version}
                        onMutation={mutate}
                        onDeviceSignal={recordDeviceSignal}
                        onResearch={startResearch}
                      />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-hairline bg-white px-xl py-3xl text-center">
                <span className="material-symbols-outlined text-[34px] text-muted" aria-hidden="true">done_all</span>
                <h2 className="mt-sm text-lg font-black text-ink">지금 확인할 신호가 없습니다</h2>
                <p className="mt-xs text-sm leading-6 text-muted">임의의 추천을 더 붙이지 않습니다.</p>
              </div>
            )}

            <div className="py-2xl text-center" aria-live="polite">
              <div className="mx-auto flex max-w-[360px] items-center justify-center gap-sm border-t border-hairline pt-base">
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
          </>
        )}
      </main>
    </>
  );
}

function ResearchActivityRail({
  activeItems,
  completedItems,
  focused,
  feedSessionId,
  rankingVersion,
  onMutation,
  onDeviceSignal,
  reducedMotion,
}: {
  activeItems: PulseItem[];
  completedItems: PulseItem[];
  focused: boolean;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  onMutation: (item: PulseItem, action: PulseMutationAction) => void;
  onDeviceSignal: (item: PulseItem, signal: PulseDeviceSignal) => void;
  reducedMotion: boolean;
}) {
  const counts = [
    activeItems.length > 0 ? `진행 ${activeItems.length}` : null,
    completedItems.length > 0 ? `완료 ${completedItems.length}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <motion.section
      id="research-activity"
      data-onboarding-target="research-activity-rail"
      className="mb-base overflow-hidden rounded-[22px] bg-ink text-white"
      animate={{
        boxShadow: focused && !reducedMotion
          ? [
              "inset 0 0 0 0 rgba(173, 200, 255, 0)",
              "inset 0 0 0 3px rgba(173, 200, 255, 0.55)",
              "inset 0 0 0 0 rgba(173, 200, 255, 0)",
            ]
          : "inset 0 0 0 0 rgba(173, 200, 255, 0)",
      }}
      transition={{ duration: focused && !reducedMotion ? 1.2 : 0, ease: easeOutExpo }}
      aria-labelledby="research-activity-title"
    >
      <div className="flex min-h-9 items-center justify-between border-b border-white/15 px-lg py-sm">
        <h2 id="research-activity-title" className="text-[12px] font-extrabold tracking-[0.08em] text-[#adc8ff]">
          리서치 활동
        </h2>
        <span className="text-[11px] font-semibold text-[#d2d9ea]">{counts.join(" · ")}</span>
      </div>
      <div className="px-lg py-base">
        <AnimatePresence initial={false}>
          {activeItems.length > 0 ? (
            <motion.div
              key="active-research"
              layout="position"
              initial={reducedMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: reducedMotion ? 0 : 0.22, ease: easeOutExpo }}
            >
              <p className="mb-1 px-sm text-[11px] font-bold tracking-[0.08em] text-[#adc8ff]">
                진행 중
              </p>
              {activeItems.map((item) => (
                <motion.div
                  key={item.id}
                  layout="position"
                  initial={reducedMotion ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: reducedMotion ? 0 : 0.22, ease: easeOutExpo }}
                >
                  <ActiveResearchRow
                    item={item}
                    feedSessionId={feedSessionId}
                    rankingVersion={rankingVersion}
                    onDeviceSignal={onDeviceSignal}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {activeItems.length > 0 && completedItems.length > 0 ? (
          <div className="my-xs border-t border-white/15" aria-hidden="true" />
        ) : null}

        <AnimatePresence initial={false}>
          {completedItems.length > 0 ? (
            <motion.div
              key="completed-research"
              layout="position"
              initial={reducedMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: reducedMotion ? 0 : 0.24, ease: easeOutExpo }}
              aria-live="polite"
              aria-relevant="additions text"
            >
              <p className="mb-1 px-sm text-[11px] font-bold tracking-[0.08em] text-[#adc8ff]">
                방금 완료
              </p>
              {completedItems.map((item) => (
                <motion.div
                  key={item.id}
                  layout="position"
                  initial={reducedMotion ? false : { opacity: 0, y: -8, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
                  transition={{ duration: reducedMotion ? 0 : 0.28, ease: easeOutExpo }}
                >
                  <CompletedResearchRow
                    item={item}
                    feedSessionId={feedSessionId}
                    rankingVersion={rankingVersion}
                    onMutation={onMutation}
                    onDeviceSignal={onDeviceSignal}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

function ActiveResearchRow({
  item,
  feedSessionId,
  rankingVersion,
  onDeviceSignal,
}: {
  item: PulseItem;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  onDeviceSignal: (item: PulseItem, signal: PulseDeviceSignal) => void;
}) {
  const companyName = pulseCompanyName(item);
  const companyHref = pulseCompanyHref(item.ticker);
  const primary = item.primary_action;
  // Every item in this component comes from the active-analysis lane. The
  // backend may still report pending/queued before the worker starts, but it
  // is already in progress from the user's perspective.
  const isRunning = item.phase === "active";
  const openResearch = () => {
    onDeviceSignal(item, "open");
    trackClientEventSilently("pulse_item_opened", {
      item_kind: item.kind,
      action: "active_research",
      item_state: item.state,
      phase: item.phase,
      feed_session_id: feedSessionId,
      ranking_version: rankingVersion,
      reason_code: item.reason_code,
      has_source_grounded_brief: false,
    });
  };

  const identity = item.ticker ? (
    <CompanyLogo
      ticker={item.ticker}
      companyName={companyName}
      className="size-9 text-[10px] text-ink"
      imageSize={48}
    />
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-[8px] border border-white/20 bg-white/[0.08] text-[11px] font-black text-[#adc8ff]" aria-hidden="true">K</span>
  );

  return (
    <div className="flex min-h-[72px] items-center gap-sm rounded-[14px] px-sm py-sm transition hover:bg-white/[0.06]">
      {companyHref ? (
        <Link
          href={companyHref}
          className="shrink-0 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={`${companyName} 회사 소개`}
        >
          {identity}
        </Link>
      ) : identity}
      {primary.type === "link" ? (
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-x-1.5 text-[12px] leading-5">
            {companyHref ? (
              <Link
                href={companyHref}
                className="font-extrabold text-white underline-offset-4 hover:text-[#adc8ff] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {companyName}
              </Link>
            ) : (
              <span className="font-extrabold text-white">{companyName}</span>
            )}
            <span className="font-semibold text-[#d2d9ea]">리서치 진행 중</span>
          </div>
          <Link
            href={primary.href}
            className="group mt-0.5 flex min-w-0 items-center justify-between gap-sm rounded-[6px] py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label={`${companyName} 리서치 열기`}
            onClick={openResearch}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-5 text-white">
              <span className="truncate">{item.title}</span>
            </span>
            <span
              className={`material-symbols-outlined shrink-0 text-[18px] text-[#adc8ff] ${isRunning ? "progress-spin" : "transition-transform group-hover:translate-x-0.5"}`}
              aria-hidden="true"
            >
              {isRunning ? "progress_activity" : "arrow_forward"}
            </span>
          </Link>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold text-white">{companyName}</p>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-[#d2d9ea]">{item.title}</p>
        </div>
      )}
    </div>
  );
}

function CompletedResearchRow({
  item,
  feedSessionId,
  rankingVersion,
  onMutation,
  onDeviceSignal,
}: {
  item: PulseItem;
  feedSessionId: string;
  rankingVersion: PulseFeedResponse["ranking_version"];
  onMutation: (item: PulseItem, action: PulseMutationAction) => void;
  onDeviceSignal: (item: PulseItem, signal: PulseDeviceSignal) => void;
}) {
  const companyName = pulseCompanyName(item);
  const companyHref = pulseCompanyHref(item.ticker);
  const primary = item.primary_action;
  const openResult = () => {
    onDeviceSignal(item, "open");
    trackClientEventSilently("pulse_item_opened", {
      item_kind: item.kind,
      action: "completed_research",
      item_state: item.state,
      phase: item.phase,
      feed_session_id: feedSessionId,
      ranking_version: rankingVersion,
      reason_code: item.reason_code,
      has_source_grounded_brief: false,
    });
  };
  const identity = item.ticker ? (
    <CompanyLogo
      ticker={item.ticker}
      companyName={companyName}
      className="size-9 text-[10px] text-ink"
      imageSize={48}
    />
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-[8px] border border-white/20 bg-white/[0.08] text-[11px] font-black text-[#adc8ff]" aria-hidden="true">K</span>
  );

  return (
    <div className="group relative flex min-h-[72px] items-center gap-sm rounded-[14px] border border-[#adc8ff]/20 bg-[#adc8ff]/[0.08] px-sm py-sm transition-colors hover:bg-[#adc8ff]/[0.13]">
      {companyHref ? (
        <Link
          href={companyHref}
          className="shrink-0 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={`${companyName} 회사 소개`}
        >
          {identity}
        </Link>
      ) : identity}
      {primary.type === "link" ? (
        <Link
          href={primary.href}
          className="flex min-w-0 flex-1 items-center gap-sm rounded-[6px] py-1 pr-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={openResult}
          aria-label={`${companyName} 리서치 답변과 근거 보기`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-x-1.5 text-[12px] leading-5">
              <span className="font-extrabold text-white">{companyName}</span>
              <span className="font-semibold text-[#adc8ff]">리서치 완료</span>
            </div>
            <p className="mt-0.5 truncate text-[13px] font-semibold leading-5 text-[#d2d9ea] group-hover:text-white">{item.title}</p>
          </div>
          <span className="material-symbols-outlined shrink-0 text-[18px] text-[#adc8ff] transition-transform group-hover:translate-x-0.5 group-hover:text-white" aria-hidden="true">arrow_forward</span>
        </Link>
      ) : (
        <div className="min-w-0 flex-1 pr-9">
          <div className="flex min-w-0 items-center gap-x-1.5 text-[12px] leading-5">
            <span className="font-extrabold text-white">{companyName}</span>
            <span className="font-semibold text-[#adc8ff]">리서치 완료</span>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-[#d2d9ea]">{item.title}</p>
        </div>
      )}
      <button
        type="button"
        className="absolute right-sm top-sm inline-flex size-8 items-center justify-center rounded-full text-[#d2d9ea] opacity-70 transition hover:bg-white/[0.08] hover:text-white hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        onClick={() => onMutation(item, "dismiss")}
        aria-label="완료 알림 숨기기"
        title="완료 알림 숨기기"
      >
        <span className="material-symbols-outlined text-[17px]" aria-hidden="true">close</span>
      </button>
    </div>
  );
}

function FirstValuePulseContext({
  intent,
}: {
  intent: FirstValueIntent | null;
}) {
  const copy = intent === "earnings"
    ? {
      title: "실적 변화를 먼저 확인해보세요",
      body: "오늘 카드에서 매출·마진·현금흐름 변화가 있는 공시를 고르고, 원문으로 돌아가 확인하세요.",
    }
    : intent === "risk"
      ? {
        title: "새 리스크 신호를 먼저 확인해보세요",
        body: "오늘 카드에서 확인할 위험이 있는 공시를 고르고, 원문 문맥을 직접 살펴보세요.",
      }
      : intent === "growth"
        ? {
          title: "성장 신호를 먼저 확인해보세요",
          body: "사업 변화와 확장을 보여주는 공시를 고른 뒤, 원문 근거를 직접 확인하세요.",
        }
        : intent === "valuation"
          ? {
            title: "가치 판단에 필요한 변화를 확인해보세요",
            body: "숫자만 보기 전에 사업과 리스크가 바뀐 공시를 고르고, 원문으로 돌아가 확인하세요.",
          }
          : {
            title: "오늘의 공시 변화부터 살펴보세요",
            body: "관심 가는 카드 하나를 열고, 그 변화가 나온 SEC 원문까지 확인해보세요.",
          };

  return (
    <section
      className="mb-base rounded-[12px] border border-primary/25 bg-primary-fixed/45 px-base py-sm"
      aria-label="첫 리서치 안내"
    >
      <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
        첫 리서치
      </p>
      <h2 className="mt-1 text-[15px] font-black leading-5 text-ink">
        {copy.title}
      </h2>
      <p className="mt-1 text-[12px] font-semibold leading-5 text-muted">
        {copy.body}
      </p>
    </section>
  );
}

function PulseFeedLoadingSkeleton() {
  return (
    <section aria-busy="true" aria-label="피드를 불러오는 중" className="motion-route-loading space-y-base">
      <div className="flex items-center justify-center gap-xs py-sm text-[13px] font-semibold text-muted" role="status">
        <span className="material-symbols-outlined pulse-refresh-turn text-[17px]" aria-hidden="true">progress_activity</span>
        피드를 불러오는 중
      </div>
      <div className="rounded-[16px] border border-hairline bg-white px-base py-base shadow-[0_8px_24px_rgba(16,24,40,0.04)] sm:px-lg" aria-hidden="true">
        <div className="motion-loading-block h-3 w-28 rounded-full bg-surface-strong" />
        <div className="motion-loading-block mt-3 h-5 w-48 max-w-[70%] rounded-[7px] bg-surface-strong" />
        <div className="motion-loading-block mt-2 h-3 w-full max-w-[540px] rounded-full bg-surface-strong" />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-[18px] border border-hairline bg-white p-lg pl-[22px] shadow-[0_12px_36px_rgba(16,24,40,0.055)] sm:p-xl sm:pl-[26px]" aria-hidden="true">
          <div className="flex items-start justify-between gap-base">
            <div className="flex items-center gap-sm">
              <div className="motion-loading-block size-9 rounded-[11px] bg-surface-strong" />
              <div className="space-y-2">
                <div className="motion-loading-block h-3 w-24 rounded-full bg-surface-strong" />
                <div className="motion-loading-block h-3 w-16 rounded-full bg-surface-strong" />
              </div>
            </div>
            <div className="motion-loading-block h-3 w-10 rounded-full bg-surface-strong" />
          </div>
          <div className="motion-loading-block mt-base h-6 w-[84%] rounded-[8px] bg-surface-strong" />
          <div className="motion-loading-block mt-sm h-4 w-full rounded-full bg-surface-strong" />
          <div className="motion-loading-block mt-2 h-4 w-[68%] rounded-full bg-surface-strong" />
          <div className="motion-loading-block mt-lg h-11 w-32 rounded-[10px] bg-surface-strong" />
        </div>
      ))}
    </section>
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
    || item.kind === "news"
    || (item.kind === "analysis" && item.phase !== "active");
}

export interface PulseItemMutationSnapshot {
  item: PulseItem;
  itemIndex: number;
  activeAnalysisItem: PulseItem | null;
  activeAnalysisIndex: number;
  completedAnalysisItem: PulseItem | null;
  completedAnalysisIndex: number;
}

export function capturePulseItemSnapshot(
  feed: PulseFeedResponse,
  itemId: string,
): PulseItemMutationSnapshot | null {
  const itemIndex = feed.candidate_items.findIndex((item) => item.id === itemId);
  const activeAnalysisIndex = feed.active_analysis_items.findIndex(
    (item) => item.id === itemId,
  );
  const completedItems = feed.completed_analysis_items ?? [];
  const completedAnalysisIndex = completedItems.findIndex(
    (item) => item.id === itemId,
  );
  const item = itemIndex >= 0
    ? feed.candidate_items[itemIndex]
    : activeAnalysisIndex >= 0
      ? feed.active_analysis_items[activeAnalysisIndex]
      : completedAnalysisIndex >= 0
        ? completedItems[completedAnalysisIndex]
        : null;
  if (!item) return null;
  return {
    item,
    itemIndex,
    activeAnalysisItem:
      activeAnalysisIndex >= 0
        ? feed.active_analysis_items[activeAnalysisIndex]
        : null,
    activeAnalysisIndex,
    completedAnalysisItem:
      completedAnalysisIndex >= 0
        ? completedItems[completedAnalysisIndex]
        : null,
    completedAnalysisIndex,
  };
}

/** Applies a sparse candidate delta while preserving unchanged cards. */
export function applyPulseFeedDelta(
  feed: PulseFeedResponse,
  delta: PulseFeedDeltaResponse,
): PulseFeedResponse {
  if (!delta.changed || !delta.snapshot) return feed;
  const byId = new Map<string, PulseItem>([
    ...feed.candidate_items,
    ...feed.active_analysis_items,
    ...(feed.completed_analysis_items ?? []),
  ].map((item) => [item.id, item]));
  for (const item of delta.upserts) byId.set(item.id, item);

  const orderedCandidateItems = delta.ordered_candidate_ids
    .map((id) => byId.get(id))
    .filter((item): item is PulseItem => Boolean(item));
  const activeItems = delta.active_analysis_item_ids
    .map((id) => byId.get(id))
    .filter((item): item is PulseItem => Boolean(item));
  const completedItems = delta.completed_analysis_item_ids
    .map((id) => byId.get(id))
    .filter((item): item is PulseItem => Boolean(item));

  return {
    ...feed,
    ...delta.snapshot,
    revision: delta.revision,
    generated_at: delta.generated_at,
    snapshot_at: delta.generated_at,
    candidate_items: orderedCandidateItems,
    active_analysis_items: activeItems,
    completed_analysis_items: completedItems,
    item_versions: delta.item_versions,
  };
}

/** Builds the same aggregate-only result for a full recovery fetch. */
export function buildFullPulseRefreshSummary(
  previous: PulseFeedResponse,
  next: PulseFeedResponse,
): PulseFeedRefreshSummary {
  const previousIds = new Set([
    ...previous.candidate_items,
    ...previous.active_analysis_items,
    ...(previous.completed_analysis_items ?? []),
  ].map((item) => item.id));
  const nextItems = [...next.candidate_items, ...next.active_analysis_items, ...(next.completed_analysis_items ?? [])];
  const nextIds = new Set(nextItems.map((item) => item.id));

  return {
    added_candidate_count: next.candidate_items.filter((item) => !previousIds.has(item.id)).length,
    updated_item_count: nextItems.filter((item) =>
      previous.item_versions[item.id] !== undefined
      && previous.item_versions[item.id] !== next.item_versions[item.id]).length,
    removed_item_count: Object.keys(previous.item_versions).filter((id) => !nextIds.has(id)).length,
  };
}

export function applyPulseItemMutation(
  feed: PulseFeedResponse,
  item: PulseItem,
  action: PulseMutationAction,
  timestamp: string,
): PulseFeedResponse {
  const exists =
    feed.candidate_items.some((candidate) => candidate.id === item.id) ||
    feed.active_analysis_items.some((candidate) => candidate.id === item.id)
    || (feed.completed_analysis_items ?? []).some((candidate) => candidate.id === item.id);
  if (!exists) return feed;

  if (action === "dismiss" || action === "snooze") {
    return {
      ...feed,
      candidate_items: feed.candidate_items.filter((candidate) => candidate.id !== item.id),
      active_analysis_items: feed.active_analysis_items.filter(
        (candidate) => candidate.id !== item.id,
      ),
      completed_analysis_items: (feed.completed_analysis_items ?? []).filter(
        (candidate) => candidate.id !== item.id,
      ),
    };
  }

  return {
    ...feed,
    candidate_items: feed.candidate_items.map((candidate) =>
      candidate.id === item.id
        ? applyPulseItemState(candidate, action, timestamp)
        : candidate,
    ),
    active_analysis_items: feed.active_analysis_items.map((candidate) =>
      candidate.id === item.id
        ? applyPulseItemState(candidate, action, timestamp)
        : candidate,
    ),
    completed_analysis_items: (feed.completed_analysis_items ?? []).map((candidate) =>
      candidate.id === item.id
        ? applyPulseItemState(candidate, action, timestamp)
        : candidate,
    ),
  };
}

export function rollbackPulseItemMutation(
  feed: PulseFeedResponse,
  snapshot: PulseItemMutationSnapshot,
  action: PulseMutationAction,
  timestamp: string,
): PulseFeedResponse {
  if (action === "dismiss" || action === "snooze") {
    let restored = false;
    let candidateItems = feed.candidate_items;
    let activeAnalysisItems = feed.active_analysis_items;
    let completedAnalysisItems = feed.completed_analysis_items ?? [];

    if (
      snapshot.itemIndex >= 0 &&
      !candidateItems.some((item) => item.id === snapshot.item.id)
    ) {
      candidateItems = insertAt(candidateItems, snapshot.itemIndex, snapshot.item);
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
    if (
      snapshot.completedAnalysisItem &&
      snapshot.completedAnalysisIndex >= 0 &&
      !completedAnalysisItems.some((item) => item.id === snapshot.item.id)
    ) {
      completedAnalysisItems = insertAt(
        completedAnalysisItems,
        snapshot.completedAnalysisIndex,
        snapshot.completedAnalysisItem,
      );
      restored = true;
    }

    if (!restored) return feed;
    return {
      ...feed,
      candidate_items: candidateItems,
      active_analysis_items: activeAnalysisItems,
      completed_analysis_items: completedAnalysisItems,
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
  const candidateItems = feed.candidate_items.map(restoreItem);
  const activeAnalysisItems = feed.active_analysis_items.map(restoreItem);
  const completedAnalysisItems = (feed.completed_analysis_items ?? []).map(restoreItem);
  if (!restored) return feed;
  return {
    ...feed,
    candidate_items: candidateItems,
    active_analysis_items: activeAnalysisItems,
    completed_analysis_items: completedAnalysisItems,
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

function insertAt(items: PulseItem[], index: number, item: PulseItem) {
  const next = [...items];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}

function isUserInitiatedPulseRefresh(origin: PulseRefreshOrigin): boolean {
  return origin === "manual" || origin === "pull";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
