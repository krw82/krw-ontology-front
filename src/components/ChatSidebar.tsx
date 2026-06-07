"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { buildChatSessionHref, buildNewChatHref } from "@/lib/chat/history-state";
import { useSessions } from "@/hooks/useSessions";
import {
  easeOutExpo,
  popoverMenu,
  sidebarPanel,
  sidebarBackdrop,
} from "@/lib/animation";
import { OPEN_CHAT_SIDEBAR_EVENT } from "@/lib/chat/sidebar-events";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getPathLocale } from "@/i18n/routing";
import type { SessionSummary } from "@/types/api-contracts";

interface ChatSidebarProps {
  activeSessionId: string | null;
  refreshSignal?: string | number;
}

function subscribePortalTarget() {
  return () => undefined;
}

function getPortalTarget() {
  return typeof document === "undefined" ? null : document.body;
}

const sidebarCopy = {
  ko: {
    closeHistory: "채팅 기록 닫기",
    history: "채팅 기록",
    newChat: "새 채팅",
    nameSaved: "채팅 이름을 저장했습니다.",
    deleted: "채팅을 삭제했습니다.",
    empty: "저장된 채팅이 없습니다.",
    sessionTitle: "채팅 이름",
    cancelRename: "이름 변경 취소",
    saveName: "이름 저장",
    noMessage: "아직 메시지가 없습니다.",
    opening: "채팅 여는 중",
    generating: "응답 생성 중",
    menu: "메뉴",
    rename: "이름 변경",
    running: "실행 중",
    delete: "삭제",
    cannotDeleteWhileRunning: "응답 생성 중에는 삭제할 수 없습니다.",
    confirmDeleteTitle: "채팅을 삭제할까요?",
    confirmDeleteBody:
      "목록에서 숨겨집니다. 이 작업은 현재 화면에서 바로 되돌릴 수 없습니다.",
    cancel: "취소",
    deleting: "삭제 중",
  },
  en: {
    closeHistory: "Close chat history",
    history: "Chat history",
    newChat: "New chat",
    nameSaved: "Chat name saved.",
    deleted: "Chat deleted.",
    empty: "No saved chats.",
    sessionTitle: "Chat name",
    cancelRename: "Cancel rename",
    saveName: "Save name",
    noMessage: "No messages yet.",
    opening: "Opening chat",
    generating: "Generating response",
    menu: "menu",
    rename: "Rename",
    running: "Running",
    delete: "Delete",
    cannotDeleteWhileRunning:
      "Cannot delete while a response is generating.",
    confirmDeleteTitle: "Delete this chat?",
    confirmDeleteBody:
      "It will be hidden from the list. This cannot be undone from the current screen.",
    cancel: "Cancel",
    deleting: "Deleting",
  },
} satisfies Record<Locale, Record<string, string>>;

type SidebarCopy = (typeof sidebarCopy)[Locale];

interface SidebarContentProps {
  activeSessionId: string | null;
  locale: Locale;
  copy: SidebarCopy;
  loading: boolean;
  sessions: ReturnType<typeof useSessions>["sessions"];
  mutatingSessionId: ReturnType<typeof useSessions>["mutatingSessionId"];
  mutationError: ReturnType<typeof useSessions>["mutationError"];
  renameSession: ReturnType<typeof useSessions>["renameSession"];
  deleteSession: ReturnType<typeof useSessions>["deleteSession"];
  pendingNavigationSessionId?: string | null;
  onNavigate?: (sessionId: string) => void;
  onDeleteActiveSession?: () => void;
}

