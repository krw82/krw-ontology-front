"use client";

import { motion } from "motion/react";
import QueueRemotionAnimation from "@/components/QueueRemotionAnimation";
import type { ToolCallState } from "@/hooks/useChat";
import type {
  ChatCitation,
  ResearchActivityUpdate,
} from "@/types/api-contracts";
import { getResearchActivityLabel } from "@/lib/chat/research-status";
import {
  formatResearchDuration,
  getQueueStatusLabel,
} from "@/lib/chat/research-status";
import {
  useRunningDurationMs,
} from "@/hooks/useRunningStatus";

interface ResearchProgressProps {
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  isStreaming?: boolean;
  toolCalls?: ToolCallState[];
  workDurationMs?: number | null;
  runStartedAt?: string | null;
}

const progressTransition = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1] as const,
};

export default function ResearchProgress({
  isStreaming = false,
  activity,
  toolCalls = [],
  runStartedAt,
}: ResearchProgressProps) {
  const elapsedMs = useRunningDurationMs({
    isRunning: isStreaming,
    runStartedAt,
    toolCalls,
  });

  if (!isStreaming) return null;

  const isQueued = activity?.stage === "queued";
  const durationLabel = formatResearchDuration(elapsedMs);
  const statusLabel = isQueued
    ? "대기열에 추가됨"
    : activity
      ? getResearchActivityLabel(activity)
      : "분석 준비 중";
  const detailLabel = isQueued
    ? getQueueStatusLabel(activity?.queue)
    : durationLabel;
  const helperLabel = isQueued
    ? "앞 작업이 끝나면 자동으로 시작됩니다."
    : "화면을 나가도 분석은 계속 진행돼요. 채팅 기록에서 이어서 확인할 수 있습니다.";

  return (
    <motion.div
      className="mb-xs flex w-full max-w-[780px] items-start gap-sm"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={progressTransition}
    >
      {isQueued ? (
        <QueueRemotionAnimation className="-mt-2 -ml-2" size="regular" />
      ) : null}
      <div className="min-w-0">
        <p className="text-left text-[12px] font-extrabold leading-5 text-ink sm:text-[13px]">
          {statusLabel}
        </p>
        <p
          aria-hidden="true"
          className="mt-0.5 text-[12px] font-medium leading-5 text-muted-soft sm:text-[13px]"
        >
          {detailLabel}
        </p>
        <p className="mt-0.5 text-[12px] font-medium leading-5 text-muted-soft sm:text-[13px]">
          {helperLabel}
        </p>
      </div>
    </motion.div>
  );
}
