"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_ANALYSIS_MODE,
  normalizeAnalysisMode,
  type AnalysisMode,
} from "@/lib/analysis-mode";

const STORAGE_KEY = "krw:chat:analysis-mode";
const listeners = new Set<() => void>();

function readStoredMode(): AnalysisMode {
  if (typeof window === "undefined") return DEFAULT_ANALYSIS_MODE;

  try {
    return normalizeAnalysisMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_ANALYSIS_MODE;
  }
}

function writeStoredMode(mode: AnalysisMode) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage policy failures should not block chat.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function getServerSnapshot(): AnalysisMode {
  return DEFAULT_ANALYSIS_MODE;
}

export function useAnalysisModePreference() {
  const mode = useSyncExternalStore(
    subscribe,
    readStoredMode,
    getServerSnapshot,
  );

  const setMode = useCallback((nextMode: AnalysisMode) => {
    const normalizedMode = normalizeAnalysisMode(nextMode);
    writeStoredMode(normalizedMode);
    notifyListeners();
  }, []);

  return [mode, setMode] as const;
}
