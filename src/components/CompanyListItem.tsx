"use client";

import CompanyLogo from "@/components/CompanyLogo";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import {
  formatValuationMarketCap,
  formatValuationPercent,
  formatValuationRatio,
  type CompanyValuationMetrics,
} from "@/lib/companies/valuation-sort";
import { normalizeTicker } from "@/lib/ontology/ticker";

export interface CompanyListItemData {
  ticker: string;
  name?: string | null;
  companyNameKo?: string;
  sector?: string | null;
  description?: string | null;
  latest_period?: string | null;
  coverage?: string | null;
  core_strength?: string | null;
  critical_risk?: string | null;
  icon?: string | null;
  document_count?: number;
  document_types?: string[];
  periods?: string[];
  generated_at?: string | null;
  valuation?: CompanyValuationMetrics | null;
}

interface CompanyListItemProps {
  company: CompanyListItemData;
  locale?: Locale;
  variant?: "browse" | "select";
}

const englishSectorLabels: Record<string, string> = {
  기술: "Technology",
  헬스케어: "Healthcare",
  필수소비재: "Consumer staples",
  임의소비재: "Consumer discretionary",
  소비재: "Consumer discretionary",
  금융: "Financials",
  "금융 서비스": "Financials",
  커뮤니케이션: "Communication services",
  "커뮤니케이션 서비스": "Communication services",
  에너지: "Energy",
  산업재: "Industrials",
  소재: "Materials",
  유틸리티: "Utilities",
  부동산: "Real estate",
};

function readableText(value: string, locale: Locale): string {
  const normalized = value.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  if (locale === "en") {
    return normalized
      .replace(/^Primary activities:\s*/i, "Primary activity: ")
      .replace(/^Key external factors:\s*/i, "Key watch item: ");
  }

  return normalized
    .replace(/^Primary activities:\s*/i, "주요 활동: ")
    .replace(/^Key external factors:\s*/i, "핵심 변수: ");
}

function toEnglishCoverage(coverage: string | null | undefined): string | null {
  const normalized = coverage?.trim();
  if (!normalized) return null;
  if (/^\d+\s+filings\s+indexed/i.test(normalized)) return normalized;

  const coverageMatch = normalized.match(
    /^(\d+)개\s*공시\s*인덱싱(?:\s*·\s*([^·]+?))?(?:\s*·\s*최신\s*(.+))?$/,
  );
  if (!coverageMatch) return normalized;

  const [, filingCount, docTypes, latestPeriod] = coverageMatch;
  return `${filingCount} filings indexed${docTypes ? ` · ${docTypes.trim()}` : ""}${latestPeriod ? ` · latest ${latestPeriod.trim()}` : ""}`;
}

function toEnglishCoverageTextFallback(coverage: string): string {
  if (!/[가-힣]/.test(coverage)) {
    return coverage;
  }

  const indexedText = coverage
    .replace(/(\d+)개\s*공시\s*인덱싱/gi, "$1 filings indexed")
    .replace(/\s*·\s*최신\s*/gi, " · latest ")
    .replace(/\b공시\b/gi, "filing")
    .replace(/최신/gi, "latest")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (indexedText !== coverage) {
    return indexedText;
  }

  return coverage;
}

function displaySector(sector: string | null | undefined, locale: Locale) {
  const normalized = sector?.trim();
  if (!normalized) return null;
  if (locale === "ko") return normalized;
  return englishSectorLabels[normalized] ?? normalized;
}

function researchAxisItemsFromValue(value: string | null | undefined): string[] {
  if (!value) return [];

  const cleaned = value
    .replace(/^리서치\s*초점\s*:\s*/i, "")
    .replace(/^핵심\s*성장\s*동력\s*:\s*/i, "")
    .replace(/^주요\s*활동\s*:\s*/i, "")
    .replace(/^Research\s*focus\s*:\s*/i, "")
    .replace(/^Core\s*strengths\s*:\s*/i, "")
    .replace(/^Primary\s*activit(?:y|ies)\s*:\s*/i, "")
    .trim();

  const items = cleaned
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : [cleaned];
}

