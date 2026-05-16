"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { easeOutExpo, duration } from "@/lib/animation";

export interface HomeTraceNode {
  id: string;
  label: string;
  mobileLabel: string;
  eyebrow: string;
  title: string;
  detail: string;
  quote: string;
}

export function HomeHeaderActions() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isMounted) setUserEmail(user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  return (
    <div className="flex min-w-0 items-center gap-3">
      {userEmail ? (
        <span className="hidden max-w-[180px] truncate text-sm font-semibold text-on-dark-soft sm:inline">
          {userEmail}
        </span>
      ) : (
        <Link
          href="/login"
          className="hidden rounded-[8px] border border-white/15 px-4 py-2 text-sm font-semibold text-on-dark transition-colors hover:border-primary-fixed-dim hover:text-primary-fixed-dim sm:inline-flex"
        >
          로그인
        </Link>
      )}
      <Link
        href="/companies"
        className="rounded-[8px] bg-primary-fixed px-4 py-2 text-sm font-extrabold text-on-primary-fixed transition-colors hover:bg-primary-fixed-dim"
      >
        {userEmail ? "회사 목록" : "시작하기"}
      </Link>
    </div>
  );
}

export function HomeQuestionForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const startResearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const params = new URLSearchParams({ query: trimmed });
    router.push(`/chat?${params.toString()}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startResearch(query);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 flex w-full max-w-3xl items-center gap-2 rounded-[12px] border bg-canvas p-2 shadow-2xl sm:mt-10 sm:gap-3"
      style={{
        borderColor: isFocused ? "rgba(183, 196, 255, 0.5)" : "rgba(255, 255, 255, 0.15)",
        boxShadow: isFocused
          ? "0 0 0 3px rgba(183, 196, 255, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.35)"
          : "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
        transition: "border-color var(--duration-normal) var(--ease-out-expo), box-shadow var(--duration-normal) var(--ease-out-expo)",
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 pl-2 sm:pl-4">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[24px] text-primary-container"
        >
          search
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="h-12 min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:text-muted sm:h-14"
          placeholder="예: AMZN 클라우드 이익률"
          aria-label="리서치 질문"
        />
      </div>
      <button
        type="submit"
        disabled={!query.trim()}
        aria-label="질문 보내기"
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-surface-dark text-on-dark transition-all hover:bg-primary-active hover:scale-[1.04] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 sm:h-14 sm:w-14"
        style={{
          transitionDuration: "var(--duration-fast)",
          transitionTimingFunction: "var(--ease-spring)",
        }}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[28px]">
          arrow_upward
        </span>
      </button>
    </form>
  );
}

export function HomeTraceExplorer({ nodes }: { nodes: HomeTraceNode[] }) {
  const [activeTraceId, setActiveTraceId] = useState(nodes[1]?.id ?? nodes[0]?.id);
  const activeTrace =
    nodes.find((node) => node.id === activeTraceId) ?? nodes[0];

  if (!activeTrace) return null;

  return (
    <div className="mt-5 rounded-[8px] bg-surface-dark p-4 text-on-dark">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-on-dark-soft">
          ontology path
        </p>
        <p className="text-[12px] font-semibold text-primary-fixed-dim">
          confidence · high
        </p>
      </div>
      <div
        className="relative grid grid-cols-[minmax(56px,1fr)_24px_minmax(56px,1fr)_24px_minmax(88px,1.25fr)] items-center gap-1.5 sm:grid-cols-[1fr_32px_1fr_32px_1fr] sm:gap-2"
        aria-label="온톨로지 경로 선택"
        role="group"
      >
        {nodes.map((node, index) => (
          <div key={node.id} className="contents">
            <button
              type="button"
              onClick={() => setActiveTraceId(node.id)}
              aria-pressed={activeTrace.id === node.id}
              className="relative min-w-0 whitespace-nowrap rounded-[6px] border px-2 py-4 text-center text-[12px] font-bold leading-4 transition-colors sm:px-3 sm:text-[13px]"
              style={{
                borderColor:
                  activeTrace.id === node.id
                    ? "var(--color-primary-fixed-dim)"
                    : "rgba(255, 255, 255, 0.1)",
                backgroundColor:
                  activeTrace.id === node.id
                    ? "rgba(255, 255, 255, 0.14)"
                    : "rgba(255, 255, 255, 0.06)",
                color:
                  activeTrace.id === node.id
                    ? "var(--color-primary-fixed-dim)"
                    : "var(--color-on-dark)",
                transitionDuration: "var(--duration-fast)",
              }}
            >
              {/* Animated highlight background */}
              {activeTrace.id === node.id && (
                <motion.span
                  layoutId="trace-highlight"
                  className="absolute inset-0 rounded-[6px] border border-primary-fixed-dim bg-white/[0.08]"
                  style={{ zIndex: -1 }}
                  transition={{
                    type: "spring",
                    stiffness: 380,
                    damping: 30,
                  }}
                />
              )}
              <span className="relative hidden min-[420px]:inline">{node.label}</span>
              <span className="relative min-[420px]:hidden">{node.mobileLabel}</span>
            </button>
            {index < nodes.length - 1 && (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-center text-[18px] text-primary-fixed-dim"
              >
                arrow_forward
              </span>
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTrace.id}
          className="mt-4 rounded-[8px] border border-white/10 bg-white/[0.06] p-3"
          aria-live="polite"
          aria-atomic="true"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{
            duration: duration.normal,
            ease: easeOutExpo,
          }}
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-on-dark-soft">
            {activeTrace.eyebrow}
          </p>
          <p className="mt-2 text-[14px] font-extrabold leading-5 text-on-dark">
            {activeTrace.title}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-on-dark-soft">
            {activeTrace.detail}
          </p>
          <p className="mt-3 border-l border-primary-fixed-dim pl-3 text-[12px] font-semibold leading-5 text-primary-fixed-dim">
            {activeTrace.quote}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
