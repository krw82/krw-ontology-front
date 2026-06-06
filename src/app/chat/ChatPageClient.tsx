"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AnimatePresence, motion } from "motion/react";
import TopNav from "@/components/TopNav";
import ChatMessage from "@/components/ChatMessage";
import Composer, { type ComposerSendResult } from "@/components/Composer";
import SuggestedPromptActions from "@/components/SuggestedPromptActions";
import RunStatusDock from "@/components/RunStatusDock";
import { useChat } from "@/hooks/useChat";
import { useChatMobileDock } from "@/hooks/useChatMobileDock";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useResearchModePreference } from "@/hooks/useResearchModePreference";
import { useAnalysisModePreference } from "@/hooks/useAnalysisModePreference";
import {
  getSessionTickers,
  buildChatSessionHref,
} from "@/lib/chat/history-state";
import { getSuggestedPromptsForTickers } from "@/lib/companies/landing-copy";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { findQuestionTopic } from "@/lib/marketing/site";
import { createClientId } from "@/lib/client-id";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
} from "@/types/api-contracts";

const DRAFT_MESSAGE_STORAGE_PREFIX = "krw:chat-draft-message:";

type DraftMessagePayload = {
  content: string;
  requestId: string;
};

function draftMessageStorageKey(draftMessageId: string): string {
  return `${DRAFT_MESSAGE_STORAGE_PREFIX}${draftMessageId}`;
}

function storeDraftMessage(
  draftMessageId: string,
  payload: DraftMessagePayload,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(
      draftMessageStorageKey(draftMessageId),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    return false;
  }
}

function readDraftMessage(draftMessageId: string): DraftMessagePayload | null {
  if (typeof window === "undefined") return null;
  const key = draftMessageStorageKey(draftMessageId);
  const rawPayload = window.sessionStorage.getItem(key);
  if (!rawPayload) return null;

  try {
    const payload = JSON.parse(rawPayload) as Partial<DraftMessagePayload>;
    const content = payload.content?.trim();
    const requestId = payload.requestId?.trim();
    if (!content || !requestId) return null;
    return { content, requestId };
  } catch {
    const content = rawPayload.trim();
    return content ? { content, requestId: createClientId() } : null;
  }
}

function removeDraftMessage(draftMessageId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(draftMessageStorageKey(draftMessageId));
}

function sanitizeError(message: string): string {
  // Strip stack traces and internal details
  const cleaned = message.split("\n")[0];
  const lower = cleaned.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "현재 KRW-AI 계정/API 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나, 실제 ANTHROPIC_API_KEY를 설정한 뒤 서버를 재시작해주세요.";
  }
  if (cleaned.length > 200) return cleaned.slice(0, 200) + "...";
  return cleaned;
}

type CompaniesResponse = {
  companies?: Array<{
    ticker: string;
    name?: string | null;
    sector?: string | null;
  }>;
};

type CompanyMeta = {
  ticker: string;
  name: string | null;
  sector: string | null;
};

type ShareStarter = {
  question_content: string;
  tickers: string[];
  title?: string | null;
};

function ChatContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ticker = searchParams.get("ticker");
  const queryParam = searchParams.get("query");
  const shareToken = searchParams.get("shareToken");
  const templateId = searchParams.get("templateId");
  const draftMessageId = searchParams.get("draftMessageId");
  const templateTopic = templateId ? findQuestionTopic(templateId) : null;
  const existingSessionId = searchParams.get("sessionId");

  const sessionId = existingSessionId;
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [shareStarter, setShareStarter] = useState<ShareStarter | null>(null);
  const [companyMetaByTicker, setCompanyMetaByTicker] = useState<
    Record<string, CompanyMeta>
  >({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerHostRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const cancelledRef = useRef(false);
  const lastRefreshedRunIdRef = useRef<string | null>(null);
  const budgetAlertTrackedRef = useRef<string | null>(null);
  const prefilledQuestionTrackedRef = useRef<string | null>(null);
  const loadedShareTokenRef = useRef<string | null>(null);
  const startedDraftMessageIdsRef = useRef<Set<string>>(new Set());
  const prevMessagesCountRef = useRef(0);
  const { entitlement, refresh: refreshEntitlement } = useEntitlement();
  const [researchMode, setResearchMode] = useResearchModePreference(sessionId);
  const [analysisMode, setAnalysisMode] = useAnalysisModePreference(sessionId);
  const [composerDraftResetKey, setComposerDraftResetKey] = useState(0);

  const isDraftRoute = pathname === "/chat/new";
  const shareStarterTicker =
    shareStarter?.tickers[0]?.trim().toUpperCase() || null;
  const activeTicker = ticker?.trim() || shareStarterTicker;

  // H-07: cleanup on unmount to prevent race condition
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (existingSessionId || !activeTicker) return;

    let stale = false;
    const tickerToValidate = activeTicker;

    async function validateTicker() {
      const normalizedTicker = tickerToValidate.trim().toUpperCase();
      try {
        const res = await fetch(
          `/api/companies?ticker=${encodeURIComponent(normalizedTicker)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as CompaniesResponse;
        const isIndexed =
          res.ok &&
          data.companies?.some(
            (company) => company.ticker === normalizedTicker,
          );
        const matchedCompany = data.companies?.find(
          (company) => company.ticker === normalizedTicker,
        );

        if (matchedCompany && !stale && !cancelledRef.current) {
          setCompanyMetaByTicker((current) => ({
            ...current,
            [normalizedTicker]: {
              ticker: normalizedTicker,
              name:
                matchedCompany.name && matchedCompany.name !== normalizedTicker
                  ? matchedCompany.name
                  : null,
              sector: matchedCompany.sector ?? null,
            },
          }));
        }

        if (!isIndexed && !stale && !cancelledRef.current) {
          setSessionError(
            `현재 온톨로지 인덱스에 없는 회사입니다: ${normalizedTicker}`,
          );
        }
      } catch {
        if (!stale && !cancelledRef.current) {
          setSessionError("회사 인덱스를 확인하지 못했습니다.");
        }
      }
    }

    validateTicker();

    return () => {
      stale = true;
    };
  }, [activeTicker, existingSessionId]);

  const effectiveSessionError =
    existingSessionId || !activeTicker ? null : sessionError;

  const handleSessionCreated = useCallback(
    (createdSessionId: string) => {
      if (!isDraftRoute && existingSessionId) return;
      router.replace(buildChatSessionHref(createdSessionId), { scroll: false });
    },
    [existingSessionId, isDraftRoute, router],
  );

  const chat = useChat({
    sessionId: sessionId ?? "",
    scopeType: activeTicker ? "company" : "global",
    defaultTickers: activeTicker ? [activeTicker.trim().toUpperCase()] : [],
    researchMode,
    analysisMode,
    onSessionCreated: handleSessionCreated,
  });
  const sendMessage = chat.sendMessage;
  const sendNewsEventSelection = chat.sendNewsEventSelection;
  const cancelRun = chat.cancelRun;
  const isStreaming = chat.status === "running";

  // ---------------------------------------------------------------------------
  // Mobile dock state machine
  // ---------------------------------------------------------------------------

  const {
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
  } = useChatMobileDock({
    sessionKey: sessionId,
    scrollRef,
    composerHostRef,
    messageCount: chat.messages.length,
    isStreaming,
  });

  // ---------------------------------------------------------------------------
  // Session hydration & lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (chat.status !== "completed" && chat.status !== "failed") return;
    if (!chat.runId || lastRefreshedRunIdRef.current === chat.runId) return;

    lastRefreshedRunIdRef.current = chat.runId;
    void refreshEntitlement();
  }, [chat.runId, chat.status, refreshEntitlement]);

  // H-08: stable loadSession via ref-based guard
  const loadSessionRef = useRef(chat.loadSession);

  useEffect(() => {
    loadSessionRef.current = chat.loadSession;
  }, [chat.loadSession]);

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
      }).finally(() => {
        if (cancelledRef.current) return;
        removeDraftMessage(draftMessageId);
        window.history.replaceState(
          window.history.state,
          "",
          buildChatSessionHref(sessionId),
        );
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [draftMessageId, sendMessage, sessionId]);

  useEffect(() => {
    if (!sessionId || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadSessionRef.current();
  }, [sessionId]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isHydratingSession = Boolean(sessionId && chat.isHydratingSession);
  const isBudgetBlocked = entitlement?.usage.can_run === false;
  const hasConversationContent =
    chat.messages.length > 0 ||
    Boolean(chat.streamingContent) ||
    isStreaming ||
    Boolean(chat.error);
  const streamingTransition = {
    duration: 0.14,
    ease: [0.16, 1, 0.3, 1] as const,
    y: 4,
  };

  // ---------------------------------------------------------------------------
  // Auto-scroll to bottom
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasConversationContent) return;
    if (!shouldStickToBottomRef.current) return;
    if (!isStreaming && chat.messages.length === prevMessagesCountRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    chat.messages.length,
    chat.streamingContent,
    hasConversationContent,
    isStreaming,
    scrollToBottom,
    shouldStickToBottomRef,
  ]);

  useEffect(() => {
    prevMessagesCountRef.current = chat.messages.length;
  }, [chat.messages.length]);

  // ---------------------------------------------------------------------------
  // Hash-based message scrolling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!sessionId || chat.messages.length === 0) return;
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
    chat.messages.length,
    getScrollSurface,
    getScrollViewportHeight,
    isBodyScrollChat,
    sessionId,
  ]);

  // ---------------------------------------------------------------------------
  // Context tickers & suggested prompts
  // ---------------------------------------------------------------------------

  const contextTickers = getSessionTickers(chat.session, activeTicker);
  const contextTickersKey = contextTickers.join(",");
  const contextCompanies = contextTickers.map((contextTicker) => {
    const normalizedTicker = contextTicker.trim().toUpperCase();
    return (
      companyMetaByTicker[normalizedTicker] ?? {
        ticker: normalizedTicker,
        name: null,
        sector: null,
      }
    );
  });
  const contextLabel = contextCompanies
    .map((company) =>
      company.name ? `${company.name} (${company.ticker})` : company.ticker,
    )
    .join(", ");
  const contextTickerText = contextCompanies
    .map((company) => company.ticker)
    .join(" / ");
  const contextNameText = contextCompanies
    .map((company) => company.name)
    .filter((name): name is string => Boolean(name))
    .join(", ");
  const contextSectorText = Array.from(
    new Set(
      contextCompanies
        .map((company) => company.sector)
        .filter((sector): sector is string => Boolean(sector)),
    ),
  ).join(" / ");
  const suggestedPrompts = getSuggestedPromptsForTickers(contextTickers);
  const queryValue = queryParam?.trim() || null;
  const shareQuestionValue = shareStarter?.question_content.trim() || null;
  const templateQuestion =
    templateTopic &&
    activeTicker?.trim().toUpperCase() === templateTopic.questionChain.ticker
      ? templateTopic.questionChain.primaryQuestion
      : (templateTopic?.question ?? null);
  const initialComposerValue =
    queryValue ?? shareQuestionValue ?? templateQuestion ?? undefined;
  const prefillSource = queryValue
    ? "url_query"
    : shareQuestionValue
      ? "share_cta"
      : templateTopic
      ? "template_id"
      : null;
  const hasComposerPrefillParams = Boolean(
    queryParam || templateId || shareToken || shareStarter,
  );
  const serializedSearchParams = searchParams.toString();

  // ---------------------------------------------------------------------------
  // Session creation for drafts
  // ---------------------------------------------------------------------------

  const createSessionForDraft = useCallback(async (): Promise<string | null> => {
    const normalizedTicker = activeTicker?.trim().toUpperCase();
    const requestBody: CreateSessionRequest = {
      scope_type: normalizedTicker ? "company" : "global",
      default_tickers: normalizedTicker ? [normalizedTicker] : [],
      default_document_types: [],
    };

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      setSessionError(
        errorData?.error?.message || "새 채팅을 만들지 못했습니다.",
      );
      return null;
    }

    const data = (await response.json()) as CreateSessionResponse;
    return data.session.id;
  }, [activeTicker, setSessionError]);

  const clearComposerPrefillParams = useCallback(() => {
    if (!hasComposerPrefillParams) return;

    const nextParams = new URLSearchParams(serializedSearchParams);
    nextParams.delete("query");
    nextParams.delete("templateId");
    nextParams.delete("shareToken");
    const nextQuery = nextParams.toString();
    const basePath = isDraftRoute ? "/chat/new" : "/chat";
    setShareStarter(null);
    router.replace(`${basePath}${nextQuery ? `?${nextQuery}` : ""}`, {
      scroll: false,
    });
  }, [hasComposerPrefillParams, isDraftRoute, router, serializedSearchParams]);

  useEffect(() => {
    const token = shareToken?.trim();
    if (!token) {
      loadedShareTokenRef.current = null;
      return;
    }

    if (loadedShareTokenRef.current === token) return;
    loadedShareTokenRef.current = token;
    const shareTokenValue = token;
    setShareStarter(null);

    let stale = false;

    async function loadShareStarter() {
      try {
        const response = await fetch(
          `/api/share/${encodeURIComponent(shareTokenValue)}/starter`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => null)) as
          | Partial<ShareStarter>
          | { error?: { message?: string } }
          | null;

        if (stale || cancelledRef.current) return;

        if (!response.ok || !data || !("question_content" in data)) {
          setSessionError("공유된 질문을 불러오지 못했습니다.");
          return;
        }

        const question = data.question_content?.trim();
        if (!question) {
          setSessionError("공유된 질문을 불러오지 못했습니다.");
          return;
        }

        setSessionError(null);
        setShareStarter({
          question_content: question,
          tickers: Array.isArray(data.tickers)
            ? data.tickers.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          title: typeof data.title === "string" ? data.title : null,
        });
      } catch {
        if (!stale && !cancelledRef.current) {
          setSessionError("공유된 질문을 불러오지 못했습니다.");
        }
      }
    }

    loadShareStarter();

    return () => {
      stale = true;
    };
  }, [shareToken]);

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const trimmedQuestion = initialComposerValue?.trim();
    if (!trimmedQuestion || !prefillSource) return;

    const eventKey = `${prefillSource}:${templateTopic?.slug ?? "custom"}:${trimmedQuestion}:${contextTickersKey || "global"}`;
    if (prefilledQuestionTrackedRef.current === eventKey) return;
    prefilledQuestionTrackedRef.current = eventKey;

    const analyticsTickers = contextTickersKey
      ? contextTickersKey.split(",").filter(Boolean)
      : [];

    trackClientEventSilently("question_prefilled", {
      source: prefillSource,
      template_id: templateTopic?.slug ?? null,
      ticker: analyticsTickers[0] ?? null,
      tickers: analyticsTickers,
      question_length: trimmedQuestion.length,
    });
  }, [contextTickersKey, initialComposerValue, prefillSource, templateTopic?.slug]);

  useEffect(() => {
    if (contextTickers.length === 0) return;

    let stale = false;
    const missingTickers = contextTickers
      .map((contextTicker) => contextTicker.trim().toUpperCase())
      .filter((contextTicker) => !companyMetaByTicker[contextTicker]);

    if (missingTickers.length === 0) return;

    async function loadCompanyMeta() {
      const entries = await Promise.all(
        missingTickers.map(async (missingTicker) => {
          try {
            const res = await fetch(
              `/api/companies?ticker=${encodeURIComponent(missingTicker)}`,
              { cache: "no-store" },
            );
            const data = (await res.json()) as CompaniesResponse;
            const company = data.companies?.find(
              (item) => item.ticker === missingTicker,
            );
            return [
              missingTicker,
              {
                ticker: missingTicker,
                name:
                  company?.name && company.name !== missingTicker
                    ? company.name
                    : null,
                sector: company?.sector ?? null,
              },
            ] as const;
          } catch {
            return [
              missingTicker,
              { ticker: missingTicker, name: null, sector: null },
            ] as const;
          }
        }),
      );

      if (stale || cancelledRef.current) return;
      setCompanyMetaByTicker((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    }

    loadCompanyMeta();

    return () => {
      stale = true;
    };
  }, [companyMetaByTicker, contextTickers, contextTickersKey]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(
    async (content: string): Promise<ComposerSendResult> => {
      const trimmed = content.trim();
      if (!trimmed) {
        return {
          ok: false,
          message: "메시지를 입력해야 합니다.",
        };
      }

      shouldStickToBottomRef.current = true;
      setComposerExpanded({
        stickToBottom: true,
        resetManualScroll: true,
      });

      if (!sessionId) {
        const createdSessionId = await createSessionForDraft();

        if (!createdSessionId) {
          return {
            ok: false,
            message: "채팅 세션을 만들지 못했습니다.",
          };
        }

        const nextDraftMessageId = createClientId();
        const nextRequestId = createClientId();

        if (
          !storeDraftMessage(nextDraftMessageId, {
            content: trimmed,
            requestId: nextRequestId,
          })
        ) {
          setSessionError("새 채팅 메시지를 준비하지 못했습니다.");
          return {
            ok: false,
            message: "새 채팅 메시지를 준비하지 못했습니다.",
          };
        }

        setComposerDraftResetKey((value) => value + 1);
        setShareStarter(null);

        const nextParams = new URLSearchParams({
          sessionId: createdSessionId,
          draftMessageId: nextDraftMessageId,
        });
        router.replace(`/chat?${nextParams.toString()}`, {
          scroll: false,
        });
        return { ok: true };
      }

      clearComposerPrefillParams();
      try {
        const result = await sendMessage(trimmed);
        if (result.ok) return { ok: true };
        return { ok: false, message: result.message };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "메시지를 보내지 못했습니다. 다시 시도해주세요.",
        };
      }
    },
    [
      clearComposerPrefillParams,
      createSessionForDraft,
      router,
      sendMessage,
      sessionId,
      setComposerExpanded,
      setSessionError,
      shouldStickToBottomRef,
    ],
  );

  async function handlePromptSend(prompt: string) {
    setComposerDraftResetKey((current) => current + 1);
    await handleSend(prompt);
  }

  const handleCancel = useCallback(async () => {
    await cancelRun();
  }, [cancelRun]);

  const handleNewsEventSelection = useCallback(
    async (params: { artifactId: string; eventId: string }) => {
      await sendNewsEventSelection(params);
    },
    [sendNewsEventSelection],
  );

  // Escape key to cancel streaming
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && chat.status === "running") {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chat.status, handleCancel]);

  useEffect(() => {
    const alertLevel = entitlement?.usage.alert_level;
    if (!alertLevel || alertLevel === "ok") return;

    const eventKey = `${entitlement.plan.key}:${entitlement.usage.period_start}:${alertLevel}:${entitlement.usage.budget_used_usd}:${entitlement.usage.budget_reserved_usd}`;
    if (budgetAlertTrackedRef.current === eventKey) return;
    budgetAlertTrackedRef.current = eventKey;

    trackClientEventSilently(
      alertLevel === "blocked" ? "usage_limit_reached" : "usage_warning_shown",
      {
        plan: entitlement.plan.key,
        budget_used_usd: entitlement.usage.budget_used_usd,
        budget_reserved_usd: entitlement.usage.budget_reserved_usd,
        budget_limit_usd: entitlement.usage.budget_limit_usd,
        percent_used: entitlement.usage.percent_used,
      },
    );
  }, [entitlement]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-[100dvh] bg-canvas pt-[72px] md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:pt-0">
      {/* Top Nav */}
      <TopNav
        brandHref="/companies"
        brandAriaLabel="회사 목록으로 이동"
        hideAccountMenu
        showSidebarTrigger
        mobileOverlay
        mobileCollapsed={mobileHeaderHidden}
      />

      {/* Main Workspace */}
      <main id="main-content" className="mx-auto w-full max-w-[1280px] md:flex md:min-h-0 md:flex-1 md:overflow-hidden">
        {/* Chat Canvas */}
        <div className="relative min-w-0 bg-canvas md:flex md:flex-1 md:flex-col">
          {/* Chat History */}
          <div
            ref={scrollRef}
            className="px-base sm:px-xl md:flex-1 md:overflow-y-auto"
            aria-label="채팅 메시지"
            aria-relevant="additions text"
            role="log"
          >
            {/* Spacer */}
            <div className="h-xl sm:h-[96px] md:hidden" />

            {/* Company research context */}
            {contextTickers.length > 0 && (
              <div className="mx-auto mb-base w-full max-w-3xl">
                <div
                  className="max-w-full"
                  aria-label={`분석 대상: ${contextLabel}`}
                >
                  <p className="font-mono text-[14px] font-black leading-5 tracking-[0.08em] text-primary sm:text-[15px]">
                    {contextTickerText}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] font-bold leading-5 text-muted sm:text-[13px]">
                    {[contextNameText || "기업 리서치", contextSectorText]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
            )}

            {/* L-09: Loading skeleton for session */}
            {/* H-06: Session creation error */}
            {effectiveSessionError && (
              <div className="mx-auto max-w-3xl">
                <div
                  className="rounded-[8px] border border-error/20 bg-error-container/10 p-base text-[15px] leading-[1.5] text-error sm:p-lg sm:text-[16px]"
                  role="alert"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined mr-xs text-[18px] align-middle"
                  >
                    error
                  </span>
                  {effectiveSessionError}
                </div>
              </div>
            )}

            {isHydratingSession && (
              <div
                className="mx-auto w-full max-w-4xl space-y-lg"
                aria-label="채팅 불러오는 중"
                role="status"
              >
                <div className="flex justify-end">
                  <div className="h-[72px] w-[72%] animate-pulse rounded-[8px] bg-surface-strong" />
                </div>
                <div className="space-y-sm pl-0 sm:pl-[48px]">
                  <div className="h-5 w-36 animate-pulse rounded-full bg-surface-strong" />
                  <div className="h-4 w-full animate-pulse rounded-full bg-surface-strong" />
                  <div className="h-4 w-[88%] animate-pulse rounded-full bg-surface-strong" />
                  <div className="h-4 w-[64%] animate-pulse rounded-full bg-surface-strong" />
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="mx-auto w-full min-w-0 max-w-4xl space-y-lg sm:space-y-xl">
              {chat.messages
                .filter((msg): msg is typeof msg & { role: "user" | "assistant" } =>
                  msg.role === "user" || msg.role === "assistant"
                )
                .map((msg, idx, arr) => {
                  const isLatestAssistantMessage =
                    msg.role === "assistant" &&
                    idx === arr.length - 1 &&
                    chat.status === "completed";

                  return (
                    <ChatMessage
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      status={msg.status}
                      messageId={msg.role === "assistant" ? msg.id : undefined}
                      createdAt={
                        msg.role === "assistant" ? msg.created_at : undefined
                      }
                      citations={
                        isLatestAssistantMessage ? chat.citations : undefined
                      }
                      artifacts={
                        msg.role === "assistant"
                          ? chat.artifactsByMessageId[msg.id]
                          : undefined
                      }
                      artifactSelections={chat.artifactSelections}
                      onSelectNewsEvent={handleNewsEventSelection}
                      newsEventSelectionDisabled={isStreaming || isBudgetBlocked}
                      showHeader={idx === 0 || arr[idx - 1]?.role !== "assistant"}
                      toolCalls={
                        isLatestAssistantMessage ? chat.toolCalls : undefined
                      }
                      workDurationMs={
                        isLatestAssistantMessage && msg.role === "assistant"
                          ? chat.runDurationsByMessageId[msg.id]
                          : null
                      }
                    />
                  );
                })}

              <AnimatePresence mode="wait" initial={false}>
                {isStreaming && chat.streamingContent && (
                  <motion.div
                    key="streaming-content"
                    initial={{ opacity: 0, y: streamingTransition.y }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -streamingTransition.y }}
                    transition={{
                      duration: streamingTransition.duration,
                      ease: streamingTransition.ease,
                    }}
                  >
                    <ChatMessage
                      role="assistant"
                      content={chat.streamingContent}
                      isStreaming={true}
                      activity={chat.activity}
                      citations={chat.citations}
                      runStartedAt={chat.runStartedAt}
                      showHeader={
                        chat.messages.length === 0 ||
                        chat.messages[chat.messages.length - 1]?.role !== "assistant"
                      }
                      toolCalls={chat.toolCalls}
                    />
                  </motion.div>
                )}
                {isStreaming && !chat.streamingContent && (
                  <motion.div
                    key="streaming-loading"
                    initial={{ opacity: 0, y: streamingTransition.y }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -streamingTransition.y }}
                    transition={{
                      duration: streamingTransition.duration,
                      ease: streamingTransition.ease,
                    }}
                  >
                    <ChatMessage
                      role="assistant"
                      content=""
                      isStreaming={true}
                      activity={chat.activity}
                      citations={chat.citations}
                      runStartedAt={chat.runStartedAt}
                      showHeader={
                        chat.messages.length === 0 ||
                        chat.messages[chat.messages.length - 1]?.role !== "assistant"
                      }
                      toolCalls={chat.toolCalls}
                    />
                  </motion.div>
                )}
                {chat.error && (
                  <motion.div
                    key="chat-error"
                    initial={{ opacity: 0, y: streamingTransition.y }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -streamingTransition.y }}
                    transition={{
                      duration: streamingTransition.duration,
                      ease: streamingTransition.ease,
                    }}
                  >
                    <div className="flex w-full flex-col">
                      <div className="pl-0 sm:pl-[48px]">
                        <div
                          className="rounded-[8px] border border-error/20 bg-error-container/10 p-base text-[15px] leading-[1.5] text-error sm:p-lg sm:text-[16px]"
                          role="alert"
                        >
                          <span
                            aria-hidden="true"
                            className="material-symbols-outlined mr-xs text-[18px] align-middle"
                          >
                            error
                          </span>
                          {sanitizeError(chat.error)}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Empty state */}
              {chat.messages.length === 0 &&
                !isHydratingSession &&
                !isStreaming &&
                !sessionError && (
                  <div className="mx-auto grid w-full max-w-4xl gap-7 py-lg sm:py-xxl md:grid-cols-[minmax(0,1fr)_320px] md:items-start">
                  <motion.div
                    className="min-w-0 border-b border-hairline-soft pb-6 md:border-b-0 md:pb-0 md:pr-6"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: "easeOut" }}
                  >
                    <h2 className="text-balance text-[24px] font-black leading-[1.16] text-ink sm:text-[38px]">
                      {contextTickers.length > 0
                        ? `${contextTickerText}에서 무엇을 확인할까요?`
                        : "무엇을 확인할까요?"}
                    </h2>
                    <p className="mt-4 max-w-2xl text-[15px] leading-7 text-body sm:text-[16px]">
                      {contextTickers.length > 0
                        ? "매출 변화, 마진 흐름, 리스크 요인을 회사 보고서 기준으로 정리합니다."
                        : "기업, 기간, 사업 흐름을 함께 적어 리서치를 시작하세요."}
                    </p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: 0.06, ease: "easeOut" }}
                  >
                    <SuggestedPromptActions
                      prompts={suggestedPrompts}
                      groupId="empty-state-prompts"
                      disabled={isStreaming || Boolean(effectiveSessionError)}
                      analytics={{
                        sourceSurface: "chat_empty_state",
                        ticker: contextTickers[0] ?? null,
                        tickers: contextTickers,
                        promptCategory: "starter",
                        promptIds: suggestedPrompts.map(
                          (_, index) => `chat_empty_starter_${index + 1}`,
                        ),
                      }}
                      onSelect={(prompt) => {
                        void handlePromptSend(prompt);
                      }}
                    />
                  </motion.div>
                </div>
              )}

              {/* Spacer for fixed composer overlay — dynamically measured */}
              <div
                className="md:hidden"
                style={{
                  height: isBodyScrollChat
                    ? isComposerCompact
                      ? 88
                      : composerHeight + 28
                    : undefined,
                }}
                aria-hidden="true"
              />
              <div className="hidden h-xl md:block" aria-hidden="true" />
            </div>
          </div>

          {isBudgetBlocked && entitlement && (
            <div className="border-t border-hairline bg-canvas px-base py-sm sm:px-lg">
              <div className="mx-auto max-w-4xl rounded-[8px] border border-error/20 bg-error-container/10 px-base py-sm text-[13px] font-semibold leading-5 text-error">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined mr-xs text-[18px] align-middle"
                >
                  lock
                </span>
                {entitlement.upgrade.title} {entitlement.upgrade.message}
              </div>
            </div>
          )}

          {isStreaming && (
            <div className="hidden md:block">
              <RunStatusDock
                onCancel={handleCancel}
                activity={chat.activity}
                toolCalls={chat.toolCalls}
                runStartedAt={chat.runStartedAt}
              />
            </div>
          )}

          {/* Full composer (expanded / focused) */}
          <div
            ref={composerHostRef}
            className={[
              "pointer-events-none fixed inset-x-0 bottom-0 z-30 transform-gpu transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform md:pointer-events-auto md:static md:z-auto md:translate-y-0 md:opacity-100 md:transition-none",
              isComposerCompact ? "opacity-0" : "opacity-100",
              isStreaming ? "md:hidden" : "",
            ].join(" ")}
            style={{
              transform: isBodyScrollChat
                ? isComposerCompact
                  ? `translate3d(0, calc(100% + 24px), 0)`
                  : `translate3d(0, -${keyboardOffset}px, 0)`
                : "translate3d(0, 0, 0)",
            }}
            aria-hidden={isComposerCompact ? true : undefined}
            inert={isComposerCompact ? true : undefined}
            onPointerDownCapture={handleComposerPointerDown}
          >
            <Composer
              onSend={handleSend}
              onCancel={handleCancel}
              activity={chat.activity}
              disabled={Boolean(effectiveSessionError) || isBudgetBlocked}
              isGenerating={isStreaming}
              placeholder={
                effectiveSessionError
                  ? "인덱스에 있는 회사만 채팅할 수 있습니다."
                  : isBudgetBlocked
                  ? "분석 크레딧을 모두 사용했습니다."
                  : "기업에 대해 질문하세요..."
              }
              toolCalls={chat.toolCalls}
              initialValue={initialComposerValue}
              draftResetKey={composerDraftResetKey}
              runStartedAt={chat.runStartedAt}
              researchMode={researchMode}
              onResearchModeChange={setResearchMode}
              analysisMode={analysisMode}
              onAnalysisModeChange={setAnalysisMode}
              focusRequestKey={composerFocusRequestKey}
              onFocusChange={handleComposerFocusChange}
            />
          </div>

          {/* Compact pill — shown when full composer slides away */}
          <AnimatePresence>
            {isComposerCompact && (
              <motion.div
                key="compact-composer-pill"
                className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-base pb-[calc(env(safe-area-inset-bottom)+10px)] md:hidden"
                style={{
                  transform: `translate3d(0, -${keyboardOffset}px, 0)`,
                }}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{
                  duration: 0.18,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-hairline bg-canvas/94 p-1 shadow-[0_14px_42px_rgba(10,11,13,0.18)] backdrop-blur-md">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-extrabold text-ink active:bg-surface-dim"
                    onClick={isStreaming ? revealComposer : revealComposerForTyping}
                    aria-label={isStreaming ? "분석 상태 보기" : "질문 입력"}
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        "material-symbols-outlined text-[19px]",
                        isStreaming ? "animate-spin" : "",
                      ].join(" ")}
                    >
                      {isStreaming ? "progress_activity" : "edit"}
                    </span>
                    <span>{isStreaming ? "분석 진행중" : "질문 입력"}</span>
                  </button>

                  {isStreaming && (
                    <button
                      type="button"
                      className="inline-flex h-10 items-center rounded-full bg-surface-dim px-3 text-[13px] font-extrabold text-error active:scale-95"
                      onClick={handleCancel}
                      aria-label="응답 생성 중지"
                    >
                      중지
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-canvas">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
