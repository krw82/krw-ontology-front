"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AnimatePresence, motion } from "motion/react";
import TopNav from "@/components/TopNav";
import ChatMessage from "@/components/ChatMessage";
import CompanyLogo from "@/components/CompanyLogo";
import Composer, {
  type ComposerHandle,
  type ComposerSendOptions,
  type ComposerSendResult,
} from "@/components/Composer";
import QueueRemotionAnimation from "@/components/QueueRemotionAnimation";
import SuggestedPromptActions from "@/components/SuggestedPromptActions";
import RunStatusDock from "@/components/RunStatusDock";
import CreditLimitErrorCard from "@/components/chat/CreditLimitErrorCard";
import RecoverableChatErrorCard from "@/components/chat/RecoverableChatErrorCard";
import ChatWatchlistHeaderActions from "@/components/chat/ChatWatchlistHeaderActions";
import DiscoverGuideFlow from "@/components/chat/DiscoverGuideFlow";
import GuruCompanyPicker from "@/components/chat/GuruCompanyPicker";
import GuruLensContextHeader from "@/components/chat/GuruLensContextHeader";
import { useChat } from "@/hooks/useChat";
import { useChatMobileDock } from "@/hooks/useChatMobileDock";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useResearchModePreference } from "@/hooks/useResearchModePreference";
import { useGuruCompanyPicker } from "@/hooks/useGuruCompanyPicker";
import { useChatSessionLifecycle } from "@/hooks/useChatSessionLifecycle";
import { useShareStarter } from "@/hooks/useShareStarter";
import { useChatCompanyMeta } from "@/hooks/useChatCompanyMeta";
import { useChatAnalytics } from "@/hooks/useChatAnalytics";
import { useChatScrollEffects } from "@/hooks/useChatScrollEffects";
import { useDiscoverGuide } from "@/hooks/useDiscoverGuide";
import {
  getSessionTickers,
  buildChatSessionHref,
} from "@/lib/chat/history-state";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { findQuestionTopic } from "@/lib/marketing/site";
import { deriveChatPresentationContext } from "@/lib/chat/presentation-context";
import { createClientId } from "@/lib/client-id";
import {
  storeDraftMessage,
} from "@/lib/chat/draft-message";
import {
  isChatInputError,
  isWeeklyAnalysisLimitError,
  toUserFacingChatError,
} from "@/lib/chat/user-facing-error";
import type { CompanyMeta } from "@/lib/chat/company-meta";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { normalizeRunKind } from "@/lib/run-kind";
import {
  buildGuruSessionHref,
  getGuruLens,
  normalizeGuruLensKey,
} from "@/lib/guru-lenses";
import type { ResearchMode } from "@/lib/research-mode";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
} from "@/types/api-contracts";

const ALWAYS_SHOW_NOTEBOOK_ONBOARDING_IN_DEV =
  process.env.NODE_ENV === "development";
const ALWAYS_SHOW_CREDIT_LIMIT_CARD_IN_DEV =
  process.env.NODE_ENV === "development";

