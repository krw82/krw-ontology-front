"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { buildChatSessionHref } from "@/lib/chat/history-state";
import { useSessions } from "@/hooks/useSessions";
import { sidebarPanel, sidebarBackdrop } from "@/lib/animation";

interface ChatSidebarProps {
  activeSessionId: string | null;
  refreshSignal?: string | number;
}

interface SidebarContentProps {
  activeSessionId: string | null;
  loading: boolean;
  sessions: ReturnType<typeof useSessions>["sessions"];
  onNavigate?: () => void;
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
  const [mobileOpen, setMobileOpen] = useState(false);

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

  useEffect(() => {
    if (!mobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  return (
    <>
      <button
        type="button"
        className="fixed left-base top-[10px] z-[70] inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas md:hidden"
        aria-label="채팅 기록 열기"
        aria-expanded={mobileOpen}
        aria-controls="mobile-chat-sidebar"
        onClick={() => setMobileOpen(true)}
      >
        <span aria-hidden="true" className="relative block h-5 w-6">
          <span className="absolute left-0 top-[3px] h-[2px] w-5 rounded-full bg-ink" />
          <span className="absolute bottom-[3px] left-0 h-[2px] w-3.5 rounded-full bg-ink" />
        </span>
      </button>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[80] md:hidden">
            <motion.button
              type="button"
              className="absolute inset-0 bg-black/35"
              aria-label="채팅 기록 닫기"
              onClick={() => setMobileOpen(false)}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={sidebarBackdrop}
            />
            <motion.aside
              id="mobile-chat-sidebar"
              className="absolute bottom-0 left-0 top-0 flex w-[min(88vw,340px)] flex-col border-r border-hairline bg-canvas shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="채팅 기록"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={sidebarPanel}
            >
            <div className="flex h-[64px] items-center justify-between border-b border-hairline px-md">
              <p className="text-[15px] font-extrabold text-ink">채팅 기록</p>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink"
                aria-label="채팅 기록 닫기"
                onClick={() => setMobileOpen(false)}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                  close
                </span>
              </button>
            </div>
            <SidebarContent
              activeSessionId={activeSessionId}
              loading={loading}
              sessions={sessions}
              onNavigate={() => setMobileOpen(false)}
            />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-hairline bg-surface/80 md:flex">
        <SidebarContent
          activeSessionId={activeSessionId}
          loading={loading}
          sessions={sessions}
        />
      </aside>
    </>
  );
}

function SidebarContent({
  activeSessionId,
  loading,
  sessions,
  onNavigate,
}: SidebarContentProps) {
  return (
    <>
      <div className="border-b border-hairline p-md">
        <Link
          href="/chat"
          className="flex h-11 items-center justify-center gap-xs rounded-[8px] bg-surface-dark px-md text-[14px] font-bold text-on-dark transition-colors hover:bg-primary-active"
          onClick={onNavigate}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
            add
          </span>
          새 채팅
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-sm">
        {loading && sessions.length === 0 ? (
          <div className="space-y-xs">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-[72px] animate-pulse rounded-[8px] bg-surface-strong"
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
                <motion.div
                  key={session.id}
                  layout="position"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <Link
                    href={buildChatSessionHref(session.id)}
                    className={[
                      "block rounded-[8px] border px-sm py-xs transition-colors",
                      isActive
                        ? "border-primary bg-primary-fixed text-on-primary-fixed"
                        : "border-transparent hover:border-hairline hover:bg-surface",
                    ].join(" ")}
                    onClick={onNavigate}
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
                </motion.div>
              );
            })}
          </nav>
        )}
      </div>
    </>
  );
}
