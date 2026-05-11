"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const navLinks = [
  { href: "/chat", label: "Research" },
  { href: "/companies", label: "Company Browser" },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // L-06: mobile nav toggle
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // M-07: useMemo to cache Supabase client
  const supabase = useMemo(() => createClient(), []);

  // M-08: onAuthStateChange listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserEmail(session?.user?.email ?? null);
      }
    );

    // Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUserEmail(null);
    router.push("/login");
  }, [supabase, router]);

  return (
    <header className="bg-canvas w-full sticky top-0 h-[64px] border-b border-hairline flex-shrink-0 z-50">
      <div className="flex justify-between items-center w-full max-w-[1600px] mx-auto px-md h-full">
        <div className="flex items-center gap-lg">
          <Link
            href="/companies"
            className="text-[18px] leading-[1.33] font-semibold text-primary tracking-tight"
          >
            KRW Ontology
          </Link>
          <nav className="hidden md:flex items-center gap-lg ml-xl pt-4 h-full">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "text-[14px] leading-[1.4] font-medium pb-4 border-b-2 transition-colors duration-200",
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
        <div className="flex items-center gap-md">
          {userEmail ? (
            <>
              <span className="hidden md:block text-[14px] leading-[1.4] font-medium text-muted truncate max-w-[200px]">
                {userEmail}
              </span>
              <button
                className="text-[14px] leading-[1.15] font-semibold text-body hover:text-primary transition-colors px-sm"
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button
                className="hidden md:block text-[16px] leading-[1.15] font-semibold text-body hover:text-primary transition-colors px-sm"
                aria-label="Sign in"
                onClick={() => router.push("/login")}
              >
                Sign In
              </button>
              <button
                className="text-[16px] leading-[1.15] font-semibold bg-primary-container text-on-primary rounded-full px-base py-xs hover:bg-primary-active transition-colors duration-200"
                aria-label="Get started"
                onClick={() => router.push("/login")}
              >
                Get Started
              </button>
            </>
          )}

          {/* L-06: Mobile hamburger menu */}
          <button
            className="md:hidden p-sm text-body hover:text-primary transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            <span className="material-symbols-outlined text-[24px]">
              {mobileMenuOpen ? "close" : "menu"}
            </span>
          </button>
        </div>
      </div>

      {/* L-06: Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-hairline bg-canvas px-md py-base">
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
