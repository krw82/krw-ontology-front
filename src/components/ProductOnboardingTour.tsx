"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { dispatchOpenWorkspaceMenu } from "@/lib/navigation/workspace-menu-events";
import { easeOutExpo } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { getPathLocale } from "@/i18n/routing";
import type { Locale } from "@/i18n/config";

const TOUR_STORAGE_VERSION = "v2";
const TOUR_STORAGE_PREFIX = `krw:onboarding:product-tour:${TOUR_STORAGE_VERSION}`;
const IS_DEV_ENV = process.env.NODE_ENV === "development";
const SPOTLIGHT_PADDING = 8;
const CARD_WIDTH = 340;
const CARD_HEIGHT_ESTIMATE = 236;
const spotlightTransition = {
  duration: 0.42,
  ease: easeOutExpo,
} as const;
const cardTransition = {
  duration: 0.34,
  ease: easeOutExpo,
} as const;

type TourStepId =
  | "pulse-feed-cards"
  | "pulse-activity-rail"
  | "pulse-follow"
  | "menu-now"
  | "menu-explore"
  | "menu-monitor"
  | "company-search"
  | "chat-context"
  | "chat-starters"
  | "guru-lens"
  | "guru-company"
  | "guru-question"
  | "guru-composer";

interface TourStep {
  id: TourStepId;
  selector: string;
  icon: string;
  /** Steps that highlight a workspace-menu group need the mobile drawer open. */
  opensMobileMenu?: boolean;
  title: Record<Locale, string>;
  body: Record<Locale, string>;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ProductOnboardingTourProps {
  pathname: string;
  tour?: "pulse" | "companies" | "chat" | "guru-directory" | "guru-chat";
  force?: boolean;
  continuePath?: string | null;
}

/**
 * First-visit spotlight tours.
 *
 * Each surface (pulse, companies, chat, guru) has its own short tour that
 * auto-starts once per browser on first visit — in production too. The pulse
 * tour is the main one: it explains the feed, then walks the workspace menu
 * group by group (now / explore / monitor). On mobile the menu drawer slides
 * open for the group steps. `?tour=1` still forces a replay for demos.
 */
const pulseTourSteps: TourStep[] = [
  {
    id: "pulse-feed-cards",
    selector: '[data-onboarding-target="pulse-feed-list"]',
    icon: "dynamic_feed",
    title: {
      ko: "오늘 확인할 질문이 이 피드에 쌓여요",
      en: "Today's questions stack up in this feed",
    },
    body: {
      ko: "매일 확인할 만한 질문 카드가 정해집니다. 누르면 공시 근거 리서치가 바로 실행돼요.",
      en: "Cards worth checking are picked each day. Tap one and filing-grounded research runs right away.",
    },
  },
  {
    id: "pulse-activity-rail",
    selector:
      '[data-onboarding-target="research-activity-rail"], [data-onboarding-target="pulse-feed-list"]',
    icon: "route",
    title: {
      ko: "진행 중·완료된 리서치는 여기서 이어보세요",
      en: "Continue research from here",
    },
    body: {
      ko: "리서치가 끝나면 결과가 피드로 돌아옵니다. 완료된 답변은 카드에서 바로 열어볼 수 있어요.",
      en: "Finished research returns to the feed. Open completed answers straight from the cards.",
    },
  },
  {
    id: "pulse-follow",
    selector:
      '[data-onboarding-target="watchlist-story-tray"], [data-onboarding-target="pulse-feed-list"]',
    icon: "notifications",
    title: {
      ko: "관심 기업을 지정하면 알림이 와요",
      en: "Follow companies to get alerts",
    },
    body: {
      ko: "회사에 관심을 표시하면 새 공시와 리서치 소식을 알림으로 받아요. 무료 3개, 유료는 무제한입니다.",
      en: "Follow a company and its new filings and research arrive as alerts. Free covers three; paid is unlimited.",
    },
  },
  {
    id: "menu-now",
    selector:
      "[data-onboarding-group=\"now\"], [data-onboarding-target=\"market-issues-nav\"], [data-onboarding-target=\"workspace-menu-trigger\"]",
    icon: "dynamic_feed",
    opensMobileMenu: true,
    title: {
      ko: "지금 — 피드와 뉴스",
      en: "Now — feed and news",
    },
    body: {
      ko: "오늘 확인할 거리는 피드와 뉴스에 쌓입니다. 뉴스는 호재인지 악재인지 함께 짚어줘요.",
      en: "Today's checks land in the feed and news. News cards weigh whether a story helps or hurts.",
    },
  },
  {
    id: "menu-explore",
    selector:
      "[data-onboarding-group=\"explore\"], [data-onboarding-target=\"guru-advisor-nav\"], [data-onboarding-target=\"workspace-menu-trigger\"]",
    icon: "travel_explore",
    opensMobileMenu: true,
    title: {
      ko: "탐색 — 첫 질문은 회사에서 시작",
      en: "Explore — start the first question from a company",
    },
    body: {
      ko: "처음 질문은 회사를 골라 시작하는 게 가장 편해요. 버핏·막스 같은 관점으로 점검하거나, 조건으로 여러 회사를 좁혀보는 것도 여기 있습니다.",
      en: "For your first question, picking a company is the easiest start. Pressure-test through lenses like Buffett or Marks, or narrow many companies by criteria — all from here.",
    },
  },
  {
    id: "menu-monitor",
    selector:
      "[data-onboarding-group=\"monitor\"], [data-onboarding-target=\"institutional-holdings-nav\"], [data-onboarding-target=\"workspace-menu-trigger\"]",
    icon: "monitoring",
    opensMobileMenu: true,
    title: {
      ko: "추적 — 13F 보유",
      en: "Monitor — 13F holdings",
    },
    body: {
      ko: "기관이 새로 담거나 뺀 주식을 보고, 다음에 확인할 회사와 질문을 정해보세요.",
      en: "See what institutions added or trimmed, then pick the next companies and questions to check.",
    },
  },
];

const companiesTourSteps: TourStep[] = [
  {
    id: "company-search",
    selector:
      '[data-onboarding-target="company-search"], [data-onboarding-target="company-search-nav"], [data-onboarding-target="workspace-menu-trigger"]',
    icon: "search",
    title: {
      ko: "회사명·티커를 검색해 바로 시작하세요",
      en: "Search a name or ticker to start",
    },
    body: {
      ko: "회사를 고르면 공시·실적·리스크 리서치가 그 회사 맥락으로 시작됩니다.",
      en: "Pick a company and filing, earnings, and risk research starts in that company's context.",
    },
  },
];

const chatTourSteps: TourStep[] = [
  {
    id: "chat-context",
    selector:
      '[data-onboarding-target="chat-context"], [data-onboarding-target="chat-empty-heading"], [data-onboarding-target="chat-composer"]',
    icon: "business_center",
    title: {
      ko: "채팅은 현재 리서치 맥락에서 시작합니다",
      en: "Chat starts from the current research context",
    },
    body: {
      ko: "회사 페이지에서 들어오면 그 회사 기준으로 봅니다. 뉴스나 가격 질문도 결국 매출, 마진, 현금흐름, 리스크로 이어서 확인할 수 있습니다.",
      en: "From a company page, chat starts with that company. News or price questions can then continue into revenue, margin, cash-flow, and risk checks.",
    },
  },
  {
    id: "chat-starters",
    selector:
      '[data-onboarding-target="chat-suggested-prompts"], [data-onboarding-target="chat-composer"]',
    icon: "format_list_bulleted",
    title: {
      ko: "처음엔 시작 질문으로 흐름을 잡으세요",
      en: "Use starter questions to set the direction",
    },
    body: {
      ko: "무엇을 물어야 할지 애매하면 시작 질문으로 시작하세요. 답변 끝의 이어서 볼 질문은 그대로 눌러 다음 리서치로 이어갈 수 있습니다.",
      en: "If the next question is unclear, start from suggested prompts. Follow-up prompts after answers are written so you can send them directly.",
    },
  },
];

const guruDirectoryTourSteps: TourStep[] = [
  {
    id: "guru-lens",
    selector: '[data-onboarding-target="guru-lens-cards"]',
    icon: "psychology",
    title: {
      ko: "먼저 분석 관점을 고릅니다",
      en: "Start by choosing an analysis perspective",
    },
    body: {
      ko: "버핏, 하워드 막스, 애크먼처럼 서로 다른 질문법으로 같은 회사를 다르게 점검할 수 있습니다. 잘 모르겠으면 자동 선택으로 시작해도 됩니다.",
      en: "Check the same company through different question frames, such as Buffett, Howard Marks, or Ackman. If unsure, start with Auto.",
    },
  },
];

const guruChatTourSteps: TourStep[] = [
  {
    id: "guru-company",
    selector:
      '[data-onboarding-target="guru-company-tool"], [data-onboarding-target="guru-company-picker"], [data-onboarding-target="chat-composer-tools"], [data-onboarding-target="chat-context"]',
    icon: "domain",
    title: {
      ko: "회사 컨텍스트를 같이 넣으세요",
      en: "Add company context",
    },
    body: {
      ko: "회사를 선택하면 최신 보고서가 분석 배경에 들어갑니다. 관점만 보는 게 아니라, 실제 회사 근거와 함께 봅니다.",
      en: "Choose a company to bring its latest filings into the analysis. The answer combines the perspective with company evidence.",
    },
  },
  {
    id: "guru-question",
    selector:
      '[data-onboarding-target="guru-suggested-prompts"], [data-onboarding-target="chat-composer"]',
    icon: "format_list_bulleted",
    title: {
      ko: "시작 질문은 가정 점검용입니다",
      en: "Starter questions pressure-test assumptions",
    },
    body: {
      ko: "“좋은 회사일까?”보다 “어떤 조건에서 판단을 바꿀까?”처럼 물으면 분석 결과가 더 좋아집니다.",
      en: "Instead of only asking whether a company is good, ask what would change the judgment for a stronger analysis.",
    },
  },
  {
    id: "guru-composer",
    selector:
      '[data-onboarding-target="chat-composer"], [data-onboarding-target="chat-composer-input"]',
    icon: "edit",
    title: {
      ko: "분석은 판단 조건을 정리하는 용도입니다",
      en: "Use analysis to clarify judgment conditions",
    },
    body: {
      ko: "관점별 분석은 결론을 대신 내리는 곳이 아니라, 좋은 점·의심할 점·판단이 바뀌는 조건을 정리하는 공간입니다.",
      en: "Perspective analysis does not make the decision for you. It helps organize strengths, doubts, and what would change the judgment.",
    },
  },
];

function getTourSteps(tour: ProductOnboardingTourProps["tour"]): TourStep[] {
  if (tour === "pulse") return pulseTourSteps;
  if (tour === "companies") return companiesTourSteps;
  if (tour === "chat") return chatTourSteps;
  if (tour === "guru-directory") return guruDirectoryTourSteps;
  if (tour === "guru-chat") return guruChatTourSteps;
  return companiesTourSteps;
}

function tourSeenKey(tour: string): string {
  return `${TOUR_STORAGE_PREFIX}:${tour}`;
}

function devSessionSeenKey(tour: string): string {
  return `${tourSeenKey(tour)}:dev-session`;
}

function hasStorageValue(key: string | null): boolean {
  if (!key || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export default function ProductOnboardingTour({
  pathname,
  tour = "companies",
  force = false,
  continuePath = null,
}: ProductOnboardingTourProps) {
  const router = useRouter();
  const locale = getPathLocale(pathname) ?? "ko";
  const reducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDirection, setStepDirection] = useState(1);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const steps = getTourSteps(tour);

  const currentStep = steps[stepIndex] ?? steps[0];
  const isLastStep = stepIndex >= steps.length - 1;
  const copy = useMemo(
    () =>
      locale === "ko"
        ? {
            eyebrow: "처음 사용 가이드",
            next: "다음",
            done: "시작하기",
            skip: "건너뛰기",
            count: `${stepIndex + 1} / ${steps.length}`,
          }
        : {
            eyebrow: "Quick start",
            next: "Next",
            done: "Start",
            skip: "Skip",
            count: `${stepIndex + 1} / ${steps.length}`,
          },
    [locale, stepIndex, steps.length],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setStepDirection(1);
      setStepIndex(0);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [tour]);

  // First visit per surface (and once per dev session) auto-starts the tour.
  useEffect(() => {
    if (!force && hasStorageValue(tourSeenKey(tour))) return;
    if (
      !force &&
      IS_DEV_ENV &&
      hasStorageValue(devSessionSeenKey(tour))
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => setVisible(true), force ? 0 : 220);
    return () => window.clearTimeout(timeoutId);
  }, [force, tour]);

  const completeTour = useCallback(() => {
    try {
      window.localStorage.setItem(tourSeenKey(tour), "1");
      window.sessionStorage.setItem(devSessionSeenKey(tour), "1");
    } catch {
      // Non-critical; the tour can reappear if storage is unavailable.
    }
    setVisible(false);
    const safeContinuePath = normalizeContinuePath(continuePath);
    if (safeContinuePath) {
      router.replace(safeContinuePath, { scroll: false });
      return;
    }
    // A forced replay (?tour=1) cleans the flag so a refresh or a repeated
    // menu click starts fresh instead of silently re-running the tour.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("tour")) {
        url.searchParams.delete("tour");
        router.replace(`${url.pathname}${url.search}` || url.pathname, {
          scroll: false,
        });
      }
    }
  }, [continuePath, router, tour]);

