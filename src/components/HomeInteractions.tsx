"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { easeOutExpo } from "@/lib/animation";

const traceTransitionMs = 0.12;
const focusTransitionMs = 0.14;
const demoStepEvent = "krw-home-demo-step";
const traceTransition = {
  duration: traceTransitionMs,
  ease: easeOutExpo,
};

export type HomeDemoStep = "idle" | "source" | "node" | "path" | "complete";

export interface HomeTraceNode {
  id: string;
  label: string;
  mobileLabel: string;
  eyebrow: string;
  title: string;
  detail: string;
  quote: string;
}

export interface HomeEvidenceCard {
  id: "source" | "node" | "path";
  label: string;
  value: string;
  detail: string;
}

const demoTimeline: Array<{
  step: HomeDemoStep;
  label: string;
  icon: string;
  duration: number;
}> = [
  {
    step: "idle",
    label: "예: AMZN 클라우드 이익률",
    icon: "search",
    duration: 1400,
  },
      {
        step: "source",
    label: "근거 문맥 확인 중",
    icon: "description",
    duration: 1050,
  },
  {
    step: "node",
    label: "사업 활동 노드 연결 중",
    icon: "hub",
    duration: 1050,
  },
  {
    step: "path",
    label: "근거 경로 생성 중",
    icon: "route",
    duration: 1050,
  },
  {
    step: "complete",
    label: "근거 그래프 준비 완료",
    icon: "check_circle",
    duration: 1250,
  },
];

function emitDemoStep(step: HomeDemoStep) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<HomeDemoStep>(demoStepEvent, { detail: step }),
  );
}

