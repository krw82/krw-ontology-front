"use client";

import { motion } from "motion/react";
import { easeOutExpo, duration, staggerContainer, fadeInUp } from "@/lib/animation";

/* ------------------------------------------------------------------ */
/*  Character-level stagger animation for the hero heading             */
/* ------------------------------------------------------------------ */

interface HeroHeadingProps {
  /** Primary lines rendered as normal text */
  lines: string[];
  /** Accent line rendered with accent color */
  accentLine: string;
  /** Trailing line(s) after the accent */
  trailingLines?: string[];
}

function splitChars(text: string) {
  return Array.from(text);
}

const charVariant = {
  hidden: { opacity: 0, y: 18, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.4, ease: easeOutExpo },
  },
};

const accentCharVariant = {
  hidden: { opacity: 0, y: 18, scale: 1.04, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.45, ease: easeOutExpo },
  },
};

export function HeroHeading({ lines, accentLine, trailingLines = [] }: HeroHeadingProps) {
  return (
    <motion.h1
      className="max-w-4xl text-balance text-[44px] font-black leading-[1.12] tracking-normal text-on-dark min-[390px]:text-[48px] sm:text-[64px] sm:leading-[1.08] lg:text-[84px]"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: 0.03,
            delayChildren: 0.15,
          },
        },
      }}
    >
      {lines.map((line, lineIdx) => (
        <span key={lineIdx}>
          {splitChars(line).map((char, charIdx) => (
            <motion.span
              key={`${lineIdx}-${charIdx}`}
              variants={charVariant}
              className="inline-block"
              style={{ whiteSpace: char === " " ? "pre" : undefined }}
            >
              {char}
            </motion.span>
          ))}
        </span>
      ))}
      <span className="block text-primary-fixed-dim">
        {splitChars(accentLine).map((char, charIdx) => (
          <motion.span
            key={`accent-${charIdx}`}
            variants={accentCharVariant}
            className="inline-block"
            style={{ whiteSpace: char === " " ? "pre" : undefined }}
          >
            {char}
          </motion.span>
        ))}
      </span>
      {trailingLines.map((line, lineIdx) => (
        <span key={`trailing-${lineIdx}`}>
          {splitChars(line).map((char, charIdx) => (
            <motion.span
              key={`trailing-${lineIdx}-${charIdx}`}
              variants={charVariant}
              className="inline-block"
              style={{ whiteSpace: char === " " ? "pre" : undefined }}
            >
              {char}
            </motion.span>
          ))}
        </span>
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
      className="mt-6 max-w-2xl text-pretty text-[17px] leading-8 text-on-dark-soft sm:text-[20px]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: easeOutExpo, delay: 0.6 }}
    >
      {children}
    </motion.p>
  );
}

/* ------------------------------------------------------------------ */
/*  Eyebrow label fade-in                                              */
/* ------------------------------------------------------------------ */

export function HeroEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      className="mb-6 font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary-fixed-dim"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.normal, ease: easeOutExpo, delay: 0.05 }}
    >
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
      className="mt-8 flex max-w-3xl flex-col gap-2 border-l border-white/15 pl-4 text-[13px] font-bold text-on-dark-soft min-[520px]:flex-row min-[520px]:gap-5 min-[520px]:border-l-0 min-[520px]:pl-0"
      aria-label="리서치 작업 흐름"
      variants={staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
    >
      {steps.map((step, index) => (
        <motion.li key={step} className="min-w-0" variants={fadeInUp}>
          <span className="mr-2 font-mono text-[12px] text-primary-fixed-dim">
            0{index + 1}
          </span>
          {step}
        </motion.li>
      ))}
    </motion.ol>
  );
}

/* ------------------------------------------------------------------ */
/*  Evidence card slide-in from right                                  */
/* ------------------------------------------------------------------ */

export function TraceCardEntrance({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="relative min-w-0 max-w-full lg:sticky lg:top-28 lg:self-start"
      initial={{ opacity: 0, x: 40, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: duration.hero, ease: easeOutExpo, delay: 0.35 }}
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
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

export function EvidenceCardItem({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={fadeInUp}>
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
      transition={{ duration: duration.slow, ease: easeOutExpo }}
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: easeOutExpo, delay: 0.7 }}
    >
      {children}
    </motion.div>
  );
}
