"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useDragControls,
} from "motion/react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import {
  BOTTOM_SHEET_SPRING,
  shouldDismissBottomSheet,
} from "./bottom-sheet";

type BottomSheetPresentation = "sheet" | "responsive-dialog";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  presentation?: BottomSheetPresentation;
  panelClassName?: string;
  contentClassName?: string;
  rootClassName?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  dragToDismiss?: boolean;
  testId?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
  "[contenteditable='true']",
].join(",");

interface BackgroundElementSnapshot {
  inert: boolean;
  ariaHidden: string | null;
}

interface BodyStyleSnapshot {
  overflow: string;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  htmlOverscrollBehavior: string;
  scrollX: number;
  scrollY: number;
}

let activeModalCount = 0;
let bodyStyleSnapshot: BodyStyleSnapshot | null = null;
let backgroundSnapshots = new Map<HTMLElement, BackgroundElementSnapshot>();
let backgroundObserver: MutationObserver | null = null;
const activePanels: HTMLElement[] = [];

function isPortalHost(element: Element): boolean {
  return element.hasAttribute("data-bottom-sheet-portal");
}

function makeBackgroundElementInert(element: HTMLElement): void {
  if (isPortalHost(element) || backgroundSnapshots.has(element)) return;

  backgroundSnapshots.set(element, {
    inert: element.inert,
    ariaHidden: element.getAttribute("aria-hidden"),
  });
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
}

