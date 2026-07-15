"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";

import CompanyLogo from "@/components/CompanyLogo";
import type { CompanyMeta } from "@/lib/chat/company-meta";
import {
  getGuruCompanyPrimaryLabel,
  getGuruCompanySecondaryLabel,
} from "@/lib/chat/guru-company-search";
import { normalizeTicker } from "@/lib/ontology/ticker";

export interface GuruCompanyPickerProps {
  open: boolean;
  locale: string;
  query: string;
  results: CompanyMeta[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  hasMore: boolean;
  onQueryChange: (value: string) => void;
  onLoadMore: () => void;
  onSelect: (company: CompanyMeta) => void;
  onClose: () => void;
}

export default function GuruCompanyPicker({
  open,
  locale,
  query,
  results,
  loading,
  error,
  totalCount,
  hasMore,
  onQueryChange,
  onLoadMore,
  onSelect,
  onClose,
}: GuruCompanyPickerProps) {
  const isKo = locale === "ko";
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !hasMore || !loadMoreRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "160px 0px" },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="guru-company-picker"
          className="fixed inset-0 z-[170] flex items-end sm:items-center sm:justify-center"
          role="presentation"
        >
          <motion.button
            type="button"
            aria-label={isKo ? "회사 선택 닫기" : "Close company picker"}
            className="absolute inset-0 bg-ink/24"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.section
            data-onboarding-target="guru-company-picker"
            className="relative z-10 w-full overflow-hidden rounded-t-[24px] border-t border-hairline bg-canvas text-ink shadow-[0_-18px_54px_rgba(10,11,13,0.18)] sm:max-w-[560px] sm:rounded-[18px] sm:border sm:shadow-[0_24px_70px_rgba(10,11,13,0.22)]"
            role="dialog"
            aria-modal="true"
            aria-label={isKo ? "상담 회사 선택" : "Choose company for consultation"}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="grid max-h-[min(84dvh,700px)] gap-4 overflow-y-auto px-base pb-[calc(env(safe-area-inset-bottom)+20px)] pt-md sm:p-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                    Company context
                  </p>
                  <h2 className="mt-1 text-[24px] font-black leading-8 text-ink">
                    {isKo ? "어떤 회사를 상담할까요?" : "Which company should we discuss?"}
                  </h2>
                  <p className="mt-1 text-[14px] font-semibold leading-6 text-muted">
                    {isKo
                      ? "KRW가 가진 회사만 먼저 보여줍니다. 선택하면 이 회사의 최신 보고서가 상담 컨텍스트에 들어갑니다."
                      : "Only covered companies are shown first. Selecting one adds its latest filings to the consultation context."}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-dim hover:text-ink"
                  onClick={onClose}
                  aria-label={isKo ? "회사 선택 닫기" : "Close company picker"}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
                    close
                  </span>
                </button>
              </div>

              <label className="sr-only" htmlFor="guru-company-search">
                {isKo ? "회사 또는 티커 검색" : "Search company or ticker"}
              </label>
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center rounded-[14px] border border-hairline bg-surface-soft px-3 focus-within:border-primary focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_rgba(0,82,255,0.10)]">
                <span aria-hidden="true" className="material-symbols-outlined mr-2 text-[20px] text-muted">
                  search
                </span>
                <input
                  id="guru-company-search"
                  type="search"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-w-0 border-none bg-transparent py-3 text-[16px] font-bold leading-6 text-ink placeholder:text-muted focus:outline-none focus:ring-0"
                  placeholder={isKo ? "예: AAPL, 애플, 브로드컴" : "e.g. AAPL, Apple, Broadcom"}
                  value={query}
                  onChange={(event) => onQueryChange(event.currentTarget.value)}
                />
              </div>

              <div className="grid gap-2">
                {loading ? (
                  <div className="rounded-[8px] border border-hairline bg-surface-soft px-3 py-3 text-[13px] font-bold text-muted">
                    {isKo ? "회사 목록 확인 중" : "Checking companies"}
                  </div>
                ) : error ? (
                  <div className="rounded-[8px] border border-error/20 bg-error-container/10 px-3 py-3 text-[13px] font-bold text-error">
                    {error}
                  </div>
                ) : results.length === 0 ? (
                  <div className="rounded-[8px] border border-hairline bg-surface-soft px-3 py-3 text-[13px] font-bold text-muted">
                    {isKo
                      ? "현재 커버리지에서 찾지 못했습니다. 티커를 다시 확인해주세요."
                      : "No covered company found. Check the ticker again."}
                  </div>
                ) : (
                  <>
                    {results.map((company) => (
                      <GuruCompanyPickerItem
                        key={company.ticker}
                        company={company}
                        locale={locale}
                        onSelect={onSelect}
                      />
                    ))}
                    {hasMore ? (
                      <div
                        ref={loadMoreRef}
                        className="py-2 text-center text-[12px] font-bold text-muted"
                      >
                        {isKo
                          ? `${Math.min(results.length, totalCount)} / ${totalCount}개 표시 중`
                          : `Showing ${Math.min(results.length, totalCount)} / ${totalCount}`}
                      </div>
                    ) : totalCount > 0 ? (
                      <div className="py-2 text-center text-[12px] font-bold text-muted">
                        {isKo ? `${totalCount}개 모두 표시` : `All ${totalCount} shown`}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function GuruCompanyPickerItem({
  company,
  locale,
  onSelect,
}: {
  company: CompanyMeta;
  locale: string;
  onSelect: (company: CompanyMeta) => void;
}) {
  const ticker = normalizeTicker(company.ticker) ?? company.ticker;
  const primaryLabel = getGuruCompanyPrimaryLabel(company, locale);
  const secondaryLabel = getGuruCompanySecondaryLabel(company, locale);
  const logoCompanyName = company.name ?? primaryLabel;

  return (
    <button
      type="button"
      className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(company)}
    >
      <article className="grid min-h-[76px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-hairline bg-canvas px-3 py-2.5 transition-[background-color,border-color] duration-150 group-hover:border-outline group-hover:bg-surface-soft group-active:bg-surface">
        <CompanyLogo
          ticker={ticker}
          companyName={logoCompanyName}
          className="h-10 w-10 text-[10px]"
        />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-extrabold leading-5 text-ink">
            {primaryLabel}
          </p>
          <p className="mt-0.5 truncate font-mono text-[13px] font-black leading-4 text-primary">
            {ticker}
          </p>
          {secondaryLabel ? (
            <p className="mt-0.5 truncate text-[12px] font-semibold leading-4 text-muted">
              {secondaryLabel}
            </p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[22px] text-muted transition-colors group-hover:text-ink"
        >
          arrow_forward
        </span>
      </article>
    </button>
  );
}
