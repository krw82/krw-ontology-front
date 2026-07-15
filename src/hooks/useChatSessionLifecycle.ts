"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import { readDraftMessage, removeDraftMessage } from "@/lib/chat/draft-message";
import { buildChatSessionHref } from "@/lib/chat/history-state";
import { buildGuruSessionHref, type GuruLensKey } from "@/lib/guru-lenses";
import type { Locale } from "@/i18n/config";
import type { RunKind } from "@/lib/run-kind";
import type { ChatState, SendMessageResult } from "@/hooks/useChat";

type DraftSendOptions = {
  requestId?: string;
  runKind?: RunKind;
  guruLensKey?: GuruLensKey;
  userUrl?: string;
  userUrls?: string[];
  attachmentIds?: string[];
};

export interface UseChatSessionLifecycleParams {
  sessionId: string | null;
  draftMessageId: string | null;
  activeTicker: string | null;
  isGuruAdvisor: boolean;
  requestedRunKind: RunKind | undefined;
  responseLocale: Locale;
  guruLensKey: GuruLensKey;
  chatStatus: ChatState["status"];
  chatRunId: string | null;
  sendMessage: (
    content: string,
    options?: DraftSendOptions,
  ) => Promise<SendMessageResult>;
  loadSession: () => Promise<void>;
  refreshEntitlement: () => Promise<void>;
  cancelledRef: MutableRefObject<boolean>;
}

export function useChatSessionLifecycle({
  sessionId,
  draftMessageId,
  activeTicker,
  isGuruAdvisor,
  requestedRunKind,
  responseLocale,
  guruLensKey,
  chatStatus,
  chatRunId,
  sendMessage,
  loadSession,
  refreshEntitlement,
  cancelledRef,
}: UseChatSessionLifecycleParams): void {
  const hasLoadedRef = useRef(false);
  const lastRefreshedRunIdRef = useRef<string | null>(null);
  const startedDraftMessageIdsRef = useRef<Set<string>>(new Set());
  const loadSessionRef = useRef(loadSession);

  useEffect(() => {
    if (chatStatus !== "completed" && chatStatus !== "failed") return;
    if (!chatRunId || lastRefreshedRunIdRef.current === chatRunId) return;

    lastRefreshedRunIdRef.current = chatRunId;
    void refreshEntitlement();
  }, [chatRunId, chatStatus, refreshEntitlement]);

  useEffect(() => {
    loadSessionRef.current = loadSession;
  }, [loadSession]);

  useEffect(() => {
    hasLoadedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !draftMessageId) return;

    const draftMessage = readDraftMessage(draftMessageId);
    if (!draftMessage) return;
    if (startedDraftMessageIdsRef.current.has(draftMessageId)) return;

    hasLoadedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      if (startedDraftMessageIdsRef.current.has(draftMessageId)) return;
      startedDraftMessageIdsRef.current.add(draftMessageId);
      void sendMessage(draftMessage.content, {
        requestId: draftMessage.requestId,
        runKind: draftMessage.runKind,
        guruLensKey: draftMessage.guruLensKey,
        userUrl: draftMessage.userUrl,
        userUrls: draftMessage.userUrls,
        attachmentIds: draftMessage.attachmentIds,
      }).finally(() => {
        if (cancelledRef.current) return;
        removeDraftMessage(draftMessageId);
        const cleanedSessionHref = isGuruAdvisor
          ? buildGuruSessionHref(
              sessionId,
              responseLocale,
              guruLensKey,
              activeTicker,
            )
          : buildChatSessionHref(sessionId, {
              locale: responseLocale,
              ticker: activeTicker,
              runKind: requestedRunKind,
            });
        window.history.replaceState(
          window.history.state,
          "",
          cleanedSessionHref,
        );
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeTicker,
    cancelledRef,
    draftMessageId,
    guruLensKey,
    isGuruAdvisor,
    requestedRunKind,
    responseLocale,
    sendMessage,
    sessionId,
  ]);

  useEffect(() => {
    if (!sessionId || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadSessionRef.current();
  }, [sessionId]);
}
