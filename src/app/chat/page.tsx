"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import TopNav from "@/components/TopNav";
import ChatMessage from "@/components/ChatMessage";
import Composer from "@/components/Composer";
import { useChat } from "@/hooks/useChat";
import { getSessionTickers, buildChatSessionHref } from "@/lib/chat/history-state";
import { getSuggestedPromptsForTickers } from "@/lib/chat/suggested-prompts";

function sanitizeError(message: string): string {
  // Strip stack traces and internal details
  const cleaned = message.split("\n")[0];
  const lower = cleaned.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "현재 Claude Code 계정/API 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나, 실제 ANTHROPIC_API_KEY를 설정한 뒤 서버를 재시작해주세요.";
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

const promptCycleIntervalMs = 2200;

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticker = searchParams.get("ticker");
  const queryParam = searchParams.get("query");
  const existingSessionId = searchParams.get("sessionId");

  const sessionId = existingSessionId;
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [companyMetaByTicker, setCompanyMetaByTicker] = useState<
    Record<string, CompanyMeta>
  >({});
  const [activePromptIndex, setActivePromptIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const cancelledRef = useRef(false);

  // H-07: cleanup on unmount to prevent race condition
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (existingSessionId || !ticker) return;

    let stale = false;
    const tickerToValidate = ticker;

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
  }, [ticker, existingSessionId]);

  const effectiveSessionError = existingSessionId || !ticker ? null : sessionError;

  const handleSessionCreated = useCallback(
    (createdSessionId: string) => {
      router.replace(buildChatSessionHref(createdSessionId), { scroll: false });
    },
    [router],
  );

  const chat = useChat({
    sessionId: sessionId ?? "",
    scopeType: ticker ? "company" : "global",
    defaultTickers: ticker ? [ticker.trim().toUpperCase()] : [],
    onSessionCreated: handleSessionCreated,
  });

  // H-08: stable loadSession via ref-based guard
  const loadSessionRef = useRef(chat.loadSession);

  useEffect(() => {
    loadSessionRef.current = chat.loadSession;
  }, [chat.loadSession]);

  useEffect(() => {
    hasLoadedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadSessionRef.current();
  }, [sessionId]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const isStreaming = chat.status === "running";
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

  useEffect(() => {
    if (!hasConversationContent) return;
    const frameId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    chat.activity,
    chat.messages.length,
    chat.streamingContent,
    hasConversationContent,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (!sessionId || chat.messages.length === 0) return;
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("message-")) return;

    const frameId = window.requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({
        block: "center",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [chat.messages.length, sessionId]);

  const contextTickers = getSessionTickers(chat.session, ticker);
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
  const initialComposerValue = queryParam ?? undefined;
  const sendMessage = chat.sendMessage;
  const cancelRun = chat.cancelRun;

  useEffect(() => {
    if (chat.messages.length > 0 || isStreaming || effectiveSessionError) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActivePromptIndex(
        (currentIndex) => (currentIndex + 1) % suggestedPrompts.length,
      );
    }, promptCycleIntervalMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    activePromptIndex,
    chat.messages.length,
    effectiveSessionError,
    isStreaming,
    suggestedPrompts.length,
  ]);

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

  const handleSend = useCallback(
    async (content: string) => {
      await sendMessage(content);
    },
    [sendMessage],
  );

  const handleCancel = useCallback(async () => {
    await cancelRun();
  }, [cancelRun]);

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Top Nav */}
      <TopNav />

      {/* Main Workspace */}
      <main id="main-content" className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 overflow-hidden">
        {/* Chat Canvas */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-canvas">
          {/* Chat History */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-base pb-[calc(88px+env(safe-area-inset-bottom))] sm:px-xl sm:pb-[96px]"
            aria-label="채팅 메시지"
            aria-relevant="additions text"
            role="log"
          >
            {/* Spacer */}
            <div className="h-xl sm:h-[96px]" />

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

            {/* Messages */}
            <div className="mx-auto w-full min-w-0 max-w-3xl space-y-lg sm:space-y-xl">
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
                      messageId={msg.role === "assistant" ? msg.id : undefined}
                      createdAt={
                        msg.role === "assistant" ? msg.created_at : undefined
                      }
                      citations={
                        isLatestAssistantMessage ? chat.citations : undefined
                      }
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
              {chat.messages.length === 0 && !isStreaming && !sessionError && (
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
                    className="space-y-1"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: 0.06, ease: "easeOut" }}
                  >
                    <LayoutGroup id="empty-state-prompts">
                      {suggestedPrompts.map((prompt, index) => {
                        const isActivePrompt = index === activePromptIndex;

                        return (
                          <motion.button
                            type="button"
                            key={prompt}
                            layout
                            className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-[10px] px-3 py-3 text-left text-[14px] font-semibold leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                              isActivePrompt
                                ? "text-ink"
                                : "text-body hover:bg-surface-soft hover:text-ink"
                            }`}
                            onClick={() => handleSend(prompt)}
                            onFocus={() => setActivePromptIndex(index)}
                            onMouseEnter={() => setActivePromptIndex(index)}
                            disabled={
                              isStreaming || Boolean(effectiveSessionError)
                            }
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.2,
                              delay: 0.1 + index * 0.04,
                              ease: "easeOut",
                            }}
                          >
                            {isActivePrompt && (
                              <motion.span
                                layoutId="empty-state-prompt-active"
                                aria-hidden="true"
                                className="absolute inset-0 rounded-[10px] bg-surface"
                                transition={{
                                  duration: 0.36,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                              />
                            )}
                            <span className="relative z-10 shrink-0 font-mono text-[13px] font-black leading-6 text-muted">
                              {index + 1}.
                            </span>
                            <span className="relative z-10 min-w-0 flex-1">
                              {prompt}
                            </span>
                            <AnimatePresence initial={false} mode="popLayout">
                              {isActivePrompt && (
                                <motion.span
                                  key="active-prompt-arrow"
                                  layoutId="empty-state-prompt-arrow"
                                  aria-hidden="true"
                                  className="material-symbols-outlined relative z-10 shrink-0 text-[18px] text-muted transition-colors group-hover:text-primary"
                                  initial={{ opacity: 0, x: -3 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 3 }}
                                  transition={{
                                    duration: 0.22,
                                    ease: "easeOut",
                                  }}
                                >
                                  arrow_forward
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </motion.button>
                        );
                      })}
                    </LayoutGroup>
                  </motion.div>
                </div>
              )}
            </div>
          </div>

          {/* M-09: Session creation loading indicator */}
          <Composer
            onSend={handleSend}
            onCancel={handleCancel}
            activity={chat.activity}
            disabled={Boolean(effectiveSessionError)}
            isGenerating={isStreaming}
            placeholder={
              effectiveSessionError
                ? "인덱스에 있는 회사만 채팅할 수 있습니다."
                : "기업에 대해 질문하세요..."
            }
            toolCalls={chat.toolCalls}
            initialValue={initialComposerValue}
          />
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
