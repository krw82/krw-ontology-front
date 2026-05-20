"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { KrwBrand } from "@/components/KrwBrand";
import { createClient } from "@/lib/supabase/client";
import {
  DEV_AUTH_EMAIL,
  DEV_AUTH_NAME,
  isDevAuthBypassEnabled,
} from "@/lib/dev-auth";
import type { User } from "@supabase/supabase-js";

interface UserProfile {
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

function profileFromUser(user: User | null | undefined): UserProfile | null {
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

function profileInitial(profile: UserProfile): string {
  const source = profile.name ?? profile.email;
  return source.trim().charAt(0).toUpperCase();
}

function UserAvatar({
  profile,
  onAvatarError,
}: {
  profile: UserProfile;
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
      sizes="44px"
      referrerPolicy="no-referrer"
      onError={onAvatarError}
    />
  );
}

export default function TopNav() {
  const router = useRouter();
  const devAuthBypass = isDevAuthBypassEnabled();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() =>
    devAuthBypass
      ? { email: DEV_AUTH_EMAIL, name: DEV_AUTH_NAME, avatarUrl: null }
      : null,
  );
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  // M-07: useMemo to cache Supabase client
  const supabase = useMemo(
    () => (devAuthBypass ? null : createClient()),
    [devAuthBypass],
  );

  // M-08: onAuthStateChange listener
  useEffect(() => {
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserProfile(profileFromUser(session?.user));
        setAccountMenuOpen(false);
      }
    );

    // Initial check
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserProfile(profileFromUser(user));
    });

    return () => {
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
      router.push("/companies");
      return;
    }

    await supabase.auth.signOut();
    setUserProfile(null);
    setAccountMenuOpen(false);
    router.push("/login");
  }, [supabase, router]);

  const handleAvatarError = useCallback(() => {
    setUserProfile((profile) =>
      profile ? { ...profile, avatarUrl: null } : profile,
    );
  }, []);

  return (
    <header className="sticky top-0 z-50 h-[64px] w-full flex-shrink-0 border-b border-hairline bg-canvas/95 backdrop-blur-xl">
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-sm px-base pl-[68px] sm:px-md md:pl-md">
        <div className="flex min-w-0 items-center gap-lg">
          <KrwBrand href="/" compact />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-xs sm:gap-md">
          {userProfile ? (
            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[8px] border border-hairline bg-surface-dark text-[14px] font-semibold text-on-dark shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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

              {accountMenuOpen && (
                <div
                  className="fixed left-base right-base top-[72px] z-50 mt-0 w-auto rounded-[8px] border border-hairline bg-canvas p-xs shadow-lg md:absolute md:left-auto md:right-0 md:top-full md:mt-xs md:w-[260px]"
                  role="menu"
                >
                  <div className="flex items-center gap-sm border-b border-hairline px-sm py-sm">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-surface-dark text-[15px] font-semibold text-on-dark">
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
                </div>
              )}
            </div>
          ) : (
            <button
              className="rounded-[8px] bg-surface-dark px-sm py-xs text-[14px] font-semibold leading-[1.15] text-on-dark transition-colors duration-200 hover:bg-primary-active sm:px-base sm:text-[16px]"
              aria-label="로그인"
              onClick={() => router.push("/login")}
            >
              로그인
            </button>
          )}

        </div>
      </div>
    </header>
  );
}
