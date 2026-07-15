"use client";

import { useEffect, useRef, type RefObject } from "react";

export interface UseChatScrollEffectsParams {
  sessionId: string | null;
  messageCount: number;
  streamingContent: string;
  hasConversationContent: boolean;
  isActiveRun: boolean;
  shouldStickToBottomRef: RefObject<boolean>;
  scrollToBottom: () => void;
  getScrollSurface: () => HTMLElement | null;
  getScrollViewportHeight: (surface: HTMLElement) => number;
  isBodyScrollChat: boolean;
}

export function useChatScrollEffects({
  sessionId,
  messageCount,
  streamingContent,
  hasConversationContent,
  isActiveRun,
  shouldStickToBottomRef,
  scrollToBottom,
  getScrollSurface,
  getScrollViewportHeight,
  isBodyScrollChat,
}: UseChatScrollEffectsParams): void {
  const previousMessageCountRef = useRef(0);

  useEffect(() => {
    if (!hasConversationContent) return;
    if (!shouldStickToBottomRef.current) return;
    if (!isActiveRun && messageCount === previousMessageCountRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    hasConversationContent,
    isActiveRun,
    messageCount,
    scrollToBottom,
    shouldStickToBottomRef,
    streamingContent,
  ]);

  useEffect(() => {
    previousMessageCountRef.current = messageCount;
  }, [messageCount]);

  useEffect(() => {
    if (!sessionId || messageCount === 0) return;
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("message-")) return;

    const frameId = window.requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      const surface = getScrollSurface();
      if (!target || !surface) return;

      const surfaceTop = isBodyScrollChat
        ? 0
        : surface.getBoundingClientRect().top;
      const targetTop =
        target.getBoundingClientRect().top - surfaceTop + surface.scrollTop;
      surface.scrollTop = Math.max(
        0,
        targetTop - getScrollViewportHeight(surface) / 2,
      );
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    getScrollSurface,
    getScrollViewportHeight,
    isBodyScrollChat,
    messageCount,
    sessionId,
  ]);
}