export function getCompanyListAccessibleSummary(
  company: CompanyListItemData,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const ticker = normalizeTicker(company.ticker) ?? company.ticker;
  const companyName = company.name?.trim();
  const companyNameKo =
    locale === "ko" ? company.companyNameKo?.trim() : undefined;
  const sectorLabel = displaySector(company.sector, locale);
  const coverageLabel =
    locale === "en"
      ? toEnglishCoverageTextFallback(
          toEnglishCoverage(company.coverage) ?? company.coverage ?? "",
        )
      : company.coverage;
  const coreStrength = company.core_strength
    ? readableText(company.core_strength, locale)
    : null;

  return [
    ticker,
    companyName && companyName !== ticker ? companyName : null,
    companyNameKo,
    sectorLabel
      ? locale === "ko"
        ? `${sectorLabel} 섹터`
        : `${sectorLabel} sector`
      : null,
    coverageLabel,
    coreStrength,
  ]
    .filter(Boolean)
    .join(". ");
}

export default function CompanyListItem({
  company,
  locale = DEFAULT_LOCALE,
  variant = "browse",
}: CompanyListItemProps) {
  const ticker = normalizeTicker(company.ticker);
  if (!ticker) return null;

  const companyName = company.name?.trim() ?? "";
  const companyLabel = companyName && companyName !== ticker ? companyName : "";
  const companyNameKo =
    locale === "ko" ? company.companyNameKo?.trim() : undefined;
  const sectorLabel = displaySector(company.sector, locale);
  const secondaryLabel = [companyNameKo, sectorLabel]
    .filter(Boolean)
    .join(" · ");
  const coreStrength = company.core_strength
    ? readableText(company.core_strength, locale)
    : null;
  const researchAxisItems = researchAxisItemsFromValue(
    coreStrength ?? company.description ?? null,
  );

  if (variant === "select") {
    return (
      <article className="grid min-h-[76px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-hairline bg-canvas px-3 py-2.5 transition-[background-color,border-color] duration-150 group-hover:border-outline group-hover:bg-surface-soft group-active:bg-surface">
        <CompanyLogo
          ticker={ticker}
          companyName={companyLabel || ticker}
          className="h-10 w-10 text-[10px]"
        />
        <div className="min-w-0">
          <p className="font-mono text-[14px] font-black leading-5 text-primary">
            {ticker}
          </p>
          <p className="truncate text-[14px] font-extrabold leading-5 text-ink">
            {companyLabel || ticker}
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
    );
  }

  return (
    <article className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-4 transition-[transform,color,background-color] duration-150 ease-out group-hover:bg-surface xl:grid-cols-[148px_minmax(160px,1.1fr)_minmax(200px,1.4fr)_84px_64px_64px_64px_64px] xl:items-start xl:gap-3 xl:py-3.5 group-active:bg-surface-soft">
      <div className="row-span-4 flex min-w-0 items-start xl:row-auto xl:block">
        <div className="flex min-w-0 items-start gap-3">
          <CompanyLogo
            ticker={ticker}
            companyName={companyLabel || ticker}
            className="h-12 w-12 text-[11px] sm:h-14 sm:w-14 xl:h-10 xl:w-10"
          />
          <h2 className="hidden font-mono text-[21px] font-black leading-none text-ink transition-colors group-hover:text-primary group-active:text-primary sm:text-[22px] xl:block">
            {ticker}
          </h2>
        </div>
      </div>

      <div className="min-w-0 xl:hidden">
        <h2 className="font-mono text-[23px] font-black leading-none text-ink transition-colors group-hover:text-primary group-active:text-primary">
          {ticker}
        </h2>
      </div>

      <div className="min-w-0">
        {companyLabel ? (
          <p className="truncate text-[15px] font-extrabold leading-5 text-ink">
            {companyLabel}
          </p>
        ) : (
          <span aria-hidden="true" className="block h-5" />
        )}
        {secondaryLabel && (
          <p className="mt-1 truncate text-[12px] font-semibold leading-4 text-muted">
            {secondaryLabel}
          </p>
        )}
        <MobileValuationStrip
          valuation={company.valuation ?? null}
          locale={locale}
        />
        <ResearchAxisSummary
          items={researchAxisItems}
          locale={locale}
          className="mt-2 xl:hidden"
        />
      </div>

      <ResearchAxisSummary
        items={researchAxisItems}
        locale={locale}
        className="hidden min-w-0 xl:block"
      />

      <ValuationCells valuation={company.valuation ?? null} locale={locale} />
    </article>
  );
}

