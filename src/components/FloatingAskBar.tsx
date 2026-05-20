"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth";

interface FloatingAskBarProps {
  selectedTicker?: string | null;
}

export default function FloatingAskBar({ selectedTicker }: FloatingAskBarProps) {
  const [query, setQuery] = useState("");
  const devAuthBypass = isDevAuthBypassEnabled();
  const [visible, setVisible] = useState(devAuthBypass);
  const router = useRouter();
  const supabase = useMemo(
    () => (devAuthBypass ? null : createClient()),
    [devAuthBypass],
  );

  // M-06: reactive auth state via onAuthStateChange
  useEffect(() => {
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setVisible(!!session?.user);
      }
    );

    supabase.auth.getUser().then(({ data }) => {
      setVisible(!!data.user);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  if (!visible) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    const params = new URLSearchParams();
    if (selectedTicker) params.set("ticker", selectedTicker);
    params.set("query", query.trim());
    router.push(`/chat?${params.toString()}`);
  };

  return (
    <div className="pointer-events-none fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-[100] w-full max-w-[700px] -translate-x-1/2 px-base sm:top-[75%] sm:bottom-auto sm:px-md">
      <form
        onSubmit={handleSubmit}
        className="pointer-events-auto flex items-center rounded-[10px] border border-hairline bg-surface/95 p-[4px] pl-sm shadow-lg backdrop-blur-sm transition-shadow hover:shadow-xl sm:pl-base"
      >
        <input
          className="min-w-0 flex-grow border-0 bg-transparent text-[15px] font-bold leading-[1.5] text-ink placeholder:text-muted-soft focus:outline-none focus:ring-0 sm:text-[16px]"
          placeholder="KRW Ontology에 질문하세요..."
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="질문 입력"
        />
        <button
          type="submit"
          className="flex h-[44px] shrink-0 items-center justify-center rounded-[8px] bg-surface-dark px-base text-[15px] font-bold leading-[1.15] text-on-dark transition-colors hover:bg-primary-active sm:px-lg sm:text-[16px]"
          aria-label="질문 제출"
        >
          질문
        </button>
      </form>
    </div>
  );
}
