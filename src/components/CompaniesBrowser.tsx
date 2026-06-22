"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  const [search, setSearch] = useState("");
  const reducedMotion = useReducedMotion();
  const normalizedSearch = search.trim();
  const copy = locale === "ko"
    ? {
        eyebrow: "회사 찾기",
        heading: "분석할 회사를 고르세요.",
        intro:
          "티커, 회사명, 사업 활동, 리스크 키워드로 바로 찾고 채팅 리서치로 이어갑니다.",
        searchLabel: "Ticker 검색",
        searchPlaceholder: "예: AAPL, NVDA, TSLA",
        searchAria: "티커 검색",
        multiCompanyCta: "종목 발굴하기",
        multiCompanyLineOne: "종목 발굴하기",
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
        searchLabel: "Ticker search",
        searchPlaceholder: "e.g. AAPL, NVDA, TSLA",
        searchAria: "Ticker search",
        multiCompanyCta: "Discover stocks",
        multiCompanyLineOne: "Discover stocks",
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
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="relative min-w-0">
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
                <Link
                  href="/discover"
                  className="group inline-flex h-11 min-w-0 items-center justify-between gap-2 rounded-[8px] bg-ink px-3 text-[13px] font-bold leading-5 text-canvas shadow-sm transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  aria-label={copy.multiCompanyCta}
                >
                  <span className="truncate">{copy.multiCompanyLineOne}</span>
                  <FlowAnimation disabled={reducedMotion} />
                </Link>
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
              <div className="hidden grid-cols-[104px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)] border-b border-hairline bg-surface px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted xl:grid">
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
