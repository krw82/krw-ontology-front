"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { buildNewChatHref } from "@/lib/chat/history-state";
import type { Locale } from "@/i18n/config";

export interface ConsoleScenario {
  question: string;
  lines: [string, string, string];
  verdict: string;
}

export interface ConsoleSource {
  labelKo: string;
  labelEn: string;
  icon: string;
}

/**
 * The four data pipelines the product actually runs (chips in the console).
 * The scenarios below are staged demo copy — deliberately process-language,
 * never excerpts of a real answer.
 */
export const CONSOLE_SOURCES: ConsoleSource[] = [
  { labelKo: "SEC 8-K", labelEn: "SEC 8-K", icon: "description" },
  { labelKo: "시장 뉴스", labelEn: "Market news", icon: "feed" },
  { labelKo: "13F 보유", labelEn: "13F holdings", icon: "account_balance" },
  { labelKo: "Form 4", labelEn: "Form 4", icon: "swap_vert" },
];

export function consoleScript(locale: Locale): ConsoleScenario[] {
  if (locale === "en") {
    return [
      {
        question: "Is this stock worth buying now?",
        lines: ["Quarterly revenue trend checked", "Growth drivers by segment", "Filing-based risks reviewed"],
        verdict: "Verdict: momentum intact",
      },
      {
        question: "Is today's news a tailwind?",
        lines: ["Cross-checked the filing", "Major-holder stake changes", "Market reaction mapped"],
        verdict: "Verdict: watch closely",
      },
      {
        question: "How have earnings been lately?",
        lines: ["Recent quarters summarized", "Segment mix reviewed", "Margin structure checked"],
        verdict: "Verdict: structurally strong",
      },
    ];
  }
  return [
    {
      question: "이 종목 지금 살만한가?",
      lines: ["분기 매출 흐름 대조 완료", "사업부별 성장 동인 확인", "공시 기준 리스크 점검"],
      verdict: "판단: 모멘텀 유지",
    },
    {
      question: "오늘 이 뉴스, 호재인가?",
      lines: ["관련 공시 원문 대조", "주요 주주 지분 변화 확인", "시장 반응 경로 정리"],
      verdict: "판단: 관찰 필요",
    },
    {
      question: "요즘 실적이 어때?",
      lines: ["최근 분기 실적 흐름 정리", "사업부 매출 믹스 확인", "이익률 구조 변화 점검"],
      verdict: "판단: 구조 강세",
    },
  ];
}

type Phase = "typing" | "sources" | "lines" | "verdict" | "hold" | "exit";

const TYPING_MS_PER_CHAR = 45;
const PHASE_MS = {
  afterTyping: 350,
  sources: 2_100,
  lines: 1_560,
  verdict: 600,
  hold: 3_200,
  exit: 550,
} as const;
const FULL_LOOP_MS =
  2_500 + PHASE_MS.afterTyping + PHASE_MS.sources + PHASE_MS.lines + PHASE_MS.verdict + PHASE_MS.hold + PHASE_MS.exit;

