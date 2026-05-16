/**
 * Shared Motion variants for the KRW Ontology design system.
 *
 * Every animation across the app should import from here to ensure
 * consistent easing, duration, and stagger values.
 *
 * Usage:
 *   import { fadeInUp, staggerContainer } from "@/lib/animation";
 *   <motion.div variants={staggerContainer} initial="hidden" animate="visible">
 *     <motion.div variants={fadeInUp} />
 *   </motion.div>
 */

import type { Variants } from "motion/react";

type CubicBezier = [number, number, number, number];

/* ------------------------------------------------------------------ */
/*  Easing curves (mirror the CSS tokens in globals.css)               */
/* ------------------------------------------------------------------ */

export const easeOutExpo: CubicBezier = [0.16, 1, 0.3, 1];
export const easeOutQuart: CubicBezier = [0.25, 1, 0.5, 1];
export const easeSpring: CubicBezier = [0.34, 1.56, 0.64, 1];

/* ------------------------------------------------------------------ */
/*  Durations (seconds, for Motion – mirrors the CSS ms tokens)        */
/* ------------------------------------------------------------------ */

export const duration = {
  fast: 0.15,
  normal: 0.3,
  slow: 0.5,
  hero: 0.8,
} as const;

/* ------------------------------------------------------------------ */
/*  Fade variants                                                      */
/* ------------------------------------------------------------------ */

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: duration.normal, ease: easeOutQuart },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.normal, ease: easeOutExpo },
  },
};

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.normal, ease: easeOutExpo },
  },
};

/* ------------------------------------------------------------------ */
/*  Slide variants                                                     */
/* ------------------------------------------------------------------ */

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: duration.normal, ease: easeOutExpo },
  },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: duration.slow, ease: easeOutExpo },
  },
};

/* ------------------------------------------------------------------ */
/*  Scale                                                              */
/* ------------------------------------------------------------------ */

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: duration.normal, ease: easeOutExpo },
  },
};

/* ------------------------------------------------------------------ */
/*  Stagger containers                                                 */
/* ------------------------------------------------------------------ */

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const staggerContainerFast: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Chat-specific                                                      */
/* ------------------------------------------------------------------ */

export const chatMessageUser: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.14, ease: easeOutExpo },
  },
};

export const chatMessageAssistant: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.14, ease: easeOutExpo },
  },
};

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

export const sidebarPanel: Variants = {
  hidden: { x: "-100%" },
  visible: {
    x: 0,
    transition: { duration: duration.normal, ease: easeOutExpo },
  },
  exit: {
    x: "-100%",
    transition: { duration: 0.2, ease: easeOutQuart },
  },
};

export const sidebarBackdrop: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2 },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15 },
  },
};
