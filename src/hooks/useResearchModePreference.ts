"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  DEFAULT_RESEARCH_MODE,
  normalizeResearchMode,
  type ResearchMode,
} from "@/lib/research-mode";

const STORAGE_PREFIX = "krw:chat:research-mode:";
const CLIENT_RESEARCH_MODE_PREFERENCE_ENABLED = false;

let draftMode: ResearchMode = DEFAULT_RESEARCH_MODE;
const listeners = new Set<() => void>();

function getStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

function readMode(key: string): ResearchMode | null {
  if (!CLIENT_RESEARCH_MODE_PREFERENCE_ENABLED) return null;
  if (typeof window === "undefined") return null;

  try {
    const stored = window.sessionStorage.getItem(key);
    return stored === null ? null : normalizeResearchMode(stored);
  } catch {
    return null;
  }
}

function writeMode(key: string, mode: ResearchMode) {
  if (!CLIENT_RESEARCH_MODE_PREFERENCE_ENABLED) return;
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(key, mode);
  } catch {
    // Private browsing or storage policy failures should not block chat.
  }
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): ResearchMode {
  return DEFAULT_RESEARCH_MODE;
}

export function useResearchModePreference(
  sessionId: string | null | undefined,
) {
  const previousSessionIdRef = useRef<string | null | undefined>(sessionId);
  const getSnapshot = useCallback((): ResearchMode => {
    if (!CLIENT_RESEARCH_MODE_PREFERENCE_ENABLED) return DEFAULT_RESEARCH_MODE;
    if (!sessionId) return draftMode;
    return readMode(getStorageKey(sessionId)) ?? DEFAULT_RESEARCH_MODE;
  }, [sessionId]);

  const mode = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (!CLIENT_RESEARCH_MODE_PREFERENCE_ENABLED) return;

    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = sessionId;

    if (sessionId && !previousSessionId) {
      const key = getStorageKey(sessionId);
      if (!readMode(key)) {
        writeMode(key, draftMode);
      }
      draftMode = DEFAULT_RESEARCH_MODE;
      notifyListeners();
      return;
    }

    if (!sessionId && previousSessionId) {
      draftMode = DEFAULT_RESEARCH_MODE;
      notifyListeners();
    }
  }, [sessionId]);

  const setMode = useCallback(
    (nextMode: ResearchMode) => {
      if (!CLIENT_RESEARCH_MODE_PREFERENCE_ENABLED) return;
      const normalizedMode = normalizeResearchMode(nextMode);
      if (sessionId) {
        writeMode(getStorageKey(sessionId), normalizedMode);
      } else {
        draftMode = normalizedMode;
      }
      notifyListeners();
    },
    [sessionId],
  );

  return [mode, setMode] as const;
}
