import type { Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import { normalizeTicker } from "@/lib/ontology/ticker";

export const COVERAGE_ONBOARDING_REQUIRED_COMPANIES = 3;

export type CoverageOnboardingFiling = {
  id: string;
  ticker: string;
  form_type: "8-K" | "8-K/A" | "6-K" | "6-K/A" | "4" | "4/A";
  filing_date: string;
  label: string;
};

export type CoverageOnboardingProgress = {
  activated: boolean;
  achieved_at: string | null;
  coverage_count: number;
  judgment_count: number;
  monitoring_rule_count: number;
  evidence_opened: boolean;
  required_coverage_count: number;
};

export type CoverageOnboardingProgressInput = {
  achievedAt?: string | null;
  coverageCount?: number | null;
  judgmentCount?: number | null;
  monitoringRuleCount?: number | null;
  evidenceOpened?: boolean | null;
};

/**
 * The database milestone is the only completion authority. Counts are exposed
 * for guidance, but intentionally never infer `activated` on the client.
 */
export function toCoverageOnboardingProgress(
  input: CoverageOnboardingProgressInput,
): CoverageOnboardingProgress {
  const achievedAt = input.achievedAt?.trim() || null;
  return {
    activated: achievedAt !== null,
    achieved_at: achievedAt,
    coverage_count: boundedCount(input.coverageCount),
    judgment_count: boundedCount(input.judgmentCount),
    monitoring_rule_count: boundedCount(input.monitoringRuleCount),
    evidence_opened: input.evidenceOpened === true,
    required_coverage_count: COVERAGE_ONBOARDING_REQUIRED_COMPANIES,
  };
}

export function companyCoverageOnboardingHref(
  locale: Locale,
  rawTicker: string,
  enabled: boolean,
  continuePath?: string | null,
): string | null {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;
  const pathname = localizedPath(
    locale,
    `/companies/${encodeURIComponent(ticker)}`,
  );
  if (!enabled) return pathname;
  const params = new URLSearchParams({ onboarding: "coverage" });
  const safeContinuePath = normalizeCoverageContinuePath(continuePath);
  if (safeContinuePath) params.set("continue", safeContinuePath);
  return `${pathname}?${params.toString()}`;
}

export function normalizeCoverageContinuePath(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/") || /[\\\u0000-\u001f\u007f]/u.test(trimmed)) {
    return null;
  }

  const base = new URL("https://krwontology.com");
  let target: URL;
  try {
    target = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (target.origin !== base.origin) return null;

  // Reject path separators and control bytes hidden behind percent encoding.
  // Keeping the path in one canonical representation prevents a later router
  // or proxy decode from turning a same-origin-looking value into `//host`.
  if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/iu.test(target.pathname)) {
    return null;
  }

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(target.pathname);
  } catch {
    return null;
  }
  if (/^\/(?:auth(?:\/|$)|login(?:\/|$))/u.test(decodedPathname)) {
    return null;
  }

  return `${target.pathname}${target.search}${target.hash}`;
}

export function remainingCoverageCompanies(
  progress: Pick<CoverageOnboardingProgress, "coverage_count" | "required_coverage_count">,
): number {
  return Math.max(0, progress.required_coverage_count - progress.coverage_count);
}

function boundedCount(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}
