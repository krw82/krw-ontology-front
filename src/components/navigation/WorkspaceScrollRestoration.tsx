"use client";

import { useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { resolveRouteLocale } from "@/i18n/routing";
import {
  buildWorkspaceScrollStorageKey,
  pruneWorkspaceScrollEntries,
  readWorkspaceScrollEntry,
  writeWorkspaceScrollSnapshot,
} from "@/lib/navigation/workspace-scroll-restoration";

const WRITE_THROTTLE_MS = 180;
const RESTORE_RETRY_MS = 50;
const RESTORE_SETTLE_MS = 200;
const RESTORE_TIMEOUT_MS = 1_800;

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function maxWindowScrollY(): number {
  return Math.max(
    0,
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) -
      window.innerHeight,
  );
}

function scrollWindowImmediately(top: number) {
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo({ top, left: 0, behavior: "auto" });
  root.style.scrollBehavior = previousScrollBehavior;
}

function visibleWorkspaceAnchor(): {
  anchorId: string;
  anchorOffset: number;
} | null {
  const anchors = document.querySelectorAll<HTMLElement>(
    "[data-workspace-scroll-anchor]",
  );

  for (const anchor of anchors) {
    const anchorId = anchor.getAttribute("data-workspace-scroll-anchor");
    if (!anchorId) continue;
    const bounds = anchor.getBoundingClientRect();
    if (bounds.bottom > 0 && bounds.top < window.innerHeight) {
      return { anchorId, anchorOffset: bounds.top };
    }
  }

  return null;
}

function workspaceAnchorById(anchorId: string): HTMLElement | null {
  const anchors = document.querySelectorAll<HTMLElement>(
    "[data-workspace-scroll-anchor]",
  );
  return (
    Array.from(anchors).find(
      (anchor) =>
        anchor.getAttribute("data-workspace-scroll-anchor") === anchorId,
    ) ?? null
  );
}