  const goToNextStep = useCallback(() => {
    if (isLastStep) {
      completeTour();
      return;
    }
    setStepDirection(1);
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }, [completeTour, isLastStep, steps.length]);

  // Escape closes; Tab stays inside the card.
  useEffect(() => {
    if (!visible) return;
    const node = dialogRef.current;
    node
      ?.querySelector<HTMLButtonElement>("[data-tour-next]")
      ?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        completeTour();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        node?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).filter((button) => !button.disabled);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [completeTour, stepIndex, visible]);

  const updateSpotlight = useCallback(() => {
    if (!visible) return;
    const target = findVisibleTarget(currentStep.selector);
    if (!target) {
      setSpotlight(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const paddedTop = Math.max(0, rect.top - SPOTLIGHT_PADDING);
    const paddedLeft = Math.max(0, rect.left - SPOTLIGHT_PADDING);
    const paddedRight = Math.min(
      window.innerWidth,
      rect.right + SPOTLIGHT_PADDING,
    );
    const paddedBottom = Math.min(
      window.innerHeight,
      rect.bottom + SPOTLIGHT_PADDING,
    );

    setSpotlight({
      top: paddedTop,
      left: paddedLeft,
      width: Math.max(0, paddedRight - paddedLeft),
      height: Math.max(0, paddedBottom - paddedTop),
    });
  }, [currentStep.selector, visible]);

  useEffect(() => {
    if (!visible) return;

    if (
      isMobileViewport() &&
      (currentStep.opensMobileMenu || needsMobileWorkspaceMenu(currentStep.id))
    ) {
      dispatchOpenWorkspaceMenu();
    }

    const frameId = window.requestAnimationFrame(updateSpotlight);
    const retryTimers = [80, 220, 420].map((delay) =>
      window.setTimeout(updateSpotlight, delay),
    );

    window.addEventListener("resize", updateSpotlight);
    window.addEventListener("scroll", updateSpotlight, true);
    return () => {
      window.cancelAnimationFrame(frameId);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", updateSpotlight);
      window.removeEventListener("scroll", updateSpotlight, true);
    };
  }, [currentStep, updateSpotlight, visible]);

  if (!visible) return null;

  const cardPosition = getCardPosition(spotlight);

  return (
    <AnimatePresence>
      <div
        ref={dialogRef}
        className="fixed inset-0 z-[1100]"
        role="dialog"
        aria-modal="true"
      >
        <SpotlightOverlay
          rect={spotlight}
          reducedMotion={reducedMotion}
          stepKey={`${tour}-${currentStep.id}`}
        />
        <motion.div
          layout
          className="fixed z-[1110] w-[min(calc(100vw-32px),340px)] rounded-[8px] border border-hairline bg-canvas p-base shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
          style={{ left: 0, top: 0 }}
          initial={{
            opacity: 0,
            x: cardPosition.left,
            y: cardPosition.top + (reducedMotion ? 0 : 10),
            scale: 0.98,
          }}
          animate={{
            opacity: 1,
            x: cardPosition.left,
            y: cardPosition.top,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: cardPosition.top + (reducedMotion ? 0 : 6),
            scale: 0.98,
          }}
          transition={reducedMotion ? { duration: 0 } : cardTransition}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentStep.id}
              initial={{
                opacity: reducedMotion ? 1 : 0,
                y: reducedMotion ? 0 : stepDirection * 6,
              }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: reducedMotion ? 1 : 0,
                y: reducedMotion ? 0 : stepDirection * -4,
              }}
              transition={{
                duration: reducedMotion ? 0 : 0.18,
                ease: easeOutExpo,
              }}
            >
              <div className="min-w-0">
                  <div className="flex items-center gap-xs">
                    <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                      {copy.eyebrow}
                    </p>
                    <span className="font-mono text-[10px] font-bold text-muted">
                      {copy.count}
                    </span>
                  </div>
                  <h2 className="mt-1 text-[17px] font-black leading-[1.25] tracking-normal text-ink">
                    {currentStep.title[locale]}
                  </h2>
                  <p className="mt-2 text-[13px] font-medium leading-5 text-body">
                    {currentStep.body[locale]}
                  </p>
              </div>

              <div className="mt-base flex items-center justify-between gap-xs">
                <button
                  type="button"
                  className="inline-flex h-11 items-center rounded-[8px] px-sm text-[13px] font-bold text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={completeTour}
                >
                  {copy.skip}
                </button>
                <button
                  type="button"
                  data-tour-next=""
                  className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-surface-dark px-sm text-[13px] font-bold text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  onClick={goToNextStep}
                >
                  <span>{isLastStep ? copy.done : copy.next}</span>
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[18px]"
                  >
                    {isLastStep ? "check" : "arrow_forward"}
                  </span>
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function SpotlightOverlay({
  rect,
  reducedMotion,
  stepKey,
}: {
  rect: SpotlightRect | null;
  reducedMotion: boolean;
  stepKey: string;
}) {
  if (!rect) {
    return (
      <motion.div
        className="fixed inset-0 bg-black/68"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.18, ease: easeOutExpo }}
      />
    );
  }

