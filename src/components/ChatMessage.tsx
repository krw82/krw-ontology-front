"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import EvidenceGraphPreview from "@/components/EvidenceGraphPreview";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import ResearchProgress from "@/components/ResearchProgress";
import type { ToolCallState } from "@/hooks/useChat";
import type {
  ChatCitation,
  MessageStatus,
  ResearchActivityUpdate,
} from "@/types/api-contracts";
import { chatMessageAssistant, chatMessageUser } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  CANCELLED_ASSISTANT_MESSAGE,
  FAILED_ASSISTANT_MESSAGE,
} from "@/lib/chat/message-status";
import { parseChatAttachmentContent } from "@/lib/chat/attachments";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  showHeader?: boolean;
  toolCalls?: ToolCallState[];
  workDurationMs?: number | null;
  runStartedAt?: string | null;
  messageId?: string;
  createdAt?: string;
  status?: MessageStatus;
}

const statusTransition = {
  duration: 0.14,
  ease: [0.16, 1, 0.3, 1] as const,
};

const dotTransition = {
  duration: 0.9,
  repeat: Infinity,
  repeatType: "loop" as const,
  ease: "easeInOut" as const,
};

function useStreamingMotionOffset() {
  const prefersReducedMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const sync = (query: MediaQueryList | MediaQueryListEvent) => {
      setIsMobile(query.matches);
    };

    sync(mediaQuery);
    mediaQuery.addEventListener("change", sync);

    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  if (prefersReducedMotion) return 0;
  return isMobile ? 4 : 8;
}

function LoadingDots({ label = "분석 준비 중" }: { label?: string }) {
  const verticalOffset = useStreamingMotionOffset();

  return (
    <motion.div
      className="flex items-center gap-xs text-[14px] leading-[1.4] text-muted"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: statusTransition.ease }}
    >
      <div className="flex gap-1">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="h-2 w-2 rounded-full bg-muted"
            initial={{ opacity: 0.2 }}
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ ...dotTransition, delay: index * 0.14 }}
          />
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: verticalOffset / 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -(verticalOffset / 2) }}
          transition={statusTransition}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

function formatMessageTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";

    document.body.appendChild(textArea);
    textArea.select();
    textArea.setSelectionRange(0, text.length);

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
}

