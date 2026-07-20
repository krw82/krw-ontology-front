"use client";

import { useRunningDurationMs } from "@/hooks/useRunningStatus";
import QueueRemotionAnimation from "@/components/QueueRemotionAnimation";
import {
  getQueueStatusLabel,
  getResearchActivityLabel,
} from "@/lib/chat/research-status";
import type { ResearchActivityUpdate } from "@/types/api-contracts";
import type { ToolCallState } from "@/hooks/useChat";

interface RunStatusDockProps {
  label?: string;
  activity?: ResearchActivityUpdate | null;
  toolCalls?: ToolCallState[];
  workDurationMs?: number | null;
  runStartedAt?: string | null;
  onCancel?: () => void | Promise<void>;
  variant?: "queued" | "running";
}

export default function RunStatusDock({
  label,
  activity,
  toolCalls = [],
  workDurationMs,
  runStartedAt,
  onCancel,
  variant = "running",
}: RunStatusDockProps) {
  const isQueued = variant === "queued" || activity?.stage === "queued";
  const runningElapsedMs = useRunningDurationMs({
    isRunning: !isQueued,
    runStartedAt,
    toolCalls,
  });
  const elapsedMs = workDurationMs ?? runningElapsedMs;
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));

  const titleLabel = label ?? (isQueued ? "대기열에 추가됨" : "분석 진행중");
  const helperLabel = isQueued
    ? "앞 작업이 끝나면 자동으로 시작됩니다."
    : "화면을 나가도 분석은 계속 진행돼요.";
  const progressLabel = isQueued
    ? getQueueStatusLabel(activity?.queue)
    : activity
      ? getResearchActivityLabel(activity)
      : "분석 준비 중";

  return (
    <div className="border-t border-hairline bg-canvas px-base py-xs sm:px-lg">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-[12px] border border-hairline bg-canvas px-3 py-2 shadow-sm">
        <div className="min-w-0 flex items-center gap-2.5">
          {isQueued ? (
            <QueueRemotionAnimation className="-ml-1" size="compact" />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-outline-variant border-t-primary"
            >
              <span className="sr-only">분석 진행중</span>
            </span>
          )}
          <div className="min-w-0 leading-none">
            <p className="truncate text-[13px] font-bold leading-5 text-ink">
              {titleLabel}
            </p>
            <p className="truncate text-[12px] font-medium leading-4 text-muted">
              {progressLabel}
              {!isQueued && seconds > 0 ? ` · ${seconds}초` : ""}
            </p>
          </div>
        </div>
        <p className="hidden min-w-0 flex-1 truncate text-right text-[12px] font-medium leading-4 text-muted-soft sm:block">
          {helperLabel}
        </p>
        {onCancel && (
          <button
            type="button"
            className="inline-flex h-11 items-center rounded-[8px] border border-hairline bg-surface px-3 text-[12px] font-bold text-error transition-colors hover:bg-error-container/25 active:scale-95"
            onClick={() => void onCancel()}
          >
            중지
          </button>
        )}
      </div>
    </div>
  );
}