function formatRelativeDate(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (locale === "en") {
    const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return formatter.format(-diffMinutes, "minute");

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return formatter.format(-diffHours, "hour");

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  }

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    sessions,
    loading,
    mutatingSessionId,
    mutationError,
    listSessions,
    renameSession,
    deleteSession,
  } = useSessions();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingNavigationSessionId, setPendingNavigationSessionId] =
    useState<string | null>(null);
  const queryLocale = searchParams.get("locale");
  const locale =
    getPathLocale(pathname) ??
    (isLocale(queryLocale) ? queryLocale : DEFAULT_LOCALE);
  const copy = sidebarCopy[locale];

  const closeMobileSidebar = useCallback(() => {
    setMobileOpen(false);
    setPendingNavigationSessionId(null);
  }, []);

  useEffect(() => {
    listSessions(1, 30);
  }, [listSessions, refreshSignal]);

  useEffect(() => {
    const handleOpenSidebar = () => {
      setPendingNavigationSessionId(null);
      setMobileOpen(true);
    };

    window.addEventListener(OPEN_CHAT_SIDEBAR_EVENT, handleOpenSidebar);
    return () => {
      window.removeEventListener(OPEN_CHAT_SIDEBAR_EVENT, handleOpenSidebar);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileSidebar();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileSidebar, mobileOpen]);

  useEffect(() => {
    if (!pendingNavigationSessionId) return;
    if (pathname !== "/chat") return;
    if (activeSessionId !== pendingNavigationSessionId) return;

    const timeoutId = window.setTimeout(closeMobileSidebar, 0);
    return () => window.clearTimeout(timeoutId);
  }, [
    activeSessionId,
    closeMobileSidebar,
    pathname,
    pendingNavigationSessionId,
  ]);

  const handleMobileSessionNavigate = (sessionId: string) => {
    if (pathname === "/chat" && activeSessionId === sessionId) {
      closeMobileSidebar();
      return;
    }

    setPendingNavigationSessionId(sessionId);
    router.push(buildChatSessionHref(sessionId, { locale }), { scroll: false });
  };

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[80] md:hidden">
            <motion.button
              type="button"
              className="absolute inset-0 bg-black/35"
              aria-label={copy.closeHistory}
              onClick={closeMobileSidebar}
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
              aria-label={copy.history}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={sidebarPanel}
            >
              <div className="flex h-[64px] items-center justify-between border-b border-hairline px-md">
                <p className="text-[15px] font-extrabold text-ink">
                  {copy.history}
                </p>
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink"
                  aria-label={copy.closeHistory}
                  onClick={closeMobileSidebar}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                    close
                  </span>
                </button>
              </div>
              <SidebarContent
                activeSessionId={activeSessionId}
                locale={locale}
                copy={copy}
                loading={loading}
                sessions={sessions}
                mutatingSessionId={mutatingSessionId}
                mutationError={mutationError}
                renameSession={renameSession}
                deleteSession={deleteSession}
                pendingNavigationSessionId={pendingNavigationSessionId}
                onNavigate={handleMobileSessionNavigate}
                onDeleteActiveSession={() => {
                  closeMobileSidebar();
                  router.replace(buildNewChatHref(undefined, { locale }));
                }}
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-hairline bg-surface/80 md:sticky md:top-0 md:flex md:h-[100dvh] md:max-h-[100dvh]">
        <SidebarContent
          activeSessionId={activeSessionId}
          locale={locale}
          copy={copy}
          loading={loading}
          sessions={sessions}
          mutatingSessionId={mutatingSessionId}
          mutationError={mutationError}
          renameSession={renameSession}
          deleteSession={deleteSession}
          pendingNavigationSessionId={null}
          onDeleteActiveSession={() =>
            router.replace(buildNewChatHref(undefined, { locale }))
          }
        />
      </aside>
    </>
  );
}

function SidebarContent({
  activeSessionId,
  locale,
  copy,
  loading,
  sessions,
  mutatingSessionId,
  mutationError,
  renameSession,
  deleteSession,
  pendingNavigationSessionId,
  onNavigate,
  onDeleteActiveSession,
}: SidebarContentProps) {
  const reducedMotion = useReducedMotion();
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pendingDeleteSession, setPendingDeleteSession] =
    useState<SessionSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpenId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        menuRootRef.current &&
        event.target instanceof Node &&
        !menuRootRef.current.contains(event.target)
      ) {
        setMenuOpenId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpenId(null);
        setEditingSessionId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpenId]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const beginRename = (session: SessionSummary) => {
    setMenuOpenId(null);
    setEditingSessionId(session.id);
    setEditingTitle(session.title || copy.newChat);
  };

  const cancelRename = () => {
    setEditingSessionId(null);
    setEditingTitle("");
  };

  const handleRenameSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingSessionId) return;
    const updated = await renameSession(editingSessionId, editingTitle);
    if (!updated) return;
    setNotice(copy.nameSaved);
    cancelRename();
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteSession) return;
    const deletingActiveSession = pendingDeleteSession.id === activeSessionId;
    const result = await deleteSession(pendingDeleteSession.id);
    if (!result) return;
    setNotice(copy.deleted);
    setPendingDeleteSession(null);
    if (deletingActiveSession) {
      onDeleteActiveSession?.();
    }
  };

  return (
    <>
      <div ref={menuRootRef} className="flex-1 overflow-y-auto p-sm">
        {(mutationError || notice) && (
          <div
            className={[
              "mb-sm rounded-[8px] border px-sm py-xs text-[12px] font-semibold leading-[1.45]",
              mutationError
                ? "border-error-container bg-error-container/30 text-on-error-container"
                : "border-hairline bg-canvas text-body",
            ].join(" ")}
            role={mutationError ? "alert" : "status"}
          >
            {mutationError || notice}
          </div>
        )}
        {loading && sessions.length === 0 ? (
          <div className="space-y-xs">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-[72px] animate-pulse rounded-[8px] bg-surface-strong"
              />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline bg-canvas px-sm py-md text-[13px] font-semibold leading-[1.45] text-muted">
            {copy.empty}
          </div>
        ) : (
          <nav className="space-y-xs" aria-label={copy.history}>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isRunning =
                session.latest_run_status === "running" ||
                session.latest_run_status === "queued" ||
                session.latest_run_status === "pending";
              return (
                <SessionRow
                  key={session.id}
                  session={session}
                  isActive={isActive}
                  isNavigating={pendingNavigationSessionId === session.id}
                  isRunning={isRunning}
                  isMenuOpen={menuOpenId === session.id}
                  isEditing={editingSessionId === session.id}
                  isBusy={mutatingSessionId === session.id}
                  editingTitle={editingTitle}
                  reducedMotion={reducedMotion}
                  locale={locale}
                  copy={copy}
                  onNavigate={onNavigate}
                  onMenuToggle={() =>
                    setMenuOpenId((current) =>
                      current === session.id ? null : session.id,
                    )
                  }
                  onRename={() => beginRename(session)}
                  onDelete={() => {
                    setMenuOpenId(null);
                    setPendingDeleteSession(session);
                  }}
                  onCancelRename={cancelRename}
                  onEditingTitleChange={setEditingTitle}
                  onRenameSubmit={handleRenameSubmit}
                />
              );
            })}
          </nav>
        )}
      </div>
      <DeleteSessionDialog
        session={pendingDeleteSession}
        copy={copy}
        isDeleting={
          Boolean(pendingDeleteSession) &&
          mutatingSessionId === pendingDeleteSession?.id
        }
        onCancel={() => setPendingDeleteSession(null)}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}

