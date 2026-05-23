"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { easeOutExpo } from "@/lib/animation";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { DEV_AUTH_EMAIL, isDevAuthBypassEnabled } from "@/lib/dev-auth";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const traceTransitionMs = 0.12;
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
    label: "답변 단서 확인 중",
    icon: "description",
    duration: 1050,
  },
  {
    step: "node",
    label: "사업 흐름 연결 중",
    icon: "hub",
    duration: 1050,
  },
  {
    step: "path",
    label: "답변 근거 정리 중",
    icon: "route",
    duration: 1050,
  },
  {
    step: "complete",
    label: "근거 기반 답변 준비 완료",
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
  const devAuthBypass = isDevAuthBypassEnabled();
  const [userEmail, setUserEmail] = useState<string | null>(
    devAuthBypass ? DEV_AUTH_EMAIL : null,
  );
  const [authChecked, setAuthChecked] = useState(devAuthBypass);
  const supabase = useMemo(
    () => (devAuthBypass ? null : createClient()),
    [devAuthBypass],
  );

  useEffect(() => {
    if (!supabase) return;

    let isMounted = true;

    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (isMounted) setUserEmail(user?.email ?? null);
      })
      .catch(() => {
        if (isMounted) setUserEmail(null);
      })
      .finally(() => {
        if (isMounted) setAuthChecked(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setAuthChecked(true);
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
        <span className="hidden max-w-[180px] truncate text-sm font-semibold text-muted sm:inline">
          {userEmail}
        </span>
      ) : authChecked ? (
        <Link
          href="/login"
          className="hidden rounded-[8px] border border-hairline px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-primary hover:text-primary sm:inline-flex"
        >
          로그인
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className="hidden h-10 w-[74px] rounded-[8px] bg-surface sm:inline-flex"
        />
      )}
      <Link
        href="/companies"
        onClick={() => {
          trackClientEventSilently("cta_clicked", {
            cta_id: "home_header_start",
            cta_label: "무료로 시작",
            surface: "home_header",
            destination: "/companies",
          });
        }}
        className="rounded-[8px] bg-surface-dark px-4 py-2 text-sm font-extrabold text-on-dark transition-colors hover:bg-primary-active"
      >
        무료로 시작
      </Link>
    </div>
  );
}

export function HomePrimaryCtas() {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link
        href="/companies"
        onClick={() => {
          trackClientEventSilently("cta_clicked", {
            cta_id: "home_hero_primary",
            cta_label: "무료로 첫 분석 시작",
            surface: "home_hero_primary",
            destination: "/companies",
          });
        }}
        className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        무료로 첫 분석 시작
      </Link>
    </div>
  );
}

