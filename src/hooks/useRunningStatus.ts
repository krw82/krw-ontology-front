"use client";

import { useEffect, useState } from "react";

type StartedToolCall = {
  started_at?: number;
};

export const runningStatusLabels = [
  "분석 진행 중",
  "생각 중",
  "열심히 하는 중",
] as const;

function pickRandomLabel(currentLabel?: string): string {
  const labels: readonly string[] = runningStatusLabels;
  if (labels.length <= 1) return labels[0] ?? "";

  let nextLabel = labels[Math.floor(Math.random() * labels.length)];

  while (nextLabel === currentLabel) {
    nextLabel = labels[Math.floor(Math.random() * labels.length)];
  }

  return nextLabel;
}

export function useRandomRunningStatus(isRunning: boolean): string {
  const [label, setLabel] = useState<string>(runningStatusLabels[0]);

  useEffect(() => {
    if (!isRunning) return;

    const timer = window.setInterval(() => {
      setLabel((currentLabel) => pickRandomLabel(currentLabel));
    }, 2600);

    return () => window.clearInterval(timer);
  }, [isRunning]);

  return isRunning ? label : runningStatusLabels[0];
}

export function useRunningDurationMs({
  isRunning,
  runStartedAt,
  toolCalls = [],
}: {
  isRunning: boolean;
  runStartedAt?: string | null;
  toolCalls?: StartedToolCall[];
}): number {
  const firstToolStartedAt = toolCalls.find((toolCall) => toolCall.started_at)
    ?.started_at;
  const runStartedAtMs = runStartedAt ? Date.parse(runStartedAt) : NaN;
  const [fallbackStartedAt, setFallbackStartedAt] = useState<number | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFallbackStartedAt(isRunning ? Date.now() : null);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [isRunning]);

  if (!isRunning) return 0;

  const startedAt = Number.isFinite(runStartedAtMs)
    ? runStartedAtMs
    : firstToolStartedAt ?? fallbackStartedAt ?? now;
  return Math.max(0, now - startedAt);
}
