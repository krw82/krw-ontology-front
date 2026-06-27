"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { dispatchOpenChatSidebar } from "@/lib/chat/sidebar-events";
import { easeOutExpo } from "@/lib/animation";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { getPathLocale } from "@/i18n/routing";
import type { Locale } from "@/i18n/config";

const TOUR_STORAGE_VERSION = "v1";
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
  | "company-search"
  | "stock-discovery-cta"
  | "stock-discovery-nav"
  | "research-notebook-nav"
  | "chat-context"
  | "chat-wide-research"
  | "chat-starters"
  | "chat-composer"
  | "chat-notebook";

interface TourStep {
  id: TourStepId;
  selector: string;
  icon: string;
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
  tour?: "companies" | "chat";
  force?: boolean;
}

const companyTourSteps: TourStep[] = [
  {
    id: "company-search",
    selector: '[data-onboarding-target="company-search"]',
    icon: "search",
    title: {
      ko: "회사를 알고 있다면 검색부터",
      en: "Start with search when you know the company",
    },
    body: {
      ko: "AAPL, 애플, 브로드컴처럼 티커나 회사명을 입력하면 해당 회사 리서치로 바로 이어집니다.",
      en: "Enter a ticker or company name like AAPL, Apple, or Broadcom to start company research directly.",
    },
  },
  {
    id: "stock-discovery-cta",
    selector: '[data-onboarding-target="stock-discovery-cta"]',
    icon: "travel_explore",
    title: {
      ko: "회사를 모르면 종목 발굴기",
      en: "Use discovery when you do not know the stock",
    },
    body: {
      ko: "산업, 리스크, 재무 조건을 넣으면 여러 회사를 비교해 후보를 좁힙니다.",
      en: "Add an industry, risk, or financial condition to compare multiple companies and narrow the candidate list.",
    },
  },
  {
    id: "stock-discovery-nav",
    selector:
      '[data-onboarding-target="stock-discovery-nav"], [data-onboarding-target="stock-discovery-sidebar"], [data-onboarding-target="sidebar-trigger"]',
    icon: "menu_open",
    title: {
      ko: "조건이 구체적일수록 빨라집니다",
      en: "Specific conditions make discovery faster",
    },
    body: {
      ko: "“지금 살만한 기업”보다 “AI 투자 수혜지만 부채 부담이 낮은 기업”처럼 시작하면 더 정확합니다.",
      en: "Instead of asking for any stock to buy now, start with a condition like AI beneficiaries with lower debt burden.",
    },
  },
  {
    id: "research-notebook-nav",
    selector:
      '[data-onboarding-target="research-notebook-nav"], [data-onboarding-target="research-notebook-sidebar"], [data-onboarding-target="sidebar-trigger"]',
    icon: "article",
    title: {
      ko: "리서치 노트북은 이어보기 공간입니다",
      en: "Research notebook is where you continue",
    },
    body: {
      ko: "관심·보유 종목과 이전 질문을 모아두고 다음에 이어서 볼 때 사용합니다.",
      en: "Use the notebook to continue from watched companies, holdings, and past questions.",
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
      ko: "회사 페이지에서 들어오면 그 회사 기준으로 깊게 봅니다. 회사가 없다면 여러 회사를 넓게 훑는 질문으로 시작합니다.",
      en: "When you enter from a company page, chat goes deep on that company. Without one, it starts as broader multi-company research.",
    },
  },
  {
    id: "chat-wide-research",
    selector:
      '[data-onboarding-target="chat-empty-heading"], [data-onboarding-target="chat-suggested-prompts"], [data-onboarding-target="wide-research-sidebar"], [data-onboarding-target="chat-composer"]',
    icon: "hub",
    title: {
      ko: "와이드 리서치는 여러 회사를 동시에 봅니다",
      en: "Wide research checks multiple companies at once",
    },
    body: {
      ko: "일반 회사 채팅보다 더 걸릴 수 있지만, 아이디어·산업·리스크 조건으로 후보와 비교축을 함께 잡을 수 있습니다.",
      en: "It can take longer than single-company chat, but it can find candidates and comparison angles from an idea, industry, or risk condition.",
    },
  },
  {
    id: "chat-starters",
    selector:
      '[data-onboarding-target="chat-suggested-prompts"], [data-onboarding-target="chat-composer"]',
    icon: "format_list_bulleted",
    title: {
      ko: "처음엔 추천 질문으로 흐름을 잡으세요",
      en: "Use starter questions to set the direction",
    },
    body: {
      ko: "무엇을 물어야 할지 애매하면 추천 질문으로 시작하세요. 답변 끝의 이어서 볼 질문도 바로 다음 질문으로 쓸 수 있습니다.",
      en: "If the next question is unclear, start from suggested prompts. Follow-up prompts after answers can be sent as the next question.",
    },
  },
  {
    id: "chat-composer",
    selector:
      '[data-onboarding-target="chat-composer"], [data-onboarding-target="chat-composer-input"]',
    icon: "edit",
    title: {
      ko: "질문과 자료는 아래 입력창에서",
      en: "Ask and attach context from the composer",
    },
    body: {
      ko: "질문을 이어서 쓰고, 필요하면 + 버튼으로 URL이나 파일을 붙여 분석에 필요한 맥락을 보강할 수 있습니다.",
      en: "Continue questions here, or use the + button to add URLs and files as extra context for analysis.",
    },
  },
  {
    id: "chat-notebook",
    selector:
      '[data-onboarding-target="chat-notebook-actions"], [data-onboarding-target="research-notebook-nav"], [data-onboarding-target="research-notebook-sidebar"], [data-onboarding-target="sidebar-trigger"]',
    icon: "article",
    title: {
      ko: "중요한 리서치는 노트북에 남기세요",
      en: "Save important research to the notebook",
    },
    body: {
      ko: "관심·보유로 저장하면 리서치 노트북에서 종목별 질문과 메모를 이어서 관리할 수 있습니다.",
      en: "Mark companies as watched or held, then continue notes and questions in the research notebook.",
    },
  },
];

