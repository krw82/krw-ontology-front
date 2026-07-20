"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { dispatchOpenWorkspaceMenu } from "@/lib/navigation/workspace-menu-events";
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
  | "research-notebook-nav"
  | "stock-discovery-nav"
  | "guru-advisor-nav"
  | "company-search-nav"
  | "wide-research-nav"
  | "institutional-holdings-nav"
  | "chat-context"
  | "chat-wide-research"
  | "chat-starters"
  | "chat-composer"
  | "chat-notebook"
  | "guru-lens"
  | "guru-company"
  | "guru-question"
  | "guru-composer";

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
  tour?: "companies" | "chat" | "guru-directory" | "guru-chat";
  force?: boolean;
  continuePath?: string | null;
}

const companyTourSteps: TourStep[] = [
  {
    id: "research-notebook-nav",
    selector:
      '[data-onboarding-target="research-notebook-nav"], [data-onboarding-target="workspace-menu-trigger"]',
    icon: "article",
    title: {
      ko: "리서치 노트북은 이어보기 공간입니다",
      en: "Research notebook is where you continue",
    },
    body: {
      ko: "관심·보유 종목과 이전 질문을 모아두고, 나중에 같은 맥락에서 다시 이어볼 때 사용합니다.",
      en: "Use the notebook to keep watched companies, holdings, and past questions so you can continue from the same context later.",
    },
  },
  {
    id: "stock-discovery-nav",
    selector:
      '[data-onboarding-target="stock-discovery-nav"], [data-onboarding-target="workspace-menu-trigger"]',
    icon: "travel_explore",
    title: {
      ko: "조건으로 기업을 검색하세요",
      en: "Search companies by criteria",
    },
    body: {
      ko: "아이디어, 산업, 리스크, 재무 조건을 넣으면 여러 회사를 비교해 리서치 범위를 좁힙니다. 조건이 구체적일수록 더 빠르고 정확합니다.",
      en: "Add an idea, industry, risk, or financial condition to compare companies and narrow the research scope. More specific conditions make it faster.",
    },
  },
  {
    id: "guru-advisor-nav",
    selector:
      '[data-onboarding-target="guru-advisor-nav"], [data-onboarding-target="guru-advisor-cta"], [data-onboarding-target="workspace-menu-trigger"]',
    icon: "psychology",
    title: {
      ko: "공개 원칙으로 아이디어 점검",
      en: "Check ideas with public principles",
    },
    body: {
      ko: "버핏, 하워드 막스처럼 공개된 질문 원칙으로 회사나 아이디어의 좋은 점과 의심할 점을 다시 정리합니다.",
      en: "Reframe a company or idea through public question principles such as Buffett or Howard Marks, then separate strengths from doubts.",
    },
  },
  {
    id: "company-search-nav",
    selector:
      '[data-onboarding-target="company-search-nav"], [data-onboarding-target="company-search"], [data-onboarding-target="workspace-menu-trigger"]',
    icon: "search",
    title: {
      ko: "회사를 알면 회사 찾기",
      en: "Use company search when you know the company",
    },
    body: {
      ko: "티커나 회사명을 입력하면 그 회사의 공시·실적·리스크 리서치로 바로 이어집니다.",
      en: "Enter a ticker or company name to go straight into filing, earnings, and risk research for that company.",
    },
  },
  {
    id: "wide-research-nav",
    selector:
      '[data-onboarding-target="wide-research-nav"], [data-onboarding-target="workspace-menu-trigger"]',
    icon: "hub",
    title: {
      ko: "이슈를 넓게 보려면 와이드 리서치",
      en: "Use wide research for broad issues",
    },
    body: {
      ko: "티커 없이 산업이나 이슈를 넣어 여러 회사를 함께 탐색합니다. 범위가 넓어 일반 회사 질문보다 시간이 더 걸릴 수 있습니다.",
      en: "Explore an industry or issue across multiple companies without starting from a ticker. Broad searches can take longer than single-company research.",
    },
  },
  {
    id: "institutional-holdings-nav",
    selector:
      '[data-onboarding-target="institutional-holdings-nav"], [data-onboarding-target="workspace-menu-trigger"]',
    icon: "monitoring",
    title: {
      ko: "기관 보유 변화는 13F",
      en: "Use 13F for institutional holdings",
    },
    body: {
      ko: "기관의 보유 변화를 보고, 다음에 더 확인할 회사와 질문을 정할 때 사용합니다.",
      en: "Use institutional holding changes to decide which companies and questions to review next.",
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
    id: "chat-wide-research",
    selector:
      '[data-onboarding-target="chat-empty-heading"], [data-onboarding-target="chat-suggested-prompts"], [data-onboarding-target="chat-composer"]',
    icon: "hub",
    title: {
      ko: "와이드 리서치는 여러 회사를 동시에 봅니다",
      en: "Wide research checks multiple companies at once",
    },
    body: {
      ko: "일반 회사 채팅보다 더 걸릴 수 있지만, 아이디어·산업·리스크 조건으로 후보와 비교축을 함께 잡을 수 있습니다.",
      en: "It can take longer than single-company chat, but it finds candidates and comparison angles from an idea, industry, or risk condition.",
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
      '[data-onboarding-target="chat-notebook-actions"], [data-onboarding-target="research-notebook-nav"], [data-onboarding-target="workspace-menu-trigger"]',
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
  if (tour === "chat") return chatTourSteps;
  if (tour === "guru-directory") return guruDirectoryTourSteps;
  if (tour === "guru-chat") return guruChatTourSteps;
  return companyTourSteps;
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
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDirection, setStepDirection] = useState(1);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [userStorageKey, setUserStorageKey] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 220);
    let authTimer: number | null = null;

    if (IS_DEV_ENV || force) {
      authTimer = window.setTimeout(() => {
        if (cancelled) return;
        setIsAuthenticated(true);
        setUserStorageKey(`${TOUR_STORAGE_PREFIX}:${tour}:dev`);
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
        if (authTimer !== null) window.clearTimeout(authTimer);
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
    const timeoutId = window.setTimeout(() => {
      setStepDirection(1);
      setStepIndex(0);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [tour]);

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    let timeoutId: number | null = null;

    // Development pages are opened repeatedly while implementing and testing
    // product flows. Keep the tour available through `?tour=1`, but do not let
    // it cover every dev navigation by default.
    if (IS_DEV_ENV && !force) return;

    if (force) {
      timeoutId = window.setTimeout(() => setVisible(true), 0);
      return () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      };
    }
    if (!userStorageKey) return;

    try {
      if (window.localStorage.getItem(userStorageKey) === "1") return;
    } catch {
      // If storage is unavailable, still show once for this page view.
    }

    timeoutId = window.setTimeout(() => setVisible(true), 0);
    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
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
    const safeContinuePath = normalizeContinuePath(continuePath);
    if (safeContinuePath) {
      router.replace(safeContinuePath, { scroll: false });
    }
  }, [continuePath, router, userStorageKey]);

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

    if (isMobileViewport() && needsMobileWorkspaceMenu(currentStep.id)) {
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
                  className="inline-flex h-11 items-center rounded-[8px] px-sm text-[13px] font-bold text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={completeTour}
                >
                  {copy.skip}
                </button>
                <button
                  type="button"
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
  if (stepId === "chat-notebook") {
    return !findVisibleTarget('[data-onboarding-target="chat-notebook-actions"]');
  }

  return (
    stepId === "research-notebook-nav" ||
    stepId === "stock-discovery-nav" ||
    stepId === "guru-advisor-nav" ||
    stepId === "company-search-nav" ||
    stepId === "wide-research-nav" ||
    stepId === "institutional-holdings-nav"
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
