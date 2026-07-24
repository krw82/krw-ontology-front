"use client";

import Link from "next/link";
import { motion } from "motion/react";
import CompanyListItem, {
  getCompanyListAccessibleSummary,
  type CompanyListItemData,
} from "@/components/CompanyListItem";
import { easeOutExpo, listRow } from "@/lib/animation";
import { trackClientEventSilently } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { companyCoverageOnboardingHref } from "@/lib/onboarding/coverage-flow";
import { normalizeTicker } from "@/lib/ontology/ticker";

export interface CompanyCardData
  extends Omit<
    CompanyListItemData,
    "name" | "description" | "core_strength" | "critical_risk" | "icon"
  > {
  name: string;
  description: string;
  core_strength?: string;
  critical_risk?: string;
  icon?: string;
}

interface CompanyCardProps {
  company: CompanyCardData;
  motionDelay?: number;
  locale?: Locale;
  animateRow?: boolean;
  coverageOnboarding?: boolean;
  onboardingContinuePath?: string | null;
}

export default function CompanyCard({
  company,
  motionDelay = 0,
  locale = DEFAULT_LOCALE,
  animateRow = true,
  coverageOnboarding = false,
  onboardingContinuePath = null,
}: CompanyCardProps) {
  const reducedMotion = useReducedMotion();
  const ticker = normalizeTicker(company.ticker);
  if (!ticker) return null;

  const accessibleSummary = getCompanyListAccessibleSummary(company, locale);
  const coverageDestination = companyCoverageOnboardingHref(
    locale,
    ticker,
    coverageOnboarding,
    onboardingContinuePath,
  );
  if (!coverageDestination) return null;
  const destination = coverageDestination;

  function trackSelection() {
    trackClientEventSilently("cta_clicked", {
      cta_id: "company_card",
      cta_label: ticker,
      surface: "companies_index",
      source_surface: "companies_index",
      destination,
      ticker,
      company_name: company.name ?? null,
      sector: company.sector ?? null,
    });
    trackClientEventSilently("company_selected", {
      ticker,
      company_name: company.name ?? null,
      sector: company.sector ?? null,
      surface: "companies_index",
      entry: coverageOnboarding ? "coverage" : "company_browse",
    });
  }

  return (
    <motion.div
      layout={animateRow ? "position" : false}
      variants={listRow}
      initial={animateRow ? "hidden" : false}
      animate="visible"
      exit={animateRow ? "exit" : undefined}
      transition={{
        duration: reducedMotion || !animateRow ? 0 : 0.16,
        delay: reducedMotion || !animateRow ? 0 : motionDelay / 1000,
        ease: easeOutExpo,
        layout: {
          duration: reducedMotion || !animateRow ? 0 : 0.16,
          ease: easeOutExpo,
        },
      }}
      className="border-b border-hairline-soft [contain-intrinsic-size:auto_112px] [content-visibility:auto] last:border-b-0"
    >
      <Link
        href={destination}
        onClick={trackSelection}
        className="group block cursor-pointer"
        aria-label={`${accessibleSummary}. ${
          locale === "ko"
            ? "이 회사 리서치 페이지 열기"
            : "Open this company research page"
        }`}
      >
        <CompanyListItem company={company} locale={locale} variant="browse" />
      </Link>
    </motion.div>
  );
}