function acquireModalEnvironment(): () => void {
  activeModalCount += 1;

  if (activeModalCount === 1) {
    const body = document.body;
    const html = document.documentElement;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    bodyStyleSnapshot = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      scrollX,
      scrollY,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `${-scrollY}px`;
    body.style.left = `${-scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    html.style.overscrollBehavior = "none";

    for (const child of Array.from(body.children)) {
      if (child instanceof HTMLElement) makeBackgroundElementInert(child);
    }

    backgroundObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node instanceof HTMLElement) makeBackgroundElementInert(node);
        }
      }
    });
    backgroundObserver.observe(body, { childList: true });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeModalCount = Math.max(0, activeModalCount - 1);
    if (activeModalCount > 0) return;

    backgroundObserver?.disconnect();
    backgroundObserver = null;

    for (const [element, snapshot] of backgroundSnapshots) {
      if (!element.isConnected) continue;
      element.inert = snapshot.inert;
      if (snapshot.ariaHidden === null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", snapshot.ariaHidden);
      }
    }
    backgroundSnapshots = new Map();

    const snapshot = bodyStyleSnapshot;
    bodyStyleSnapshot = null;
    if (!snapshot) return;

    const body = document.body;
    const html = document.documentElement;
    body.style.overflow = snapshot.overflow;
    body.style.position = snapshot.position;
    body.style.top = snapshot.top;
    body.style.left = snapshot.left;
    body.style.right = snapshot.right;
    body.style.width = snapshot.width;
    html.style.overscrollBehavior = snapshot.htmlOverscrollBehavior;
    window.scrollTo(snapshot.scrollX, snapshot.scrollY);
  };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => {
    if (element.tabIndex < 0 || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    return element.getClientRects().length > 0;
  });
}

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const sync = (event: MediaQueryList | MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    sync(query);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

export default function BottomSheet({
  open,
  onClose,
  children,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  presentation = "sheet",
  panelClassName,
  contentClassName,
  rootClassName,
  initialFocusRef,
  returnFocusRef,
  closeOnBackdrop = true,
  dragToDismiss = true,
  testId,
}: BottomSheetProps) {
  const [portalHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const host = document.createElement("div");
    host.setAttribute("data-bottom-sheet-portal", "");
    return host;
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const invokingElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const dragControls = useDragControls();
  const reducedMotion = useReducedMotion();
  const isMobile = useIsMobileViewport();
  const isSheetPresentation =
    presentation === "sheet" ||
    (presentation === "responsive-dialog" && isMobile);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!portalHost) return;
    document.body.appendChild(portalHost);

    return () => {
      portalHost.remove();
    };
  }, [portalHost]);

  useEffect(() => {
    if (!open || !portalHost) return;

    const activeElement = document.activeElement;
    invokingElementRef.current =
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement
        ? activeElement
        : null;
    const fallbackReturnTarget = returnFocusRef?.current ?? null;

    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });
    if (panel) activePanels.push(panel);
    const releaseEnvironment = acquireModalEnvironment();

    const focusFrame = window.requestAnimationFrame(() => {
      const preferredTarget = initialFocusRef?.current;
      const target =
        preferredTarget && preferredTarget.isConnected
          ? preferredTarget
          : panel
            ? getFocusableElements(panel)[0]
            : null;
      target?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (activePanels.at(-1) !== panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (active === last || !panel.contains(active))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const keepFocusInside = (event: FocusEvent) => {
      if (activePanels.at(-1) !== panel) return;
      if (!panel || panel.contains(event.target as Node)) return;
      const target = getFocusableElements(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", keepFocusInside, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", keepFocusInside, true);
      if (panel) {
        const panelIndex = activePanels.lastIndexOf(panel);
        if (panelIndex >= 0) activePanels.splice(panelIndex, 1);
      }
      releaseEnvironment();

      const capturedTarget = invokingElementRef.current;
      const returnTarget =
        capturedTarget?.isConnected === true
          ? capturedTarget
          : fallbackReturnTarget;
      if (returnTarget?.isConnected) {
        window.requestAnimationFrame(() => {
          returnTarget.focus({ preventScroll: true });
        });
      }
    };
  }, [initialFocusRef, open, portalHost, returnFocusRef]);

  if (!portalHost) return null;

  const panelTransition = reducedMotion
    ? ({ duration: 0 } as const)
    : BOTTOM_SHEET_SPRING;
  const panelInitial = isSheetPresentation
    ? { opacity: 1, y: "102%", scale: 1 }
    : { opacity: 0, y: 18, scale: 0.98 };
  const panelVisible = { opacity: 1, y: 0, scale: 1 };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="bottom-sheet"
          className={cn(
            "fixed inset-0 flex items-end",
            presentation === "responsive-dialog" &&
              "sm:items-center sm:justify-center sm:p-4",
            rootClassName,
          )}
          data-testid={testId}
          role="presentation"
        >
          <motion.button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 cursor-default bg-ink/24"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            onClick={
              closeOnBackdrop ? () => onCloseRef.current() : undefined
            }
            onPointerDown={(event) => event.preventDefault()}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            className={cn(
              "relative z-10 w-full overflow-hidden rounded-t-[28px] border-t border-hairline bg-canvas text-ink shadow-[0_-18px_54px_rgba(10,11,13,0.18)] outline-none",
              presentation === "responsive-dialog" &&
                "sm:max-w-[520px] sm:rounded-[24px] sm:border sm:shadow-[0_24px_70px_rgba(10,11,13,0.22)]",
              panelClassName,
            )}
            initial={panelInitial}
            animate={panelVisible}
            exit={panelInitial}
            transition={panelTransition}
            drag={isSheetPresentation && dragToDismiss ? "y" : false}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.18 }}
            onDragEnd={(_, info) => {
              if (shouldDismissBottomSheet(info.offset.y, info.velocity.y)) {
                onCloseRef.current();
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
          >
            {isSheetPresentation ? (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="mx-auto flex h-11 w-16 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
                onPointerDown={(event) => {
                  event.preventDefault();
                  dragControls.start(event);
                }}
              >
                <span className="h-1.5 w-11 rounded-full bg-outline-variant" />
              </button>
            ) : null}
            <div
              className={cn(
                "max-h-[min(82dvh,660px)] overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+20px)]",
                contentClassName,
              )}
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    portalHost,
  );
}
