"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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
  setComposerExpanded: () => void;
}

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const NEAR_BOTTOM_TOLERANCE = 48;

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
  const isAnimatingFocusRef = useRef(false);

  const getScrollSurface = useCallback(() => {
    return scrollRef.current;
  }, [scrollRef]);

  const getScrollViewportHeight = useCallback((surface: HTMLElement): number => {
    return surface.clientHeight;
  }, []);

  const updateComposerHeight = useCallback(() => {
    const composerHost = composerHostRef.current;
    if (!composerHost) {
      setComposerHeight(0);
      return;
    }

    setComposerHeight(Math.max(composerHost.offsetHeight, 0));
  }, [composerHostRef]);

  const setComposerExpanded = useCallback(() => {
    shouldStickToBottomRef.current = true;
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
      shouldStickToBottomRef.current = focused;
      if (!focused) return;
      setComposerExpanded();
      isAnimatingFocusRef.current = false;
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

  const applyScrollState = useCallback(() => {
    if (!isBodyScrollChat) {
      shouldStickToBottomRef.current = true;
      setMobileHeaderHidden(false);
      return;
    }

    const surface = getScrollSurface();
    if (!surface) return;

    const current = surface.scrollTop;
    const atBottom =
      surface.scrollHeight - surface.clientHeight - current <= NEAR_BOTTOM_TOLERANCE;

    shouldStickToBottomRef.current = atBottom;

    const previous = lastScrollTopRef.current;
    if (current > previous + 8) {
      setMobileHeaderHidden(true);
    } else if (current < previous - 8) {
      setMobileHeaderHidden(false);
    }
    lastScrollTopRef.current = current;
  }, [isBodyScrollChat, getScrollSurface]);

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
      applyScrollState();
    };

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

      const diff = Math.max(
        0,
        window.innerHeight - viewportHeight,
      );
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
    const shouldCompact =
      isBodyScrollChat && messageCount > 0 && !isStreaming;
    setIsComposerCompact(shouldCompact);
  }, [isBodyScrollChat, isStreaming, messageCount]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setMobileHeaderHidden(false);
    setComposerFocusRequestKey((value) => value + 1);
    isAnimatingFocusRef.current = false;
  }, [sessionKey]);

  useEffect(() => {
    if (isStreaming) {
      shouldStickToBottomRef.current = true;
      setIsComposerCompact(false);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    updateComposerHeight();
    if (isBodyScrollChat) return;
    setMobileHeaderHidden(false);

    window.requestAnimationFrame(() => {
      scrollToBottom();
    });
  }, [messageCount, isStreaming, isBodyScrollChat, scrollToBottom, updateComposerHeight]);

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
