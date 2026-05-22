"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { KrwBrand } from "@/components/KrwBrand";
import { normalizeInternalNextPath } from "@/lib/auth/redirect-path";
import { createClient } from "@/lib/supabase/client";
import { popoverMenu } from "@/lib/animation";
import {
  DEV_AUTH_EMAIL,
  DEV_AUTH_NAME,
  isDevAuthBypassEnabled,
} from "@/lib/dev-auth";
import type { User } from "@supabase/supabase-js";

export interface TopNavUserProfile {
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface TopNavProps {
  initialUserProfile?: TopNavUserProfile | null;
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
}: TopNavProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const devAuthBypass = isDevAuthBypassEnabled();
  const [userProfile, setUserProfile] = useState<TopNavUserProfile | null>(() =>
    initialUserProfile ??
    (devAuthBypass
      ? { email: DEV_AUTH_EMAIL, name: DEV_AUTH_NAME, avatarUrl: null }
      : null),
  );
  const [authChecked, setAuthChecked] = useState(
    Boolean(initialUserProfile) || devAuthBypass,
  );
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  // M-07: useMemo to cache Supabase client
  const supabase = useMemo(
    () => (devAuthBypass ? null : createClient()),
    [devAuthBypass],
  );
  const query = searchParams.toString();
  const currentPath = normalizeInternalNextPath(
    query ? `${pathname}?${query}` : pathname,
  );

  // M-08: onAuthStateChange listener
  useEffect(() => {
    if (!supabase) return;

    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;
        setUserProfile(profileFromUser(session?.user));
        setAuthChecked(true);
        setAccountMenuOpen(false);
      }
    );

    // Initial check
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (isMounted) setUserProfile(profileFromUser(user));
      })
      .catch(() => {
        if (isMounted) setUserProfile(null);
      })
      .finally(() => {
        if (isMounted) setAuthChecked(true);
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

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
  }, [supabase, router]);

  const handleAvatarError = useCallback(() => {
    setUserProfile((profile) =>
      profile ? { ...profile, avatarUrl: null } : profile,
    );
  }, []);

  return (
    <header className="sticky top-0 z-50 h-[72px] w-full flex-shrink-0 border-b border-hairline bg-canvas/95 backdrop-blur-xl md:h-[64px]">
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-sm px-base pl-[72px] sm:px-md md:pl-md">
        <div className="flex min-w-0 items-center gap-lg">
          <KrwBrand href="/companies" compact />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-xs sm:gap-md">
          {!authChecked ? (
            <div
              aria-hidden="true"
              className="h-9 w-0 sm:h-10"
            />
          ) : userProfile ? (
            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-[8px] border border-hairline bg-surface-dark text-[13px] font-semibold text-on-dark shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:h-10 sm:w-10"
                aria-label={`${userProfile.name ?? userProfile.email} 계정 메뉴`}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
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
                    <button
                      type="button"
                      className="mt-xs flex w-full items-center justify-between rounded-[8px] px-sm py-sm text-left text-[14px] font-semibold leading-[1.3] text-body transition-colors hover:bg-surface-soft hover:text-primary"
                      role="menuitem"
                      onClick={handleSignOut}
                    >
                      <span>로그아웃</span>
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
              aria-label="로그인"
            >
              로그인
            </Link>
          )}

        </div>
      </div>
    </header>
  );
}