export function HomeQuestionForm() {
  const [demoStep, setDemoStep] = useState<HomeDemoStep>("idle");
  const activeDemo =
    demoTimeline.find((item) => item.step === demoStep) ?? demoTimeline[0];
  const isResolving = demoStep !== "idle";

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
    <div
      className="mt-8 flex w-full max-w-3xl items-center gap-2 rounded-[14px] border bg-canvas p-2 shadow-[0_10px_28px_rgba(10,11,13,0.08)] sm:mt-10 sm:gap-3"
      style={{
        borderColor: "var(--color-outline-variant)",
      }}
      aria-label="기업 분석 예시"
    >
      <div
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[10px] pl-2 text-left sm:min-h-14 sm:pl-4"
        aria-live="polite"
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
              key={`${activeDemo.step}-progress`}
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-px bg-primary-container/55"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 0.9, ease: easeOutExpo }}
            />
          )}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-primary-fixed text-on-primary-fixed sm:h-14 sm:w-14"
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
      </span>
    </div>
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
            className="relative -mx-2 grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-[8px] px-3 py-3 transition-colors duration-150"
            style={{
              backgroundColor: isActive
                ? "rgba(221, 225, 255, 0.52)"
                : "transparent",
            }}
          >
            <AnimatePresence initial={false}>
              {isActive && (
                <motion.span
                  aria-hidden="true"
                  className="home-evidence-active-rail absolute bottom-3 left-0 top-3 w-[2px] rounded-full bg-primary"
                  initial={{ opacity: 0, scaleY: 0.4 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0.4 }}
                  transition={{ duration: 0.16, ease: easeOutExpo }}
                />
              )}
            </AnimatePresence>
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
  const reducedMotion = useReducedMotion();
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
    nodes[0]?.id;
  const activeTrace =
    nodes.find((node) => node.id === activeTraceId) ?? nodes[0];

  if (!activeTrace) return null;

  const activeTraceIndex = Math.max(
    nodes.findIndex((node) => node.id === activeTrace.id),
    0,
  );

  return (
    <div className="home-trace-card relative mt-5 overflow-hidden rounded-[8px] border border-hairline bg-surface p-4 text-ink">
      <span className="home-trace-scan" aria-hidden="true" />
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
          근거 흐름
        </p>
        <p className="text-[12px] font-semibold text-primary">
          근거 기반
        </p>
      </div>
      <div
        className="relative grid grid-cols-[minmax(56px,1fr)_24px_minmax(56px,1fr)_24px_minmax(88px,1.25fr)] items-center gap-1.5 sm:grid-cols-[1fr_32px_1fr_32px_1fr] sm:gap-2"
        aria-label="근거 흐름 선택"
        role="group"
      >
        {nodes.map((node, index) => (
          <div key={node.id} className="contents">
            <button
              type="button"
              onClick={() => setSelectedTraceId(node.id)}
              aria-pressed={activeTrace.id === node.id}
              className="relative min-w-0 overflow-hidden whitespace-nowrap rounded-[6px] border px-2 py-4 text-center text-[12px] font-bold leading-4 transition-colors sm:px-3 sm:text-[13px]"
              style={{
                borderColor:
                  activeTrace.id === node.id
                    ? "var(--color-primary)"
                    : "var(--color-hairline)",
                backgroundColor:
                  activeTrace.id === node.id
                    ? "var(--color-primary-fixed)"
                    : "var(--color-canvas)",
                color:
                  activeTrace.id === node.id
                    ? "var(--color-on-primary-fixed)"
                    : "var(--color-ink)",
                transitionDuration: "var(--duration-fast)",
              }}
            >
              {/* Animated highlight background */}
              {activeTrace.id === node.id && (
                <motion.span
                  layoutId="trace-highlight"
                  className="pointer-events-none absolute inset-0 rounded-[6px] border border-primary bg-primary-fixed/70"
                  transition={traceTransition}
                />
              )}
              <span className="relative hidden min-[420px]:inline">{node.label}</span>
              <span className="relative min-[420px]:hidden">{node.mobileLabel}</span>
            </button>
            {index < nodes.length - 1 && (
              <motion.span
                aria-hidden="true"
                className="home-trace-edge material-symbols-outlined text-center text-[18px]"
                animate={{
                  color:
                    activeTraceIndex > index
                      ? "var(--color-primary)"
                      : "var(--color-outline-variant)",
                  x:
                    !reducedMotion &&
                    demoStep !== "idle" &&
                    activeTraceIndex === index + 1
                      ? [0, 3, 0]
                      : 0,
                }}
                transition={{
                  duration: reducedMotion ? 0 : 0.2,
                  ease: easeOutExpo,
                }}
              >
                arrow_forward
              </motion.span>
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTrace.id}
          className="home-trace-panel mt-4 rounded-[8px] border border-hairline bg-canvas p-3"
          aria-live="polite"
          aria-atomic="true"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={traceTransition}
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            {activeTrace.eyebrow}
          </p>
          <p className="mt-2 text-[14px] font-extrabold leading-5 text-ink">
            {activeTrace.title}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-body">
            {activeTrace.detail}
          </p>
          <p className="mt-3 border-l border-primary pl-3 text-[12px] font-semibold leading-5 text-primary">
            {activeTrace.quote}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