  const bottomTop = rect.top + rect.height;
  const rightLeft = rect.left + rect.width;

  return (
    <>
      <motion.div
        className="fixed left-0 right-0 top-0 bg-black/68"
        initial={{ opacity: 0, height: rect.top }}
        animate={{ opacity: 1, height: rect.top }}
        transition={reducedMotion ? { duration: 0 } : spotlightTransition}
      />
      <motion.div
        className="fixed left-0 bg-black/68"
        initial={{
          opacity: 0,
          top: rect.top,
          width: rect.left,
          height: rect.height,
        }}
        animate={{
          opacity: 1,
          top: rect.top,
          width: rect.left,
          height: rect.height,
        }}
        transition={reducedMotion ? { duration: 0 } : spotlightTransition}
      />
      <motion.div
        className="fixed right-0 bg-black/68"
        initial={{
          opacity: 0,
          top: rect.top,
          left: rightLeft,
          height: rect.height,
        }}
        animate={{
          opacity: 1,
          top: rect.top,
          left: rightLeft,
          height: rect.height,
        }}
        transition={reducedMotion ? { duration: 0 } : spotlightTransition}
      />
      <motion.div
        className="fixed bottom-0 left-0 right-0 bg-black/68"
        initial={{ opacity: 0, top: bottomTop }}
        animate={{ opacity: 1, top: bottomTop }}
        transition={reducedMotion ? { duration: 0 } : spotlightTransition}
      />
      <motion.div
        key={stepKey}
        aria-hidden="true"
        className="pointer-events-none fixed rounded-[10px] border-2 border-primary"
        initial={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          opacity: reducedMotion ? 0 : 0,
          scale: 1,
        }}
        animate={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          opacity: reducedMotion ? 0 : [0, 0.72, 0],
          scale: reducedMotion ? 1 : [1, 1.028, 1.052],
        }}
        transition={
          reducedMotion ? { duration: 0 } : { duration: 0.72, ease: easeOutExpo }
        }
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-[10px] border-2 border-primary shadow-[0_0_0_1px_rgba(255,255,255,0.72),0_0_0_8px_rgba(0,82,255,0.18),0_20px_60px_rgba(0,0,0,0.25)]"
        initial={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          opacity: 0,
          scale: reducedMotion ? 1 : 0.992,
        }}
        animate={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          opacity: 1,
          scale: 1,
        }}
        transition={reducedMotion ? { duration: 0 } : spotlightTransition}
      />
    </>
  );
}

