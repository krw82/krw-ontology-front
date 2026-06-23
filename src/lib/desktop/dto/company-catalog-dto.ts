import type { IndexedCompany } from "@/lib/ontology/catalog";
import {
  getCompanyDisplayCopyForTicker,
  getSuggestedPromptDisplaysForTickers,
} from "@/content/companies/display";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { buildBrandfetchTickerLogoUrl } from "@/lib/brandfetch-logo";

export const DESKTOP_COMPANY_CATALOG_CONTRACT =
  "desktop-company-catalog/v1" as const;
export const DESKTOP_COMPANY_DETAIL_CONTRACT =
  "desktop-company-detail/v1" as const;

export interface DesktopCompanySummaryDto {
  ticker: string;
  name: string;
  display_name: string;
  localized_name: string | null;
  sector: string | null;
  description: string;
  core_strength: string | null;
  critical_risk: string | null;
  latest_period: string | null;
  document_count: number;
  document_types: string[];
  coverage_label: string;
  logo_url: string | null;
  suggested_prompts: string[];
}

export interface DesktopCompanyDetailDto extends DesktopCompanySummaryDto {
  periods: string[];
  documents: Array<{
    period: string;
    document_type: string;
    doc_type_key: string | null;
    generated_at: string | null;
  }>;
  generated_at: string | null;
}

export function toDesktopCompanySummary(
  company: IndexedCompany,
): DesktopCompanySummaryDto {
  const copy = getCompanyDisplayCopyForTicker(DEFAULT_LOCALE, company.ticker);
  const suggestedPrompts = getSuggestedPromptDisplaysForTickers(
    DEFAULT_LOCALE,
    [company.ticker],
  )
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(0, 3);
  const name = copy.name ?? company.name;
  const displayName = copy.companyNameKo ?? copy.name ?? company.name;

  return {
    ticker: company.ticker,
    name,
    display_name: displayName,
    localized_name: copy.companyNameKo ?? null,
    sector: copy.sector ?? company.sector,
    description: copy.description ?? company.description,
    core_strength: copy.core_strength ?? company.core_strength ?? null,
    critical_risk: copy.critical_risk ?? company.critical_risk ?? null,
    latest_period: company.latest_period,
    document_count: company.document_count,
    document_types: company.document_types,
    coverage_label: company.coverage,
    logo_url: buildBrandfetchTickerLogoUrl(company.ticker),
    suggested_prompts: suggestedPrompts,
  };
}

export function toDesktopCompanyDetail(
  company: IndexedCompany,
): DesktopCompanyDetailDto {
  return {
    ...toDesktopCompanySummary(company),
    periods: company.periods,
    documents: company.documents,
    generated_at: company.generated_at,
  };
}
