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

interface CompaniesBrowserProps {
  initialCompanies: CompanyCardData[];
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
}: CompaniesBrowserProps) {
  const [search, setSearch] = useState("");
  const reducedMotion = useReducedMotion();
  const normalizedSearch = search.trim();

  const filteredCompanies = useMemo(() => {
    return filterAndSortCompanies(initialCompanies, search);
  }, [initialCompanies, search]);

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-[1600px] flex-1">
      <main
        id="main-content"
        className="min-h-0 w-full flex-grow overflow-y-auto px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <header className="border-b border-hairline pb-8">
          <div className="w-full">
            <div className="min-w-0 max-w-3xl">
              <p className="text-[13px] font-extrabold leading-5 text-primary">
                회사 찾기
              </p>
              <h1 className="mt-3 max-w-3xl text-balance text-[32px] font-black leading-[1.08] tracking-normal text-ink sm:text-[44px]">
                분석할 회사를 고르세요.
              </h1>
              <p className="mt-4 max-w-2xl text-[16px] leading-7 text-body sm:text-[18px]">
                티커를 알면 바로 검색하고, 회사명이 떠오르지 않으면 사업
                활동이나 리스크 키워드로 찾아보세요. 선택한 회사는 채팅에서
                이어서 분석할 수 있습니다.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className="mb-2 font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
              Ticker 검색
            </p>
            <div className="relative w-full">
              <motion.span
                aria-hidden="true"
                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px]"
                animate={{
                  color: normalizedSearch
                    ? "var(--color-primary)"
                    : "var(--color-primary-container)",
                }}
                transition={{
                  duration: reducedMotion ? 0 : 0.16,
                  ease: easeOutExpo,
                }}
              >
                search
              </motion.span>
              <input
                className="h-[52px] w-full rounded-[8px] border border-hairline bg-surface pl-11 pr-sm font-mono text-[15px] font-semibold uppercase leading-[1.5] tracking-wide transition-all duration-300 ease-out placeholder:normal-case placeholder:tracking-normal placeholder:text-muted focus:border-primary-fixed-dim focus:bg-canvas focus:ring-4 focus:ring-primary-fixed-dim/20 focus:outline-none"
                placeholder="예: AAPL, NVDA, TSLA"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="티커 검색"
              />
            </div>
          </div>

          {/* CTA: 아이디어 하나로 여러 회사 리서치 */}
          <Link
            href="/chat"
            className="group mt-3 grid min-h-[72px] w-full grid-cols-[minmax(0,1fr)_56px] items-center gap-3 rounded-[8px] bg-ink px-6 py-5 text-[15px] font-extrabold leading-6 text-canvas shadow-sm transition-all hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:min-h-[80px] sm:grid-cols-[minmax(0,1fr)_64px] sm:gap-4 sm:px-7 sm:text-[16px]"
            aria-label="아이디어 하나로 여러 회사 리서치해 보세요"
          >
            <span className="min-w-0 leading-[1.45]">
              <span className="block">아이디어 하나로</span>
              <span className="block">여러 회사 리서치해 보세요</span>
            </span>
            <FlowAnimation disabled={reducedMotion} />
          </Link>
        </header>

        {initialCompanies.length === 0 ? (
          <div className="mt-8 rounded-[8px] border border-hairline bg-surface p-lg text-[15px] leading-[1.5] text-body sm:text-[16px]">
            로컬 온톨로지 디렉터리에서 인덱싱된 회사를 찾지 못했습니다.
          </div>
        ) : (
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-[13px] font-extrabold leading-5 text-ink">
                분석 가능한 회사
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
                    {filteredCompanies.length.toLocaleString()}개 표시
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
              <div className="hidden grid-cols-[116px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)] border-b border-hairline bg-surface px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted 2xl:grid">
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
                검색 조건에 맞는 회사가 없습니다.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="mt-xxl w-full border-t border-hairline py-xxl md:mt-[96px] md:py-[72px]">
          <div className="flex w-full flex-col items-center text-center md:items-start md:text-left">
            <div className="text-[15px] font-bold leading-[1.4] text-ink sm:text-[16px] md:leading-[1.25]">
              &copy; 2026 KRW Ontology. 근거 기반 기업 리서치와 데이터 분석.
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