export default function ResearchConsole({ locale }: { locale: Locale }) {
  const reducedMotion = useReducedMotion();
  const scenarios = useMemo(() => consoleScript(locale), [locale]);
  const rootRef = useRef<HTMLElement>(null);
  const timersRef = useRef<number[]>([]);
  const startedRef = useRef(false);
  const [active, setActive] = useState(false);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [typedChars, setTypedChars] = useState(0);

  const scenario = scenarios[scenarioIndex];

  useEffect(() => {
    const element = rootRef.current;
    if (!element || startedRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        startedRef.current = true;
        setActive(true);
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const clearTimers = () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.length = 0;
    };
    if (!active) return;

    if (reducedMotion) {
      clearTimers();
      const rotate = window.setTimeout(() => {
        setScenarioIndex((index) => (index + 1) % scenarios.length);
      }, 8_000);
      timers.push(rotate);
      return clearTimers;
    }

    // Phase/typedChars start at "typing"/0 for every scenario; the advancing
    // callback below resets them inside the timeout so no sync setState here.
    const schedule = (delay: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, delay));
    };
    const typingDuration = scenario.question.length * TYPING_MS_PER_CHAR;

    scenario.question.split("").forEach((_, charIndex) => {
      schedule((charIndex + 1) * TYPING_MS_PER_CHAR, () => setTypedChars(charIndex + 1));
    });
    schedule(typingDuration + PHASE_MS.afterTyping, () => setPhase("sources"));
    schedule(typingDuration + PHASE_MS.afterTyping + PHASE_MS.sources, () => setPhase("lines"));
    schedule(typingDuration + PHASE_MS.afterTyping + PHASE_MS.sources + PHASE_MS.lines, () => setPhase("verdict"));
    schedule(typingDuration + PHASE_MS.afterTyping + PHASE_MS.sources + PHASE_MS.lines + PHASE_MS.verdict, () => setPhase("hold"));
    schedule(typingDuration + PHASE_MS.afterTyping + PHASE_MS.sources + PHASE_MS.lines + PHASE_MS.verdict + PHASE_MS.hold, () => setPhase("exit"));
    schedule(typingDuration + PHASE_MS.afterTyping + PHASE_MS.sources + PHASE_MS.lines + PHASE_MS.verdict + PHASE_MS.hold + PHASE_MS.exit, () => {
      setScenarioIndex((index) => (index + 1) % scenarios.length);
      setCycle((value) => value + 1);
      setPhase("typing");
      setTypedChars(0);
    });

    return clearTimers;
  }, [active, cycle, reducedMotion, scenario, scenarios]);

  const activePhase = reducedMotion ? "hold" as const : phase;
  const activeTypedChars = reducedMotion ? scenario.question.length : typedChars;
  const sourcesVisible = activePhase === "sources" || activePhase === "lines" || activePhase === "verdict" || activePhase === "hold" || activePhase === "exit";
  const sourcesConnected = activePhase === "lines" || activePhase === "verdict" || activePhase === "hold" || activePhase === "exit";
  const linesVisible = activePhase === "lines" || activePhase === "verdict" || activePhase === "hold" || activePhase === "exit";
  const verdictVisible = activePhase === "verdict" || activePhase === "hold" || activePhase === "exit";
  const isEn = locale === "en";
  const ctaHref = buildNewChatHref(undefined, { locale });

  return (
    <motion.section
      ref={rootRef}
      aria-label={isEn ? "Research console demo" : "리서치 콘솔 예시"}
      className="relative overflow-hidden rounded-[16px] border border-[#223049] bg-[#101827] text-[#dce8ff] shadow-[0_24px_64px_rgba(10,15,30,0.35)]"
      initial={false}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(72%_44%_at_50%_0%,rgba(93,140,255,0.16),transparent_70%)]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:28px_28px]"
      />

      <div className="relative flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.18em] text-[#7da5ff]">
            RESEARCH CONSOLE
          </p>
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa1c7]">
            <motion.span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-[#7da5ff]"
              animate={reducedMotion ? undefined : { opacity: [1, 0.25, 1] }}
              transition={reducedMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            LIVE
          </p>
        </div>

        <motion.div
          key={`${scenarioIndex}-${cycle}`}
          initial={false}
          animate={phase === "exit" && !reducedMotion ? { opacity: 0, y: -8 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="flex flex-col gap-4"
        >
          <div className="min-h-[76px] rounded-[12px] border border-white/10 bg-white/[0.045] px-4 py-3.5">
            <p className="text-[15px] font-bold leading-[1.6] text-[#eaf1ff] sm:text-[16px]">
              {active || reducedMotion ? scenario.question.slice(0, activeTypedChars) : null}
              <motion.span
                aria-hidden="true"
                className="ml-0.5 inline-block w-[2px] self-stretch bg-[#7da5ff] align-middle"
                animate={reducedMotion ? undefined : { opacity: [1, 1, 0, 0] }}
                transition={reducedMotion ? undefined : { duration: 0.9, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: "linear" }}
              >
                {"\u00A0"}
              </motion.span>
            </p>
          </div>

          <div className="flex min-h-[36px] items-center gap-2" aria-hidden={sourcesVisible ? undefined : true}>
            <motion.span
              className="h-px flex-1 origin-left bg-gradient-to-r from-transparent via-[#7da5ff]/70 to-transparent"
              initial={false}
              animate={{ scaleX: sourcesVisible ? 1 : 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {CONSOLE_SOURCES.map((source, index) => (
                <motion.span
                  key={source.labelEn}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.02em] transition-colors duration-300 ${
                    sourcesConnected
                      ? "border-[#7da5ff]/70 bg-[#7da5ff]/10 text-[#bcd2ff]"
                      : "border-[#2d4160] bg-[#0d1729] text-[#8fa1c7]"
                  }`}
                  initial={false}
                  animate={{
                    opacity: sourcesVisible ? 1 : 0,
                    y: sourcesVisible ? 0 : 8,
                  }}
                  transition={{ duration: 0.3, delay: sourcesVisible ? index * 0.14 : 0, ease: "easeOut" }}
                >
                  <span
                    className={`material-symbols-outlined text-[13px] ${sourcesConnected ? "text-[#7da5ff]" : "text-[#5d6f96]"}`}
                    aria-hidden="true"
                  >
                    {source.icon}
                  </span>
                  {isEn ? source.labelEn : source.labelKo}
                </motion.span>
              ))}
            </div>
            <motion.span
              className="h-px flex-1 origin-right bg-gradient-to-r from-transparent via-[#7da5ff]/70 to-transparent"
              initial={false}
              animate={{ scaleX: sourcesVisible ? 1 : 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
          </div>

          <div className="flex min-h-[128px] flex-col justify-center gap-2.5 rounded-[12px] border border-white/[0.07] bg-[#0c1425]/80 px-4 py-3.5">
            {scenario.lines.map((line, index) => (
              <motion.p
                key={line}
                className={`font-mono text-[12px] leading-[1.7] sm:text-[12.5px] ${linesVisible ? "text-[#c7d6f5]" : "text-transparent"}`}
                initial={false}
                animate={linesVisible ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                transition={{ duration: 0.32, delay: linesVisible && !reducedMotion ? index * 0.38 : 0, ease: "easeOut" }}
              >
                <span className="mr-2 text-[#7da5ff]" aria-hidden="true">▸</span>
                {line}
              </motion.p>
            ))}
            <VerdictChip visible={verdictVisible} reducedMotion={reducedMotion}>
              <span className="inline-flex items-center gap-2 rounded-[10px] border border-[#7da5ff]/60 bg-[#7da5ff]/10 px-3.5 py-2 text-[12.5px] font-extrabold tracking-[0.01em] text-[#dce8ff] shadow-[0_0_24px_rgba(125,165,255,0.18)]">
                <span className="material-symbols-outlined text-[15px] text-[#7da5ff]" aria-hidden="true">verified</span>
                {scenario.verdict}
              </span>
            </VerdictChip>
          </div>
        </motion.div>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          {scenarios.map((item, index) => (
            <span key={item.question} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
              <motion.span
                className={`block h-full origin-left rounded-full ${index === scenarioIndex ? "bg-[#7da5ff]" : "bg-transparent"}`}
                initial={false}
                animate={{ scaleX: index === scenarioIndex ? 1 : 0 }}
                transition={
                  index === scenarioIndex && !reducedMotion
                    ? { duration: FULL_LOOP_MS / 1000, ease: "linear" }
                    : { duration: 0.2 }
                }
              />
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-2.5">
          <MarketingCtaLink
            href={ctaHref}
            ctaId="home_console_start"
            ctaLabel={isEn ? "Start with your question" : "내 질문으로 시작하기"}
            surface="home_preview"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#dce8ff] px-4 text-[13px] font-extrabold tracking-[0.01em] text-[#101827] shadow-[0_10px_30px_rgba(125,165,255,0.22)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7da5ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#101827]"
          >
            {isEn ? "Start with your question" : "내 질문으로 시작하기"}
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span>
          </MarketingCtaLink>
          <p className="text-center text-[10px] font-semibold leading-4 text-[#8fa1c7]/80">
            {isEn ? "Staged demo — answers are generated per question" : "예시 연출입니다 — 답변은 질문마다 생성됩니다"}
          </p>
        </div>
      </div>
    </motion.section>
  );
}

function VerdictChip({
  visible,
  reducedMotion,
  children,
}: {
  visible: boolean;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <motion.span
      className="mt-1 inline-flex"
      initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
    >
      {children}
    </motion.span>
  );
}
