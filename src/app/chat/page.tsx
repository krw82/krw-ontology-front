"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import TopNav from "@/components/TopNav";
import ChatMessage from "@/components/ChatMessage";
import Composer from "@/components/Composer";
import { useChat } from "@/hooks/useChat";
import { getSessionTickers, buildChatSessionHref } from "@/lib/chat/history-state";

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
  companies?: Array<{ ticker: string }>;
};

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticker = searchParams.get("ticker");
  const queryParam = searchParams.get("query");
  const existingSessionId = searchParams.get("sessionId");

  const sessionId = existingSessionId;
  const [sessionError, setSessionError] = useState<string | null>(null);
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

  useEffect(() => {
    scrollToBottom();
  }, [chat.activity, chat.messages, chat.streamingContent, scrollToBottom]);

  const isStreaming = chat.status === "running";
  const contextTickers = getSessionTickers(chat.session, ticker);

  const handleSend = useCallback(
    async (content: string) => {
      await chat.sendMessage(content);
    },
    [chat],
  );


  const handleCancel = useCallback(async () => {
    await chat.cancelRun();
  }, [chat]);

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
      <main id="main-content" className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 overflow-hidden">
        {/* Chat Canvas */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-canvas">
          {/* Chat History */}
          {/* L-04: aria-live region for screen readers */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-base pb-[calc(88px+env(safe-area-inset-bottom))] sm:px-xl sm:pb-[96px]"
            aria-live="polite"
            aria-label="채팅 메시지"
            role="log"
          >
            {/* Spacer */}
            <div className="h-xl sm:h-[96px]" />

            {/* Ticker context indicator */}
            {contextTickers.length > 0 && (
              <div className="mx-auto mb-lg w-full max-w-3xl">
                <span className="inline-flex max-w-full items-center gap-xs rounded-full border border-hairline bg-surface-soft px-sm py-xs text-[13px] font-medium leading-[1.4] text-body sm:px-md sm:text-[14px]">
                  <span className="material-symbols-outlined text-[16px] text-primary">
                    business
                  </span>
                  <span className="shrink-0">분석 대상:</span>{" "}
                  <span className="truncate font-mono font-medium text-ink">
                    {contextTickers.join(", ")}
                  </span>
                </span>
              </div>
            )}

            {/* L-09: Loading skeleton for session */}
            {/* H-06: Session creation error */}
            {effectiveSessionError && (
              <div className="mx-auto max-w-3xl">
                <div className="rounded-xl border border-error/20 bg-error-container/10 p-base text-[15px] leading-[1.5] text-error sm:p-lg sm:text-[16px]">
                  <span className="material-symbols-outlined text-[18px] mr-xs align-middle">
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
                  const isLastAssistant =
                    msg.role === "assistant" && idx === arr.length - 1;
                  const citations =
                    msg.role === "assistant" && !isStreaming
                      ? chat.citations.filter((citation) =>
                          citation.message_id
                            ? citation.message_id === msg.id
                            : isLastAssistant,
                        )
                      : undefined;
                  const richAnswers =
                    msg.role === "assistant"
                      ? chat.richAnswers.filter(
                          (answer) => answer.message_id === msg.id,
                        )
                      : undefined;

                  return (
                    <ChatMessage
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      citations={citations}
                      richAnswers={richAnswers}
                    />
                  );
                })}

              {/* Streaming response */}
              {isStreaming && chat.streamingContent && (
                <ChatMessage
                  role="assistant"
                  content={chat.streamingContent}
                  isStreaming={true}
                  activity={chat.activity}
                  citations={chat.citations}
                />
              )}
              {isStreaming && !chat.streamingContent && (
                <ChatMessage
                  role="assistant"
                  content=""
                  isStreaming={true}
                  activity={chat.activity}
                />
              )}

              {/* Error */}
              {chat.error && (
                <div className="flex w-full flex-col">
                  <div className="pl-0 sm:pl-[48px]">
                    <div className="rounded-xl border border-error/20 bg-error-container/10 p-base text-[15px] leading-[1.5] text-error sm:p-lg sm:text-[16px]">
                      <span className="material-symbols-outlined text-[18px] mr-xs align-middle">
                        error
                      </span>
                      {sanitizeError(chat.error)}
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {chat.messages.length === 0 && !isStreaming && sessionId && !sessionError && (
                <div className="flex w-full min-w-0 flex-col items-center justify-center py-xxl text-center">
                  <div className="mb-lg flex h-14 w-14 items-center justify-center rounded-full bg-surface-soft sm:h-16 sm:w-16">
                    <span className="material-symbols-outlined text-[28px] text-primary sm:text-[32px]">
                      auto_awesome
                    </span>
                  </div>
                  <h2 className="mb-sm text-[18px] font-semibold leading-[1.33] text-ink">
                    KRW Ontology에 질문하세요
                  </h2>
                  <p className="w-full min-w-[280px] max-w-[440px] whitespace-normal text-[15px] font-normal leading-[1.5] text-muted [overflow-wrap:normal] [word-break:keep-all] sm:text-[16px]">
                    {contextTickers.length > 0
                      ? `${contextTickers.join(", ")}의 재무 데이터, 실적, 온톨로지 분석에 대해 질문해보세요.`
                      : "어떤 기업의 재무 데이터, 실적, 온톨로지 분석에 대해서도 질문해보세요."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* M-09: Session creation loading indicator */}
          <Composer
            onSend={handleSend}
            disabled={isStreaming || Boolean(effectiveSessionError)}
            placeholder={
              effectiveSessionError
                ? "인덱스에 있는 회사만 채팅할 수 있습니다."
                : isStreaming
                  ? "응답을 기다리는 중..."
                  : "후속 질문이나 심층 분석을 요청하세요..."
            }
            initialValue={queryParam ?? undefined}
          />

          {/* Cancel button overlay when streaming */}
          {isStreaming && (
            <div className="absolute bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 sm:bottom-[100px]">
              <button
                onClick={handleCancel}
                className="flex items-center gap-xs rounded-full border border-hairline bg-surface-strong px-base py-sm text-[14px] font-medium leading-[1.4] text-body shadow-sm transition-colors hover:bg-surface-dim sm:px-lg"
                aria-label="응답 생성 중지"
              >
                <span className="material-symbols-outlined text-[16px]">
                  stop_circle
                </span>
                생성 중지
              </button>
            </div>
          )}
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
