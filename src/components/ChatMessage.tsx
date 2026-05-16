"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import type { ResearchActivityUpdate } from "@/types/api-contracts";
import { chatMessageAssistant, chatMessageUser } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  activity?: ResearchActivityUpdate | null;
  showHeader?: boolean;
  workDurationMs?: number | null;
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

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds}초`;
  if (seconds === 0) return `${minutes}분`;
  return `${minutes}분 ${seconds}초`;
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

function useElapsedMilliseconds(enabled: boolean): number {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    if (!enabled) return undefined;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [enabled]);

  return now - startedAt;
}

function WorkMetaLine({
  activity,
  isStreaming,
  workDurationMs,
}: {
  activity?: ResearchActivityUpdate | null;
  isStreaming?: boolean;
  workDurationMs?: number | null;
}) {
  const elapsedMs = useElapsedMilliseconds(Boolean(isStreaming));
  const verticalOffset = useStreamingMotionOffset();
  const streamingLabel = activityLabel(activity);
  const statusLabel = isStreaming
    ? streamingLabel
    : workDurationMs && workDurationMs > 0
      ? `${formatDuration(workDurationMs)} 동안 작업`
      : null;
  const statusText = isStreaming ? `${formatDuration(elapsedMs)}` : null;
  const statusKey = isStreaming
    ? `${activity?.stage ?? "preparing"}:${streamingLabel}`
    : "completed";

  if (!statusLabel) return null;

  return (
    <div
      className="mb-md flex w-full max-w-[780px] items-center gap-xs border-b border-hairline pb-sm text-[14px] font-semibold leading-[1.4] text-muted sm:text-[15px]"
      aria-live="polite"
    >
      {isStreaming && (
        <motion.span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-primary"
          initial={{ opacity: 0.45, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      )}
      <span className="inline-flex items-center gap-xs">
        <AnimatePresence mode="wait">
          <motion.span
            key={statusKey}
            initial={{ opacity: 0, y: verticalOffset }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -verticalOffset }}
            transition={statusTransition}
          >
            {statusLabel}
          </motion.span>
        </AnimatePresence>
        {isStreaming && statusText ? <span>· {statusText}</span> : null}
      </span>
    </div>
  );
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
  showHeader = true,
  workDurationMs,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <motion.div
        className="flex w-full flex-col items-end"
        initial="hidden"
        animate="visible"
        variants={chatMessageUser}
      >
        <div className="max-w-[92%] rounded-[8px] border border-hairline bg-surface p-base text-ink sm:max-w-[80%] sm:p-lg">
          <p className="whitespace-pre-wrap break-words text-[15px] font-normal leading-[1.5] sm:text-[16px]">
            {content}
          </p>
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
          <WorkMetaLine
            activity={activity}
            isStreaming={isStreaming}
            workDurationMs={workDurationMs}
          />
        </div>
      )}
      {isStreaming ? (
        <div className="pl-0 sm:pl-[48px]">
          <LoadingDots label={activityLabel(activity)} />
        </div>
      ) : (
        <div className="max-w-full pl-0 text-body sm:pl-[48px]">
          {content ? <StreamingContentBlocks content={content} /> : null}
        </div>
      )}
    </motion.div>
  );
}