function findVisibleTarget(selector: string): Element | null {
  for (const selectorPart of selector.split(",")) {
    const candidates = Array.from(document.querySelectorAll(selectorPart.trim()));
    const visibleTarget = candidates.find(isVisibleTarget);
    if (visibleTarget) return visibleTarget;
  }

  return null;
}

function isVisibleTarget(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0
  );
}

function needsMobileWorkspaceMenu(stepId: TourStepId): boolean {
  return (
    stepId === "company-search" ||
    stepId === "guru-company" ||
    stepId === "guru-question" ||
    stepId === "guru-composer"
  );
}

function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 767px)").matches;
}

function normalizeContinuePath(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("/auth/") || trimmed.startsWith("/login")) return null;
  return trimmed;
}

function getCardPosition(rect: SpotlightRect | null): {
  left: number;
  top: number;
} {
  if (!rect) {
    return {
      left: Math.max(16, (window.innerWidth - CARD_WIDTH) / 2),
      top: Math.max(88, (window.innerHeight - CARD_HEIGHT_ESTIMATE) / 2),
    };
  }

  const left = clamp(
    rect.left + rect.width / 2 - CARD_WIDTH / 2,
    16,
    Math.max(16, window.innerWidth - CARD_WIDTH - 16),
  );
  const belowTop = rect.top + rect.height + 16;
  const aboveTop = rect.top - CARD_HEIGHT_ESTIMATE - 16;
  const top =
    belowTop + CARD_HEIGHT_ESTIMATE < window.innerHeight - 16
      ? belowTop
      : aboveTop > 16
        ? aboveTop
        : 16;

  return { left, top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