function supportCodeFor(runId: string | null, sessionId: string | null): string {
  const raw = runId ?? sessionId ?? "chat";
  let hash = 0;
  for (const character of raw) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return `R-${(hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

type ChatWorkspace = "chat" | "guru";

function ChatContent({ workspace = "chat" }: { workspace?: ChatWorkspace }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ticker = searchParams.get("ticker");
  const queryParam = searchParams.get("query");
  const shareToken = searchParams.get("shareToken");
  const templateId = searchParams.get("templateId");
  const draftMessageId = searchParams.get("draftMessageId");
  const localeParam = searchParams.get("locale");
  const runKindParam = searchParams.get("runKind");
  const guruParam = searchParams.get("guru");
  const entryParam = searchParams.get("entry");
  const filingEventId = searchParams.get("filing_event_id");
  const isDiscoverRoute = pathname === "/discover";
  const isGuruRoute = pathname === "/guru";
  const isGuruWorkspace = workspace === "guru" || isGuruRoute;
  const templateTopic = templateId ? findQuestionTopic(templateId) : null;
  const existingSessionId = searchParams.get("sessionId");
  const responseLocale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;
  const requestedRunKind = isGuruWorkspace
    ? "guru_advisor"
    : isDiscoverRoute
    ? "idea_generation"
    : runKindParam
      ? normalizeRunKind(runKindParam)
      : undefined;
  const isIdeaGeneration = requestedRunKind === "idea_generation";
  const isGuruAdvisor = requestedRunKind === "guru_advisor";

  const sessionId = existingSessionId;
  const [sessionError, setSessionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerHostRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const { entitlement, refresh: refreshEntitlement } = useEntitlement();
  const [researchMode, setResearchMode] = useResearchModePreference(sessionId);
  const effectiveResearchMode: ResearchMode = isIdeaGeneration || isGuruAdvisor
    ? "deep"
    : researchMode;
  const [composerDraftResetKey, setComposerDraftResetKey] = useState(0);
  const composerRef = useRef<ComposerHandle>(null);

  // H-07: cleanup on unmount to prevent race condition
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const { shareStarter, clearShareStarter } = useShareStarter({
    shareToken,
    cancelledRef,
    onSessionError: setSessionError,
  });

  const isDraftRoute = pathname === "/chat/new" || isDiscoverRoute || isGuruRoute;
  const shareStarterTicker = normalizeTicker(shareStarter?.tickers[0] ?? "");
  const activeTicker = normalizeTicker(ticker ?? "") ?? shareStarterTicker;
  const selectedGuruLensKey = normalizeGuruLensKey(guruParam) ?? "auto";
  const selectedGuruLens = getGuruLens(selectedGuruLensKey);

  const guruCompanyPicker = useGuruCompanyPicker({
    enabled: isGuruAdvisor,
    locale: responseLocale,
  });

  const effectiveSessionError =
    existingSessionId || !activeTicker ? null : sessionError;

  const handleSessionCreated = useCallback(
    (createdSessionId: string) => {
      if (!isDraftRoute && existingSessionId) return;
      if (isGuruAdvisor) {
        router.replace(
          buildGuruSessionHref(
            createdSessionId,
            responseLocale,
            selectedGuruLens.key,
            activeTicker,
          ),
          { scroll: false },
        );
        return;
      }
      router.replace(
        buildChatSessionHref(createdSessionId, {
          locale: responseLocale,
          ticker: activeTicker,
          runKind: requestedRunKind,
        }),
        { scroll: false },
      );
    },
    [
      activeTicker,
      existingSessionId,
      isDraftRoute,
      isGuruAdvisor,
      requestedRunKind,
      responseLocale,
      router,
      selectedGuruLens.key,
    ],
  );

  const chat = useChat({
    sessionId: sessionId ?? "",
    scopeType: activeTicker ? "company" : "global",
    defaultTickers: activeTicker ? [activeTicker] : [],
    researchMode: effectiveResearchMode,
    runKind: requestedRunKind,
    responseLocale,
    onSessionCreated: handleSessionCreated,
  });
  const sendMessage = chat.sendMessage;
  const sendNewsEventSelection = chat.sendNewsEventSelection;
  const cancelRun = chat.cancelRun;
  const isQueued = chat.status === "queued" || chat.activity?.stage === "queued";
  const isRunning = chat.status === "running";
  const isActiveRun = isQueued || isRunning;

  const contextTickers = getSessionTickers(chat.session, activeTicker);
  const contextTickersKey = contextTickers.join(",");
  const { companyMetaByTicker, setCompanyMetaByTicker } = useChatCompanyMeta({
    activeTicker,
    existingSessionId,
    contextTickers,
    contextTickersKey,
    cancelledRef,
    onSessionError: setSessionError,
  });

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
    isStreaming: isActiveRun,
  });

  useChatSessionLifecycle({
    sessionId,
    draftMessageId,
    activeTicker,
    isGuruAdvisor,
    requestedRunKind,
    responseLocale,
    guruLensKey: selectedGuruLens.key,
    chatStatus: chat.status,
    chatRunId: chat.runId,
    sendMessage,
    loadSession: chat.loadSession,
    refreshEntitlement,
    cancelledRef,
  });

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isHydratingSession = Boolean(sessionId && chat.isHydratingSession);
  const isBudgetBlocked = entitlement?.usage.can_run === false;
  const userFacingChatError = toUserFacingChatError(chat.error);
  const isInputError = isChatInputError(userFacingChatError);
  const isCreditLimitError = isWeeklyAnalysisLimitError(userFacingChatError);
  const shouldPreviewCreditLimitCard =
    ALWAYS_SHOW_CREDIT_LIMIT_CARD_IN_DEV && !chat.error;
  const shouldShowCreditLimitCard =
    isCreditLimitError || shouldPreviewCreditLimitCard;
  const shouldShowChatError = Boolean(chat.error) || shouldPreviewCreditLimitCard;
  const hasConversationContent =
    chat.messages.length > 0 ||
    Boolean(chat.streamingContent) ||
    isActiveRun ||
    Boolean(chat.error);
  const hasCompletedAssistantAnswer = chat.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "completed" &&
      message.content.trim().length > 0,
  );
  const latestCompletedAssistantMessage = [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        message.status === "completed" &&
        message.content.trim().length > 0,
    );
  const retryPrompt =
    chat.lastAttemptedContent ??
    [...chat.messages]
      .reverse()
      .find((message) => message.role === "user" && message.content.trim())
      ?.content ??
    null;
  const shouldShowDiscoverGuide =
    isIdeaGeneration &&
    chat.messages.length === 0 &&
    !isHydratingSession &&
    !isActiveRun &&
    !effectiveSessionError;
  const shouldHideDiscoverComposer = shouldShowDiscoverGuide;
  const streamingTransition = {
    duration: 0.14,
    ease: [0.16, 1, 0.3, 1] as const,
    y: 4,
  };

  useChatScrollEffects({
    sessionId,
    messageCount: chat.messages.length,
    streamingContent: chat.streamingContent,
    hasConversationContent,
    isActiveRun,
    shouldStickToBottomRef,
    scrollToBottom,
    getScrollSurface,
    getScrollViewportHeight,
    isBodyScrollChat,
  });

  // ---------------------------------------------------------------------------
  // Context tickers & suggested prompts
  // ---------------------------------------------------------------------------

  const {
    contextLabel,
    contextTickerText,
    contextDisplayText,
    contextNameText,
    contextSectorText,
    headerActionTicker,
    primaryContextCompany,
    guruContextCompany,
    suggestedPrompts,
    emptyStateCopy,
    initialComposerValue,
    prefillSource,
  } = deriveChatPresentationContext({
    contextTickers,
    companyMetaByTicker,
    responseLocale,
    isGuruAdvisor,
    isIdeaGeneration,
    selectedGuruLens,
    queryParam,
    templateId,
    shareToken,
    shareStarter,
    templateTopic,
    activeTicker,
  });
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
      ...(filingEventId ? { source_filing_event_id: filingEventId } : {}),
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
  }, [activeTicker, filingEventId, setSessionError]);

  const clearComposerPrefillParams = useCallback(() => {
    if (!hasComposerPrefillParams) return;

    const nextParams = new URLSearchParams(serializedSearchParams);
    nextParams.delete("query");
    nextParams.delete("templateId");
    nextParams.delete("shareToken");
    const nextQuery = nextParams.toString();
    const basePath = isGuruAdvisor
      ? "/guru"
      : isDiscoverRoute
      ? "/discover"
      : isDraftRoute
        ? "/chat/new"
        : "/chat";
    clearShareStarter();
    router.replace(`${basePath}${nextQuery ? `?${nextQuery}` : ""}`, {
      scroll: false,
    });
  }, [
    clearShareStarter,
    hasComposerPrefillParams,
    isDiscoverRoute,
    isDraftRoute,
    isGuruAdvisor,
    router,
    serializedSearchParams,
  ]);

  useChatAnalytics({
    initialComposerValue,
    prefillSource,
    templateSlug: templateTopic?.slug,
    contextTickersKey,
    entitlement,
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(
    async (
      content: string,
      options?: ComposerSendOptions,
    ): Promise<ComposerSendResult> => {
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

      const outboundContent = trimmed;

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
            content: outboundContent,
            requestId: nextRequestId,
            ...(requestedRunKind ? { runKind: requestedRunKind } : {}),
            ...(isGuruAdvisor ? { guruLensKey: selectedGuruLens.key } : {}),
            userUrl: options?.userUrl,
            userUrls: options?.userUrls,
            attachmentIds: options?.attachmentIds,
          })
        ) {
          setSessionError("새 채팅 메시지를 준비하지 못했습니다.");
          return {
            ok: false,
            message: "새 채팅 메시지를 준비하지 못했습니다.",
          };
        }

        setComposerDraftResetKey((value) => value + 1);
        clearShareStarter();

        const nextParams = new URLSearchParams({
          sessionId: createdSessionId,
          draftMessageId: nextDraftMessageId,
        });
        if (activeTicker) {
          nextParams.set("ticker", activeTicker);
        }
        if (requestedRunKind && !isGuruAdvisor) {
          nextParams.set("runKind", requestedRunKind);
        }
        if (isGuruAdvisor && selectedGuruLens.key !== "auto") {
          nextParams.set("guru", selectedGuruLens.key);
        }
        if (responseLocale !== DEFAULT_LOCALE) {
          nextParams.set("locale", responseLocale);
        }
        const nextHref = isGuruAdvisor
          ? `/guru?${nextParams.toString()}`
          : `/chat?${nextParams.toString()}`;
        router.replace(nextHref, {
          scroll: false,
        });
        return { ok: true };
      }

      clearComposerPrefillParams();
      try {
        const result = await sendMessage(outboundContent, {
          runKind: requestedRunKind,
          guruLensKey: isGuruAdvisor ? selectedGuruLens.key : undefined,
          userUrl: options?.userUrl,
          userUrls: options?.userUrls,
          attachmentIds: options?.attachmentIds,
        });
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
      activeTicker,
      clearComposerPrefillParams,
      clearShareStarter,
      createSessionForDraft,
      router,
      sendMessage,
      sessionId,
      responseLocale,
      isGuruAdvisor,
      requestedRunKind,
      selectedGuruLens.key,
      setComposerExpanded,
      setSessionError,
      shouldStickToBottomRef,
    ],
  );

  async function handlePromptSend(prompt: string) {
    setComposerDraftResetKey((current) => current + 1);
    await handleSend(prompt);
  }

  const discoverGuide = useDiscoverGuide({
    composerRef,
    responseLocale,
    onSend: handleSend,
    initialStep: entryParam === "onboarding" ? "idea" : "url",
  });

  function openGuruCompanyPicker() {
    guruCompanyPicker.open(activeTicker ?? "");
  }

  function handleGuruCompanySelect(company: CompanyMeta) {
    const normalizedTicker = company.ticker.trim().toUpperCase();
    if (!normalizedTicker) return;

    setCompanyMetaByTicker((current) => ({
      ...current,
      [normalizedTicker]: { ...company, ticker: normalizedTicker },
    }));
    guruCompanyPicker.close();

    const params = new URLSearchParams();
    params.set("ticker", normalizedTicker);
    if (selectedGuruLens.key !== "auto") {
      params.set("guru", selectedGuruLens.key);
    }
    if (responseLocale !== DEFAULT_LOCALE) {
      params.set("locale", responseLocale);
    }

    router.push(`/guru?${params.toString()}`);
  }

  const handleCancel = useCallback(async () => {
    await cancelRun();
  }, [cancelRun]);

  const handleRetry = useCallback(() => {
    if (!retryPrompt || isBudgetBlocked || isActiveRun) return;
    void handleSend(retryPrompt);
  }, [handleSend, isActiveRun, isBudgetBlocked, retryPrompt]);

  const handleShowPriorEvidence = useCallback(() => {
    if (!latestCompletedAssistantMessage) return;
    document
      .getElementById(`chat-message-${latestCompletedAssistantMessage.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [latestCompletedAssistantMessage]);

  const handleNewsEventSelection = useCallback(
    async (params: { artifactId: string; eventId: string }) => {
      await sendNewsEventSelection(params);
    },
    [sendNewsEventSelection],
  );

  // Escape key to cancel streaming
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isActiveRun) {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCancel, isActiveRun]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const mobileComposerBottomBuffer = isGuruAdvisor ? 72 : 28;
  const mobileCompactComposerHeight = isGuruAdvisor ? 116 : 88;
  const mobileComposerSpacerHeight = isBodyScrollChat
    ? shouldHideDiscoverComposer
      ? 0
      : isComposerCompact
        ? mobileCompactComposerHeight + keyboardOffset
        : composerHeight + keyboardOffset + mobileComposerBottomBuffer
    : undefined;

  return (
    <div className="min-h-[100dvh] bg-canvas pt-[72px] md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:pt-0">
      {/* Top Nav */}
      <TopNav
        brandHref="/companies"
        brandAriaLabel="회사 목록으로 이동"
        hideAccountMenu
        showChatHistoryTrigger
        mobileOverlay
        mobileCollapsed={mobileHeaderHidden}
        actionSlot={
          headerActionTicker ? (
            <ChatWatchlistHeaderActions
              ticker={headerActionTicker}
              showNotebookOnboarding={
                ALWAYS_SHOW_NOTEBOOK_ONBOARDING_IN_DEV ||
                hasCompletedAssistantAnswer
              }
              forceShowNotebookOnboarding={
                ALWAYS_SHOW_NOTEBOOK_ONBOARDING_IN_DEV
              }
            />
          ) : null
        }
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
                  data-onboarding-target="chat-context"
                  className="flex max-w-full items-center gap-3 sm:gap-4"
                  aria-label={`분석 대상: ${contextLabel}`}
                >
                  {primaryContextCompany ? (
                    <CompanyLogo
                      ticker={primaryContextCompany.ticker}
                      companyName={
                        contextDisplayText || primaryContextCompany.name || primaryContextCompany.ticker
                      }
                      imageSize={112}
                      className="h-12 w-12 text-[12px] sm:h-14 sm:w-14"
                    />
                  ) : null}
                  <div className="min-w-0">
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
              </div>
            )}

            {isGuruAdvisor &&
            selectedGuruLens.key !== "auto" &&
            (hasConversationContent || isHydratingSession) && (
              <GuruLensContextHeader
                lens={selectedGuruLens}
                locale={responseLocale}
                compact
              />
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
                    <div
                      key={msg.id}
                      id={
                        msg.role === "assistant"
                          ? `chat-message-${msg.id}`
                          : undefined
                      }
                    >
                      <ChatMessage
                        role={msg.role}
                        content={msg.content}
                        presentation={
                          isGuruAdvisor && msg.role === "assistant"
                            ? "guru"
                            : "default"
                        }
                        metadata={msg.metadata}
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
                        charts={
                          msg.role === "assistant"
                            ? chat.chartsByMessageId[msg.id]
                            : undefined
                        }
                        artifactSelections={chat.artifactSelections}
                        onSelectNewsEvent={handleNewsEventSelection}
                        onFollowUpQuestionSelect={(question) => {
                          void handlePromptSend(question);
                        }}
                        followUpQuestionDisabled={isActiveRun || isBudgetBlocked}
                        newsEventSelectionDisabled={isActiveRun || isBudgetBlocked}
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
                    </div>
                  );
                })}

              <AnimatePresence initial={false}>
                {isActiveRun && chat.streamingContent && (
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
                      presentation={isGuruAdvisor ? "guru" : "default"}
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
                {isActiveRun && !chat.streamingContent && (
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
                      presentation={isGuruAdvisor ? "guru" : "default"}
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
                {shouldShowChatError && (
                  <motion.div
                    className="w-full"
                    key={
                      shouldPreviewCreditLimitCard
                        ? "credit-limit-preview"
                        : "chat-error"
                    }
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
                        {shouldShowCreditLimitCard ? (
                          <CreditLimitErrorCard entitlement={entitlement} />
                        ) : isInputError ? (
                          <div
                            className="rounded-[8px] border border-error/20 bg-error-container/10 p-base text-[15px] font-medium leading-6 text-error sm:p-lg sm:text-[16px]"
                            role="alert"
                          >
                            {userFacingChatError}
                          </div>
                        ) : (
                          <RecoverableChatErrorCard
                            message={userFacingChatError}
                            supportCode={supportCodeFor(chat.runId, sessionId)}
                            canRetry={Boolean(retryPrompt) && !isBudgetBlocked}
                            hasPriorEvidence={Boolean(latestCompletedAssistantMessage)}
                            onRetry={handleRetry}
                            onShowPriorEvidence={handleShowPriorEvidence}
                          />
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Empty state */}
              {chat.messages.length === 0 &&
                !isHydratingSession &&
                !isActiveRun &&
                !sessionError && (
                  <div
                    className={[
                      "mx-auto flex w-full flex-col items-center text-center",
                      shouldShowDiscoverGuide
                        ? "min-h-[calc(100dvh-112px)] max-w-[42rem] justify-start pb-lg pt-md sm:pt-lg md:min-h-[calc(100dvh-96px)]"
                        : "min-h-[46dvh] max-w-2xl justify-center py-lg sm:py-xxl md:min-h-[56dvh]",
                    ].join(" ")}
                  >
                    <motion.div
                      className="w-full min-w-0"
                      data-onboarding-target="chat-empty-heading"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, ease: "easeOut" }}
                    >
                      <h2 className="text-balance text-[26px] font-black leading-[1.12] text-ink sm:text-[36px]">
                        {contextTickers.length > 0
                          ? emptyStateCopy.headingWithContext
                          : emptyStateCopy.headingWithoutContext}
                      </h2>
                      {contextTickers.length === 0 ? (
                        <p className="mx-auto mt-3 max-w-[34rem] text-balance text-[15px] font-semibold leading-6 text-body sm:text-[16px]">
                          {emptyStateCopy.descriptionWithoutContext}
                        </p>
                      ) : null}
                    </motion.div>

                    <motion.div
                      className={[
                        "w-full max-w-[38rem] text-left",
                        shouldShowDiscoverGuide ? "mt-4" : "mt-6",
                      ].join(" ")}
                      data-onboarding-target="chat-suggested-prompts"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.24,
                        delay: 0.06,
                        ease: "easeOut",
                      }}
                    >
                      {isIdeaGeneration ? (
                        shouldShowDiscoverGuide ? (
                          <DiscoverGuideFlow
                            locale={responseLocale}
                            step={discoverGuide.step}
                            disabled={
                              !discoverGuide.isClientReady ||
                              !discoverGuide.isComposerReady ||
                              isBudgetBlocked ||
                              Boolean(effectiveSessionError)
                            }
                            urlValue={discoverGuide.urlValue}
                            urlError={discoverGuide.urlError}
                            ideaValue={discoverGuide.ideaValue}
                            ideaError={discoverGuide.ideaError}
                            onUrlValueChange={discoverGuide.onUrlValueChange}
                            onCommitUrl={discoverGuide.onCommitUrl}
                            onSkipUrl={discoverGuide.onSkipUrl}
                            onAddFile={discoverGuide.onAddFile}
                            onSkipFile={discoverGuide.onSkipFile}
                            onIdeaValueChange={discoverGuide.onIdeaValueChange}
                            onSubmitIdea={discoverGuide.onSubmitIdea}
                            onSelectExample={discoverGuide.onSelectExample}
                          />
                        ) : null
                      ) : (
                        <div
                          className="grid gap-4"
                          data-onboarding-target={
                            isGuruAdvisor ? "guru-suggested-prompts" : undefined
                          }
                        >
                          <SuggestedPromptActions
                            prompts={suggestedPrompts}
                            groupId={
                              isGuruAdvisor
                                ? "guru-empty-state-prompts"
                                : "empty-state-prompts"
                            }
                            disabled={isActiveRun || Boolean(effectiveSessionError)}
                            analytics={{
                              sourceSurface: isGuruAdvisor
                                ? "guru_empty_state"
                                : "chat_empty_state",
                              ticker: contextTickers[0] ?? null,
                              tickers: contextTickers,
                              promptCategory: isGuruAdvisor
                                ? selectedGuruLens.key
                                : "starter",
                              promptIds: suggestedPrompts.map(
                                (_, index) =>
                                  isGuruAdvisor
                                    ? `guru_${selectedGuruLens.key}_${index + 1}`
                                    : `chat_empty_starter_${index + 1}`,
                              ),
                            }}
                            onSelect={(prompt) => {
                              void handlePromptSend(prompt);
                            }}
                          />
                        </div>
                      )}
                    </motion.div>
                  </div>
              )}

              {/* Spacer for fixed composer overlay — dynamically measured */}
              <div
                className="md:hidden"
                style={{ height: mobileComposerSpacerHeight }}
                aria-hidden="true"
              />
              <div className="hidden h-xl md:block" aria-hidden="true" />
            </div>
          </div>

          {isBudgetBlocked && entitlement && !shouldShowCreditLimitCard && (
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

          {isActiveRun && (
            <div className="hidden md:block">
              <RunStatusDock
                onCancel={handleCancel}
                activity={chat.activity}
                toolCalls={chat.toolCalls}
                runStartedAt={chat.runStartedAt}
                variant={isQueued ? "queued" : "running"}
              />
            </div>
          )}

          {/* Full composer (expanded / focused) */}
          <div
            ref={composerHostRef}
            data-onboarding-target="chat-composer"
            className={[
              "pointer-events-none fixed inset-x-0 bottom-0 z-30 transform-gpu pb-[calc(env(safe-area-inset-bottom)+10px)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform md:pointer-events-auto md:static md:z-auto md:translate-y-0 md:pb-0 md:opacity-100 md:transition-none",
              isComposerCompact || shouldHideDiscoverComposer
                ? "opacity-0"
                : "opacity-100",
              isActiveRun ? "md:hidden" : "",
            ].join(" ")}
            style={{
              transform: isBodyScrollChat
                ? isComposerCompact || shouldHideDiscoverComposer
                  ? `translate3d(0, calc(100% + 24px), 0)`
                  : `translate3d(0, -${keyboardOffset}px, 0)`
                : "translate3d(0, 0, 0)",
            }}
            aria-hidden={
              isComposerCompact || shouldHideDiscoverComposer ? true : undefined
            }
            inert={
              isComposerCompact || shouldHideDiscoverComposer ? true : undefined
            }
            onPointerDownCapture={handleComposerPointerDown}
          >
            <Composer
              ref={composerRef}
              onSend={handleSend}
              onCancel={handleCancel}
              activity={chat.activity}
              disabled={Boolean(effectiveSessionError) || isBudgetBlocked}
              isGenerating={isActiveRun}
              placeholder={
                effectiveSessionError
                  ? "인덱스에 있는 회사만 채팅할 수 있습니다."
                  : isBudgetBlocked
                  ? "주간 분석 한도에 도달했습니다."
                  : isIdeaGeneration
                  ? responseLocale === "ko"
                    ? "예: 백로그 증가가 매출로 연결될 기업"
                    : "e.g. Companies converting backlog growth into revenue"
                  : isGuruAdvisor
                  ? responseLocale === "ko"
                    ? guruContextCompany
                      ? "예: 이 기업을 오래 보유해도 될까요?"
                      : "회사 선택 후 상담 질문을 입력하세요..."
                    : guruContextCompany
                      ? "e.g. Is this a business I can hold for years?"
                      : "Choose a company, then ask your consultation question..."
                  : "기업에 대해 질문하세요..."
              }
              toolCalls={chat.toolCalls}
              initialValue={initialComposerValue}
              draftResetKey={composerDraftResetKey}
              runStartedAt={chat.runStartedAt}
              researchMode={effectiveResearchMode}
              onResearchModeChange={setResearchMode}
              urlModeAvailable={
                !isGuruAdvisor && (isIdeaGeneration || contextTickers.length > 0)
              }
              fileModeAvailable={!isGuruAdvisor}
              urlOnlyFallbackMessage={
                isIdeaGeneration
                  ? "이 URL을 바탕으로 관련 종목을 발굴해줘."
                  : undefined
              }
              attachmentCoachmarkEnabled={!isIdeaGeneration && !isGuruAdvisor}
              onUserUrlsChange={
                isIdeaGeneration ? discoverGuide.onUserUrlsChange : undefined
              }
              onAttachmentsChange={
                isIdeaGeneration ? discoverGuide.onAttachmentsChange : undefined
              }
              inputSurfaceVisible={!shouldHideDiscoverComposer}
              focusRequestKey={composerFocusRequestKey}
              onFocusChange={handleComposerFocusChange}
              onReadyChange={discoverGuide.onComposerReadyChange}
              extraTools={
                isGuruAdvisor
                  ? [
                      {
                        id: "guru-company",
                        label:
                          responseLocale === "ko"
                            ? guruContextCompany
                              ? "회사 변경"
                              : "회사 선택"
                            : guruContextCompany
                              ? "Change company"
                              : "Choose company",
                        description:
                          responseLocale === "ko"
                            ? "상담할 커버리지 회사를 고릅니다."
                            : "Choose a covered company for this consultation.",
                        icon: "domain",
                        badge: guruContextCompany?.ticker ?? "회사",
                        onboardingTarget: "guru-company-tool",
                        onClick: openGuruCompanyPicker,
                        disabled: isActiveRun || isBudgetBlocked,
                      },
                    ]
                  : []
              }
            />
          </div>

          {/* Compact pill — shown when full composer slides away */}
          <AnimatePresence>
            {isComposerCompact && !shouldHideDiscoverComposer && (
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
                <div className="pointer-events-auto flex items-center gap-1 rounded-[14px] border border-hairline bg-canvas p-1.5 shadow-sm">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-bold text-ink active:bg-surface-dim"
                    onClick={isActiveRun ? revealComposer : revealComposerForTyping}
                    aria-label={isActiveRun ? "분석 상태 보기" : "질문 입력"}
                  >
                    {isQueued ? (
                      <QueueRemotionAnimation size="compact" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={[
                          "material-symbols-outlined text-[19px]",
                          isRunning ? "animate-spin" : "",
                        ].join(" ")}
                      >
                        {isRunning ? "progress_activity" : "edit"}
                      </span>
                    )}
                    <span>
                      {isQueued ? "대기 중" : isRunning ? "분석 진행중" : "질문 입력"}
                    </span>
                  </button>

                  {isActiveRun && (
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-[10px] border border-hairline bg-surface px-3 text-[12px] font-bold text-error active:scale-95"
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
      <GuruCompanyPicker
        open={guruCompanyPicker.isOpen}
        locale={responseLocale}
        query={guruCompanyPicker.query}
        results={guruCompanyPicker.results}
        loading={guruCompanyPicker.loading}
        error={guruCompanyPicker.error}
        totalCount={guruCompanyPicker.totalCount}
        hasMore={guruCompanyPicker.hasMore}
        onQueryChange={guruCompanyPicker.onQueryChange}
        onLoadMore={guruCompanyPicker.loadMore}
        onSelect={handleGuruCompanySelect}
        onClose={guruCompanyPicker.close}
      />
    </div>
  );
}

export default function ChatPage({
  workspace = "chat",
}: {
  workspace?: ChatWorkspace;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-canvas">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ChatContent workspace={workspace} />
    </Suspense>
  );
}
