"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import CompanyCard, {
  type CompanyCardData,
} from "@/components/CompanyCard";
import { easeOutExpo } from "@/lib/animation";
import { filterAndSortCompanies } from "@/lib/companies/filter";
import {
  DEFAULT_VALUATION_SORT_DIRECTION,
  sortCompaniesByValuation,
  type CompanyValuationMetrics,
  type MetricValuationSortKey,
  type ValuationSortDirection,
  type ValuationSortKey,
} from "@/lib/companies/valuation-sort";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import {
  readDeviceCompanyBrowseCatalog,
  saveDeviceCompanyBrowseCatalog,
} from "@/lib/pwa/device-cache";

interface CompaniesBrowserProps {
  initialCompanies: CompanyCardData[];
  locale?: Locale;
  catalogReleaseId?: string | null;
  catalogGeneratedAt?: string | null;
  loadCatalog?: boolean;
}

type CompanyBrowseCatalogResponse = {
  release_id: string | null;
  generated_at: string | null;
  companies: CompanyCardData[];
};

type ValuationSummaryResponse = {
  generated_at: string | null;
  count: number;
  valuations: CompanyValuationMetrics[];
};

interface ValuationSortChip {
  key: ValuationSortKey;
  label: string;
}

const SEARCH_COACHMARK_STORAGE_KEY = "krw:companies-search-coachmark-seen:v1";
const IS_DEV_ENV = process.env.NODE_ENV === "development";
const EMPTY_COMPANIES: CompanyCardData[] = [];

