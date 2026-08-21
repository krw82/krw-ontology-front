"use client";

import { motion } from "motion/react";
import { easeOutExpo, staggerContainerFast } from "@/lib/animation";

const fastTransition = 0.24;

const headingContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0 },
  },
};

/* ------------------------------------------------------------------ */
/*  Hero heading — per-word mask reveal with accent underline draw     */
/* ------------------------------------------------------------------ */

interface HeroHeadingProps {
  /** Primary lines rendered as normal text */
  lines: string[];
  /** Accent line rendered with accent color */
  accentLine: string;
  /** Trailing line(s) after the accent */
  trailingLines?: string[];
}

const wordMask = {
  hidden: { y: "112%" },
  visible: {
    y: "0%",
    transition: { duration: 0.52, ease: easeOutExpo },
  },
};

function MaskedLine({
  text,
  lineDelay,
  accent = false,
}: {
  text: string;
  lineDelay: number;
  accent?: boolean;
}) {
  return (
    <motion.span
      className={accent ? "block text-primary" : "block"}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.045, delayChildren: lineDelay } },
      }}
    >
      {text.split(" ").map((word, wordIdx) => (
        <span
          key={wordIdx}
          className="inline-block overflow-hidden pb-[0.14em] -mb-[0.14em] align-bottom"
        >
          <motion.span className="inline-block" variants={wordMask}>
            {word}
            {wordIdx < text.split(" ").length - 1 ? "\u00A0" : ""}
          </motion.span>
        </span>
      ))}
      {accent && (
        <motion.span
          aria-hidden="true"
          className="mt-[0.06em] block h-[0.085em] w-full origin-left rounded-full bg-gradient-to-r from-primary-fixed via-primary-container to-primary"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, ease: easeOutExpo, delay: lineDelay + 0.34 }}
        />
      )}
    </motion.span>
  );
}

export function HeroHeading({ lines, accentLine, trailingLines = [] }: HeroHeadingProps) {
  return (
    <motion.h1
      className="max-w-4xl text-balance text-[44px] font-black leading-[1.12] tracking-normal text-ink min-[390px]:text-[48px] sm:text-[64px] sm:leading-[1.08] lg:text-[84px]"
      initial="hidden"
      animate="visible"
      variants={headingContainer}
    >
      {lines.map((line, lineIdx) => (
        <MaskedLine key={lineIdx} text={line} lineDelay={lineIdx * 0.16} />
      ))}
      <MaskedLine text={accentLine} lineDelay={lines.length * 0.16} accent />
      {trailingLines.map((line, lineIdx) => (
        <MaskedLine key={`trailing-${lineIdx}`} text={line} lineDelay={(lines.length + 1 + lineIdx) * 0.16} />
      ))}
    </motion.h1>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero subtitle + question form wrapper with delayed entrance         */
/* ------------------------------------------------------------------ */

export function HeroSubtext({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      className="mt-6 max-w-2xl text-pretty text-[17px] leading-8 text-body sm:text-[20px]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: fastTransition, ease: easeOutExpo, delay: 0.42 }}
    >
      {children}
    </motion.p>
  );
}

/* ------------------------------------------------------------------ */
/*  Eyebrow label with live dot                                        */
/* ------------------------------------------------------------------ */

export function HeroEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      className="mb-6 flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: fastTransition, ease: easeOutExpo }}
    >
      <span
        aria-hidden="true"
        className="home-live-dot relative inline-flex h-2 w-2 shrink-0 rounded-full bg-primary-container"
      />
      {children}
    </motion.p>
  );
}

/* ------------------------------------------------------------------ */
/*  Workflow steps with scroll-triggered stagger                       */
/* ------------------------------------------------------------------ */

export function WorkflowSteps({ steps }: { steps: string[] }) {
  return (
    <motion.ol
      className="mt-8 flex max-w-3xl flex-col gap-2 border-l border-hairline pl-4 text-[13px] font-bold text-muted min-[520px]:flex-row min-[520px]:gap-5 min-[520px]:border-l-0 min-[520px]:pl-0"
      aria-label="리서치 작업 흐름"
      variants={staggerContainerFast}
      initial="hidden"
      animate="visible"
    >
      {steps.map((step, index) => (
        <motion.li
          key={step}
          className="min-w-0"
          variants={{
            hidden: { opacity: 0, y: 8 },
            visible: {
              opacity: 1,
              y: 0,
              transition: {
                duration: fastTransition,
                ease: easeOutExpo,
              },
            },
          }}
        >
          <span className="mr-2 font-mono text-[12px] text-primary">
            0{index + 1}
          </span>
          {step}
        </motion.li>
      ))}
    </motion.ol>
  );
}

/* ------------------------------------------------------------------ */
/*  Trace card fade-up entrance */
/* ------------------------------------------------------------------ */

export function TraceCardEntrance({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="relative min-w-0 max-w-full lg:sticky lg:top-28 lg:self-start"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: fastTransition, ease: easeOutExpo, delay: 0.02 }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Evidence cards stagger                                             */
/* ------------------------------------------------------------------ */

export function EvidenceCardsStagger({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="mt-5 divide-y divide-hairline border-y border-hairline"
      variants={staggerContainerFast}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

export function EvidenceCardItem({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: fastTransition, ease: easeOutExpo },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom insight block                                               */
/* ------------------------------------------------------------------ */

export function InsightBlock({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="mt-5 border-l-2 border-primary-container pl-4"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-20px" }}
      transition={{ duration: fastTransition, ease: easeOutExpo }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Question form entrance                                             */
/* ------------------------------------------------------------------ */

export function QuestionFormEntrance({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.44, ease: easeOutExpo, delay: 0.55 }}
    >
      {children}
    </motion.div>
  );
}
