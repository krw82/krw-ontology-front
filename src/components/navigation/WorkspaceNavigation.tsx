"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getWorkspaceNavigationGroups,
  getWorkspaceNavigationItems,
} from "@/lib/navigation/workspace-routes";
import { OPEN_WORKSPACE_MENU_EVENT } from "@/lib/navigation/workspace-menu-events";
import { sidebarBackdrop } from "@/lib/animation";
import { Pressable } from "@/components/ui/Pressable";
import type { Locale } from "@/i18n/config";

interface WorkspaceNavigationProps {
  locale: Locale;
  pathname: string;
}

const mobileMenuTransition = {
  hidden: { opacity: 0, x: -24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: {
    opacity: 0,
    x: -16,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] as const },
  },
};

export default function WorkspaceNavigation({
  locale,
  pathname,
}: WorkspaceNavigationProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const items = useMemo(
    () => getWorkspaceNavigationItems(locale, pathname),
    [locale, pathname],
  );
  const groups = useMemo(
    () => getWorkspaceNavigationGroups(locale, pathname),
    [locale, pathname],
  );
  const copy = locale === "ko"
    ? { menu: "메뉴", open: "전체 메뉴 열기", close: "메뉴 닫기" }
    : { menu: "Menu", open: "Open workspace menu", close: "Close menu" };

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openMenu = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setMenuOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener(OPEN_WORKSPACE_MENU_EVENT, openMenu);
    return () => window.removeEventListener(OPEN_WORKSPACE_MENU_EVENT, openMenu);
  }, [openMenu]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setClientReady(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [closeMenu, menuOpen]);

  const mobileMenu = menuOpen && portalTarget
    ? createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[90] lg:hidden">
            <motion.button
              type="button"
              className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
              aria-label={copy.close}
              onClick={closeMenu}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={sidebarBackdrop}
            />
            <motion.aside
              id="workspace-navigation-menu"
              className="absolute inset-y-0 left-0 flex w-[min(340px,calc(100vw-44px))] flex-col overflow-y-auto border-r border-hairline bg-canvas shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label={copy.menu}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={mobileMenuTransition}
            >
              <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-hairline px-base">
                <p className="text-[16px] font-black tracking-[-0.02em] text-ink">
                  {copy.menu}
                </p>
                <Pressable
                  ref={closeButtonRef}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  hoverEffect="surface"
                  aria-label={copy.close}
                  onClick={closeMenu}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[21px]">
                    close
                  </span>
                </Pressable>
              </div>
              <nav className="flex-1 space-y-base p-base" aria-label={copy.menu}>
                {groups.map((group) => (
                  <section key={group.id} aria-labelledby={`workspace-menu-${group.id}`}>
                    <h2
                      id={`workspace-menu-${group.id}`}
                      className="px-sm font-mono text-[11px] font-black uppercase tracking-[0.12em] text-muted"
                    >
                      {group.label}
                    </h2>
                    <div className="mt-xs space-y-1">
                      {group.items.map((item) => (
                        <Link
                          key={item.id}
                          href={item.href}
                          data-onboarding-target={item.onboardingTarget}
                          className={[
                            "flex min-h-11 items-center gap-sm rounded-[8px] px-sm py-2 text-[14px] font-extrabold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                            item.active
                              ? "bg-surface text-ink"
                              : "text-body hover:bg-surface-soft hover:text-ink",
                          ].join(" ")}
                          onClick={closeMenu}
                        >
                          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-muted">
                            {item.icon}
                          </span>
                          <span className="min-w-0 flex-1">{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </nav>
            </motion.aside>
          </div>
        </AnimatePresence>,
        portalTarget,
      )
    : null;

  return (
    <>
      <Pressable
        data-onboarding-target="workspace-menu-trigger"
        data-workspace-menu-ready={clientReady ? "true" : "false"}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas lg:hidden"
        hoverEffect="surface"
        aria-label={copy.open}
        aria-controls="workspace-navigation-menu"
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        onClick={openMenu}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[23px]">menu</span>
      </Pressable>
      <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
        {items.filter((item) => item.desktop).map((item) => (
          <Link
            key={item.id}
            href={item.href}
            data-onboarding-target={item.onboardingTarget}
            className={[
              "rounded-[8px] px-sm py-xs text-[13px] font-extrabold leading-5 transition-colors",
              item.active
                ? "bg-surface text-ink"
                : "text-muted hover:bg-surface-soft hover:text-primary",
            ].join(" ")}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {mobileMenu}
    </>
  );
}
