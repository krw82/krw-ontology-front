"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const navLinks = [
  { href: "/chat", label: "리서치" },
  { href: "/companies", label: "회사 목록" },
];

function KrwLogo() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
      fill="none"
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="krwGradient"
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="120"
          y1="0"
          y2="120"
        >
          <stop stopColor="#4F8CFF" />
          <stop offset="1" stopColor="#7AA8FF" />
        </linearGradient>

        <filter id="softGlow" height="200%" width="200%" x="-50%" y="-50%">
          <feGaussianBlur result="blur" stdDeviation="12" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="
              0 0 0 0 0.31
              0 0 0 0 0.55
              0 0 0 0 1
              0 0 0 0.22 0"
          />
          <feBlend in="SourceGraphic" />
        </filter>
      </defs>

      <g filter="url(#softGlow)">
        <rect
          fill="#FFFFFF"
          height="120"
          rx="28"
          stroke="#D9E2F2"
          strokeWidth="2"
          width="120"
        />
        <path
          d="M28 28V92"
          stroke="url(#krwGradient)"
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path
          d="M70 30L36 61L76 92"
          stroke="url(#krwGradient)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="10"
        />
        <circle cx="84" cy="28" fill="#4F8CFF" r="5" />
        <circle cx="92" cy="92" fill="#4F8CFF" r="5" />
        <line
          stroke="#4F8CFF"
          strokeOpacity="0.4"
          x1="84"
          x2="92"
          y1="28"
          y2="92"
        />
      </g>
    </svg>
  );
}

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
  const pathname = usePathname();
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  // L-06: mobile nav toggle
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  // M-07: useMemo to cache Supabase client
  const supabase = useMemo(() => createClient(), []);

  // M-08: onAuthStateChange listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserProfile(profileFromUser(session?.user));
        setAccountMenuOpen(false);
      }
    );

    // Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserProfile(profileFromUser(session?.user));
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
    <header className="sticky top-0 z-50 h-[64px] w-full flex-shrink-0 border-b border-hairline bg-canvas">
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-sm px-base sm:px-md">
        {/* L-06: Mobile hamburger menu */}
        <button
          className="-ml-xs p-xs text-body transition-colors hover:text-primary md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="메뉴 열기"
          aria-expanded={mobileMenuOpen}
        >
          <span className="material-symbols-outlined text-[24px]">
            {mobileMenuOpen ? "close" : "menu"}
          </span>
        </button>

        <div className="flex min-w-0 items-center gap-lg">
          <Link
            href="/companies"
            className="flex min-w-0 items-center gap-xs text-primary"
            aria-label="KRW Ontology 홈"
          >
            <KrwLogo />
            <span className="truncate text-[18px] font-semibold leading-[1.33] tracking-tight">
              KRW Ontology
            </span>
          </Link>
          <nav className="ml-xl hidden h-full items-center gap-lg pt-4 md:flex">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "border-b-2 pb-4 text-[14px] font-medium leading-[1.4] transition-colors duration-200",
                    isActive
                      ? "text-primary border-primary font-semibold"
                      : "text-body border-transparent hover:text-primary",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-xs sm:gap-md">
          {userProfile ? (
            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-hairline bg-primary-container text-[14px] font-semibold text-on-primary shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                aria-label={`${userProfile.name ?? userProfile.email} 계정 메뉴`}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                <UserAvatar
                  profile={userProfile}
                  onAvatarError={handleAvatarError}
                />
              </button>

              {accountMenuOpen && (
                <div
                  className="absolute right-0 top-full z-50 mt-xs w-[260px] rounded-[16px] border border-hairline bg-canvas p-xs shadow-lg"
                  role="menu"
                >
                  <div className="flex items-center gap-sm border-b border-hairline px-sm py-sm">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container text-[15px] font-semibold text-on-primary">
                      <UserAvatar
                        profile={userProfile}
                        onAvatarError={handleAvatarError}
                      />
                    </div>
                    <div className="min-w-0">
                      {userProfile.name && (
                        <p className="truncate text-[14px] font-semibold leading-[1.3] text-heading">
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
                    className="mt-xs flex w-full items-center justify-between rounded-[12px] px-sm py-sm text-left text-[14px] font-semibold leading-[1.3] text-body transition-colors hover:bg-subtle hover:text-primary"
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
              className="rounded-full bg-primary-container px-sm py-xs text-[14px] font-semibold leading-[1.15] text-on-primary transition-colors duration-200 hover:bg-primary-active sm:px-base sm:text-[16px]"
              aria-label="로그인"
              onClick={() => router.push("/login")}
            >
              로그인
            </button>
          )}

        </div>
      </div>

      {/* L-06: Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="border-t border-hairline bg-canvas px-base py-base shadow-sm md:hidden sm:px-md">
          <nav className="flex flex-col gap-base">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "text-[16px] leading-[1.5] font-medium py-sm transition-colors",
                    isActive
                      ? "text-primary font-semibold"
                      : "text-body hover:text-primary",
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
