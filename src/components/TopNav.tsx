"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { KrwBrand } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import UsageStatus from "@/components/UsageStatus";
import { getPathLocale, localizedPath } from "@/i18n/routing";
import { normalizeInternalNextPath } from "@/lib/auth/redirect-path";
import { dispatchOpenChatSidebar } from "@/lib/chat/sidebar-events";
import { createClient } from "@/lib/supabase/client";
import { popoverMenu } from "@/lib/animation";
import { useEntitlement } from "@/hooks/useEntitlement";
import type { WatchlistOverviewResponse } from "@/types/api-contracts";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

export interface TopNavUserProfile {
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface TopNavProps {
  initialUserProfile?: TopNavUserProfile | null;
  brandHref?: string;
  brandAriaLabel?: string;
  hideAccountMenu?: boolean;
  showSidebarTrigger?: boolean;
  mobileCollapsed?: boolean;
  mobileOverlay?: boolean;
  preserveInitialUserProfile?: boolean;
  showLocaleSwitcher?: boolean;
  accountIconHref?: string;
  accountIconAriaLabel?: string;
  actionSlot?: ReactNode;
}

function profileFromUser(user: User | null | undefined): TopNavUserProfile | null {
  if (!user?.email) return null;

  const metadata = user.user_metadata;
  const avatarUrl =
    stringValue(metadata.avatar_url) ??
    stringValue(metadata.picture) ??
    stringValue(metadata.photo_url);
  const name =
    stringValue(metadata.full_name) ??
    stringValue(metadata.name) ??
    stringValue(metadata.display_name);

  return {
    email: user.email,
    name,
    avatarUrl,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function profileInitial(profile: TopNavUserProfile): string {
  const source = profile.name ?? profile.email;
  return source.trim().charAt(0).toUpperCase();
}

function UserAvatar({
  profile,
  onAvatarError,
}: {
  profile: TopNavUserProfile;
  onAvatarError: () => void;
}) {
  if (!profile.avatarUrl) {
    return <span aria-hidden="true">{profileInitial(profile)}</span>;
  }

  return (
    <Image
      src={profile.avatarUrl}
      alt=""
      fill
      className="object-cover"
      sizes="40px"
      referrerPolicy="no-referrer"
      onError={onAvatarError}
    />
  );
}

export default function TopNav({
  initialUserProfile,
  brandHref = "/",
  brandAriaLabel,
  hideAccountMenu = false,
  showSidebarTrigger = false,
  mobileCollapsed = false,
  mobileOverlay = false,
  preserveInitialUserProfile = false,
  showLocaleSwitcher = false,
  accountIconHref,
  accountIconAriaLabel,
  actionSlot,
}: TopNavProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocale = getPathLocale(pathname) ?? "ko";
  const [userProfile, setUserProfile] = useState<TopNavUserProfile | null>(() =>
    initialUserProfile ?? null,
  );
  const [authChecked, setAuthChecked] = useState(
    Boolean(initialUserProfile) || hideAccountMenu,
  );
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [researchInboxIndicator, setResearchInboxIndicator] = useState<{
    userKey: string | null;
    hasItems: boolean;
  }>({ userKey: null, hasItems: false });
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const shouldLoadAccount = !hideAccountMenu;
  const { entitlement } = useEntitlement(shouldLoadAccount && Boolean(userProfile));
  const userProfileKey = userProfile?.email ?? null;
  const hasResearchInboxItems =
    Boolean(accountIconHref && userProfileKey) &&
    researchInboxIndicator.userKey === userProfileKey &&
    researchInboxIndicator.hasItems;

  // M-07: useMemo to cache Supabase client
  const supabase = useMemo(
    () => (shouldLoadAccount ? createClient() : null),
    [shouldLoadAccount],
  );
  const query = searchParams.toString();
  const currentPath = normalizeInternalNextPath(
    query ? `${pathname}?${query}` : pathname,
  );
  const navLinks = [
    {
      href: localizedPath(currentLocale, "/companies"),
      label: currentLocale === "ko" ? "회사" : "Companies",
      active: pathname.includes("/companies"),
    },
    {
      href: "/watchlist",
      label: currentLocale === "ko" ? "리서치 노트북" : "Research Notebook",
      active: pathname.startsWith("/watchlist"),
    },
  ];

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setClientReady(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  // M-08: onAuthStateChange listener
  useEffect(() => {
    if (!shouldLoadAccount) return;
    if (!supabase) return;

    let isMounted = true;
    const fallbackProfile = preserveInitialUserProfile
      ? initialUserProfile ?? null
      : null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;
        setUserProfile(profileFromUser(session?.user) ?? fallbackProfile);
        setAuthChecked(true);
        setAccountMenuOpen(false);
      }
    );

    // Initial check
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (isMounted) setUserProfile(profileFromUser(user) ?? fallbackProfile);
      })
      .catch(() => {
        if (isMounted) setUserProfile(fallbackProfile);
      })
      .finally(() => {
        if (isMounted) setAuthChecked(true);
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [initialUserProfile, preserveInitialUserProfile, shouldLoadAccount, supabase]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        accountMenuRef.current &&
        event.target instanceof Node &&
        !accountMenuRef.current.contains(event.target)
      ) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!accountIconHref || !userProfileKey) return;

    let stale = false;
    const userKey = userProfileKey;
    async function loadResearchInboxState() {
      try {
        const response = await fetch("/api/watchlist", { cache: "no-store" });
        if (!response.ok) {
          if (!stale) {
            setResearchInboxIndicator({ userKey, hasItems: false });
          }
          return;
        }
        const overview = (await response.json()) as WatchlistOverviewResponse;
        if (!stale) {
          setResearchInboxIndicator({
            userKey,
            hasItems: overview.research_inbox.length > 0,
          });
        }
      } catch {
        if (!stale) {
          setResearchInboxIndicator({ userKey, hasItems: false });
        }
      }
    }

    void loadResearchInboxState();
    return () => {
      stale = true;
    };
  }, [accountIconHref, userProfileKey]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) {
      setAccountMenuOpen(false);
      router.refresh();
      return;
    }

