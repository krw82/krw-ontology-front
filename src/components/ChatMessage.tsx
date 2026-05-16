"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import ResearchMarkdown from "@/components/ResearchMarkdown";
import type { ResearchActivityUpdate } from "@/types/api-contracts";
import { chatMessageUser, chatMessageAssistant } from "@/lib/animation";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  activity?: ResearchActivityUpdate | null;
  showHeader?: boolean;
  workDurationMs?: number | null;
}

function LoadingDots({ label = "분석 준비 중" }: { label?: string }) {
  return (
    <motion.div
      className="flex items-center gap-xs text-[14px] leading-[1.4] text-muted"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted" />
      </div>
      <span>{label}</span>
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
  const label = isStreaming
    ? `${activityLabel(activity)} · ${formatDuration(elapsedMs)}`
    : workDurationMs && workDurationMs > 0
      ? `${formatDuration(workDurationMs)} 동안 작업`
      : null;

  if (!label) return null;

  return (
    <div
      className="mb-md flex w-full max-w-[780px] items-center gap-xs border-b border-hairline pb-sm text-[14px] font-semibold leading-[1.4] text-muted sm:text-[15px]"
      aria-live="polite"
    >
      {isStreaming && (
        <motion.span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-primary"
          animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
        />
      )}
      <span>{label}</span>
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
          <p className="whitespace-pre-wrap break-words text-[15px] font-normal leading-[1.5] sm:text-[16px]">{content}</p>
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
        <div className="max-w-full space-y-md break-words pl-0 text-body sm:pl-[48px]">
          {content ? <ResearchMarkdown content={content} /> : null}
        </div>
      )}
    </motion.div>
  );
}
