"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { buildChatSessionHref, buildNewChatHref } from "@/lib/chat/history-state";
import { useSessions } from "@/hooks/useSessions";
import {
  easeOutExpo,
  popoverMenu,
  bottomSheetPanel,
  rightDrawerPanel,
  sidebarBackdrop,
} from "@/lib/animation";
import { OPEN_CHAT_SIDEBAR_EVENT } from "@/lib/chat/sidebar-events";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { Locale } from "@/i18n/config";
import {
  localeSwitchHref,
  resolveRouteLocale,
} from "@/i18n/routing";
import type { SessionSummary } from "@/types/api-contracts";
import { normalizeTickers } from "@/lib/ontology/ticker";
import {
  DEVICE_CACHE_OWNER_CHANGED_EVENT,
  getDeviceCacheOwner,
} from "@/lib/pwa/device-cache-owner";

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
    researchNotebook: "리서치 노트북",
    openResearchNotebook: "내 리서치 노트북 열기",
    stockDiscovery: "조건으로 기업 검색",
    openStockDiscovery: "조건으로 기업 검색 열기",
    guruAdvisor: "관점별 분석",
    openGuruAdvisor: "관점별 분석 열기",
    companySearch: "회사 찾기",
    openCompanySearch: "회사 찾기 열기",
    wideResearch: "와이드 리서치",
    openWideResearch: "와이드 리서치 시작",
    institutionalHoldings: "13F 기관 보유",
    openInstitutionalHoldings: "13F 기관 보유 열기",
    recentChats: "최근 채팅 목록",
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
    retry: "다시 시도",
    upgradeRequired: "현재 플랜에서 사용할 수 없습니다. 플랜을 확인하세요.",
  },
  en: {
    closeHistory: "Close chat history",
    history: "Chat history",
    researchNotebook: "Research notebook",
    openResearchNotebook: "Open my research notebook",
    stockDiscovery: "Company search by criteria",
    openStockDiscovery: "Open company search by criteria",
    guruAdvisor: "Perspective analysis",
    openGuruAdvisor: "Open perspective analysis",
    companySearch: "Find companies",
    openCompanySearch: "Open company search",
    wideResearch: "Wide research",
    openWideResearch: "Start wide research",
    institutionalHoldings: "13F institutional holdings",
    openInstitutionalHoldings: "Open 13F institutional holdings",
    recentChats: "Recent chats",
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
    retry: "Retry",
    upgradeRequired: "Unavailable on the current plan. Review plans.",
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
  listError: ReturnType<typeof useSessions>["listError"];
  onRetry: () => void;
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
  const [cacheOwnerId, setCacheOwnerId] = useState<string | null>(null);
  const {
    sessions,
    loading,
    mutatingSessionId,
    mutationError,
    listError,
    listSessions,
    renameSession,
    deleteSession,
  } = useSessions({ cacheOwnerId });
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [pendingNavigationSessionId, setPendingNavigationSessionId] =
    useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const locale = resolveRouteLocale(pathname, searchParams.get("locale"));
  const copy = sidebarCopy[locale];
  const preferredTicker = normalizeTickers([searchParams.get("ticker") ?? ""])[0] ?? null;
  const orderedSessions = useMemo(() => [...sessions].sort((left, right) => {
    const leftRunning = ["pending", "queued", "running"].includes(left.latest_run_status ?? "") ? 1 : 0;
    const rightRunning = ["pending", "queued", "running"].includes(right.latest_run_status ?? "") ? 1 : 0;
    if (leftRunning !== rightRunning) return rightRunning - leftRunning;
    if (preferredTicker) {
      const leftPreferred = normalizeTickers(left.default_tickers).includes(preferredTicker) ? 1 : 0;
      const rightPreferred = normalizeTickers(right.default_tickers).includes(preferredTicker) ? 1 : 0;
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    }
    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  }), [preferredTicker, sessions]);

  useEffect(() => {
    const syncOwner = () => setCacheOwnerId(getDeviceCacheOwner());
    syncOwner();
    window.addEventListener(DEVICE_CACHE_OWNER_CHANGED_EVENT, syncOwner);
    return () => {
      window.removeEventListener(DEVICE_CACHE_OWNER_CHANGED_EVENT, syncOwner);
    };
  }, []);

  const closeHistory = useCallback(() => {
    setOpen(false);
    setPendingNavigationSessionId(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    void listSessions(1, 30);
  }, [listSessions, open, refreshSignal]);

  useEffect(() => {
    const handleOpenSidebar = () => {
      setPendingNavigationSessionId(null);
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setOpen(true);
    };

    window.addEventListener(OPEN_CHAT_SIDEBAR_EVENT, handleOpenSidebar);
    return () => {
      window.removeEventListener(OPEN_CHAT_SIDEBAR_EVENT, handleOpenSidebar);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHistory();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [closeHistory, open]);

  useEffect(() => {
    if (!pendingNavigationSessionId) return;
    if (pathname !== "/chat") return;
    if (activeSessionId !== pendingNavigationSessionId) return;

    const timeoutId = window.setTimeout(closeHistory, 0);
    return () => window.clearTimeout(timeoutId);
  }, [
    activeSessionId,
    closeHistory,
    pathname,
    pendingNavigationSessionId,
  ]);

  const handleSessionNavigate = (sessionId: string) => {
    if (pathname === "/chat" && activeSessionId === sessionId) {
      closeHistory();
      return;
    }

    setPendingNavigationSessionId(sessionId);
    router.push(buildChatSessionHref(sessionId, { locale }), { scroll: false });
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[80]">
            <motion.button
              type="button"
              className="absolute inset-0 bg-black/35 backdrop-blur-[1px]"
              aria-label={copy.closeHistory}
              onClick={closeHistory}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={sidebarBackdrop}
            />
            <motion.aside
              id="chat-history-panel"
              className="absolute inset-x-0 bottom-0 flex h-[min(78dvh,720px)] max-h-[88dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-hairline bg-surface shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:w-[400px] md:rounded-none md:border-l md:border-t-0"
              role="dialog"
              aria-modal="true"
              aria-label={copy.history}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={isDesktop ? rightDrawerPanel : bottomSheetPanel}
            >
              <div className="flex justify-center pb-1 pt-2 md:hidden" aria-hidden="true">
                <span className="h-1 w-10 rounded-full bg-outline" />
              </div>
              <div className="flex min-h-[56px] items-center justify-between border-b border-hairline px-base">
                <div>
                  <p className="text-[15px] font-black leading-5 text-ink">
                    {preferredTicker ? `${preferredTicker} ${copy.history}` : copy.history}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold text-muted">
                    {locale === "ko" ? "진행 중인 분석과 최근 대화" : "Running research and recent conversations"}
                  </p>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-canvas hover:text-ink"
                  aria-label={copy.closeHistory}
                  onClick={closeHistory}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                    close
                  </span>
                </button>
              </div>
              <div className="border-b border-hairline px-sm py-xs">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] leading-4 text-muted">
                  {copy.recentChats}
                </p>
              </div>
              <SidebarContent
                activeSessionId={activeSessionId}
                locale={locale}
                copy={copy}
                loading={loading}
                sessions={orderedSessions}
                mutatingSessionId={mutatingSessionId}
                mutationError={mutationError}
                listError={listError}
                onRetry={() => void listSessions(1, 30)}
                renameSession={renameSession}
                deleteSession={deleteSession}
                pendingNavigationSessionId={pendingNavigationSessionId}
                onNavigate={handleSessionNavigate}
                onDeleteActiveSession={() => {
                  closeHistory();
                  router.replace(buildNewChatHref(undefined, { locale }));
                }}
              />
              <div className="border-t border-hairline bg-canvas/80 p-xs">
                <Link
                  href={localeSwitchHref(locale, "/watchlist", "tab=history")}
                  className="flex h-11 items-center justify-between rounded-[8px] px-sm text-[13px] font-extrabold text-primary transition-colors hover:bg-surface-soft"
                  onClick={closeHistory}
                >
                  <span>{locale === "ko" ? "리서치 노트북에서 전체 기록 보기" : "View all in Research Notebook"}</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </Link>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

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
  listError,
  onRetry,
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
      <div ref={menuRootRef} className="flex-1 overflow-y-auto p-xs">
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
        {listError ? (
          <div
            className="mb-sm flex items-center justify-between gap-2 rounded-[8px] border border-error-container bg-error-container/30 px-sm py-xs text-[12px] font-semibold leading-[1.45] text-on-error-container"
            role="alert"
          >
            <span>{listError}</span>
            <button
              type="button"
              className="shrink-0 rounded-[6px] border border-current px-2 py-1 font-bold hover:bg-canvas/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={onRetry}
            >
              {copy.retry}
            </button>
          </div>
        ) : null}
        {loading && sessions.length === 0 ? (
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded-[8px] bg-surface-strong"
              />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          listError ? null : (
            <div className="rounded-[8px] border border-dashed border-hairline bg-canvas px-sm py-sm text-[13px] font-medium leading-[1.45] text-muted">
              {copy.empty}
            </div>
          )
        ) : (
          <nav className="space-y-1" aria-label={copy.history}>
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
  const visibleTickers = normalizeTickers(session.default_tickers);
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
          className="absolute bottom-2 left-0 top-2 z-10 w-[2px] rounded-r-full bg-ink/70"
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
            className="h-11 w-full rounded-[6px] border border-hairline bg-surface-soft px-xs text-[13px] font-semibold leading-[1.35] text-ink outline-none transition-colors focus:border-primary"
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
              className="inline-flex h-11 w-11 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-surface hover:text-ink"
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
              className="inline-flex h-11 w-11 items-center justify-center rounded-[6px] bg-surface-dark text-on-dark transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled"
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
              "block rounded-[8px] border px-sm py-2 pr-9 transition-colors",
              isActive || isNavigating
                ? "border-hairline bg-canvas text-ink shadow-sm"
                : "border-transparent hover:border-hairline-soft hover:bg-canvas/70",
            ].join(" ")}
            aria-busy={isNavigating}
            onClick={handleSessionClick}
          >
            <div className="flex items-start justify-between gap-xs">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold leading-5 text-ink">
                  {session.title || copy.newChat}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-muted">
                  {session.last_message_preview || copy.noMessage}
                </p>
              </div>
              {isNavigating ? (
                <span
                  className="mt-[3px] h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-outline-variant border-t-primary"
                  aria-label={copy.opening}
                />
              ) : isRunning && (
                <span
                  className="relative mt-[5px] h-2 w-2 shrink-0"
                  aria-label={copy.generating}
                >
                  <span className="absolute inset-0 rounded-full bg-primary" />
                  {!reducedMotion && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border border-primary"
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
            <div className="mt-1 flex items-center justify-between gap-xs text-[11px] leading-4 text-muted-soft">
              <span>{formatRelativeDate(session.updated_at, locale)}</span>
              {visibleTickers.length > 0 && (
                <span className="truncate font-mono">
                  {visibleTickers.join(", ")}
                </span>
              )}
            </div>
          </Link>

          <button
            type="button"
            className={[
              "absolute right-1.5 top-1.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent bg-surface text-muted transition-all hover:border-hairline hover:bg-canvas/70 hover:text-ink focus-visible:border-hairline focus-visible:bg-canvas/70 focus-visible:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100",
              isMenuOpen
                ? "border-hairline bg-canvas/70 text-ink md:opacity-100"
                : isActive
                  ? "md:opacity-100"
                  : "",
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
                className="inline-flex h-11 items-center rounded-[8px] border border-hairline bg-canvas px-sm text-[14px] font-bold text-body transition-colors hover:bg-surface"
                onClick={onCancel}
                disabled={isDeleting}
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center rounded-[8px] bg-error px-sm text-[14px] font-bold text-on-error transition-colors hover:bg-on-error-container disabled:cursor-not-allowed disabled:bg-primary-disabled"
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
