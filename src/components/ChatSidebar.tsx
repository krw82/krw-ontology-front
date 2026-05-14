"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buildChatSessionHref } from "@/lib/chat/history-state";
import { useSessions } from "@/hooks/useSessions";

interface ChatSidebarProps {
  activeSessionId: string | null;
  refreshSignal?: string | number;
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "방금";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function ChatSidebar({
  activeSessionId,
  refreshSignal,
}: ChatSidebarProps) {
  const { sessions, loading, listSessions } = useSessions();

  useEffect(() => {
    listSessions(1, 30);
  }, [listSessions, refreshSignal]);

  useEffect(() => {
    const hasRunningSession = sessions.some(
      (session) =>
        session.latest_run_status === "running" ||
        session.latest_run_status === "pending",
    );

    if (!hasRunningSession) return;

    const intervalId = window.setInterval(() => {
      listSessions(1, 30);
    }, 2500);

    return () => window.clearInterval(intervalId);
  }, [listSessions, sessions]);

  return (
    <aside className="hidden md:flex w-[280px] shrink-0 flex-col border-r border-hairline bg-surface/80">
      <div className="p-md border-b border-hairline">
        <Link
          href="/chat"
          className="flex h-10 items-center justify-center gap-xs rounded-[8px] bg-surface-dark px-md text-[14px] font-bold text-stone-50 transition-colors hover:bg-primary-active"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          새 채팅
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-sm">
        {loading && sessions.length === 0 ? (
          <div className="space-y-xs">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-[72px] rounded-[8px] bg-surface-strong animate-pulse"
              />
            ))}
          </div>
        ) : (
          <nav className="space-y-xs" aria-label="채팅 기록">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isRunning =
                session.latest_run_status === "running" ||
                session.latest_run_status === "pending";
              return (
                <Link
                  key={session.id}
                  href={buildChatSessionHref(session.id)}
                  className={[
                    "block rounded-[8px] border px-sm py-xs transition-colors",
                    isActive
                      ? "border-tertiary-container bg-primary-fixed text-on-primary-fixed"
                      : "border-transparent hover:border-hairline hover:bg-surface",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-xs">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold leading-[1.4] text-ink">
                        {session.title || "새 채팅"}
                      </p>
                      <p className="mt-xxs line-clamp-2 text-[12px] leading-[1.35] text-muted">
                        {session.last_message_preview || "아직 메시지가 없습니다."}
                      </p>
                    </div>
                    {isRunning && (
                      <span
                        className="mt-[2px] h-2 w-2 shrink-0 rounded-full bg-primary-container"
                        aria-label="응답 생성 중"
                      />
                    )}
                  </div>
                  <div className="mt-xs flex items-center justify-between gap-xs text-[11px] leading-[1.3] text-muted-soft">
                    <span>{formatRelativeDate(session.updated_at)}</span>
                    {session.default_tickers.length > 0 && (
                      <span className="truncate font-mono">
                        {session.default_tickers.join(", ")}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}
