"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import ResearchProgress from "@/components/ResearchProgress";
import type { ToolCallState } from "@/hooks/useChat";
import type {
  ChatCitation,
  ResearchActivityUpdate,
} from "@/types/api-contracts";
import { chatMessageAssistant, chatMessageUser } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  showHeader?: boolean;
  toolCalls?: ToolCallState[];
  workDurationMs?: number | null;
}

interface DisplayAttachment {
  name: string;
  characterCount: number;
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

const attachedFilePattern =
  /(?:\n\n)?<attached_file\s+name="([^"]*)">\n?([\s\S]*?)\n?<\/attached_file>/g;

function decodeAttachmentName(name: string): string {
  return name
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseUserDisplayContent(content: string): {
  visibleText: string;
  attachments: DisplayAttachment[];
} {
  const attachments: DisplayAttachment[] = [];
  const visibleText = content
    .replace(attachedFilePattern, (_match, rawName: string, rawContent: string) => {
      attachments.push({
        name: decodeAttachmentName(rawName),
        characterCount: rawContent.trim().length,
      });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { visibleText, attachments };
}

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

function activityLabel(activity?: ResearchActivityUpdate | null): string {
  switch (activity?.stage) {
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
    <div className="space-y-md">
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
            <ResearchMarkdown content={section} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
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
}: ChatMessageProps) {
  if (role === "user") {
    const { visibleText, attachments } = parseUserDisplayContent(content);

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
          />
        </div>
      )}
      {isStreaming ? (
        <div className="max-w-full pl-0 text-body sm:pl-[48px]">
          {content ? (
            <StreamingContentBlocks content={content} />
          ) : !showHeader ? (
            <LoadingDots label={activityLabel(activity)} />
          ) : null}
        </div>
      ) : (
        <div className="max-w-full pl-0 text-body sm:pl-[48px]">
          {content ? <StreamingContentBlocks content={content} /> : null}
        </div>
      )}
    </motion.div>
  );
}