function SessionRow({
  session,
  isActive,
  isNavigating,
  isRunning,
  isMenuOpen,
  isEditing,
  isBusy,
  editingTitle,
  reducedMotion,
  locale,
  copy,
  onNavigate,
  onMenuToggle,
  onRename,
  onDelete,
  onCancelRename,
  onEditingTitleChange,
  onRenameSubmit,
}: {
  session: SessionSummary;
  isActive: boolean;
  isNavigating: boolean;
  isRunning: boolean;
  isMenuOpen: boolean;
  isEditing: boolean;
  isBusy: boolean;
  editingTitle: string;
  reducedMotion: boolean;
  locale: Locale;
  copy: SidebarCopy;
  onNavigate?: (sessionId: string) => void;
  onMenuToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCancelRename: () => void;
  onEditingTitleChange: (value: string) => void;
  onRenameSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const handleSessionClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate) return;
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    onNavigate(session.id);
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.18,
        ease: easeOutExpo,
        layout: { duration: reducedMotion ? 0 : 0.16 },
      }}
      className="group relative"
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-0 top-2 z-10 w-[3px] rounded-r-full bg-primary"
        />
      )}

      {isEditing ? (
        <form
          className="rounded-[8px] border border-primary bg-canvas p-xs shadow-sm"
          onSubmit={onRenameSubmit}
        >
          <label className="sr-only" htmlFor={`session-title-${session.id}`}>
            {copy.sessionTitle}
          </label>
          <input
            id={`session-title-${session.id}`}
            className="h-9 w-full rounded-[6px] border border-hairline bg-surface-soft px-xs text-[13px] font-semibold leading-[1.35] text-ink outline-none transition-colors focus:border-primary"
            value={editingTitle}
            maxLength={200}
            autoFocus
            onChange={(event) => onEditingTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelRename();
            }}
          />
          <div className="mt-xs flex items-center justify-end gap-xxs">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-surface hover:text-ink"
              aria-label={copy.cancelRename}
              onClick={onCancelRename}
              disabled={isBusy}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                close
              </span>
            </button>
            <button
              type="submit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] bg-surface-dark text-on-dark transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled"
              aria-label={copy.saveName}
              disabled={isBusy}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                check
              </span>
            </button>
          </div>
        </form>
      ) : (
        <>
          <Link
            href={buildChatSessionHref(session.id, { locale })}
            className={[
              "block rounded-[8px] border py-xs pl-sm pr-10 transition-colors",
              isActive || isNavigating
                ? "border-primary bg-primary-fixed text-on-primary-fixed"
                : "border-transparent hover:border-hairline hover:bg-canvas",
            ].join(" ")}
            aria-busy={isNavigating}
            onClick={handleSessionClick}
          >
            <div className="flex items-start justify-between gap-xs">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold leading-[1.4] text-ink">
                  {session.title || copy.newChat}
                </p>
                <p className="mt-xxs line-clamp-2 text-[12px] leading-[1.35] text-muted">
                  {session.last_message_preview || copy.noMessage}
                </p>
              </div>
              {isNavigating ? (
                <span
                  className="mt-[3px] h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary-container/25 border-t-primary-container"
                  aria-label={copy.opening}
                />
              ) : isRunning && (
                <span
                  className="relative mt-[3px] h-2.5 w-2.5 shrink-0"
                  aria-label={copy.generating}
                >
                  <span className="absolute inset-[1px] rounded-full bg-primary-container" />
                  {!reducedMotion && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border border-primary-container"
                      animate={{ opacity: [0.48, 0], scale: [1, 2.2] }}
                      transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        ease: "easeOut",
                      }}
                    />
                  )}
                </span>
              )}
            </div>
            <div className="mt-xs flex items-center justify-between gap-xs text-[11px] leading-[1.3] text-muted-soft">
              <span>{formatRelativeDate(session.updated_at, locale)}</span>
              {session.default_tickers.length > 0 && (
                <span className="truncate font-mono">
                  {session.default_tickers.join(", ")}
                </span>
              )}
            </div>
          </Link>

          <button
            type="button"
            className={[
              "absolute right-1.5 top-1.5 z-20 inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-transparent bg-canvas/80 text-muted shadow-sm backdrop-blur transition-all hover:border-hairline hover:bg-canvas hover:text-ink focus-visible:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100",
              isActive || isMenuOpen ? "md:opacity-100" : "",
            ].join(" ")}
            aria-label={`${session.title || copy.newChat} ${copy.menu}`}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={onMenuToggle}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              more_horiz
            </span>
          </button>

          <AnimatePresence initial={false}>
            {isMenuOpen && (
              <motion.div
                className="absolute right-1.5 top-10 z-30 w-[168px] rounded-[8px] border border-hairline bg-canvas p-xxs shadow-lg"
                role="menu"
                variants={popoverMenu}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{ transformOrigin: "top right" }}
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-[6px] px-xs py-xs text-left text-[13px] font-semibold text-body transition-colors hover:bg-surface-soft hover:text-ink"
                  role="menuitem"
                  onClick={onRename}
                  disabled={isBusy}
                >
                  <span>{copy.rename}</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                    edit
                  </span>
                </button>
                <button
                  type="button"
                  className="mt-xxs flex w-full items-center justify-between rounded-[6px] px-xs py-xs text-left text-[13px] font-semibold text-error transition-colors hover:bg-error-container/35"
                  role="menuitem"
                  onClick={onDelete}
                  disabled={isBusy || isRunning}
                  title={isRunning ? copy.cannotDeleteWhileRunning : undefined}
                >
                  <span>{isRunning ? copy.running : copy.delete}</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
                    delete
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}

