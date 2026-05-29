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
  setComposerExpanded: (options?: { keepFocus?: boolean }) => void;
}

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const NEAR_BOTTOM_TOLERANCE = 48;
const COMPACT_ENTER_DISTANCE = 180;
const COMPACT_EXIT_DISTANCE = 80;
const SCROLL_DIRECTION_THRESHOLD = 8;

export function useChatMobileDock({
  sessionKey,
  scrollRef,
  composerHostRef,
  messageCount,
  isStreaming,
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

  const getScrollSurface = useCallback((): HTMLElement | null => {
    if (!isBodyScrollChat || typeof document === "undefined") {
      return scrollRef.current;
    }

    return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  }, [isBodyScrollChat, scrollRef]);

  const getScrollViewportHeight = useCallback((surface: HTMLElement): number => {
    if (isBodyScrollChat) {
      return typeof window === "undefined" ? surface.clientHeight : window.innerHeight;
    }

    return surface.clientHeight;
  }, [isBodyScrollChat]);

  const updateComposerHeight = useCallback(() => {
    const composerHost = composerHostRef.current;
    if (!composerHost) {
      setComposerHeight(0);
      return;
    }

    setComposerHeight(Math.max(composerHost.offsetHeight, 0));
  }, [composerHostRef]);

  const setComposerExpanded = useCallback((options?: { keepFocus?: boolean }) => {
    shouldStickToBottomRef.current = true;
    if (!options?.keepFocus) {
      isComposerFocusedRef.current = false;
    }
    hasManualScrollRef.current = false;
    setIsComposerCompact(false);
  }, []);

  const revealComposer = useCallback(() => {
    setComposerExpanded();
  }, [setComposerExpanded]);

  const revealComposerForTyping = useCallback(() => {
    setComposerExpanded();
    setComposerFocusRequestKey((value) => value + 1);
  }, [setComposerExpanded]);

  const handleComposerPointerDown = useCallback(() => {
    setComposerExpanded();
  }, [setComposerExpanded]);

  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      isComposerFocusedRef.current = focused;
      if (!focused) return;

      shouldStickToBottomRef.current = true;
      setComposerExpanded({ keepFocus: true });
    },
    [setComposerExpanded],
  );

  const scrollToBottom = useCallback(() => {
    const surface = getScrollSurface();
    if (!surface) return;

    surface.scrollTo({
      top: surface.scrollHeight,
      behavior: "auto",
    });
  }, [getScrollSurface]);

  const applyScrollState = useCallback(
    (surface: HTMLElement) => {
      const viewportHeight = getScrollViewportHeight(surface);
      const current = surface.scrollTop;
      const distanceFromBottom = Math.max(
        surface.scrollHeight - viewportHeight - current,
        0,
      );

      shouldStickToBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_TOLERANCE;

      const previous = lastScrollTopRef.current;
      const delta = current - previous;
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

        if (delta > SCROLL_DIRECTION_THRESHOLD) {
          setMobileHeaderHidden(true);
        } else if (delta < -SCROLL_DIRECTION_THRESHOLD) {
          setMobileHeaderHidden(false);
        }

        setIsComposerCompact((currentCompact) => {
          if (isStreaming) return true;
          if (isComposerFocusedRef.current) return false;
          if (messageCount === 0) return false;
          if (distanceFromBottom <= COMPACT_EXIT_DISTANCE) return false;

          if (delta > SCROLL_DIRECTION_THRESHOLD) {
            return true;
          }

          if (delta < -SCROLL_DIRECTION_THRESHOLD) {
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
      isBodyScrollChat,
      isStreaming,
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
    if (!surface) return;

    const onScroll = () => {
      applyScrollState(surface);
    };

    onScroll();
    surface.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      surface.removeEventListener("scroll", onScroll);
    };
  }, [applyScrollState, getScrollSurface]);

  useEffect(() => {
    if (!isBodyScrollChat) {
      setKeyboardOffset(0);
      return;
    }

    if (!window.visualViewport) return;

    const updateKeyboardOffset = () => {
      const viewportHeight = window.visualViewport?.height;
      if (typeof viewportHeight !== "number") return;

      const diff = Math.max(0, window.innerHeight - viewportHeight);
      setKeyboardOffset(Math.min(diff, 280));
    };

    updateKeyboardOffset();
    window.visualViewport.addEventListener("resize", updateKeyboardOffset);
    window.visualViewport.addEventListener("scroll", updateKeyboardOffset);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateKeyboardOffset);
      window.visualViewport?.removeEventListener("scroll", updateKeyboardOffset);
    };
  }, [isBodyScrollChat]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setMobileHeaderHidden(false);
    isComposerFocusedRef.current = false;
    hasManualScrollRef.current = false;
    setIsComposerCompact(false);
    lastScrollTopRef.current = 0;
  }, [sessionKey, isBodyScrollChat]);

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
    scrollToBottom,
    revealComposer,
    revealComposerForTyping,
    handleComposerPointerDown,
    handleComposerFocusChange,
    setComposerExpanded,
  };
}
