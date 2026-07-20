"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseChatMobileDockParams {
  sessionKey: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  composerHostRef: RefObject<HTMLDivElement | null>;
  messageCount: number;
  isStreaming: boolean;
}

export interface UseChatMobileDockResult {
  isBodyScrollChat: boolean;
  mobileHeaderHidden: boolean;
  isComposerCompact: boolean;
  keyboardOffset: number;
  composerHeight: number;
  composerFocusRequestKey: number;
  shouldStickToBottomRef: RefObject<boolean>;
  getScrollSurface: () => HTMLElement | null;
  getScrollViewportHeight: (surface: HTMLElement) => number;
  scrollToBottom: () => void;
  revealComposer: () => void;
  revealComposerForTyping: () => void;
  handleComposerPointerDown: () => void;
  handleComposerFocusChange: (focused: boolean) => void;
  setComposerExpanded: (options?: {
    keepFocus?: boolean;
    stickToBottom?: boolean;
    resetManualScroll?: boolean;
  }) => void;
}

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const NEAR_BOTTOM_TOLERANCE = 80;
const COMPACT_ENTER_DISTANCE = 180;
const COMPACT_EXIT_DISTANCE = 80;
const SCROLL_DIRECTION_THRESHOLD = 18;
const HEADER_HIDE_DELTA = 18;
const HEADER_SHOW_DELTA = -14;
const HEADER_HIDE_MIN_SCROLL_TOP = 96;
const HEADER_FORCE_SHOW_SCROLL_TOP = 40;
const FOCUS_ANCHOR_RESTORE_TIME_MS = 800;
const FOCUS_ANCHOR_MAX_CORRECTION_PX = 480;
const VIEWPORT_SETTLE_STABLE_FRAMES = 2;
const VIEWPORT_SETTLE_EPSILON_PX = 1;

interface ViewportSnapshot {
  height: number;
  offsetTop: number;
  stableFrames: number;
}

export function calculateKeyboardOffset({
  layoutViewportHeight,
  visualViewportHeight,
  visualViewportOffsetTop,
}: {
  layoutViewportHeight: number;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
}): number {
  return Math.max(
    0,
    Math.round(
      layoutViewportHeight -
        visualViewportHeight -
        visualViewportOffsetTop,
    ),
  );
}

export function boundedFocusAnchorTarget({
  currentTop,
  targetTop,
  maxCorrection = FOCUS_ANCHOR_MAX_CORRECTION_PX,
}: {
  currentTop: number;
  targetTop: number;
  maxCorrection?: number;
}): number {
  const correction = Math.max(
    -maxCorrection,
    Math.min(maxCorrection, targetTop - currentTop),
  );
  return Math.max(0, currentTop + correction);
}

