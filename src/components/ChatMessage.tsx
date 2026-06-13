"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ChatArtifacts from "@/components/ChatArtifacts";
import EvidenceGraphPreview from "@/components/EvidenceGraphPreview";
import QueueRemotionAnimation from "@/components/QueueRemotionAnimation";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import ResearchProgress from "@/components/ResearchProgress";
import type { ToolCallState } from "@/hooks/useChat";
import type {
  ChatCitation,
  ChatArtifact,
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

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  artifacts?: ChatArtifact[];
  artifactSelections?: ChatArtifactSelection[];
  onSelectNewsEvent?: (params: {
    artifactId: string;
    eventId: string;
  }) => void | Promise<void>;
  newsEventSelectionDisabled?: boolean;
  showHeader?: boolean;
  toolCalls?: ToolCallState[];
  workDurationMs?: number | null;
  runStartedAt?: string | null;
  messageId?: string;
  createdAt?: string;
  status?: MessageStatus;
  researchNoteTicker?: string;
  researchNoteSessionId?: string | null;
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
type WorkspaceSaveKind = "note" | "card" | "thesis";
type WorkspaceSaveState =
  | "idle"
  | "saving"
  | "saved"
  | "failed"
  | "auth_required";

const WORKSPACE_SAVE_ACTIONS: Array<{
  kind: WorkspaceSaveKind;
  idleIcon: string;
  idleLabel: string;
  savedLabel: string;
  failedLabel: string;
  savingLabel: string;
  visibleSavedStatus: string;
  visibleFailedStatus: string;
}> = [
  {
    kind: "note",
    idleIcon: "edit_note",
    idleLabel: "리서치 노트로 저장",
    savedLabel: "리서치 노트 저장 완료",
    failedLabel: "리서치 노트 저장 실패",
    savingLabel: "리서치 노트 저장 중",
    visibleSavedStatus: "노트 저장 완료",
    visibleFailedStatus: "노트 저장 실패",
  },
  {
    kind: "card",
    idleIcon: "assignment",
    idleLabel: "종목 카드로 저장",
    savedLabel: "종목 카드 저장 완료",
    failedLabel: "종목 카드 저장 실패",
    savingLabel: "종목 카드 저장 중",
    visibleSavedStatus: "카드 저장 완료",
    visibleFailedStatus: "카드 저장 실패",
  },
  {
    kind: "thesis",
    idleIcon: "fact_check",
    idleLabel: "Thesis로 저장",
    savedLabel: "Thesis 저장 완료",
    failedLabel: "Thesis 저장 실패",
    savingLabel: "Thesis 저장 중",
    visibleSavedStatus: "Thesis 저장 완료",
    visibleFailedStatus: "Thesis 저장 실패",
  },
];

const INITIAL_WORKSPACE_SAVE_STATES: Record<
  WorkspaceSaveKind,
  WorkspaceSaveState
> = {
  note: "idle",
  card: "idle",
  thesis: "idle",
};

async function saveAssistantMessageAsResearchNote({
  ticker,
  sessionId,
  messageId,
  content,
}: {
  ticker: string;
  sessionId?: string | null;
  messageId: string;
  content: string;
}) {
  const response = await fetch(
    `/api/watchlist/${encodeURIComponent(ticker)}/notes`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        title: `${ticker} 채팅 요약`,
        body: content,
        note_type: "chat_summary",
        tags: ["chat"],
        source_chat_session_id: sessionId || undefined,
        source_message_id: messageId,
      }),
    },
  );
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    const error = new Error(data?.error?.message || "리서치 노트로 저장하지 못했습니다.");
    if (response.status === 401) error.name = "AuthRequiredError";
    throw error;
  }
}

async function saveAssistantMessageAsCompanyCard({
  ticker,
  sessionId,
  messageId,
  content,
}: {
  ticker: string;
  sessionId?: string | null;
  messageId: string;
  content: string;
}) {
  const response = await fetch(
    `/api/watchlist/${encodeURIComponent(ticker)}/card`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        title: `${ticker} 종목 카드`,
        summary: compactTextPreview(content, 1200),
        content_md: content,
        source_chat_session_id: sessionId || undefined,
        source_message_id: messageId,
      }),
    },
  );
  await assertWorkspaceSaveResponse(response, "종목 카드로 저장하지 못했습니다.");
}

