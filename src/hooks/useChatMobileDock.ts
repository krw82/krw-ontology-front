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
  const restoreTimersRef = useRef<number[]>([]);

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

  const clearRestoreTimers = useCallback(() => {
    restoreTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    restoreTimersRef.current = [];
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
    composerInteractionUntilRef.current = performance.now() + FOCUS_ANCHOR_RESTORE_TIME_MS;
  }, [getScrollSurface, isBodyScrollChat]);

  const restoreComposerFocusAnchor = useCallback(() => {
    if (!isBodyScrollChat || typeof window === "undefined") return;
    const targetTop = composerFocusScrollTopRef.current;
    if (targetTop == null) return;

    const restore = () => {
      window.scrollTo({ top: targetTop, behavior: "auto" });
      shouldStickToBottomRef.current = composerFocusStickToBottomRef.current;
      lastScrollTopRef.current = targetTop;
    };

    restore();
    clearRestoreTimers();
    restoreTimersRef.current.push(
      window.setTimeout(() => requestAnimationFrame(restore), 80),
    );
    restoreTimersRef.current.push(
      window.setTimeout(() => requestAnimationFrame(restore), 180),
    );
  }, [clearRestoreTimers, isBodyScrollChat]);

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
      if (!focused) return;

      setComposerExpanded({ keepFocus: true });
      withInteractionLock();
      requestAnimationFrame(() => {
        restoreComposerFocusAnchor();
      });
    },
    [restoreComposerFocusAnchor, setComposerExpanded, withInteractionLock],
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

    if (!window.visualViewport) return;
    const viewport = window.visualViewport;

    const updateKeyboardOffset = () => {
      const viewportHeight = viewport.height;
      if (typeof viewportHeight !== "number") return;
      const offsetTop = viewport.offsetTop ?? 0;
      const diff = Math.max(
        0,
        Math.round(window.innerHeight - viewportHeight - offsetTop),
      );
      setKeyboardOffset(diff);
    };

    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
    };
  }, [isBodyScrollChat]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setMobileHeaderHidden(false);
    isComposerFocusedRef.current = false;
    hasManualScrollRef.current = false;
    setIsComposerCompact(false);
    lastScrollTopRef.current = 0;
    clearRestoreTimers();
  }, [sessionKey, isBodyScrollChat, clearRestoreTimers]);

  useEffect(() => {
    return () => {
      clearRestoreTimers();
    };
  }, [clearRestoreTimers]);

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
