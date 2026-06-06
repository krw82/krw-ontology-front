"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ANALYSIS_MODE,
  normalizeAnalysisMode,
  type AnalysisMode,
} from "@/lib/analysis-mode";

export function useAnalysisModePreference(
  sessionId: string | null | undefined,
) {
  const [mode, setModeState] = useState<AnalysisMode>(DEFAULT_ANALYSIS_MODE);
  const previousSessionIdRef = useRef<string | null | undefined>(sessionId);

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = sessionId;

    if (!sessionId && previousSessionId) {
      setModeState(DEFAULT_ANALYSIS_MODE);
    }
  }, [sessionId]);

  const setMode = useCallback((nextMode: AnalysisMode) => {
    setModeState(normalizeAnalysisMode(nextMode));
  }, []);

  return [mode, setMode] as const;
}