async function saveAssistantMessageAsThesis({
  ticker,
  sessionId,
  messageId,
  content,
}: {
  ticker: string;
  sessionId?: string | null;
  messageId: string;
  content: string;
}) {
  const response = await fetch(
    `/api/watchlist/${encodeURIComponent(ticker)}/theses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        title: `${ticker} 채팅 기반 Thesis`,
        thesis_text: content,
        status: "needs_review",
        tags: ["chat"],
        source_chat_session_id: sessionId || undefined,
        source_message_id: messageId,
      }),
    },
  );
  await assertWorkspaceSaveResponse(response, "Thesis로 저장하지 못했습니다.");
}

async function assertWorkspaceSaveResponse(
  response: Response,
  fallbackMessage: string,
) {
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    const error = new Error(data?.error?.message || fallbackMessage);
    if (response.status === 401) error.name = "AuthRequiredError";
    throw error;
  }
}

function compactTextPreview(content: string, maxLength: number): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function MessageActions({
  messageId,
  createdAt,
  assistantContent,
  researchNoteTicker,
  researchNoteSessionId,
}: {
  messageId: string;
  createdAt: string;
  assistantContent: string;
  researchNoteTicker?: string;
  researchNoteSessionId?: string | null;
}) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [saveStates, setSaveStates] = useState<
    Record<WorkspaceSaveKind, WorkspaceSaveState>
  >(() => ({ ...INITIAL_WORKSPACE_SAVE_STATES }));
  const formattedTime = useMemo(() => formatMessageTime(createdAt), [createdAt]);

  const setSaveState = useCallback(
    (kind: WorkspaceSaveKind, state: WorkspaceSaveState) => {
      setSaveStates((current) => ({ ...current, [kind]: state }));
    },
    [],
  );

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

  useEffect(() => {
    const hasTerminalState = WORKSPACE_SAVE_ACTIONS.some(({ kind }) =>
      ["saved", "failed", "auth_required"].includes(saveStates[kind]),
    );
    if (!hasTerminalState) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setSaveStates((current) => {
        const next = { ...current };
        for (const { kind } of WORKSPACE_SAVE_ACTIONS) {
          if (["saved", "failed", "auth_required"].includes(next[kind])) {
            next[kind] = "idle";
          }
        }
        return next;
      });
    }, 1800);
    return () => window.clearTimeout(timeoutId);
  }, [saveStates]);

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

  const handleSaveWorkspaceAsset = useCallback(async (kind: WorkspaceSaveKind) => {
    if (!researchNoteTicker || !assistantContent.trim()) return;
    if (saveStates[kind] === "saving") return;

    setSaveState(kind, "saving");
    try {
      if (kind === "note") {
        await saveAssistantMessageAsResearchNote({
          ticker: researchNoteTicker,
          sessionId: researchNoteSessionId,
          messageId,
          content: assistantContent,
        });
      } else if (kind === "card") {
        await saveAssistantMessageAsCompanyCard({
          ticker: researchNoteTicker,
          sessionId: researchNoteSessionId,
          messageId,
          content: assistantContent,
        });
      } else {
        await saveAssistantMessageAsThesis({
          ticker: researchNoteTicker,
          sessionId: researchNoteSessionId,
          messageId,
          content: assistantContent,
        });
      }
      setSaveState(kind, "saved");
    } catch (error) {
      setSaveState(
        kind,
        error instanceof Error && error.name === "AuthRequiredError"
          ? "auth_required"
          : "failed",
      );
    }
  }, [
    assistantContent,
    messageId,
    researchNoteSessionId,
    researchNoteTicker,
    saveStates,
    setSaveState,
  ]);

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
  const canSaveResearchNote = Boolean(
    researchNoteTicker && assistantContent.trim(),
  );
  const activeSaveAction = WORKSPACE_SAVE_ACTIONS.find(
    ({ kind }) => saveStates[kind] !== "idle",
  );
  const visibleSaveStatus =
    activeSaveAction && saveStates[activeSaveAction.kind] === "saved"
      ? activeSaveAction.visibleSavedStatus
      : activeSaveAction && saveStates[activeSaveAction.kind] === "failed"
        ? activeSaveAction.visibleFailedStatus
        : activeSaveAction &&
            saveStates[activeSaveAction.kind] === "auth_required"
          ? "로그인이 필요합니다"
          : "";

  return (
    <div className="mt-sm flex items-center gap-xs text-[13px] leading-none text-muted">
      {canSaveResearchNote && (
        <>
          {WORKSPACE_SAVE_ACTIONS.map((action) => {
            const state = saveStates[action.kind];
            const actionIcon =
              state === "saved"
                ? "check"
                : state === "failed"
                  ? "error"
                  : state === "auth_required"
                    ? "lock"
                    : state === "saving"
                      ? "progress_activity"
                      : action.idleIcon;
            const actionLabel =
              state === "saved"
                ? action.savedLabel
                : state === "failed"
                  ? action.failedLabel
                  : state === "auth_required"
                    ? "로그인이 필요합니다"
                    : state === "saving"
                      ? action.savingLabel
                      : action.idleLabel;

            return (
              <button
                key={action.kind}
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
                aria-label={actionLabel}
                disabled={state === "saving"}
                onClick={() => handleSaveWorkspaceAsset(action.kind)}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "material-symbols-outlined text-[18px]",
                    state === "saving" ? "animate-spin" : "",
                  ].join(" ")}
                >
                  {actionIcon}
                </span>
              </button>
            );
          })}
        </>
      )}
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
      <span
        aria-live="polite"
        className={[
          "min-w-0 text-[12px] leading-none transition-opacity",
          visibleSaveStatus || visibleShareStatus ? "opacity-100" : "opacity-0",
          shareState === "failed" ||
          shareState === "auth_required" ||
          (activeSaveAction &&
            ["failed", "auth_required"].includes(
              saveStates[activeSaveAction.kind],
            ))
            ? "text-error"
            : "text-muted",
        ].join(" ")}
      >
        {visibleSaveStatus || visibleShareStatus || " "}
      </span>
    </div>
  );
}

function activityLabel(activity?: ResearchActivityUpdate | null): string {
  switch (activity?.stage) {
    case "queued":
      return "대기열에 추가됨";
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
  artifacts,
  artifactSelections,
  onSelectNewsEvent,
  newsEventSelectionDisabled,
  showHeader = true,
  toolCalls,
  workDurationMs,
  runStartedAt,
  messageId,
  createdAt,
  status,
  researchNoteTicker,
  researchNoteSessionId,
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

  const assistantContent = sanitizeAssistantContent(content);

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
          {assistantContent ? (
            <StreamingContentBlocks content={assistantContent} />
          ) : !toolCalls?.length && !citations?.length ? (
            <LoadingDots label={activityLabel(activity)} />
          ) : null}
        </div>
      ) : (
        <div className="max-w-full pl-0 text-body sm:pl-[48px]">
          {assistantContent ? (
            <CompletedAssistantContent content={assistantContent} />
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
              assistantContent={assistantContent}
              researchNoteTicker={researchNoteTicker}
              researchNoteSessionId={researchNoteSessionId}
            />
          ) : null}
        </div>
      )}
    </motion.div>
  );
}
