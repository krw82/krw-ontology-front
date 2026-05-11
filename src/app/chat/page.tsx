"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import TopNav from "@/components/TopNav";
import ChatMessage from "@/components/ChatMessage";
import Composer from "@/components/Composer";
import { useSessions } from "@/hooks/useSessions";
import { useChat } from "@/hooks/useChat";

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
  const searchParams = useSearchParams();
  const ticker = searchParams.get("ticker");
  const queryParam = searchParams.get("query");
  const existingSessionId = searchParams.get("sessionId");

  const [sessionId, setSessionId] = useState<string | null>(existingSessionId);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const { createSession, creating } = useSessions();
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

  // Create session on mount only if no existing sessionId
  useEffect(() => {
    if (existingSessionId) return;
    let stale = false;
    async function init() {
      setSessionError(null);

      if (ticker) {
        const normalizedTicker = ticker.trim().toUpperCase();
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

          if (!isIndexed) {
            if (!stale && !cancelledRef.current) {
              setSessionError(
                `현재 온톨로지 인덱스에 없는 회사입니다: ${normalizedTicker}`,
              );
            }
            return;
          }
        } catch {
          if (!stale && !cancelledRef.current) {
            setSessionError("회사 인덱스를 확인하지 못했습니다.");
          }
          return;
        }
      }

      const session = await createSession({
        scope_type: ticker ? "company" : "global",
        default_tickers: ticker ? [ticker.trim().toUpperCase()] : undefined,
      });
      if (stale || cancelledRef.current) return;
      if (session) {
        setSessionId(session.id);
      } else {
        // H-06: show session creation error to user
        setSessionError("세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    }
    init();
    return () => {
      stale = true;
    };
  }, [ticker, createSession, existingSessionId]);

  // useChat hook — only active when we have a sessionId
  const chat = useChat({ sessionId: sessionId ?? "" });

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
  }, [chat.messages, chat.streamingContent, scrollToBottom]);

  const isStreaming = chat.status === "running";

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
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Nav */}
      <TopNav />

      {/* Main Workspace */}
      <main id="main-content" className="flex-1 w-full max-w-[1200px] mx-auto flex overflow-hidden">
        {/* Chat Canvas */}
        <div className="flex-1 flex flex-col relative bg-canvas">
          {/* Chat History */}
          {/* L-04: aria-live region for screen readers */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-xl pb-[96px]"
            aria-live="polite"
            aria-label="Chat messages"
            role="log"
          >
            {/* Spacer */}
            <div className="h-[96px]" />

            {/* Ticker context indicator */}
            {ticker && (
              <div className="max-w-3xl mx-auto mb-lg">
                <span className="inline-flex items-center gap-xs px-md py-xs bg-surface-soft border border-hairline rounded-full text-[14px] leading-[1.4] font-medium text-body">
                  <span className="material-symbols-outlined text-[16px] text-primary">
                    business
                  </span>
                  Context:{" "}
                  <span className="font-mono font-medium text-ink">
                    {ticker}
                  </span>
                </span>
              </div>
            )}

            {/* L-09: Loading skeleton for session */}
            {(!sessionId || creating) && !existingSessionId && !sessionError && (
              <div className="max-w-3xl mx-auto space-y-xl" aria-busy="true">
                <div className="flex flex-col w-full animate-pulse">
                  <div className="flex items-start gap-md mb-sm">
                    <div className="w-8 h-8 rounded-full bg-surface-soft" />
                    <div className="h-5 w-40 bg-surface-soft rounded" />
                  </div>
                  <div className="pl-[48px] space-y-md">
                    <div className="h-4 w-3/4 bg-surface-soft rounded" />
                    <div className="h-4 w-1/2 bg-surface-soft rounded" />
                  </div>
                </div>
              </div>
            )}

            {/* H-06: Session creation error */}
            {sessionError && (
              <div className="max-w-3xl mx-auto">
                <div className="bg-error-container/10 border border-error/20 rounded-xl p-lg text-error text-[16px] leading-[1.5]">
                  <span className="material-symbols-outlined text-[18px] mr-xs align-middle">
                    error
                  </span>
                  {sessionError}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="max-w-3xl mx-auto space-y-xl">
              {chat.messages
                .filter((msg): msg is typeof msg & { role: "user" | "assistant" } =>
                  msg.role === "user" || msg.role === "assistant"
                )
                .map((msg, idx, arr) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  citations={
                    msg.role === "assistant" && idx === arr.length - 1 && !isStreaming
                      ? chat.citations
                      : undefined
                  }
                />
              ))}

              {/* Streaming response */}
              {isStreaming && chat.streamingContent && (
                <ChatMessage
                  role="assistant"
                  content={chat.streamingContent}
                  isStreaming={true}
                  citations={chat.citations}
                />
              )}
              {isStreaming && !chat.streamingContent && (
                <ChatMessage
                  role="assistant"
                  content=""
                  isStreaming={true}
                />
              )}

              {/* Error */}
              {chat.error && (
                <div className="flex flex-col w-full">
                  <div className="pl-[48px]">
                    <div className="bg-error-container/10 border border-error/20 rounded-xl p-lg text-error text-[16px] leading-[1.5]">
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
                <div className="flex flex-col items-center justify-center py-xxl text-center">
                  <div className="w-16 h-16 bg-surface-soft rounded-full flex items-center justify-center mb-lg">
                    <span className="material-symbols-outlined text-[32px] text-primary">
                      auto_awesome
                    </span>
                  </div>
                  <h2 className="text-[18px] leading-[1.33] font-semibold text-ink mb-sm">
                    KRW Ontology에 질문하세요
                  </h2>
                  <p className="text-[16px] leading-[1.5] font-normal text-muted max-w-md">
                    {ticker
                      ? `${ticker}의 재무 데이터, 실적, 온톨로지 분석에 대해 질문해보세요.`
                      : "어떤 기업의 재무 데이터, 실적, 온톨로지 분석에 대해서도 질문해보세요."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* M-09: Session creation loading indicator */}
          <Composer
            onSend={handleSend}
            disabled={isStreaming || !sessionId || creating}
            placeholder={
              sessionError
                ? "인덱스에 있는 회사만 채팅할 수 있습니다."
                : creating
                ? "세션을 생성하는 중..."
                : isStreaming
                  ? "응답을 기다리는 중..."
                  : "후속 질문이나 심층 분석을 요청하세요..."
            }
            initialValue={queryParam ?? undefined}
          />

          {/* Cancel button overlay when streaming */}
          {isStreaming && (
            <div className="absolute bottom-[100px] left-1/2 -translate-x-1/2 z-10">
              <button
                onClick={handleCancel}
                className="px-lg py-sm bg-surface-strong border border-hairline rounded-full text-[14px] leading-[1.4] font-medium text-body hover:bg-surface-dim transition-colors flex items-center gap-xs shadow-sm"
                aria-label="Cancel response"
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
        <div className="h-screen flex items-center justify-center bg-canvas">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