function CompanyCatalogSkeleton() {
  return (
    <div
      className="motion-route-loading mt-5 overflow-hidden rounded-[8px] border border-hairline bg-canvas"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">회사 목록을 불러오는 중입니다.</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="grid min-h-[112px] grid-cols-[88px_minmax(0,1fr)] gap-4 border-b border-hairline-soft px-4 py-4 last:border-b-0 xl:grid-cols-[148px_minmax(160px,1.1fr)_minmax(200px,1.4fr)_84px_64px_64px_64px]"
        >
          <div className="motion-loading-block h-5 w-14 rounded bg-surface-soft" />
          <div className="space-y-2">
            <div className="motion-loading-block h-5 w-36 rounded bg-surface-soft" />
            <div className="motion-loading-block h-4 w-24 rounded bg-surface-soft" />
          </div>
          <div className="hidden space-y-2 xl:block">
            <div className="motion-loading-block h-4 w-4/5 rounded bg-surface-soft" />
            <div className="motion-loading-block h-4 w-3/5 rounded bg-surface-soft" />
          </div>
          <div className="hidden xl:block">
            <div className="motion-loading-block ml-auto h-4 w-14 rounded bg-surface-soft" />
          </div>
          <div className="hidden xl:block">
            <div className="motion-loading-block ml-auto h-4 w-10 rounded bg-surface-soft" />
          </div>
          <div className="hidden xl:block">
            <div className="motion-loading-block ml-auto h-4 w-10 rounded bg-surface-soft" />
          </div>
          <div className="hidden xl:block">
            <div className="motion-loading-block ml-auto h-4 w-10 rounded bg-surface-soft" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CompaniesBrowser({
  initialCompanies,
  locale = DEFAULT_LOCALE,
  catalogReleaseId = null,
  catalogGeneratedAt = null,
  loadCatalog = false,
}: CompaniesBrowserProps) {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [showSearchCoachmark, setShowSearchCoachmark] = useState(false);
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
  const [valuationByTicker, setValuationByTicker] = useState<
    Map<string, CompanyValuationMetrics> | null
  >(null);
  const [sortKey, setSortKey] = useState<ValuationSortKey>("default");
  const [sortDirection, setSortDirection] =
    useState<ValuationSortDirection>("desc");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const coarsePointer = useCoarsePointer();
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = search.trim();
  const animateCompanyRows =
    !reducedMotion && !coarsePointer && normalizedSearch.length === 0;
  const forceCoachmarks = searchParams.get("coach") === "1";
  const coverageOnboardingActive = searchParams.get("onboarding") === "coverage";
  const onboardingContinuePath = searchParams.get("continue");
  const companies = useMemo(
    () => freshCatalog?.companies ?? deviceCatalog?.companies ?? EMPTY_COMPANIES,
    [deviceCatalog, freshCatalog],
  );
  const companiesWithValuation = useMemo(() => {
    if (!valuationByTicker || valuationByTicker.size === 0) return companies;
    return companies.map((company) => {
      const valuation = valuationByTicker.get(company.ticker);
      return valuation ? { ...company, valuation } : company;
    });
  }, [companies, valuationByTicker]);
  const valuationCoveredCount = useMemo(
    () =>
      valuationByTicker
        ? companies.filter((company) => valuationByTicker.has(company.ticker))
            .length
        : 0,
    [companies, valuationByTicker],
  );
  const copy = locale === "ko"
      ? {
        eyebrow: "회사 찾기",
        heading: "궁금한 회사가 있나요?",
        intro:
          "회사 하나를 고르면 최근 공시에서 달라진 점과 확인할 원문을 바로 안내합니다.",
        searchLabel: "회사 또는 티커 검색",
        searchPlaceholder: "예: IBM, 브로드컴, 애플",
        searchAria: "회사 검색",
        searchCoachmark: "회사명이나 티커를 입력하세요",
        dismissCoachmarkAria: "회사 검색 안내 닫기",
        emptyCatalog:
          "현재 환경의 웹 카탈로그에서 인덱싱된 회사를 찾지 못했습니다.",
        availableCompanies: "전체 분석 가능 회사",
        searchResults: "검색 결과",
        countSuffix: "개 표시",
        emptySearch: "검색 조건에 맞는 회사가 없습니다.",
        sortDefault: "기본순",
        sortMarketCap: "시총순",
        sortPerLow: "PER 낮은순",
        sortPbrLow: "PBR 낮은순",
        sortRoeHigh: "ROE 높은순",
        valuationCoverageLabel: "밸류에이션",
        sortAria: "회사 목록 정렬",
        footer:
          "© 2026 KRW.O. 공시 근거 기반 기업 리서치.",
      }
    : {
        eyebrow: "Find a company",
        heading: "Is there a company you want to understand?",
        intro:
          "Choose a company to see what changed in its latest filings and where to verify the source.",
        searchLabel: "Company or ticker",
        searchPlaceholder: "e.g. IBM, Broadcom, Apple",
        searchAria: "Company search",
        searchCoachmark: "Type a company name or ticker",
        dismissCoachmarkAria: "Dismiss company search tip",
        emptyCatalog:
          "No indexed companies were found in the current web catalog.",
        availableCompanies: "All available companies",
        searchResults: "Search results",
        countSuffix: "shown",
        emptySearch: "No companies match this search.",
        sortDefault: "Default",
        sortMarketCap: "Market cap",
        sortPerLow: "Low P/E",
        sortPbrLow: "Low P/B",
        sortRoeHigh: "High ROE",
        valuationCoverageLabel: "Valuation",
        sortAria: "Sort company list",
        footer:
          "© 2026 KRW.O. Filing-grounded company research.",
      };

  const filteredCompanies = useMemo(() => {
    const filtered = filterAndSortCompanies(
      companiesWithValuation,
      deferredSearch,
    );
    // Valuation screening only applies while browsing; an active search keeps
    // relevance ordering so typing "AAPL" always surfaces the exact match.
    if (deferredSearch.trim() || sortKey === "default") return filtered;
    return sortCompaniesByValuation(filtered, sortKey, sortDirection);
  }, [companiesWithValuation, deferredSearch, sortDirection, sortKey]);
  const isSearchActive = normalizedSearch.length > 0;
  const visibleCompanies = filteredCompanies;

  useEffect(() => {
    let active = true;
    void fetch("/api/valuation/summary", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load valuation summary");
        const data = (await response.json()) as ValuationSummaryResponse;
        if (!active || !Array.isArray(data.valuations)) return;
        setValuationByTicker(
          new Map(data.valuations.map((item) => [item.ticker, item])),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function applyValuationSort(
    nextKey: ValuationSortKey,
    source: "chip" | "header",
  ) {
    let nextDirection = sortDirection;
    if (nextKey === "default") {
      setSortKey("default");
    } else if (nextKey === sortKey) {
      nextDirection = sortDirection === "asc" ? "desc" : "asc";
      setSortDirection(nextDirection);
    } else {
      nextDirection = DEFAULT_VALUATION_SORT_DIRECTION[nextKey];
      setSortKey(nextKey);
      setSortDirection(nextDirection);
    }
    trackClientEventSilently("cta_clicked", {
      cta_id: source === "chip" ? "companies_sort_chip" : "companies_sort_header",
      surface: "companies_index",
      sort_key: nextKey,
      direction: nextKey === "default" ? null : nextDirection,
    });
  }

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

  const sortChips: ValuationSortChip[] = [
    { key: "default", label: copy.sortDefault },
    { key: "market_cap", label: copy.sortMarketCap },
    { key: "pe_ttm", label: copy.sortPerLow },
    { key: "pb", label: copy.sortPbrLow },
    { key: "roe_ttm", label: copy.sortRoeHigh },
  ];
  const metricHeaders: { key: MetricValuationSortKey; label: string }[] = [
    { key: "market_cap", label: "mkt cap" },
    { key: "pe_ttm", label: "per" },
    { key: "pb", label: "pbr" },
    { key: "roe_ttm", label: "roe" },
  ];
  const valuationSortDisabled = isSearchActive || !valuationByTicker;

  return (
    <div className="relative mx-auto w-full max-w-[1440px]">
      <main
        id="main-content"
        className="w-full px-base pb-xl pt-lg sm:px-md md:px-xl md:pb-[96px] md:pt-xl"
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
            </div>
          </div>
        </header>

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
                {isSearchActive
                  ? copy.searchResults
                  : copy.availableCompanies}
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
                    {`${filteredCompanies.length.toLocaleString()} ${copy.countSuffix}`}
                  </motion.span>
                </AnimatePresence>
              </p>
            </div>
            <div
              className="mb-3 flex flex-wrap items-center gap-xs"
              aria-label={copy.sortAria}
              role="group"
            >
              {sortChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={sortKey === chip.key}
                  disabled={chip.key !== "default" && valuationSortDisabled}
                  onClick={() => applyValuationSort(chip.key, "chip")}
                  className={[
                    "inline-flex h-9 items-center rounded-[8px] border px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
                    sortKey === chip.key
                      ? "border-primary bg-primary-fixed text-on-primary-fixed"
                      : "border-hairline bg-canvas text-muted hover:border-outline hover:text-ink",
                  ].join(" ")}
                >
                  {chip.label}
                </button>
              ))}
              <p className="ml-auto min-w-0 font-mono text-[11px] font-bold leading-4 text-muted-soft">
                {copy.valuationCoverageLabel}{" "}
                {valuationCoveredCount.toLocaleString()}/{companies.length.toLocaleString()} · TTM
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
              <div className="hidden grid-cols-[148px_minmax(160px,1.1fr)_minmax(200px,1.4fr)_84px_64px_64px_64px] border-b border-hairline bg-surface px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted xl:grid">
                <span>ticker</span>
                <span>company</span>
                <span>activity</span>
                {metricHeaders.map((header) => {
                  const isActive = sortKey === header.key;
                  return (
                    <button
                      key={header.key}
                      type="button"
                      disabled={valuationSortDisabled}
                      onClick={() => applyValuationSort(header.key, "header")}
                      aria-label={`${header.label} ${
                        isActive
                          ? sortDirection === "asc"
                            ? "↑"
                            : "↓"
                          : ""
                      }`}
                      className={[
                        "flex min-h-11 min-w-0 items-center justify-end gap-0.5 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
                        isActive ? "text-primary" : "hover:text-ink",
                      ].join(" ")}
                    >
                      <span className="truncate">{header.label}</span>
                      <span aria-hidden="true" className="shrink-0">
                        {isActive ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <AnimatePresence initial={false}>
                {visibleCompanies.map((company, index) => (
                  <CompanyCard
                    key={company.ticker}
                    company={company}
                    locale={locale}
                    motionDelay={index < 8 ? Math.min(index * 24, 120) : 0}
                    animateRow={animateCompanyRows && index < 8}
                    coverageOnboarding={coverageOnboardingActive}
                    onboardingContinuePath={onboardingContinuePath}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
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
