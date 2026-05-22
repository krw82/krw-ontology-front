"use client";

import { useState, useCallback } from "react";
import type {
  Session,
  SessionSummary,
  CreateSessionRequest,
  CreateSessionResponse,
  DeleteSessionResponse,
  ListSessionsResponse,
  UpdateSessionResponse,
} from "@/types/api-contracts";

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mutatingSessionId, setMutatingSessionId] = useState<string | null>(null);
  // M-10: separate error states for list vs create
  const [listError, setListError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

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

  const renameSession = useCallback(
    async (sessionId: string, title: string): Promise<SessionSummary | null> => {
      const previousSessions = sessions;
      const normalizedTitle = title.replace(/\s+/g, " ").trim();
      if (!normalizedTitle) {
        setMutationError("채팅 이름을 입력해주세요.");
        return null;
      }

      setMutationError(null);
      setMutatingSessionId(sessionId);
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title: normalizedTitle,
                updated_at: new Date().toISOString(),
              }
            : session,
        ),
      );

      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: normalizedTitle }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error?.message || "채팅 이름을 저장하지 못했습니다.");
        }
        const data: UpdateSessionResponse = await res.json();
        const updated = data.session;
        const previousSummary =
          previousSessions.find((session) => session.id === sessionId) ?? null;

        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  title: updated.title,
                  updated_at: updated.updated_at,
                }
              : session,
          ),
        );

        return previousSummary
          ? {
              ...previousSummary,
              title: updated.title,
              updated_at: updated.updated_at,
            }
          : null;
      } catch (err) {
        setSessions(previousSessions);
        setMutationError((err as Error).message);
        return null;
      } finally {
        setMutatingSessionId(null);
      }
    },
    [sessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string): Promise<DeleteSessionResponse | null> => {
      const previousSessions = sessions;
      setMutationError(null);
      setMutatingSessionId(sessionId);
      setSessions((current) =>
        current.filter((session) => session.id !== sessionId),
      );

      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error?.message || "채팅을 삭제하지 못했습니다.");
        }
        return (await res.json()) as DeleteSessionResponse;
      } catch (err) {
        setSessions(previousSessions);
        setMutationError((err as Error).message);
        return null;
      } finally {
        setMutatingSessionId(null);
      }
    },
    [sessions],
  );

  return {
    sessions,
    loading,
    creating,
    mutatingSessionId,
    listError,
    createError,
    mutationError,
    error: listError || createError || mutationError,
    listSessions,
    createSession,
    renameSession,
    deleteSession,
  };
}
