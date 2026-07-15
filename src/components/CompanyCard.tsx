"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent } from "react";
import { motion } from "motion/react";
import CompanyListItem, {
  getCompanyListAccessibleSummary,
  type CompanyListItemData,
} from "@/components/CompanyListItem";
import { easeOutExpo, listRow } from "@/lib/animation";
import { trackClientEventWithTimeout } from "@/lib/analytics/client";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
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

  const accessibleSummary = getCompanyListAccessibleSummary(company, locale);

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
            company_name: company.name ?? null,
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
        <CompanyListItem company={company} locale={locale} variant="browse" />
      </Link>
    </motion.div>
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
