"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ToolCallState } from "@/hooks/useChat";
import type {
  ChatCitation,
  ResearchActivityUpdate,
} from "@/types/api-contracts";
import {
  buildResearchSteps,
  formatResearchDuration,
  type ResearchStep,
  type ResearchStepStatus,
} from "@/lib/chat/research-status";

interface ResearchProgressProps {
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  isStreaming?: boolean;
  toolCalls?: ToolCallState[];
  workDurationMs?: number | null;
}

type ResearchStepId = "scope" | "search" | "trace" | "compose";
type StepIconName = Record<ResearchStepId, string>;

const progressTransition = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1] as const,
};

const stepIcons: StepIconName = {
  scope: "folder_open",
  search: "search",
  trace: "account_tree",
  compose: "edit_note",
};

function StepMarker({ status }: { status: ResearchStepStatus }) {
  if (status === "complete") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary-fixed text-[11px] font-black leading-none text-primary"
      >
        ✓
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-hairline"
    >
      <span className="h-1 w-1 rounded-full bg-muted-soft" />
    </span>
  );
}

function ResearchStepItem({ step }: { step: ResearchStep }) {
  const isActive = step.status === "running";
  const isComplete = step.status === "complete";

  return (
    <div
      className={[
        "flex min-w-0 items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] font-bold leading-none transition-colors",
        isActive
          ? "bg-primary-fixed text-on-primary-fixed"
          : isComplete
            ? "text-ink"
            : "text-muted",
      ].join(" ")}
    >
      <StepMarker status={step.status} />
      <span
        aria-hidden="true"
        className="material-symbols-outlined hidden text-[15px] sm:inline-block"
      >
        {stepIcons[step.id]}
      </span>
      <span className="truncate">{step.label}</span>
    </div>
  );
}

export default function ResearchProgress({
  activity,
  citations = [],
  isStreaming = false,
  toolCalls = [],
  workDurationMs,
}: ResearchProgressProps) {
  const [isOpen, setIsOpen] = useState(false);
  const steps = useMemo(
    () => buildResearchSteps(toolCalls),
    [toolCalls],
  );
  const hasProgress =
    !isStreaming &&
    (toolCalls.length > 0 ||
      citations.length > 0 ||
      Boolean(workDurationMs && workDurationMs > 0));

  if (!hasProgress) return null;

  const durationLabel =
    workDurationMs && workDurationMs > 0
      ? formatResearchDuration(workDurationMs)
      : null;
  const summaryParts = [
    "작업 내역",
    toolCalls.length > 0 ? `도구 ${toolCalls.length}회` : null,
    citations.length > 0 ? `근거 ${citations.length}개` : null,
    durationLabel,
  ].filter(Boolean);

  return (
    <motion.div
      className="mt-md w-full max-w-[780px]"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={progressTransition}
    >
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-xs rounded-full border border-hairline bg-surface-soft px-sm py-xs text-[12px] font-bold leading-none text-body transition-colors hover:border-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-[13px]"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[16px] text-primary-container"
        >
          checklist
        </span>
        <span className="truncate">{summaryParts.join(" · ")}</span>
        <span
          aria-hidden="true"
          className={[
            "material-symbols-outlined text-[16px] transition-transform",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
        >
          expand_more
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            className="mt-xs grid max-w-[560px] grid-cols-2 gap-1 sm:grid-cols-4"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={progressTransition}
          >
            {steps.map((step) => (
              <ResearchStepItem key={step.id} step={step} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {activity?.stage === "complete" && (
        <span className="sr-only">작업 완료</span>
      )}
    </motion.div>
  );
}
