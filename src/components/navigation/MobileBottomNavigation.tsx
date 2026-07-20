"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { resolveRouteLocale } from "@/i18n/routing";
import {
  FILING_UNREAD_CHANGED_EVENT,
  FILING_UNREAD_SERVICE_WORKER_MESSAGE,
  filingUnreadBadgeText,
  normalizeFilingUnreadCount,
} from "@/lib/filing-notifications/client-events";
import { getWorkspaceTabItems } from "@/lib/navigation/workspace-routes";

const UNREAD_REFRESH_INTERVAL_MS = 60_000;

function useFilingUnreadCount() {
  const [unreadCount, setUnreadCount] = useState(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const refreshUnreadCount = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    const requestSequence = requestSequenceRef.current + 1;
    requestControllerRef.current = controller;
    requestSequenceRef.current = requestSequence;

    try {
      const response = await fetch("/api/filings/unread-count", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { unread_count?: unknown };
      const nextCount = normalizeFilingUnreadCount(payload.unread_count);
      if (
        nextCount !== null &&
        requestSequence === requestSequenceRef.current
      ) {
        setUnreadCount(nextCount);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      void refreshUnreadCount();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== FILING_UNREAD_SERVICE_WORKER_MESSAGE) return;
      const pushedCount = normalizeFilingUnreadCount(event.data?.unreadCount);
      if (pushedCount !== null) {
        setUnreadCount(pushedCount);
      } else {
        refresh();
      }
    };

    refresh();
    const intervalId = window.setInterval(refresh, UNREAD_REFRESH_INTERVAL_MS);
    window.addEventListener(FILING_UNREAD_CHANGED_EVENT, refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      requestSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      window.clearInterval(intervalId);
      window.removeEventListener(FILING_UNREAD_CHANGED_EVENT, refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [refreshUnreadCount]);

  return unreadCount;
}

export default function MobileBottomNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = resolveRouteLocale(pathname, searchParams.get("locale"));
  const tabs = getWorkspaceTabItems(locale, pathname);
  const filingUnreadCount = useFilingUnreadCount();

  return (
    <nav
      aria-label={locale === "ko" ? "주요 메뉴" : "Primary tabs"}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/95 backdrop-blur-xl lg:hidden"
      data-workspace-bottom-navigation
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto grid min-h-14 w-full max-w-[560px] grid-cols-4 px-xs">
        {tabs.map((tab) => {
          const tabUnreadCount = tab.id === "filings" ? filingUnreadCount : 0;
          const accessibleLabel =
            tabUnreadCount > 0
              ? `${tab.label}, ${locale === "ko" ? `읽지 않음 ${tabUnreadCount}건` : `${tabUnreadCount} unread`}`
              : tab.label;

          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-label={accessibleLabel}
              aria-current={tab.active ? "page" : undefined}
              className={[
                "relative flex min-h-14 min-w-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-[10px] px-xs text-[10px] font-extrabold leading-4 transition-[color,transform,background-color] duration-150 active:scale-[0.975] motion-reduce:transform-none motion-reduce:transition-none",
                tab.active
                  ? "text-primary"
                  : "text-muted hover:bg-surface-soft hover:text-ink",
              ].join(" ")}
            >
              {tab.active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-[30%] top-0 h-0.5 rounded-full bg-primary"
                />
              ) : null}
              <span className="relative inline-flex" aria-hidden="true">
                <span className="material-symbols-outlined text-[22px] leading-none">
                  {tab.icon}
                </span>
                {tabUnreadCount > 0 ? (
                  <span className="absolute -right-3 -top-2 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-canvas bg-error px-1 text-[9px] font-black leading-none text-on-primary">
                    {filingUnreadBadgeText(tabUnreadCount)}
                  </span>
                ) : null}
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
