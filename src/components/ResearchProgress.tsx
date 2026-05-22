"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { ToolCallState } from "@/hooks/useChat";
import type {
  ChatCitation,
  ResearchActivityUpdate,
} from "@/types/api-contracts";
import {
  formatResearchDuration,
  getActiveResearchLabel,
} from "@/lib/chat/research-status";

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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function getToolTopic(toolCalls: ToolCallState[]): string | null {
  for (const toolCall of [...toolCalls].reverse()) {
    const args = toolCall.arguments;
    if (!args) continue;

    const values = [
      ...asStringArray(args.topic),
      ...asStringArray(args.topics),
      ...asStringArray(args.query),
      ...asStringArray(args.question),
    ];

    if (values[0]) {
      return values[0]
        .replace(/[_:/|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter((word) => word.length > 1)
        .slice(0, 7)
        .join(" ");
    }
  }

  return null;
}

function useStreamingDuration(
  isStreaming: boolean,
  toolCalls: ToolCallState[],
  runStartedAt?: string | null,
) {
  const firstToolStartedAt = toolCalls.find((toolCall) => toolCall.started_at)
    ?.started_at;
  const runStartedAtMs = runStartedAt ? Date.parse(runStartedAt) : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [isStreaming]);

  if (!isStreaming) return 0;

  const startedAt = Number.isFinite(runStartedAtMs)
    ? runStartedAtMs
    : firstToolStartedAt ?? now;
  return Math.max(0, now - startedAt);
}

export default function ResearchProgress({
  activity,
  isStreaming = false,
  toolCalls = [],
  runStartedAt,
}: ResearchProgressProps) {
  const elapsedMs = useStreamingDuration(isStreaming, toolCalls, runStartedAt);
  const activeLabel = useMemo(
    () => getActiveResearchLabel(toolCalls, activity),
    [activity, toolCalls],
  );
  const topic = useMemo(() => getToolTopic(toolCalls), [toolCalls]);

  if (!isStreaming) return null;

  const durationLabel = formatResearchDuration(elapsedMs);
  const progressText = topic
    ? `${activeLabel} 중 ${topic} · ${durationLabel}`
    : `${activeLabel} 중 · ${durationLabel}`;

  return (
    <motion.div
      className="mb-xs w-full max-w-[780px]"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={progressTransition}
    >
      <p className="max-w-full truncate text-[13px] font-semibold leading-5 text-muted sm:text-[14px]">
        {progressText}
      </p>
    </motion.div>
  );
}