function DeleteSessionDialog({
  session,
  copy,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  session: SessionSummary | null;
  copy: SidebarCopy;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const portalTarget = useSyncExternalStore(
    subscribePortalTarget,
    getPortalTarget,
    () => null,
  );

  if (!portalTarget) return null;

  return createPortal(
    <AnimatePresence>
      {session && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/20 p-base">
          <motion.div
            className="w-full max-w-[360px] rounded-[8px] border border-hairline bg-canvas p-md shadow-xl"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: easeOutExpo }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
          >
            <div className="flex items-start gap-sm">
              <span
                aria-hidden="true"
                className="material-symbols-outlined mt-[1px] text-[22px] text-error"
              >
                delete
              </span>
              <div className="min-w-0">
                <h2
                  id="delete-session-title"
                  className="text-[16px] font-extrabold leading-[1.35] text-ink"
                >
                  {copy.confirmDeleteTitle}
                </h2>
                <p className="mt-xs text-[13px] font-medium leading-[1.55] text-body">
                  {copy.confirmDeleteBody}
                </p>
                <p className="mt-xs truncate rounded-[6px] bg-surface px-xs py-xxs text-[12px] font-semibold text-muted">
                  {session.title || copy.newChat}
                </p>
              </div>
            </div>
            <div className="mt-md flex justify-end gap-xs">
              <button
                type="button"
                className="inline-flex h-10 items-center rounded-[8px] border border-hairline bg-canvas px-sm text-[14px] font-bold text-body transition-colors hover:bg-surface"
                onClick={onCancel}
                disabled={isDeleting}
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center rounded-[8px] bg-error px-sm text-[14px] font-bold text-on-error transition-colors hover:bg-on-error-container disabled:cursor-not-allowed disabled:bg-primary-disabled"
                onClick={onConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? copy.deleting : copy.delete}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    portalTarget,
  );
}