    await supabase.auth.signOut();
    setUserProfile(null);
    setAccountMenuOpen(false);
    router.replace("/login");
    router.refresh();
  }, [router, setAccountMenuOpen, setUserProfile, supabase]);

  const handleAvatarError = useCallback(() => {
    setUserProfile((profile) =>
      profile ? { ...profile, avatarUrl: null } : profile,
    );
  }, [setUserProfile]);

  return (
    <header
      className={[
        mobileOverlay ? "fixed inset-x-0 top-0 md:sticky md:inset-auto" : "sticky top-0",
        "z-50 h-[72px] w-full flex-shrink-0 border-b bg-canvas/95 backdrop-blur-xl transition-[transform,opacity,border-color] duration-200 ease-out md:h-[64px] md:translate-y-0 md:border-hairline md:opacity-100",
        mobileCollapsed
          ? "-translate-y-full border-transparent opacity-0"
          : "translate-y-0 border-hairline opacity-100",
      ].join(" ")}
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-sm px-base sm:px-md md:pl-md">
        <div className="flex min-w-0 items-center gap-sm sm:gap-lg">
          {showSidebarTrigger && (
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-55 md:hidden"
              aria-label={
                currentLocale === "ko" ? "채팅 기록 열기" : "Open chat history"
              }
              aria-controls="mobile-chat-sidebar"
              onClick={dispatchOpenChatSidebar}
              disabled={!clientReady}
            >
              <span aria-hidden="true" className="relative block h-5 w-6">
                <span className="absolute left-0 top-[3px] h-[2px] w-5 rounded-full bg-ink" />
                <span className="absolute bottom-[3px] left-0 h-[2px] w-3.5 rounded-full bg-ink" />
              </span>
            </button>
          )}
          <KrwBrand
            href={brandHref}
            compact
            ariaLabel={brandAriaLabel}
          />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  "rounded-[8px] px-sm py-xs text-[13px] font-extrabold leading-5 transition-colors",
                  link.active
                    ? "bg-surface text-ink"
                    : "text-muted hover:bg-surface-soft hover:text-primary",
                ].join(" ")}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-xs sm:gap-md">
          {actionSlot}
          {showLocaleSwitcher && <LocaleSwitcher compact />}
          {hideAccountMenu ? null : !authChecked ? (
            <div
              aria-hidden="true"
              className="h-9 w-0 sm:h-10"
            />
          ) : userProfile && accountIconHref ? (
            <Link
              href={accountIconHref}
              className="relative flex h-9 w-9 items-center justify-center rounded-[8px] border border-hairline bg-surface-dark text-[13px] font-semibold text-on-dark shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:h-10 sm:w-10"
              aria-label={
                accountIconAriaLabel ??
                (currentLocale === "ko"
                  ? "리서치 노트북으로 이동"
                  : "Go to research notebook")
              }
            >
              <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[7px]">
                <UserAvatar
                  profile={userProfile}
                  onAvatarError={handleAvatarError}
                />
              </span>
              {hasResearchInboxItems && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-error shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
                />
              )}
            </Link>
          ) : userProfile ? (
            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-[8px] border border-hairline bg-surface-dark text-[13px] font-semibold text-on-dark shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-55 sm:h-10 sm:w-10"
                aria-label={`${userProfile.name ?? userProfile.email} ${
                  currentLocale === "ko" ? "계정 메뉴" : "account menu"
                }`}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                disabled={!clientReady}
                onClick={() => {
                  setAccountMenuOpen((open) => !open);
                }}
              >
                <UserAvatar
                  profile={userProfile}
                  onAvatarError={handleAvatarError}
                />
              </button>

              <AnimatePresence initial={false}>
                {accountMenuOpen && (
                  <motion.div
                    className="fixed left-base right-base top-[72px] z-50 mt-0 w-auto rounded-[8px] border border-hairline bg-canvas p-xs shadow-lg md:absolute md:left-auto md:right-0 md:top-full md:mt-xs md:w-[260px]"
                    role="menu"
                    variants={popoverMenu}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    style={{ transformOrigin: "top right" }}
                  >
                    <div className="flex items-center gap-sm border-b border-hairline px-sm py-sm">
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-surface-dark text-[14px] font-semibold text-on-dark">
                        <UserAvatar
                          profile={userProfile}
                          onAvatarError={handleAvatarError}
                        />
                      </div>
                      <div className="min-w-0">
                        {userProfile.name && (
                          <p className="truncate text-[14px] font-semibold leading-[1.3] text-ink">
                            {userProfile.name}
                          </p>
                        )}
                        <p className="truncate text-[13px] font-medium leading-[1.35] text-muted">
                          {userProfile.email}
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/settings/billing"
                      className="mt-xs block rounded-[8px] transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      role="menuitem"
                      onClick={() => setAccountMenuOpen(false)}
                    >
                      <UsageStatus entitlement={entitlement} variant="menu" />
                    </Link>
                    <button
                      type="button"
                      className="mt-xs flex w-full items-center justify-between rounded-[8px] px-sm py-sm text-left text-[14px] font-semibold leading-[1.3] text-body transition-colors hover:bg-surface-soft hover:text-primary"
                      role="menuitem"
                      onClick={handleSignOut}
                    >
                      <span>{currentLocale === "ko" ? "로그아웃" : "Log out"}</span>
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-[18px]"
                      >
                        logout
                      </span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(currentPath)}`}
              className="inline-flex min-h-10 items-center rounded-[8px] bg-surface-dark px-sm py-xs text-[14px] font-semibold leading-[1.15] text-on-dark transition-colors duration-200 hover:bg-primary-active sm:px-base sm:text-[16px]"
              aria-label={currentLocale === "ko" ? "로그인" : "Log in"}
            >
              {currentLocale === "ko" ? "로그인" : "Log in"}
            </Link>
          )}

        </div>
      </div>
    </header>
  );
}
