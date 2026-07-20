"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import CompanyCard, {
  type CompanyCardData,
} from "@/components/CompanyCard";
import FirstResearchChoice from "@/components/FirstResearchChoice";
import { easeOutExpo } from "@/lib/animation";
import { filterAndSortCompanies } from "@/lib/companies/filter";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import {
  readDeviceCompanyBrowseCatalog,
  readDeviceCoverageOnboarding,
  saveDeviceCompanyBrowseCatalog,
  saveDeviceCoverageOnboarding,
} from "@/lib/pwa/device-cache";
import {
  DEVICE_CACHE_OWNER_CHANGED_EVENT,
  getDeviceCacheOwner,
} from "@/lib/pwa/device-cache-owner";

interface CompaniesBrowserProps {
  initialCompanies: CompanyCardData[];
  locale?: Locale;
  isAuthenticated?: boolean;
  cacheOwnerId?: string | null;
  catalogReleaseId?: string | null;
  catalogGeneratedAt?: string | null;
  loadCatalog?: boolean;
}

type CompanyBrowseCatalogResponse = {
  release_id: string | null;
  generated_at: string | null;
  companies: CompanyCardData[];
};

/* ─── Flow Animation ─────────────────────────────────────────────
   3 thin lines slide in from left, fade into the arrow, then the
   arrow nudges forward. Total cycle ≈ 1.2s active + 3.3s pause.
   Symbolises "many companies → one chat context".              */

const FLOW_CYCLE = 4.5; // total seconds per loop
const LINE_MOVE = 1.0; // how long lines travel
const ARROW_NUDGE_DELAY = 0.9; // when the arrow kicks
const SEARCH_COACHMARK_STORAGE_KEY = "krw:companies-search-coachmark-seen:v1";
const IS_DEV_ENV = process.env.NODE_ENV === "development";
const EMPTY_COMPANIES: CompanyCardData[] = [];
const COMPANY_RENDER_PAGE_SIZE = 120;

function FlowAnimation({ disabled }: { disabled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative flex h-7 w-14 shrink-0 items-center justify-end justify-self-end overflow-hidden sm:w-16"
    >
      {/* 3 converging lines */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute left-0 h-[2px] w-[8px] rounded-full bg-canvas/50"
          style={{ top: `${7 + i * 7}px` }}
          animate={
            disabled
              ? undefined
              : {
                  x: [0, 42, 42],
                  opacity: [0, 0.7, 0],
                }
          }
          transition={{
            duration: LINE_MOVE,
            delay: i * 0.15,
            repeat: Infinity,
            repeatDelay: FLOW_CYCLE - LINE_MOVE,
            ease: easeOutExpo,
            times: [0, 0.7, 1],
          }}
        />
      ))}

      {/* Main arrow */}
      <motion.span
        className="material-symbols-outlined relative z-10 text-[28px] text-canvas/90"
        animate={
          disabled
            ? undefined
            : {
                x: [0, 10, 0],
              }
        }
        transition={{
          duration: 0.5,
          delay: ARROW_NUDGE_DELAY,
          repeat: Infinity,
          repeatDelay: FLOW_CYCLE - 0.5,
          ease: easeOutExpo,
        }}
      >
        arrow_forward
      </motion.span>
    </span>
  );
}

