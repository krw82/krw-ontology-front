"use client";

import { useRunningDurationMs } from "@/hooks/useRunningStatus";
import { getResearchActivityLabel } from "@/lib/chat/research-status";
import type { ResearchActivityUpdate } from "@/types/api-contracts";
import type { ToolCallState } from "@/hooks/useChat";

interface RunStatusDockProps {
  label?: string;
  activity?: ResearchActivityUpdate | null;
  toolCalls?: ToolCallState[];
  runStartedAt?: string | null;
  onCancel?: () => void | Promise<void>;
}

export default function RunStatusDock({
  label = "분석 진행중",
  activity,
  toolCalls = [],
  runStartedAt,
  onCancel,
}: RunStatusDockProps) {
  const elapsedMs = useRunningDurationMs({
    isRunning: true,
    runStartedAt,
    toolCalls,
  });
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));

  const progressLabel = activity
    ? getResearchActivityLabel(activity)
    : "분석 준비 중";

  return (
    <div className="border-t border-hairline bg-canvas/95 px-base py-sm backdrop-blur-xl sm:px-lg">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-3 shadow-[0_10px_28px_rgba(10,11,13,0.08)]">
        <div className="min-w-0 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 animate-spin rounded-full bg-[conic-gradient(from_0deg,rgba(0,82,255,0.1)_0deg,rgba(0,82,255,0.18)_92deg,#0052ff_220deg,rgba(0,82,255,0.1)_360deg)] p-[2px]"
          >
            <span className="h-full w-full rounded-full bg-surface" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold text-ink">
              {label}
            </p>
            <p className="truncate text-[13px] font-semibold text-muted">
              화면을 나가도 분석은 계속 진행돼요.
            </p>
            <p className="mt-0.5 truncate text-[12px] font-medium text-muted-soft">
              {progressLabel}
              {seconds > 0 ? ` · ${seconds}초` : ""}
            </p>
          </div>
        </div>
        {onCancel && (
          <button
            type="button"
            className="rounded-full bg-surface-dim px-4 py-2 text-[13px] font-extrabold text-error transition active:scale-95"
            onClick={() => void onCancel()}
          >
            중지
          </button>
        )}
      </div>
    </div>
  );
}
