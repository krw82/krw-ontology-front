"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ChatArtifacts from "@/components/ChatArtifacts";
import ChatAnswerSaveActions, {
  type ChatAnswerSaveContext,
} from "@/components/ChatAnswerSaveActions";
import EvidenceGraphPreview from "@/components/EvidenceGraphPreview";
import FollowUpQuestionActions from "@/components/FollowUpQuestionActions";
import QueueRemotionAnimation from "@/components/QueueRemotionAnimation";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import ResearchProgress from "@/components/ResearchProgress";
import MessageAttachments, {
  filesFromParsedAttachments,
  userUrlsFromMessageMetadata,
} from "@/components/MessageAttachments";
import type { ToolCallState } from "@/hooks/useChat";
import type {
  ChatCitation,
  ChatArtifact,
  ChatMessagePresentation,
  ChatMessageVisualization,
  ChatArtifactSelection,
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
import { sanitizeAssistantContent } from "@/lib/chat/assistant-content";
import { extractFollowUpQuestions } from "@/lib/chat/follow-up-questions";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  presentation?: "default" | "guru";
  metadata?: Record<string, unknown> | null;
  isStreaming?: boolean;
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  artifacts?: ChatArtifact[];
  visualizations?: ChatMessageVisualization[];
  messagePresentation?: ChatMessagePresentation | null;
  artifactSelections?: ChatArtifactSelection[];
  onSelectNewsEvent?: (params: {
    artifactId: string;
    eventId: string;
  }) => void | Promise<void>;
  onFollowUpQuestionSelect?: (question: string) => void;
  followUpQuestionDisabled?: boolean;
  newsEventSelectionDisabled?: boolean;
  showHeader?: boolean;
  toolCalls?: ToolCallState[];
  workDurationMs?: number | null;
  runStartedAt?: string | null;
  messageId?: string;
  createdAt?: string;
  status?: MessageStatus;
  answerSaveContext?: ChatAnswerSaveContext;
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
  const isQueued = label.includes("대기");

  return (
    <motion.div
      className="flex items-center gap-xs text-[14px] leading-[1.4] text-muted"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: statusTransition.ease }}
    >
      {isQueued ? (
        <QueueRemotionAnimation className="-my-2 -ml-2" size="regular" />
      ) : (
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
      )}
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
    throw new ShareCreationError(
      data?.error?.message || "공유 링크를 만들지 못했습니다.",
      response.status,
    );
  }

  const shareUrl = data?.share_url || data?.url;
  if (!shareUrl) throw new Error("공유 링크를 만들지 못했습니다.");

  return new URL(shareUrl, window.location.origin).toString();
}

class ShareCreationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ShareCreationError";
  }
}

type ShareState = "idle" | "sharing" | "shared" | "failed" | "auth_required";

