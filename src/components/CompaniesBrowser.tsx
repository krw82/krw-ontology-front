"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import CompanyCard, {
  type CompanyCardData,
} from "@/components/CompanyCard";
import { easeOutExpo } from "@/lib/animation";
import { filterAndSortCompanies } from "@/lib/companies/filter";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

interface CompaniesBrowserProps {
  initialCompanies: CompanyCardData[];
  locale?: Locale;
}

/* ─── Flow Animation ─────────────────────────────────────────────
   3 thin lines slide in from left, fade into the arrow, then the
   arrow nudges forward. Total cycle ≈ 1.2s active + 3.3s pause.
   Symbolises "many companies → one chat context".              */

const FLOW_CYCLE = 4.5; // total seconds per loop
const LINE_MOVE = 1.0; // how long lines travel
const ARROW_NUDGE_DELAY = 0.9; // when the arrow kicks
const SEARCH_COACHMARK_STORAGE_KEY = "krw:companies-search-coachmark-seen:v1";
const IS_DEV_ENV = process.env.NODE_ENV === "development";

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

export default function CompaniesBrowser({
  initialCompanies,
  locale = DEFAULT_LOCALE,
}: CompaniesBrowserProps) {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [showSearchCoachmark, setShowSearchCoachmark] = useState(false);
  const reducedMotion = useReducedMotion();
  const normalizedSearch = search.trim();
  const forceCoachmarks = searchParams.get("coach") === "1";
  const copy = locale === "ko"
    ? {
        eyebrow: "회사 찾기",
        heading: "분석할 회사를 고르세요.",
        intro:
          "티커, 회사명, 사업 활동, 리스크 키워드로 바로 찾고 채팅 리서치로 이어갑니다.",
        searchLabel: "회사 검색",
        searchPlaceholder: "예: IBM, 브로드컴, 애플",
        searchAria: "회사 검색",
        searchCoachmark: "분석할 회사명이나 티커를 입력하세요",
        dismissCoachmarkAria: "회사 검색 안내 닫기",
        discoveryEyebrow: "회사를 아직 모른다면",
        discoveryTitle: "종목 발굴기",
        discoveryDescription:
          "아이디어, 산업, 리스크 키워드로 후보 종목을 발굴합니다.",
        discoveryCta: "종목 발굴 시작",
        emptyCatalog:
          "현재 환경의 웹 카탈로그에서 인덱싱된 회사를 찾지 못했습니다.",
        availableCompanies: "분석 가능한 회사",
        countSuffix: "개 표시",
        emptySearch: "검색 조건에 맞는 회사가 없습니다.",
        footer:
          "© 2026 KRW Ontology. 근거 기반 기업 리서치와 데이터 분석.",
      }
    : {
        eyebrow: "Find a company",
        heading: "Choose a company to analyze.",
        intro:
          "Search by ticker, company name, activity, or risk keyword, then continue into chat research.",
        searchLabel: "Company search",
        searchPlaceholder: "e.g. IBM, Broadcom, Apple",
        searchAria: "Company search",
        searchCoachmark: "Type a company name or ticker to analyze",
        dismissCoachmarkAria: "Dismiss company search tip",
        discoveryEyebrow: "If you do not know the company yet",
        discoveryTitle: "Stock discovery",
        discoveryDescription:
          "Find candidate stocks from an idea, industry, or risk keyword.",
        discoveryCta: "Start discovery",
        emptyCatalog:
          "No indexed companies were found in the current web catalog.",
        availableCompanies: "Available companies",
        countSuffix: "shown",
        emptySearch: "No companies match this search.",
        footer:
          "© 2026 KRW Ontology. Evidence-first company research and data analysis.",
      };

  const filteredCompanies = useMemo(() => {
    return filterAndSortCompanies(initialCompanies, search);
  }, [initialCompanies, search]);

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

  function dismissSearchCoachmark() {
    setShowSearchCoachmark(false);
  }

  return (
    <div className="relative mx-auto w-full max-w-[1440px]">
      <main
        id="main-content"
        className="w-full px-base pb-[112px] pt-lg sm:px-md md:px-xl md:pb-[96px] md:pt-xl"
      >
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
                      className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                    className="h-11 w-full rounded-[8px] border border-hairline bg-canvas pl-10 pr-sm font-mono text-[14px] font-semibold uppercase leading-[1.5] tracking-wide shadow-sm transition-all duration-150 ease-out placeholder:normal-case placeholder:tracking-normal placeholder:text-muted focus:border-outline focus:ring-2 focus:ring-primary-fixed-dim/25 focus:outline-none"
                    placeholder={copy.searchPlaceholder}
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
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
                    href="/discover"
                    data-onboarding-target="stock-discovery-cta"
                    className="group inline-flex h-10 min-w-0 shrink-0 items-center justify-between gap-2 rounded-[8px] bg-ink px-3 text-[13px] font-bold leading-5 text-canvas shadow-sm transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    aria-label={copy.discoveryCta}
                  >
                    <span className="truncate">{copy.discoveryCta}</span>
                    <FlowAnimation disabled={reducedMotion} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </header>

        {initialCompanies.length === 0 ? (
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
                    key={filteredCompanies.length}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.14,
                      ease: easeOutExpo,
                    }}
                  >
                    {filteredCompanies.length.toLocaleString()} {copy.countSuffix}
                  </motion.span>
                </AnimatePresence>
              </p>
            </div>
            <motion.div
              layout
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
                {filteredCompanies.map((company, index) => (
                  <CompanyCard
                    key={company.ticker}
                    company={company}
                    locale={locale}
                    motionDelay={Math.min(index * 24, 120)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {initialCompanies.length > 0 && filteredCompanies.length === 0 && (
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