function MobileValuationStrip({
  valuation,
  locale,
}: {
  valuation: CompanyValuationMetrics | null;
  locale: Locale;
}) {
  if (!valuation) return null;
  const parts = [
    formatValuationMarketCap(valuation.market_cap, locale === "ko" ? "ko" : "en"),
    formatValuationRatio(valuation.pe_ttm),
    formatValuationPercent(valuation.roe_ttm),
  ];
  if (parts.every((part) => part === "N/A")) return null;
  const capLabel = locale === "ko" ? "시총" : "cap";
  return (
    <p className="mt-1 font-mono text-[11px] font-bold leading-4 text-muted">
      <span className="text-muted-soft">{capLabel}</span> {parts[0]}
      <span className="mx-1 text-muted-soft" aria-hidden="true">·</span>
      <span className="text-muted-soft">PER</span> {parts[1]}
      <span className="mx-1 text-muted-soft" aria-hidden="true">·</span>
      <span className="text-muted-soft">ROE</span> {parts[2]}
    </p>
  );
}

function ValuationCells({
  valuation,
  locale,
}: {
  valuation: CompanyValuationMetrics | null;
  locale: Locale;
}) {
  const cellClass = "hidden min-w-0 text-right font-mono text-[12px] font-bold leading-5 xl:block";
  const valueClass = (isNa: boolean) =>
    isNa ? "text-muted-soft" : "text-body";
  return (
    <>
      <p className={cellClass}>
        <span className={valueClass(valuation?.market_cap == null)}>
          {formatValuationMarketCap(
            valuation?.market_cap ?? null,
            locale === "ko" ? "ko" : "en",
          )}
        </span>
      </p>
      <p className={cellClass}>
        <span className={valueClass(valuation?.pe_ttm == null)}>
          {formatValuationRatio(valuation?.pe_ttm ?? null)}
        </span>
      </p>
      <p className={cellClass}>
        <span className={valueClass(valuation?.pb == null)}>
          {formatValuationRatio(valuation?.pb ?? null)}
        </span>
      </p>
      <p className={cellClass}>
        <span className={valueClass(valuation?.roe_ttm == null)}>
          {formatValuationPercent(valuation?.roe_ttm ?? null)}
        </span>
      </p>
      <p className={cellClass}>
        <span className={valueClass(valuation?.roic_ttm == null)}>
          {formatValuationPercent(valuation?.roic_ttm ?? null)}
        </span>
      </p>
    </>
  );
}

function ResearchAxisSummary({
  items,
  locale,
  className = "",
}: {
  items: string[];
  locale: Locale;
  className?: string;
}) {
  const [primaryItem, ...secondaryItems] = items;
  const visibleSecondaryItems = secondaryItems.slice(0, 2);
  const hiddenCount = Math.max(
    items.length - 1 - visibleSecondaryItems.length,
    0,
  );

  if (!primaryItem) return null;

  return (
    <div
      className={[
        "grid min-w-0 grid-cols-[14px_minmax(0,1fr)] gap-2",
        className,
      ].join(" ")}
      aria-label={locale === "ko" ? "리서치 축" : "Research axes"}
    >
      <span
        aria-hidden="true"
        className="mt-[9px] h-px w-full rounded-full bg-ink/45 transition-colors group-hover:bg-primary"
      />
      <div className="min-w-0">
        <p className="line-clamp-2 text-[12px] font-bold leading-5 text-body [text-wrap:pretty]">
          {primaryItem}
        </p>
        {visibleSecondaryItems.length > 0 && (
          <p className="mt-0.5 line-clamp-1 text-[11px] font-semibold leading-4 text-muted">
            {visibleSecondaryItems.join(" · ")}
            {hiddenCount > 0 && (
              <span className="ml-1 font-mono font-bold text-muted-soft">
                +{hiddenCount}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
