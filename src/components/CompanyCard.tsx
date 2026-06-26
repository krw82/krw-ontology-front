"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent } from "react";
import { motion } from "motion/react";
import CompanyLogo from "@/components/CompanyLogo";
import { easeOutExpo, listRow } from "@/lib/animation";
import { trackClientEventWithTimeout } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import { normalizeTicker } from "@/lib/ontology/ticker";

export interface CompanyCardData {
  ticker: string;
  name: string;
  companyNameKo?: string;
  sector?: string | null;
  description: string;
  latest_period?: string | null;
  coverage?: string | null;
  core_strength?: string;
  critical_risk?: string;
  icon?: string;
  document_count?: number;
  document_types?: string[];
  periods?: string[];
  generated_at?: string | null;
}

interface CompanyCardProps {
  company: CompanyCardData;
  motionDelay?: number;
  locale?: Locale;
}

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

function researchAxisItemsFromValue(value: string | null): string[] {
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

export default function CompanyCard({
  company,
  motionDelay = 0,
  locale = DEFAULT_LOCALE,
}: CompanyCardProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const ticker = normalizeTicker(company.ticker);
  if (!ticker) return null;
  const coreStrength = company.core_strength
    ? readableText(company.core_strength, locale)
    : null;
  const criticalRisk = company.critical_risk
    ? readableText(company.critical_risk, locale)
    : null;
  const companyLabel =
    company.name && company.name !== ticker ? company.name : "";
  const companyNameKo =
    locale === "ko" ? company.companyNameKo?.trim() : undefined;
  const sectorLabel = displaySector(company.sector, locale);
  const coverageLabel =
    locale === "en"
      ? toEnglishCoverageTextFallback(toEnglishCoverage(company.coverage) ?? company.coverage ?? "")
      : company.coverage;
  const secondaryLabel = [companyNameKo, sectorLabel]
    .filter(Boolean)
    .join(" · ");
  const researchAxisItems = researchAxisItemsFromValue(
    coreStrength ?? company.description,
  );
  const accessibleSummary = [
    ticker,
    company.name && company.name !== ticker ? company.name : null,
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

  return (
    <motion.div
      layout="position"
      variants={listRow}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{
        duration: reducedMotion ? 0 : 0.16,
        delay: reducedMotion ? 0 : motionDelay / 1000,
        ease: easeOutExpo,
        layout: { duration: reducedMotion ? 0 : 0.16, ease: easeOutExpo },
      }}
      className="border-b border-hairline-soft last:border-b-0"
    >
      <Link
        href={localizedPath(locale, `/companies/${encodeURIComponent(ticker)}`)}
        onClick={(event) => {
          const destination = localizedPath(
            locale,
            `/companies/${encodeURIComponent(ticker)}`,
          );
          const shouldNavigateAfterTracking =
            shouldHandleClientNavigation(event);
          if (shouldNavigateAfterTracking) {
            event.preventDefault();
          }

          const tracking = trackClientEventWithTimeout("cta_clicked", {
            cta_id: "company_card",
            cta_label: ticker,
            surface: "companies_index",
            source_surface: "companies_index",
            destination,
            ticker,
            company_name: company.name,
            sector: company.sector ?? null,
          });

          if (shouldNavigateAfterTracking) {
            void tracking.finally(() => {
              router.push(destination);
            });
            return;
          }

          void tracking;
        }}
        className="group block cursor-pointer"
        aria-label={`${accessibleSummary}. ${
          locale === "ko"
            ? "이 회사 리서치 페이지 열기"
            : "Open this company research page"
        }`}
      >
        <article className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-4 transition-[transform,color,background-color] duration-150 ease-out hover:bg-surface xl:grid-cols-[148px_minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)] xl:items-start xl:gap-3 xl:py-3.5 active:bg-surface-soft">
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

          <p className="hidden min-w-0 text-[13px] leading-5 text-muted xl:line-clamp-2">
            {criticalRisk ??
              (locale === "ko" ? "추적 변수 미등록" : "No watch item registered")}
          </p>
        </article>
      </Link>
    </motion.div>
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
  const hiddenCount = Math.max(items.length - 1 - visibleSecondaryItems.length, 0);

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

function shouldHandleClientNavigation(
  event: MouseEvent<HTMLAnchorElement>,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}