function useHomeDemoStep(defaultStep: HomeDemoStep = "idle") {
  const [demoStep, setDemoStep] = useState<HomeDemoStep>(defaultStep);

  useEffect(() => {
    const syncStep = (event: Event) => {
      setDemoStep((event as CustomEvent<HomeDemoStep>).detail);
    };

    window.addEventListener(demoStepEvent, syncStep);
    return () => window.removeEventListener(demoStepEvent, syncStep);
  }, []);

  return demoStep;
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
  const [isFocused, setIsFocused] = useState(false);
  const [demoStep, setDemoStep] = useState<HomeDemoStep>("idle");
  const activeDemo =
    demoTimeline.find((item) => item.step === demoStep) ?? demoTimeline[0];
  const isResolving = demoStep !== "idle";
  const exampleQuery = "AMZN 클라우드 이익률";

  const startResearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const params = new URLSearchParams({ query: trimmed });
    router.push(`/chat?${params.toString()}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startResearch(exampleQuery);
  };

  useEffect(() => {
    let index = 0;
    let timeoutId: number;

    const tick = () => {
      const item = demoTimeline[index] ?? demoTimeline[0];
      setDemoStep(item.step);
      emitDemoStep(item.step);
      index = (index + 1) % demoTimeline.length;
      timeoutId = window.setTimeout(tick, item.duration);
    };

    tick();

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 flex w-full max-w-3xl items-center gap-2 rounded-[14px] border bg-canvas p-2 shadow-2xl sm:mt-10 sm:gap-3"
      style={{
        borderColor: isFocused ? "rgba(183, 196, 255, 0.5)" : "rgba(255, 255, 255, 0.15)",
        boxShadow: isFocused
          ? "0 0 0 3px rgba(183, 196, 255, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.35)"
          : "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
        transition: `border-color ${focusTransitionMs}s var(--ease-out-expo), box-shadow ${focusTransitionMs}s var(--ease-out-expo)`,
      }}
    >
      <button
        type="submit"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[10px] pl-2 text-left outline-none transition-colors hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-primary sm:min-h-14 sm:pl-4"
        aria-label={`${activeDemo.label}. 채팅에서 분석 시작`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={activeDemo.icon}
            aria-hidden="true"
            className="material-symbols-outlined shrink-0 text-[24px] text-primary-container"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={traceTransition}
          >
            {activeDemo.icon}
          </motion.span>
        </AnimatePresence>
        <span className="relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={activeDemo.step}
              className="block truncate text-[16px] font-extrabold leading-6 text-ink"
              initial={{ opacity: 0, y: 7, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -7, filter: "blur(3px)" }}
              transition={{ duration: 0.2, ease: easeOutExpo }}
            >
              {activeDemo.label}
            </motion.span>
          </AnimatePresence>
          {isResolving && (
            <motion.span
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-px bg-primary-container/55"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 0.9, ease: easeOutExpo }}
            />
          )}
        </span>
      </button>
      <button
        type="submit"
        aria-label="채팅에서 예시 질문으로 분석 시작"
        className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-primary-fixed text-on-primary-fixed transition-all hover:bg-primary-fixed-dim hover:scale-[1.04] active:scale-[0.98] sm:h-14 sm:w-14"
        style={{
          transitionDuration: "140ms",
          transitionTimingFunction: "var(--ease-out-expo)",
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isResolving ? (
            <motion.span
              key="sphere"
              className="relative inline-flex h-6 w-6 animate-spin rounded-full bg-[conic-gradient(from_0deg,rgba(0,82,255,0)_0deg,rgba(0,82,255,0.2)_90deg,var(--color-primary-container)_175deg,var(--color-primary)_270deg,rgba(0,82,255,0)_360deg)] p-[2px] [animation-duration:900ms]"
              initial={{ opacity: 0, scale: 0.82 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.82 }}
              transition={traceTransition}
            >
              <span className="h-full w-full rounded-full bg-primary-fixed" />
              <span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-primary-container shadow-[0_0_10px_rgba(0,82,255,0.65)]" />
            </motion.span>
          ) : (
            <motion.span
              key="arrow"
              aria-hidden="true"
              className="material-symbols-outlined text-[28px]"
              initial={{ opacity: 0, scale: 0.82 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.82 }}
              transition={traceTransition}
            >
              arrow_upward
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </form>
  );
}

export function HomeEvidenceCards({ cards }: { cards: HomeEvidenceCard[] }) {
  const demoStep = useHomeDemoStep();

  return (
    <motion.div
      className="mt-5 divide-y divide-hairline border-y border-hairline"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.05 },
        },
      }}
    >
      {cards.map((card) => {
        const isActive = demoStep === card.id || demoStep === "complete";

        return (
          <motion.div
            key={card.id}
            variants={{
              hidden: { opacity: 0, y: 8 },
              visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.24, ease: easeOutExpo },
              },
            }}
            className="-mx-2 grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-[8px] px-3 py-3 transition-colors duration-150"
            style={{
              backgroundColor: isActive
                ? "rgba(221, 225, 255, 0.52)"
                : "transparent",
            }}
          >
            <span
              className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150"
              style={{
                color: isActive
                  ? "var(--color-primary)"
                  : "var(--color-muted)",
              }}
            >
              {card.label}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-extrabold text-ink">
                {card.value}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-body">
                {card.detail}
              </p>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export function HomeTraceExplorer({ nodes }: { nodes: HomeTraceNode[] }) {
  const demoStep = useHomeDemoStep();
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const traceIdByStep: Partial<Record<HomeDemoStep, string>> = {
    source: "filing",
    node: "segment",
    path: "driver",
    complete: "driver",
  };
  const demoTraceId = traceIdByStep[demoStep];
  const activeTraceId =
    (selectedTraceId && nodes.some((node) => node.id === selectedTraceId)
      ? selectedTraceId
      : undefined) ??
    (demoTraceId && nodes.some((node) => node.id === demoTraceId)
      ? demoTraceId
      : undefined) ??
    nodes[1]?.id ??
    nodes[0]?.id;
  const activeTrace =
    nodes.find((node) => node.id === activeTraceId) ?? nodes[0];

  if (!activeTrace) return null;

  return (
    <div className="mt-5 rounded-[8px] bg-surface-dark p-4 text-on-dark">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-on-dark-soft">
          근거 흐름
        </p>
        <p className="text-[12px] font-semibold text-primary-fixed-dim">
          검증 가능
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
              onClick={() => setSelectedTraceId(node.id)}
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
                  transition={traceTransition}
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
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={traceTransition}
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