function MessageActions({
  messageId,
  createdAt,
}: {
  messageId: string;
  createdAt: string;
}) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const formattedTime = useMemo(() => formatMessageTime(createdAt), [createdAt]);

  useEffect(() => {
    if (
      shareState !== "shared" &&
      shareState !== "failed" &&
      shareState !== "auth_required"
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => setShareState("idle"), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [shareState]);

  const handleShare = useCallback(async () => {
    if (shareState === "sharing") return;

    setShareState("sharing");
    let shareUrl = "";

    try {
      shareUrl = await createPublicShareUrl(messageId);
      const shareData: ShareData = {
        title: "KRW.O",
        url: shareUrl,
      };
      const useNativeShare =
        Boolean(navigator.share) &&
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
      if (error instanceof ShareCreationError && error.status === 401) {
        setShareState("auth_required");
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
        : shareState === "auth_required"
          ? "lock"
          : shareState === "sharing"
            ? "progress_activity"
            : "ios_share";
  const shareLabel =
    shareState === "shared"
      ? "공유 완료"
      : shareState === "failed"
        ? "공유 링크 생성 실패"
        : shareState === "auth_required"
          ? "로그인이 필요합니다"
          : shareState === "sharing"
            ? "공유 링크 생성 중"
            : "답변 공유";
  const visibleShareStatus =
    shareState === "shared"
      ? "공유 완료"
      : shareState === "failed"
        ? "공유 실패"
        : shareState === "auth_required"
          ? "로그인이 필요합니다"
          : "";

  return (
    <div className="mt-sm flex flex-wrap items-center gap-xs text-[13px] leading-none text-muted">
      <button
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
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
      <span
        aria-live="polite"
        className={[
          "min-w-0 text-[12px] leading-none transition-opacity",
          visibleShareStatus ? "opacity-100" : "opacity-0",
          shareState === "failed" || shareState === "auth_required"
            ? "text-error"
            : "text-muted",
        ].join(" ")}
      >
        {visibleShareStatus || " "}
      </span>
    </div>
  );
}

function activityLabel(activity?: ResearchActivityUpdate | null): string {
  switch (activity?.stage) {
    case "queued":
      return "대기열에 추가됨";
    case "routing":
      return "질문 유형 확인 중";
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

function StreamingContentBlocks({
  content,
  presentation = "default",
}: {
  content: string;
  presentation?: "default" | "guru";
}) {
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
            <ResearchMarkdown
              content={section}
              normalizePlainText={false}
              presentation={presentation}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function CompletedAssistantContent({
  content,
  visualizations,
  messagePresentation,
  presentation = "default",
  onFollowUpQuestionSelect,
  followUpQuestionDisabled,
}: {
  content: string;
  visualizations?: ChatMessageVisualization[];
  messagePresentation?: ChatMessagePresentation | null;
  presentation?: "default" | "guru";
  onFollowUpQuestionSelect?: (question: string) => void;
  followUpQuestionDisabled?: boolean;
}) {
  const followUpQuestions = useMemo(() => {
    if (!onFollowUpQuestionSelect) return null;
    return extractFollowUpQuestions(content);
  }, [content, onFollowUpQuestionSelect]);

  if (!followUpQuestions || !onFollowUpQuestionSelect) {
    return (
      <ResearchMarkdown
        content={content}
        visualizations={visualizations}
        blocks={messagePresentation?.blocks}
        presentation={presentation}
      />
    );
  }

  return (
    <>
      <ResearchMarkdown
        content={followUpQuestions.body}
        visualizations={visualizations}
        presentation={presentation}
      />
      <FollowUpQuestionActions
        questions={followUpQuestions.questions}
        disabled={followUpQuestionDisabled}
        onSelect={onFollowUpQuestionSelect}
      />
    </>
  );
}

function terminalAssistantContent(status: MessageStatus | undefined) {
  if (status === "cancelled") return CANCELLED_ASSISTANT_MESSAGE;
  if (status === "failed") return FAILED_ASSISTANT_MESSAGE;
  return "";
}

export default function ChatMessage({
  role,
  content,
  presentation = "default",
  isStreaming,
  activity,
  citations,
  artifacts,
  visualizations,
  messagePresentation,
  metadata,
  artifactSelections,
  onSelectNewsEvent,
  onFollowUpQuestionSelect,
  followUpQuestionDisabled,
  newsEventSelectionDisabled,
  showHeader = true,
  toolCalls,
  workDurationMs,
  runStartedAt,
  messageId,
  createdAt,
  status,
  answerSaveContext,
}: ChatMessageProps) {
  if (role === "user") {
    const { visibleText, attachments } = parseChatAttachmentContent(content);
    const userUrls = userUrlsFromMessageMetadata(metadata);
    const attachmentFiles = filesFromParsedAttachments(attachments);
    const hasAttachments = userUrls.length > 0 || attachmentFiles.length > 0;

    return (
      <motion.div
        className="flex w-full flex-col items-end"
        initial="hidden"
        animate="visible"
        variants={chatMessageUser}
      >
        {hasAttachments ? (
          <MessageAttachments
            urls={userUrls}
            files={attachmentFiles}
            align="end"
            variant="icon"
            className="mb-xs max-w-[92%] sm:max-w-[80%]"
          />
        ) : null}
        {visibleText ? (
          <div className="max-w-[92%] rounded-[8px] border border-hairline bg-surface p-base text-ink sm:max-w-[80%] sm:p-lg">
            <p className="whitespace-pre-wrap break-words text-[15px] font-normal leading-[1.5] sm:text-[16px]">
              {visibleText}
            </p>
          </div>
        ) : null}
      </motion.div>
    );
  }

  const assistantContent = sanitizeAssistantContent(content);
  const isGuruPresentation = presentation === "guru";
  const progressFrameClass = isGuruPresentation
    ? "mx-auto w-full max-w-[760px]"
    : "pl-0 sm:pl-[48px]";
  const assistantFrameClass = isGuruPresentation
    ? "mx-auto w-full max-w-[760px] text-body"
    : "max-w-full pl-0 text-body sm:pl-[48px]";

  return (
    <motion.div
      id={messageId ? `message-${messageId}` : undefined}
      className="flex w-full flex-col"
      initial="hidden"
      animate="visible"
      variants={chatMessageAssistant}
    >
      {showHeader && (
        <div className={progressFrameClass}>
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
        <div className={assistantFrameClass}>
          <EvidenceGraphPreview
            activity={activity}
            citations={citations}
            toolCalls={toolCalls}
          />
          {assistantContent ? (
            <StreamingContentBlocks
              content={assistantContent}
              presentation={presentation}
            />
          ) : !toolCalls?.length && !citations?.length ? (
            <LoadingDots label={activityLabel(activity)} />
          ) : null}
        </div>
      ) : (
        <div className={assistantFrameClass}>
          {assistantContent ? (
            <CompletedAssistantContent
              content={assistantContent}
              visualizations={visualizations}
              messagePresentation={messagePresentation}
              presentation={presentation}
              onFollowUpQuestionSelect={onFollowUpQuestionSelect}
              followUpQuestionDisabled={followUpQuestionDisabled}
            />
          ) : terminalAssistantContent(status) ? (
            <p className="text-[15px] leading-[1.5] text-muted">
              {terminalAssistantContent(status)}
            </p>
          ) : null}
          <ChatArtifacts
            artifacts={artifacts}
            selections={artifactSelections}
            disabled={newsEventSelectionDisabled}
            onSelectNewsEvent={onSelectNewsEvent}
          />
          {messageId && createdAt && status === "completed" ? (
            <MessageActions
              messageId={messageId}
              createdAt={createdAt}
            />
          ) : null}
          {messageId &&
          status === "completed" &&
          assistantContent &&
          answerSaveContext ? (
            <div className="mt-xs flex flex-wrap items-center gap-xs">
              <ChatAnswerSaveActions
                messageId={messageId}
                content={assistantContent}
                saveContext={answerSaveContext}
              />
            </div>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}