export default function ProductOnboardingTour({
  pathname,
  tour = "companies",
  force = false,
}: ProductOnboardingTourProps) {
  const locale = getPathLocale(pathname) ?? "ko";
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDirection, setStepDirection] = useState(1);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [userStorageKey, setUserStorageKey] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const steps = tour === "chat" ? chatTourSteps : companyTourSteps;

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
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 220);

    if (IS_DEV_ENV || force) {
      setIsAuthenticated(true);
      setUserStorageKey(`${TOUR_STORAGE_PREFIX}:${tour}:dev`);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }

    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (cancelled) return;
        setIsAuthenticated(Boolean(user));
        setUserStorageKey(
          user ? `${TOUR_STORAGE_PREFIX}:${tour}:${user.id}` : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setIsAuthenticated(false);
          setUserStorageKey(null);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [force, tour]);

  useEffect(() => {
    setStepDirection(1);
    setStepIndex(0);
  }, [tour]);

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    if (IS_DEV_ENV || force) {
      setVisible(true);
      return;
    }
    if (!userStorageKey) return;

    try {
      if (window.localStorage.getItem(userStorageKey) === "1") return;
    } catch {
      // If storage is unavailable, still show once for this page view.
    }

    setVisible(true);
  }, [force, isAuthenticated, ready, userStorageKey]);

  const completeTour = useCallback(() => {
    if (userStorageKey) {
      try {
        window.localStorage.setItem(userStorageKey, "1");
      } catch {
        // Non-critical; onboarding can reappear if storage is unavailable.
      }
    }
    setVisible(false);
  }, [userStorageKey]);

  const goToNextStep = useCallback(() => {
    if (isLastStep) {
      completeTour();
      return;
    }
    setStepDirection(1);
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }, [completeTour, isLastStep, steps.length]);

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

    if (isMobileViewport() && needsMobileSidebar(currentStep.id)) {
      dispatchOpenChatSidebar();
    }

    updateSpotlight();
    const retryTimers = [80, 220, 420].map((delay) =>
      window.setTimeout(updateSpotlight, delay),
    );

    window.addEventListener("resize", updateSpotlight);
    window.addEventListener("scroll", updateSpotlight, true);
    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", updateSpotlight);
      window.removeEventListener("scroll", updateSpotlight, true);
    };
  }, [currentStep.id, updateSpotlight, visible]);

  if (!visible) return null;

  const cardPosition = getCardPosition(spotlight);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1100]" role="dialog" aria-modal="true">
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
              <div className="flex items-start gap-sm">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined mt-[2px] grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-surface-dark text-[20px] text-on-dark"
                >
                  {currentStep.icon}
                </span>
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
              </div>

              <div className="mt-base flex items-center justify-between gap-xs">
                <button
                  type="button"
                  className="inline-flex h-10 items-center rounded-[8px] px-sm text-[13px] font-bold text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={completeTour}
                >
                  {copy.skip}
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-surface-dark px-sm text-[13px] font-bold text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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

function needsMobileSidebar(stepId: TourStepId): boolean {
  if (stepId === "chat-notebook") {
    return !findVisibleTarget('[data-onboarding-target="chat-notebook-actions"]');
  }

  return (
    stepId === "stock-discovery-nav" ||
    stepId === "research-notebook-nav"
  );
}

function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 767px)").matches;
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