async function createPublicShareUrl(messageId: string): Promise<string> {
  const response = await fetch(
    `/api/share/messages/${encodeURIComponent(messageId)}`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  const data = (await response.json().catch(() => null)) as {
    share_url?: string;
    url?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(data?.error?.message || "공유 링크를 만들지 못했습니다.");
  }

  const shareUrl = data?.share_url || data?.url;
  if (!shareUrl) throw new Error("공유 링크를 만들지 못했습니다.");

  return new URL(shareUrl, window.location.origin).toString();
}

function MessageActions({
  messageId,
  createdAt,
}: {
  messageId: string;
  createdAt: string;
}) {
  const [shareState, setShareState] = useState<
    "idle" | "sharing" | "shared" | "failed"
  >("idle");
  const formattedTime = useMemo(() => formatMessageTime(createdAt), [createdAt]);

  useEffect(() => {
    if (shareState !== "shared" && shareState !== "failed") return;
    const timeoutId = window.setTimeout(() => setShareState("idle"), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [shareState]);

  const handleShare = useCallback(async () => {
    if (shareState === "sharing") return;

    setShareState("sharing");
    let shareUrl = "";

    try {
      shareUrl = await createPublicShareUrl(messageId);
      const shareData: ShareData = {
        title: "KRW Ontology",
        url: shareUrl,
      };
      const useNativeShare =
        Boolean(navigator.share) &&
        (navigator.maxTouchPoints > 0 ||
          window.matchMedia("(pointer: coarse)").matches) &&
        (!navigator.canShare || navigator.canShare(shareData));

      if (useNativeShare) {
        await navigator.share(shareData);
        setShareState("shared");
      } else {
        const copied = await copyTextToClipboard(shareUrl);
        setShareState(copied ? "shared" : "failed");
      }
    } catch (error) {
      if ((error as DOMException).name === "AbortError") {
        setShareState("idle");
        return;
      }
      const copied = shareUrl ? await copyTextToClipboard(shareUrl) : false;
      setShareState(copied ? "shared" : "failed");
    }
  }, [messageId, shareState]);

  if (!formattedTime) return null;

  const iconName =
    shareState === "shared"
      ? "check"
      : shareState === "failed"
        ? "error"
        : shareState === "sharing"
          ? "progress_activity"
          : "ios_share";
  const shareLabel =
    shareState === "shared"
      ? "공유 링크 복사됨"
      : shareState === "failed"
        ? "공유 링크 생성 실패"
        : shareState === "sharing"
          ? "공유 링크 생성 중"
          : "답변 공유";

  return (
    <div className="mt-sm flex items-center gap-xs text-[13px] leading-none text-muted">
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
        aria-label={shareLabel}
        disabled={shareState === "sharing"}
        onClick={handleShare}
      >
        <span
          aria-hidden="true"
          className={[
            "material-symbols-outlined text-[18px]",
            shareState === "sharing" ? "animate-spin" : "",
          ].join(" ")}
        >
          {iconName}
        </span>
      </button>
      <time dateTime={createdAt}>{formattedTime}</time>
      <span className="sr-only" aria-live="polite">
        {shareState === "shared"
          ? "공유 링크가 복사되었습니다."
          : shareState === "failed"
            ? "공유 링크를 만들지 못했습니다."
            : ""}
      </span>
    </div>
  );
}

function activityLabel(activity?: ResearchActivityUpdate | null): string {
  switch (activity?.stage) {
    case "queued":
      return "분석 대기 중";
    case "connecting":
      return "자료 연결 중";
    case "checking_evidence":
      return "근거 정리 중";
    case "composing":
      return "답변 작성 중";
    case "complete":
      return "작업 완료";
    case "researching":
    case "preparing":
    default:
      return "근거 확인 중";
  }
}

function splitStreamingBlocks(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  return normalized
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
}

function StreamingContentBlocks({ content }: { content: string }) {
  const verticalOffset = useStreamingMotionOffset();
  const blocks = useMemo(() => splitStreamingBlocks(content), [content]);

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-lg">
      <AnimatePresence initial={false}>
        {blocks.map((section, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: verticalOffset }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -verticalOffset }}
            transition={{
              duration: 0.16,
              ease: statusTransition.ease,
              delay: Math.min(index, 6) * 0.02,
            }}
          >
            <ResearchMarkdown content={section} normalizePlainText={false} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function CompletedAssistantContent({ content }: { content: string }) {
  return <ResearchMarkdown content={content} />;
}

function terminalAssistantContent(status: MessageStatus | undefined) {
  if (status === "cancelled") return CANCELLED_ASSISTANT_MESSAGE;
  if (status === "failed") return FAILED_ASSISTANT_MESSAGE;
  return "";
}

export default function ChatMessage({
  role,
  content,
  isStreaming,
  activity,
  citations,
  showHeader = true,
  toolCalls,
  workDurationMs,
  runStartedAt,
  messageId,
  createdAt,
  status,
}: ChatMessageProps) {
  if (role === "user") {
    const { visibleText, attachments } = parseChatAttachmentContent(content);

    return (
      <motion.div
        className="flex w-full flex-col items-end"
        initial="hidden"
        animate="visible"
        variants={chatMessageUser}
      >
        <div className="max-w-[92%] rounded-[8px] border border-hairline bg-surface p-base text-ink sm:max-w-[80%] sm:p-lg">
          {visibleText ? (
            <p className="whitespace-pre-wrap break-words text-[15px] font-normal leading-[1.5] sm:text-[16px]">
              {visibleText}
            </p>
          ) : null}
          {attachments.length > 0 && (
            <div
              className={[
                "flex max-w-full flex-wrap justify-end gap-xs",
                visibleText ? "mt-sm" : "",
              ].join(" ")}
            >
              {attachments.map((attachment, index) => (
                <div
                  key={`${attachment.name}-${index}`}
                  className="inline-flex max-w-full items-center gap-xs rounded-[8px] border border-hairline bg-canvas px-sm py-xs text-[12px] font-semibold leading-none text-body"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[16px] text-primary-container"
                  >
                    description
                  </span>
                  <span className="max-w-[180px] truncate text-ink sm:max-w-[240px]">
                    {attachment.name}
                  </span>
                  <span className="shrink-0 text-muted">
                    {attachment.characterCount.toLocaleString()}자
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      id={messageId ? `message-${messageId}` : undefined}
      className="flex w-full flex-col"
      initial="hidden"
      animate="visible"
      variants={chatMessageAssistant}
    >
      {showHeader && (
        <div className="pl-0 sm:pl-[48px]">
          <ResearchProgress
            activity={activity}
            citations={citations}
            isStreaming={isStreaming}
            toolCalls={toolCalls}
            workDurationMs={workDurationMs}
            runStartedAt={runStartedAt}
          />
        </div>
      )}
      {isStreaming ? (
        <div className="max-w-full pl-0 text-body sm:pl-[48px]">
          <EvidenceGraphPreview
            activity={activity}
            citations={citations}
            toolCalls={toolCalls}
          />
          {content ? (
            <StreamingContentBlocks content={content} />
          ) : !toolCalls?.length && !citations?.length ? (
            <LoadingDots label={activityLabel(activity)} />
          ) : null}
        </div>
      ) : (
        <div className="max-w-full pl-0 text-body sm:pl-[48px]">
          {content ? (
            <CompletedAssistantContent content={content} />
          ) : terminalAssistantContent(status) ? (
            <p className="text-[15px] leading-[1.5] text-muted">
              {terminalAssistantContent(status)}
            </p>
          ) : null}
          {messageId && createdAt && status === "completed" ? (
            <MessageActions messageId={messageId} createdAt={createdAt} />
          ) : null}
        </div>
      )}
    </motion.div>
  );
}
