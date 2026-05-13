"use client";

import { useState, useCallback } from "react";
import type {
  Session,
  SessionSummary,
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
} from "@/types/api-contracts";

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  // M-10: separate error states for list vs create
  const [listError, setListError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const listSessions = useCallback(async (page = 1, limit = 20) => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch(
        `/api/sessions?page=${page}&limit=${limit}`,
      );
      if (!res.ok) throw new Error("채팅 목록을 불러오지 못했습니다.");
      const data: ListSessionsResponse = await res.json();
      setSessions(data.sessions);
      return data;
    } catch (err) {
      setListError((err as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createSession = useCallback(
    async (request: CreateSessionRequest): Promise<Session | null> => {
      setCreateError(null);
      setCreating(true);
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error?.message || "새 채팅을 만들지 못했습니다.");
        }
        const data: CreateSessionResponse = await res.json();
        return data.session;
      } catch (err) {
        setCreateError((err as Error).message);
        return null;
      } finally {
        setCreating(false);
      }
    },
    [],
  );

  return {
    sessions,
    loading,
    creating,
    listError,
    createError,
    error: listError || createError,
    listSessions,
    createSession,
  };
}