export function useChatMobileDock({
  sessionKey,
  scrollRef,
  composerHostRef,
  messageCount,
}: UseChatMobileDockParams): UseChatMobileDockResult {
  const [isBodyScrollChat, setIsBodyScrollChat] = useState(false);
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const [isComposerCompact, setIsComposerCompact] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const [composerFocusRequestKey, setComposerFocusRequestKey] = useState(0);
  const shouldStickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const isComposerFocusedRef = useRef(false);
  const hasManualScrollRef = useRef(false);
  const composerInteractionUntilRef = useRef(0);
  const composerFocusScrollTopRef = useRef<number | null>(null);
  const composerFocusStickToBottomRef = useRef(true);
  const syncKeyboardOffsetRef = useRef<() => void>(() => undefined);
  const restoreFrameRef = useRef<number | null>(null);
  const focusAnchorRestoreCancelledRef = useRef(false);
  const viewportSnapshotRef = useRef<ViewportSnapshot | null>(null);

  const getScrollSurface = useCallback((): HTMLElement | null => {
    if (!isBodyScrollChat || typeof document === "undefined") {
      return scrollRef.current;
    }

    return (
      (document.scrollingElement as HTMLElement | null) ??
      document.documentElement
    );
  }, [isBodyScrollChat, scrollRef]);

  const getScrollViewportHeight = useCallback((surface: HTMLElement): number => {
    if (isBodyScrollChat) {
      return typeof window === "undefined" ? surface.clientHeight : window.innerHeight;
    }

    return surface.clientHeight;
  }, [isBodyScrollChat]);

  const getScrollTop = useCallback(
    (surface: HTMLElement): number => {
      if (isBodyScrollChat) {
        return typeof window === "undefined" ? 0 : window.scrollY;
      }

      return surface.scrollTop;
    },
    [isBodyScrollChat],
  );

  const clearRestoreScheduling = useCallback(() => {
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
    viewportSnapshotRef.current = null;
  }, []);

  const updateComposerHeight = useCallback(() => {
    const composerHost = composerHostRef.current;
    if (!composerHost) {
      setComposerHeight(0);
      return;
    }

    setComposerHeight(Math.max(composerHost.offsetHeight, 0));
  }, [composerHostRef]);

  const setComposerExpanded = useCallback(
    (options?: {
      keepFocus?: boolean;
      stickToBottom?: boolean;
      resetManualScroll?: boolean;
    }) => {
      if (options?.stickToBottom) {
        shouldStickToBottomRef.current = true;
      }
      if (!options?.keepFocus) {
        isComposerFocusedRef.current = false;
      }
      if (options?.resetManualScroll) {
        hasManualScrollRef.current = false;
      }
      setIsComposerCompact(false);
    },
    [],
  );

  const captureComposerFocusAnchor = useCallback(() => {
    const surface = getScrollSurface();
    if (!surface) return;

    const currentTop = isBodyScrollChat
      ? typeof window === "undefined"
        ? 0
        : window.scrollY
      : surface.scrollTop;

    composerFocusScrollTopRef.current = currentTop;
    composerFocusStickToBottomRef.current = shouldStickToBottomRef.current;
    focusAnchorRestoreCancelledRef.current = false;
    composerInteractionUntilRef.current = performance.now() + FOCUS_ANCHOR_RESTORE_TIME_MS;
  }, [getScrollSurface, isBodyScrollChat]);

  const restoreComposerFocusAnchor = useCallback(() => {
    if (!isBodyScrollChat || typeof window === "undefined") return;
    if (focusAnchorRestoreCancelledRef.current) return;
    const targetTop = composerFocusScrollTopRef.current;
    if (targetTop == null) return;

    const currentTop = window.scrollY;
    const restoredTop = boundedFocusAnchorTarget({
      currentTop,
      targetTop,
    });
    window.scrollTo({ top: restoredTop, behavior: "auto" });
    shouldStickToBottomRef.current = composerFocusStickToBottomRef.current;
    lastScrollTopRef.current = restoredTop;
    composerFocusScrollTopRef.current = null;
    clearRestoreScheduling();
  }, [clearRestoreScheduling, isBodyScrollChat]);

  const scheduleComposerFocusAnchorRestore = useCallback(() => {
    if (
      !isBodyScrollChat ||
      typeof window === "undefined" ||
      focusAnchorRestoreCancelledRef.current ||
      composerFocusScrollTopRef.current == null
    ) {
      return;
    }

    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
    }
    viewportSnapshotRef.current = null;

    const waitForStableViewport = () => {
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        if (
          focusAnchorRestoreCancelledRef.current ||
          composerFocusScrollTopRef.current == null
        ) {
          return;
        }

        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        const offsetTop = viewport?.offsetTop ?? 0;
        const previous = viewportSnapshotRef.current;
        const isStable =
          previous !== null &&
          Math.abs(previous.height - height) <= VIEWPORT_SETTLE_EPSILON_PX &&
          Math.abs(previous.offsetTop - offsetTop) <=
            VIEWPORT_SETTLE_EPSILON_PX;
        const stableFrames = isStable ? previous.stableFrames + 1 : 0;

        viewportSnapshotRef.current = { height, offsetTop, stableFrames };
        if (stableFrames >= VIEWPORT_SETTLE_STABLE_FRAMES) {
          restoreComposerFocusAnchor();
          return;
        }

        waitForStableViewport();
      });
    };

    waitForStableViewport();
  }, [isBodyScrollChat, restoreComposerFocusAnchor]);

  const cancelComposerFocusAnchorRestore = useCallback(() => {
    focusAnchorRestoreCancelledRef.current = true;
    composerFocusScrollTopRef.current = null;
    clearRestoreScheduling();
  }, [clearRestoreScheduling]);

  const withInteractionLock = useCallback(() => {
    composerInteractionUntilRef.current = performance.now() + FOCUS_ANCHOR_RESTORE_TIME_MS;
  }, []);

  const revealComposer = useCallback(() => {
    setComposerExpanded({
      resetManualScroll: true,
    });
    captureComposerFocusAnchor();
    withInteractionLock();
  }, [captureComposerFocusAnchor, setComposerExpanded, withInteractionLock]);

  const revealComposerForTyping = useCallback(() => {
    setComposerExpanded({
      resetManualScroll: true,
    });
    setComposerFocusRequestKey((value) => value + 1);
    captureComposerFocusAnchor();
    withInteractionLock();
  }, [captureComposerFocusAnchor, setComposerExpanded, withInteractionLock]);

  const handleComposerPointerDown = useCallback(() => {
    setComposerExpanded({
      resetManualScroll: true,
    });
    captureComposerFocusAnchor();
    withInteractionLock();
  }, [captureComposerFocusAnchor, setComposerExpanded, withInteractionLock]);

  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      isComposerFocusedRef.current = focused;
      if (!focused) {
        setKeyboardOffset(0);
        cancelComposerFocusAnchorRestore();
        return;
      }

      setComposerExpanded({ keepFocus: true });
      withInteractionLock();
      requestAnimationFrame(() => {
        syncKeyboardOffsetRef.current();
        scheduleComposerFocusAnchorRestore();
      });
    },
    [
      cancelComposerFocusAnchorRestore,
      scheduleComposerFocusAnchorRestore,
      setComposerExpanded,
      withInteractionLock,
    ],
  );

  const applyScrollState = useCallback(
    (surface: HTMLElement) => {
      const viewportHeight = getScrollViewportHeight(surface);
      const current = getScrollTop(surface);
      const distanceFromBottom = Math.max(
        surface.scrollHeight - viewportHeight - current,
        0,
      );

      shouldStickToBottomRef.current = distanceFromBottom < NEAR_BOTTOM_TOLERANCE;

      const previous = lastScrollTopRef.current;
      const delta = current - previous;
      const interactionLocked =
        isComposerFocusedRef.current ||
        performance.now() < composerInteractionUntilRef.current;
      const forceShowHeader = current <= HEADER_FORCE_SHOW_SCROLL_TOP;

      if (interactionLocked) {
        setMobileHeaderHidden(false);
        setIsComposerCompact(false);
        lastScrollTopRef.current = current;
        return;
      }

      if (isBodyScrollChat) {
        if (Math.abs(delta) > SCROLL_DIRECTION_THRESHOLD) {
          hasManualScrollRef.current = true;
        }

        if (!hasManualScrollRef.current) {
          setMobileHeaderHidden(false);
          setIsComposerCompact(false);
          lastScrollTopRef.current = current;
          return;
        }

        if (forceShowHeader) {
          setMobileHeaderHidden(false);
        } else if (
          !isComposerFocusedRef.current &&
          delta > HEADER_HIDE_DELTA &&
          current > HEADER_HIDE_MIN_SCROLL_TOP
        ) {
          setMobileHeaderHidden(true);
        } else if (delta < HEADER_SHOW_DELTA) {
          setMobileHeaderHidden(false);
        }

        setIsComposerCompact((currentCompact) => {
          if (isComposerFocusedRef.current) return false;
          if (messageCount === 0) return false;
          if (distanceFromBottom <= COMPACT_EXIT_DISTANCE) return false;

          if (delta > HEADER_HIDE_DELTA && current > HEADER_HIDE_MIN_SCROLL_TOP) {
            return true;
          }

          if (delta < HEADER_SHOW_DELTA) {
            return false;
          }

          return currentCompact || distanceFromBottom >= COMPACT_ENTER_DISTANCE;
        });
      } else {
        setMobileHeaderHidden(false);
        setIsComposerCompact(false);
      }

      lastScrollTopRef.current = current;
    },
    [
      getScrollViewportHeight,
      getScrollTop,
      isBodyScrollChat,
      messageCount,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const sync = () => {
      setIsBodyScrollChat(mediaQuery.matches);
    };

    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const composerHost = composerHostRef.current;
    if (!composerHost || typeof ResizeObserver === "undefined") return;

    updateComposerHeight();
    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composerHost);
    return () => observer.disconnect();
  }, [composerHostRef, updateComposerHeight]);

  useEffect(() => {
    const surface = getScrollSurface();
    if (!surface || typeof document === "undefined") return;

    const previousScrollPaddingBottom = surface.style.scrollPaddingBottom;
    const previousOverscrollBehaviorY = surface.style.overscrollBehaviorY;
    const previousComposerHeight =
      document.documentElement.style.getPropertyValue("--chat-composer-height");
    const composerHeightValue = `${Math.max(0, composerHeight)}px`;

    surface.style.scrollPaddingBottom = `calc(${composerHeightValue} + env(safe-area-inset-bottom) + 16px)`;
    surface.style.overscrollBehaviorY = "contain";
    document.documentElement.style.setProperty(
      "--chat-composer-height",
      composerHeightValue,
    );

    return () => {
      surface.style.scrollPaddingBottom = previousScrollPaddingBottom;
      surface.style.overscrollBehaviorY = previousOverscrollBehaviorY;
      if (previousComposerHeight) {
        document.documentElement.style.setProperty(
          "--chat-composer-height",
          previousComposerHeight,
        );
      } else {
        document.documentElement.style.removeProperty("--chat-composer-height");
      }
    };
  }, [composerHeight, getScrollSurface]);

  useEffect(() => {
    if (!isBodyScrollChat || typeof window === "undefined") return;

    const cancelOnUserGesture = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        composerHostRef.current?.contains(target)
      ) {
        return;
      }
      cancelComposerFocusAnchorRestore();
    };

    window.addEventListener("pointerdown", cancelOnUserGesture, {
      capture: true,
      passive: true,
    });
    window.addEventListener("touchmove", cancelOnUserGesture, {
      capture: true,
      passive: true,
    });
    window.addEventListener("wheel", cancelOnUserGesture, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("pointerdown", cancelOnUserGesture, true);
      window.removeEventListener("touchmove", cancelOnUserGesture, true);
      window.removeEventListener("wheel", cancelOnUserGesture, true);
    };
  }, [
    cancelComposerFocusAnchorRestore,
    composerHostRef,
    isBodyScrollChat,
  ]);

  useEffect(() => {
    const surface = getScrollSurface();
    const scrollTarget: Window | HTMLElement | null = isBodyScrollChat
      ? (typeof window === "undefined" ? null : window)
      : surface;
    if (!scrollTarget) return;

    let frameId: number | null = null;
    const onScroll = () => {
      if (frameId !== null) return;

      frameId = window.requestAnimationFrame(() => {
        frameId = null;

        const currentSurface = getScrollSurface();
        if (!currentSurface) return;
        applyScrollState(currentSurface);
      });
    };

    onScroll();
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", onScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [applyScrollState, getScrollSurface, isBodyScrollChat]);

  useEffect(() => {
    if (!isBodyScrollChat) {
      setKeyboardOffset(0);
      return;
    }

    if (!window.visualViewport) {
      setKeyboardOffset(0);
      return;
    }
    const viewport = window.visualViewport;

    const updateKeyboardOffset = () => {
      if (!isComposerFocusedRef.current) {
        setKeyboardOffset(0);
        return;
      }

      const viewportHeight = viewport.height;
      if (typeof viewportHeight !== "number") return;
      const offsetTop = viewport.offsetTop ?? 0;
      const diff = calculateKeyboardOffset({
        layoutViewportHeight: window.innerHeight,
        visualViewportHeight: viewportHeight,
        visualViewportOffsetTop: offsetTop,
      });
      setKeyboardOffset(diff);
      scheduleComposerFocusAnchorRestore();
    };

    syncKeyboardOffsetRef.current = updateKeyboardOffset;
    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);

    return () => {
      syncKeyboardOffsetRef.current = () => undefined;
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
    };
  }, [isBodyScrollChat, scheduleComposerFocusAnchorRestore]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setMobileHeaderHidden(false);
    isComposerFocusedRef.current = false;
    hasManualScrollRef.current = false;
    setIsComposerCompact(false);
    setKeyboardOffset(0);
    lastScrollTopRef.current = 0;
    cancelComposerFocusAnchorRestore();
  }, [
    sessionKey,
    isBodyScrollChat,
    cancelComposerFocusAnchorRestore,
  ]);

  useEffect(() => {
    return () => {
      clearRestoreScheduling();
    };
  }, [clearRestoreScheduling]);

  return {
    isBodyScrollChat,
    mobileHeaderHidden,
    isComposerCompact,
    keyboardOffset,
    composerHeight,
    composerFocusRequestKey,
    shouldStickToBottomRef,
    getScrollSurface,
    getScrollViewportHeight,
    scrollToBottom: () => {
      const surface = getScrollSurface();
      if (!surface) return;

      if (isBodyScrollChat && typeof window !== "undefined") {
        window.scrollTo({
          top: surface.scrollHeight,
          behavior: "auto",
        });
        return;
      }

      surface.scrollTo({
        top: surface.scrollHeight,
        behavior: "auto",
      });
    },
    revealComposer,
    revealComposerForTyping,
    handleComposerPointerDown,
    handleComposerFocusChange,
    setComposerExpanded,
  };
}