export default function WorkspaceScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = resolveRouteLocale(pathname, searchParams.get("locale"));
  const storageKey = buildWorkspaceScrollStorageKey({ pathname, locale });

  useLayoutEffect(() => {
    if (!storageKey) return;

    const storage = getSessionStorage();
    if (!storage) return;
    pruneWorkspaceScrollEntries(storage);

    const routeContent = document.querySelector<HTMLElement>(
      "[data-workspace-scroll-content]",
    );
    routeContent?.setAttribute(
      "data-workspace-scroll-restoration-ready",
      "true",
    );

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const root = document.documentElement;
    const previousOverflowAnchor = root.style.overflowAnchor;

    let disposed = false;
    let persistenceStarted = false;
    let lastObservedScrollY = window.scrollY;
    let writeTimer: number | null = null;
    let restoreTimer: number | null = null;
    let restoreFrame: number | null = null;
    let routeResizeObserver: ResizeObserver | null = null;
    let routeMutationObserver: MutationObserver | null = null;
    const restoreStartedAt = Date.now();
    let lastLayoutChangeAt = restoreStartedAt;
    let overflowAnchorSuppressed = false;

    const flushScrollPosition = () => {
      if (!persistenceStarted) return;
      if (writeTimer !== null) {
        window.clearTimeout(writeTimer);
        writeTimer = null;
      }
      const anchor = visibleWorkspaceAnchor();
      writeWorkspaceScrollSnapshot(storage, storageKey, {
        y: lastObservedScrollY,
        ...(anchor ?? {}),
      });
    };

    const scheduleScrollWrite = () => {
      lastObservedScrollY = window.scrollY;
      if (writeTimer !== null) return;
      writeTimer = window.setTimeout(() => {
        writeTimer = null;
        const anchor = visibleWorkspaceAnchor();
        writeWorkspaceScrollSnapshot(storage, storageKey, {
          y: lastObservedScrollY,
          ...(anchor ?? {}),
        });
      }, WRITE_THROTTLE_MS);
    };

    const handlePageHide = () => {
      lastObservedScrollY = window.scrollY;
      flushScrollPosition();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      lastObservedScrollY = window.scrollY;
      flushScrollPosition();
    };

    const beginPersistence = () => {
      if (persistenceStarted || disposed) return;
      persistenceStarted = true;
      lastObservedScrollY = window.scrollY;
      window.addEventListener("scroll", scheduleScrollWrite, { passive: true });
      window.addEventListener("pagehide", handlePageHide);
      document.addEventListener("visibilitychange", handleVisibilityChange);
    };

    const stopPersistence = () => {
      if (!persistenceStarted) return;
      window.removeEventListener("scroll", scheduleScrollWrite);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };

    const clearRestoreScheduling = () => {
      if (restoreTimer !== null) {
        window.clearTimeout(restoreTimer);
        restoreTimer = null;
      }
      if (restoreFrame !== null) {
        window.cancelAnimationFrame(restoreFrame);
        restoreFrame = null;
      }
      routeResizeObserver?.disconnect();
      routeResizeObserver = null;
      routeMutationObserver?.disconnect();
      routeMutationObserver = null;
    };

    const removeInteractionListeners = () => {
      window.removeEventListener("pointerdown", cancelRestoration, true);
      window.removeEventListener("touchstart", cancelRestoration, true);
      window.removeEventListener("wheel", cancelRestoration, true);
      window.removeEventListener("keydown", cancelRestoration, true);
    };

    const finishRestoration = (targetScrollY: number | null) => {
      if (disposed) return;
      clearRestoreScheduling();
      removeInteractionListeners();
      if (targetScrollY !== null) {
        scrollWindowImmediately(targetScrollY);
      }
      if (overflowAnchorSuppressed) {
        root.style.overflowAnchor = previousOverflowAnchor;
        overflowAnchorSuppressed = false;
      }
      beginPersistence();
    };

    function cancelRestoration() {
      finishRestoration(null);
    }

    const savedEntry = readWorkspaceScrollEntry(storage, storageKey);
    if (savedEntry === null) {
      beginPersistence();
    } else {
      // Keep the browser's scroll anchoring from moving the viewport while
      // client effects and streamed route content settle around the restored
      // position. We restore the previous value before accepting input.
      root.style.overflowAnchor = "none";
      overflowAnchorSuppressed = true;

      const scheduleRestoreAttempt = () => {
        if (disposed || restoreTimer !== null || restoreFrame !== null) return;
        restoreTimer = window.setTimeout(() => {
          restoreTimer = null;
          restoreFrame = window.requestAnimationFrame(() => {
            restoreFrame = null;
            attemptRestoration();
          });
        }, RESTORE_RETRY_MS);
      };

      const attemptRestoration = () => {
        if (disposed) return;
        const timedOut = Date.now() - restoreStartedAt >= RESTORE_TIMEOUT_MS;
        const routeIsLoading = Boolean(
          routeContent?.querySelector("[data-workspace-route-loading]"),
        );
        const maximumScrollY = maxWindowScrollY();
        let targetScrollY: number | null = null;

        if (!routeIsLoading && savedEntry.anchorId) {
          const savedAnchor = workspaceAnchorById(savedEntry.anchorId);
          if (savedAnchor) {
            const anchorTarget = Math.max(
              0,
              window.scrollY +
                savedAnchor.getBoundingClientRect().top -
                (savedEntry.anchorOffset ?? 0),
            );
            if (maximumScrollY >= anchorTarget || timedOut) {
              targetScrollY = Math.min(anchorTarget, maximumScrollY);
            }
          }
        }

        if (
          targetScrollY === null &&
          ((!routeIsLoading && maximumScrollY >= savedEntry.y) || timedOut)
        ) {
          targetScrollY = Math.min(savedEntry.y, maximumScrollY);
        }

        if (targetScrollY !== null) {
          // Reassert the target while the route is still changing, then finish
          // only after a short quiet window. This prevents an onboarding card
          // or async list hydration above the viewport from shifting a just-
          // restored page by hundreds of pixels.
          scrollWindowImmediately(targetScrollY);
          if (
            timedOut ||
            Date.now() - lastLayoutChangeAt >= RESTORE_SETTLE_MS
          ) {
            finishRestoration(targetScrollY);
            return;
          }
        }

        scheduleRestoreAttempt();
      };

      const markLayoutChanged = () => {
        lastLayoutChangeAt = Date.now();
        scheduleRestoreAttempt();
      };

      window.addEventListener("pointerdown", cancelRestoration, {
        capture: true,
        passive: true,
      });
      window.addEventListener("touchstart", cancelRestoration, {
        capture: true,
        passive: true,
      });
      window.addEventListener("wheel", cancelRestoration, {
        capture: true,
        passive: true,
      });
      window.addEventListener("keydown", cancelRestoration, true);

      if (routeContent && typeof ResizeObserver !== "undefined") {
        routeResizeObserver = new ResizeObserver(markLayoutChanged);
        routeResizeObserver.observe(routeContent);
      }
      if (routeContent && typeof MutationObserver !== "undefined") {
        routeMutationObserver = new MutationObserver(markLayoutChanged);
        routeMutationObserver.observe(routeContent, {
          childList: true,
          subtree: true,
        });
      }

      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = window.requestAnimationFrame(() => {
          restoreFrame = null;
          attemptRestoration();
        });
      });
    }

    return () => {
      // Layout-effect cleanup runs before the next route paints, preserving the
      // outgoing route position before Next resets the document scroll.
      lastObservedScrollY = window.scrollY;
      flushScrollPosition();
      disposed = true;
      clearRestoreScheduling();
      removeInteractionListeners();
      stopPersistence();
      if (overflowAnchorSuppressed) {
        root.style.overflowAnchor = previousOverflowAnchor;
        overflowAnchorSuppressed = false;
      }
      routeContent?.removeAttribute("data-workspace-scroll-restoration-ready");
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, [storageKey]);

  return null;
}