function CompanyCatalogSkeleton() {
  return (
    <div
      className="mt-5 overflow-hidden rounded-[8px] border border-hairline bg-canvas"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">회사 목록을 불러오는 중입니다.</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="grid min-h-[112px] grid-cols-[88px_minmax(0,1fr)] gap-4 border-b border-hairline-soft px-4 py-4 last:border-b-0 xl:grid-cols-[148px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)]"
        >
          <div className="h-5 w-14 animate-pulse rounded bg-surface-soft" />
          <div className="space-y-2">
            <div className="h-5 w-36 animate-pulse rounded bg-surface-soft" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-soft" />
          </div>
          <div className="hidden space-y-2 xl:block">
            <div className="h-4 w-4/5 animate-pulse rounded bg-surface-soft" />
            <div className="h-4 w-3/5 animate-pulse rounded bg-surface-soft" />
          </div>
          <div className="hidden space-y-2 xl:block">
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-soft" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-soft" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CompaniesBrowser({
  initialCompanies,
  locale = DEFAULT_LOCALE,
  isAuthenticated = false,
  cacheOwnerId = null,
  catalogReleaseId = null,
  catalogGeneratedAt = null,
  loadCatalog = false,
}: CompaniesBrowserProps) {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [showSearchCoachmark, setShowSearchCoachmark] = useState(false);
  const [showFirstResearchChoice, setShowFirstResearchChoice] = useState(false);
  const [coverageOnboardingActive, setCoverageOnboardingActive] = useState(
    () => searchParams.get("onboarding") === "coverage",
  );
  const [deviceCacheOwnerId, setDeviceCacheOwnerId] = useState<string | null>(
    null,
  );
  const [coverageOnboardingByOwner, setCoverageOnboardingByOwner] = useState<{
    ownerId: string;
    activated: boolean;
  } | null>(null);
  const [freshCatalog, setFreshCatalog] =
    useState<CompanyBrowseCatalogResponse | null>(() =>
      initialCompanies.length > 0
        ? {
            release_id: catalogReleaseId,
            generated_at: catalogGeneratedAt,
            companies: initialCompanies,
          }
        : null,
    );
  const [deviceCatalog, setDeviceCatalog] =
    useState<CompanyBrowseCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(
    loadCatalog && initialCompanies.length === 0,
  );
  const [companyRenderPage, setCompanyRenderPage] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const coarsePointer = useCoarsePointer();
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = search.trim();
  const animateCompanyRows =
    !reducedMotion && !coarsePointer && normalizedSearch.length === 0;
  const forceCoachmarks = searchParams.get("coach") === "1";
  const forceFirstResearchChoice = searchParams.get("onboarding") === "1";
  const coverageOnboardingRequested =
    searchParams.get("onboarding") === "coverage";
  const onboardingContinuePath = searchParams.get("continue");
  const resolvedCacheOwnerId = cacheOwnerId ?? deviceCacheOwnerId;
  const hasAuthenticatedSession =
    isAuthenticated || Boolean(resolvedCacheOwnerId);
  const coverageOnboardingActivated = !hasAuthenticatedSession
    ? true
    : coverageOnboardingByOwner?.ownerId === resolvedCacheOwnerId
      ? coverageOnboardingByOwner.activated
      : null;
  const companies = useMemo(
    () => freshCatalog?.companies ?? deviceCatalog?.companies ?? EMPTY_COMPANIES,
    [deviceCatalog, freshCatalog],
  );
  const copy = locale === "ko"
      ? {
        eyebrow: "회사 찾기",
        heading: "분석할 회사를 고르세요.",
        intro:
          "회사를 알고 있다면 바로 검색하세요. 질문은 회사 공시, 실적 변화, 리스크 맥락으로 이어집니다.",
        searchLabel: "회사 검색",
        searchPlaceholder: "예: IBM, 브로드컴, 애플",
        searchAria: "회사 검색",
        searchCoachmark: "분석할 회사명이나 티커를 입력하세요",
        dismissCoachmarkAria: "회사 검색 안내 닫기",
        discoveryEyebrow: "다른 분석 관점이 필요하다면",
        discoveryTitle: "관점별 분석",
        discoveryDescription:
          "버핏·하워드 막스처럼 공개된 질문 원칙으로 회사나 아이디어를 점검합니다.",
        discoveryCta: "분석 관점 선택",
        emptyCatalog:
          "현재 환경의 웹 카탈로그에서 인덱싱된 회사를 찾지 못했습니다.",
        availableCompanies: "분석 가능한 회사",
        countSuffix: "개 표시",
        loadMore: "회사 더 보기",
        emptySearch: "검색 조건에 맞는 회사가 없습니다.",
        footer:
          "© 2026 KRW.O. 공시 근거 기반 기업 리서치.",
      }
    : {
        eyebrow: "Find a company",
        heading: "Choose a company to analyze.",
        intro:
          "If you know the company, search directly. Questions continue into filing, earnings, and risk context.",
        searchLabel: "Company search",
        searchPlaceholder: "e.g. IBM, Broadcom, Apple",
        searchAria: "Company search",
        searchCoachmark: "Type a company name or ticker to analyze",
        dismissCoachmarkAria: "Dismiss company search tip",
        discoveryEyebrow: "If you want another analysis perspective",
        discoveryTitle: "Perspective analysis",
        discoveryDescription:
          "Pressure-test a company or idea through public question frames such as Buffett or Howard Marks.",
        discoveryCta: "Choose a perspective",
        emptyCatalog:
          "No indexed companies were found in the current web catalog.",
        availableCompanies: "Available companies",
        countSuffix: "shown",
        loadMore: "Load more companies",
        emptySearch: "No companies match this search.",
        footer:
          "© 2026 KRW.O. Filing-grounded company research.",
      };

  const filteredCompanies = useMemo(() => {
    return filterAndSortCompanies(companies, deferredSearch);
  }, [companies, deferredSearch]);
  const visibleCompanies = useMemo(
    () =>
      filteredCompanies.slice(
        0,
        companyRenderPage * COMPANY_RENDER_PAGE_SIZE,
      ),
    [companyRenderPage, filteredCompanies],
  );
  const hasMoreCompanies = visibleCompanies.length < filteredCompanies.length;

  useEffect(() => {
    if (!cacheOwnerId) {
      const syncOwner = () => setDeviceCacheOwnerId(getDeviceCacheOwner());
      syncOwner();
      window.addEventListener(DEVICE_CACHE_OWNER_CHANGED_EVENT, syncOwner);
      return () => {
        window.removeEventListener(DEVICE_CACHE_OWNER_CHANGED_EVENT, syncOwner);
      };
    }
    return undefined;
  }, [cacheOwnerId]);

  useEffect(() => {
    if (freshCatalog?.release_id && freshCatalog.companies.length > 0) {
      void saveDeviceCompanyBrowseCatalog({
        release_id: freshCatalog.release_id,
        generated_at: freshCatalog.generated_at,
        locale,
        companies: freshCatalog.companies,
      }).catch(() => undefined);
    }
  }, [freshCatalog, locale]);

  useEffect(() => {
    if (!loadCatalog) return;
    let active = true;
    void readDeviceCompanyBrowseCatalog<CompanyCardData>(locale)
      .then((snapshot) => {
        if (!active || !snapshot) return;
        setDeviceCatalog({
          release_id: snapshot.release_id,
          generated_at: snapshot.generated_at,
          companies: snapshot.companies,
        });
        setCatalogLoading(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadCatalog, locale]);

  useEffect(() => {
    if (!loadCatalog) return;
    const controller = new AbortController();
    let active = true;
    void fetch(`/api/companies/browse?locale=${encodeURIComponent(locale)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load company browse catalog");
        const data = await response.json() as CompanyBrowseCatalogResponse;
        if (!Array.isArray(data.companies)) {
          throw new Error("Invalid company browse catalog response");
        }
        if (active) setFreshCatalog(data);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          // A last-known-good device catalog, if available, remains visible.
        }
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loadCatalog, locale]);

  useEffect(() => {
    if (!hasAuthenticatedSession || !resolvedCacheOwnerId) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    void readDeviceCoverageOnboarding(resolvedCacheOwnerId)
      .then((snapshot) => {
        if (active && snapshot) {
          setCoverageOnboardingByOwner({
            ownerId: resolvedCacheOwnerId,
            activated: snapshot.coverage_activated,
          });
        }
      })
      .catch(() => undefined);
    void fetch("/api/onboarding/coverage/status", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load coverage status");
        const data = await response.json() as {
          coverage_activated?: boolean;
        };
        const coverageActivated = data.coverage_activated === true;
        if (active) {
          setCoverageOnboardingByOwner({
            ownerId: resolvedCacheOwnerId,
            activated: coverageActivated,
          });
        }
        void saveDeviceCoverageOnboarding(resolvedCacheOwnerId, coverageActivated)
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          // Never block the company index when a personalized onboarding read
          // is unavailable. It can retry on the next navigation.
          if (active) {
            setCoverageOnboardingByOwner({
              ownerId: resolvedCacheOwnerId,
              activated: true,
            });
          }
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [hasAuthenticatedSession, resolvedCacheOwnerId]);

  useEffect(() => {
    if (forceCoachmarks) {
      const showTimer = window.setTimeout(
        () => setShowSearchCoachmark(true),
        0,
      );
      return () => {
        window.clearTimeout(showTimer);
      };
    }

    if (IS_DEV_ENV) {
      return undefined;
    }

    try {
      if (window.localStorage.getItem(SEARCH_COACHMARK_STORAGE_KEY) === "1") {
        return undefined;
      }
      window.localStorage.setItem(SEARCH_COACHMARK_STORAGE_KEY, "1");
    } catch {
      // If storage is unavailable, still show the tip for this page view.
    }

    const showTimer = window.setTimeout(() => setShowSearchCoachmark(true), 0);

    return () => {
      window.clearTimeout(showTimer);
    };
  }, [forceCoachmarks]);

  useEffect(() => {
    if (forceFirstResearchChoice) {
      const showTimer = window.setTimeout(
        () => setShowFirstResearchChoice(true),
        0,
      );
      return () => window.clearTimeout(showTimer);
    }

    if (!hasAuthenticatedSession) return;
    if (coverageOnboardingActivated === null) return;
    if (coverageOnboardingActivated || coverageOnboardingRequested) return;

    const showTimer = window.setTimeout(
      () => setShowFirstResearchChoice(true),
      0,
    );
    return () => window.clearTimeout(showTimer);
  }, [
    coverageOnboardingActivated,
    coverageOnboardingRequested,
    forceFirstResearchChoice,
    hasAuthenticatedSession,
  ]);

  function dismissSearchCoachmark() {
    setShowSearchCoachmark(false);
  }

  function dismissFirstResearchChoice() {
    setShowFirstResearchChoice(false);
  }

  function startCompanySearch() {
    setCoverageOnboardingActive(true);
    setShowFirstResearchChoice(false);
    const params = new URLSearchParams(window.location.search);
    params.set("onboarding", "coverage");
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function updateSearch(nextSearch: string) {
    setSearch(nextSearch);

    // Keep the URL in sync during the input event, not after a debounce. This
    // is a native, no-navigation history update, so filtering can remain
    // deferred while an immediate tap on a company card still preserves the
    // query for browser back/forward and refresh.
    const params = new URLSearchParams(window.location.search);
    if (nextSearch.trim()) params.set("q", nextSearch);
    else params.delete("q");
    const query = params.toString();
    const nextLocation = `${window.location.pathname}${
      query ? `?${query}` : ""
    }`;
    if (`${window.location.pathname}${window.location.search}` !== nextLocation) {
      window.history.replaceState(window.history.state, "", nextLocation);
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-[1440px]">
      <main
        id="main-content"
        className="w-full px-base pb-xl pt-lg sm:px-md md:px-xl md:pb-[96px] md:pt-xl"
      >
        {showFirstResearchChoice ? (
          <FirstResearchChoice
            locale={locale}
            onStartCompany={startCompanySearch}
            onDismiss={dismissFirstResearchChoice}
          />
        ) : (
        <header className="border-b border-hairline pb-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.82fr)] lg:items-end">
            <div className="min-w-0 max-w-2xl">
              <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] leading-5 text-primary">
                {copy.eyebrow}
              </p>
              <h1 className="mt-2 max-w-3xl text-balance text-[30px] font-black leading-[1.08] tracking-normal text-ink sm:text-[40px]">
                {copy.heading}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-6 text-body sm:text-[16px]">
                {copy.intro}
              </p>
            </div>

            <div className="min-w-0">
              <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                {copy.searchLabel}
              </p>
              <AnimatePresence initial={false}>
                {showSearchCoachmark ? (
                  <motion.div
                    className="relative mb-2 inline-flex max-w-full items-center gap-2 rounded-[8px] border border-outline bg-canvas px-3 py-2 text-[12px] font-bold leading-4 text-ink shadow-lg"
                    initial={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
                    transition={{ duration: reducedMotion ? 0 : 0.16, ease: easeOutExpo }}
                  >
                    <span className="min-w-0 truncate">{copy.searchCoachmark}</span>
                    <button
                      type="button"
                      className="-my-2 -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={copy.dismissCoachmarkAria}
                      onClick={dismissSearchCoachmark}
                    >
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                        close
                      </span>
                    </button>
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-[5px] left-8 h-2.5 w-2.5 rotate-45 border-b border-r border-outline bg-canvas"
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <div className="grid gap-2">
                <div
                  className="relative min-w-0"
                  data-onboarding-target="company-search"
                >
                  <motion.span
                    aria-hidden="true"
                    className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px]"
                    animate={{
                      color: normalizedSearch
                        ? "var(--color-primary)"
                        : "var(--color-muted)",
                    }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.16,
                      ease: easeOutExpo,
                    }}
                  >
                    search
                  </motion.span>
                  <input
                    ref={searchInputRef}
                    className="h-11 w-full rounded-[8px] border border-hairline bg-canvas pl-10 pr-sm font-mono text-[14px] font-semibold uppercase leading-[1.5] tracking-wide shadow-sm transition-all duration-150 ease-out placeholder:normal-case placeholder:tracking-normal placeholder:text-muted focus:border-outline focus:ring-2 focus:ring-primary-fixed-dim/25 focus:outline-none"
                    placeholder={copy.searchPlaceholder}
                    type="text"
                    value={search}
                    onChange={(event) => updateSearch(event.target.value)}
                    aria-label={copy.searchAria}
                  />
                </div>
              </div>
              <div className="mt-4 rounded-[8px] border border-hairline bg-surface p-sm">
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                  {copy.discoveryEyebrow}
                </p>
                <div className="mt-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[15px] font-black leading-5 text-ink">
                      {copy.discoveryTitle}
                    </p>
                    <p className="mt-1 text-[12px] font-semibold leading-5 text-muted">
                      {copy.discoveryDescription}
                    </p>
                  </div>
                  <Link
                    href="/guru"
                    data-onboarding-target="guru-advisor-cta"
                    className="group inline-flex h-11 min-w-0 shrink-0 items-center justify-between gap-2 rounded-[8px] bg-ink px-3 text-[13px] font-bold leading-5 text-canvas shadow-sm transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    aria-label={copy.discoveryCta}
                  >
                    <span className="truncate">{copy.discoveryCta}</span>
                    <FlowAnimation disabled={reducedMotion || coarsePointer} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </header>
        )}

        {catalogLoading ? (
          <CompanyCatalogSkeleton />
        ) : companies.length === 0 ? (
          <div className="mt-8 rounded-[8px] border border-hairline bg-surface p-lg text-[15px] leading-[1.5] text-body sm:text-[16px]">
            {copy.emptyCatalog}
          </div>
        ) : (
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] leading-5 text-muted">
                {copy.availableCompanies}
              </p>
              <p className="text-[12px] font-bold leading-4 text-muted" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={`${visibleCompanies.length}:${filteredCompanies.length}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.14,
                      ease: easeOutExpo,
                    }}
                  >
                    {hasMoreCompanies
                      ? `${visibleCompanies.length.toLocaleString()} / ${filteredCompanies.length.toLocaleString()} ${copy.countSuffix}`
                      : `${filteredCompanies.length.toLocaleString()} ${copy.countSuffix}`}
                  </motion.span>
                </AnimatePresence>
              </p>
            </div>
            <motion.div
              layout={animateCompanyRows}
              className="overflow-hidden rounded-[8px] border border-hairline bg-canvas"
              transition={{
                duration: reducedMotion ? 0 : 0.18,
                ease: easeOutExpo,
              }}
            >
              <div className="hidden grid-cols-[148px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)] border-b border-hairline bg-surface px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted xl:grid">
                <span>ticker</span>
                <span>company</span>
                <span>activity</span>
                <span>watch</span>
              </div>
              <AnimatePresence initial={false}>
                {visibleCompanies.map((company, index) => (
                  <CompanyCard
                    key={company.ticker}
                    company={company}
                    locale={locale}
                    motionDelay={index < 8 ? Math.min(index * 24, 120) : 0}
                    animateRow={animateCompanyRows}
                    coverageOnboarding={coverageOnboardingActive}
                    onboardingContinuePath={onboardingContinuePath}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
            {hasMoreCompanies ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className="min-h-11 rounded-[8px] border border-hairline bg-canvas px-base text-[13px] font-extrabold text-ink shadow-sm transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => setCompanyRenderPage((page) => page + 1)}
                >
                  {copy.loadMore}
                </button>
              </div>
            ) : null}
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {companies.length > 0 && filteredCompanies.length === 0 && (
            <motion.div
              key="empty-results"
              className="py-xxl text-center"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
              transition={{ duration: reducedMotion ? 0 : 0.16, ease: easeOutExpo }}
            >
              <p className="text-[18px] font-bold leading-[1.33] text-muted">
                {copy.emptySearch}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="mt-xxl w-full border-t border-hairline py-xxl md:mt-[96px] md:py-[72px]">
          <div className="flex w-full flex-col items-center text-center md:items-start md:text-left">
            <div className="text-[15px] font-bold leading-[1.4] text-ink sm:text-[16px] md:leading-[1.25]">
              {copy.footer}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
