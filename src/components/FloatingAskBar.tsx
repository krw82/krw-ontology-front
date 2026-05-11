"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface FloatingAskBarProps {
  selectedTicker?: string | null;
}

export default function FloatingAskBar({ selectedTicker }: FloatingAskBarProps) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // M-06: reactive auth state via onAuthStateChange
  useEffect(() => {
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
    <div className="fixed top-[75%] left-1/2 -translate-x-1/2 w-full max-w-[700px] px-md z-[100] pointer-events-none">
      <form
        onSubmit={handleSubmit}
        className="bg-surface-strong/95 backdrop-blur-sm border border-hairline rounded-full flex items-center p-[4px] pl-base shadow-lg hover:shadow-xl transition-shadow pointer-events-auto"
      >
        <input
          className="flex-grow bg-transparent border-0 focus:ring-0 focus:outline-none text-[16px] leading-[1.5] font-bold text-ink placeholder:text-muted-soft"
          placeholder="KRW Ontology에 질문하세요..."
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="질문 입력"
        />
        <button
          type="submit"
          className="bg-primary-container text-on-primary h-[44px] px-lg rounded-full text-[16px] leading-[1.15] font-semibold hover:bg-primary-active transition-colors flex items-center justify-center"
          aria-label="질문 제출"
        >
          질문
        </button>
      </form>
    </div>
  );
}
