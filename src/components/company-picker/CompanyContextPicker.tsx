"use client";

import { useEffect, useRef } from "react";
import CompanyLogo from "@/components/CompanyLogo";
import BottomSheet from "@/components/ui/BottomSheet";
import type { CompanyMeta } from "@/lib/chat/company-meta";
import {
  getGuruCompanyPrimaryLabel,
  getGuruCompanySecondaryLabel,
} from "@/lib/chat/guru-company-search";
import { normalizeTicker } from "@/lib/ontology/ticker";

export interface CompanyContextPickerProps {
  open: boolean;
  locale: string;
  query: string;
  results: CompanyMeta[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  hasMore: boolean;
  title: string;
  description: string;
  searchPlaceholder: string;
  loadingMessage: string;
  emptyMessage: string;
  firstResultsLabel: string;
  ariaLabel: string;
  closeLabel: string;
  countLabel: (shown: number, total: number, hasMore: boolean) => string;
  selecting?: boolean;
  onQueryChange: (value: string) => void;
  onLoadMore: () => void;
  onSelect: (company: CompanyMeta) => void;
  onClose: () => void;
  dataOnboardingTarget?: string;
}

/**
 * Shared covered-company picker for entry flows that need a company context.
 * Mobile uses the app's accessible bottom-sheet primitive; larger viewports
 * promote the same interaction to a centered dialog.
 */
export default function CompanyContextPicker({
  open,
  locale,
  query,
  results,
  loading,
  error,
  totalCount,
  hasMore,
  title,
  description,
  searchPlaceholder,
  loadingMessage,
  emptyMessage,
  firstResultsLabel,
  ariaLabel,
  closeLabel,
  countLabel,
  selecting = false,
  onQueryChange,
  onLoadMore,
  onSelect,
  onClose,
  dataOnboardingTarget,
}: CompanyContextPickerProps) {
  const isKo = locale === "ko";
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !hasMore || !loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "180px 0px" },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, open]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={ariaLabel}
      presentation="responsive-dialog"
      initialFocusRef={searchInputRef}
      panelClassName="sm:max-w-[560px]"
      contentClassName="company-context-picker-safe-content px-base sm:p-lg"
      testId="company-context-picker"
    >
      <section className="grid gap-4" data-onboarding-target={dataOnboardingTarget}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[24px] font-black leading-8 text-ink">{title}</h2>
            <p className="mt-1 text-[14px] font-semibold leading-6 text-muted">
              {description}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
              close
            </span>
          </button>
        </div>

        <label className="sr-only" htmlFor="company-context-picker-search">
          {isKo ? "회사 또는 티커 검색" : "Search company or ticker"}
        </label>
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center rounded-[14px] border border-hairline bg-surface-soft px-3 focus-within:border-primary focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_rgba(0,82,255,0.10)]">
          <span aria-hidden="true" className="material-symbols-outlined mr-2 text-[20px] text-muted">
            search
          </span>
          <input
            ref={searchInputRef}
            id="company-context-picker-search"
            type="search"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 border-none bg-transparent py-3 text-[16px] font-bold leading-6 text-ink placeholder:text-muted focus:outline-none focus:ring-0"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
        </div>

        <div className="grid gap-2">
          {error ? (
            <div
              className="rounded-[8px] border border-error/20 bg-error-container/10 px-3 py-3 text-[13px] font-bold text-error"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {loading ? (
            <div className="rounded-[8px] border border-hairline bg-surface-soft px-3 py-3 text-[13px] font-bold text-muted">
              {loadingMessage}
            </div>
          ) : results.length === 0 ? (
            error ? null : (
              <div className="rounded-[8px] border border-hairline bg-surface-soft px-3 py-3 text-[13px] font-bold text-muted">
                {emptyMessage}
              </div>
            )
          ) : (
            <>
              {!query.trim() ? (
                <p className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-muted">
                  {firstResultsLabel}
                </p>
              ) : null}
              {results.map((company) => (
                <CompanyContextPickerItem
                  key={company.ticker}
                  company={company}
                  locale={locale}
                  disabled={selecting}
                  onSelect={onSelect}
                />
              ))}
              <div
                ref={hasMore ? loadMoreRef : undefined}
                className="py-2 text-center text-[12px] font-bold text-muted"
              >
                {countLabel(results.length, totalCount, hasMore)}
              </div>
            </>
          )}
        </div>
      </section>
    </BottomSheet>
  );
}

function CompanyContextPickerItem({
  company,
  locale,
  disabled,
  onSelect,
}: {
  company: CompanyMeta;
  locale: string;
  disabled: boolean;
  onSelect: (company: CompanyMeta) => void;
}) {
  const ticker = normalizeTicker(company.ticker) ?? company.ticker;
  const primaryLabel = getGuruCompanyPrimaryLabel(company, locale);
  const secondaryLabel = getGuruCompanySecondaryLabel(company, locale);

  return (
    <button
      type="button"
      disabled={disabled}
      className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60"
      onClick={() => onSelect(company)}
    >
      <article className="grid min-h-[76px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-hairline bg-canvas px-3 py-2.5 transition-[background-color,border-color] duration-150 group-hover:border-outline group-hover:bg-surface-soft group-active:bg-surface">
        <CompanyLogo
          ticker={ticker}
          companyName={company.name ?? primaryLabel}
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
