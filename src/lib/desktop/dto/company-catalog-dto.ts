import type { IndexedCompany } from "@/lib/ontology/catalog";

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
  return {
    ticker: company.ticker,
    name: company.name,
    display_name: company.name,
    localized_name: null,
    sector: company.sector,
    description: company.description,
    core_strength: company.core_strength ?? null,
    critical_risk: company.critical_risk ?? null,
    latest_period: company.latest_period,
    document_count: company.document_count,
    document_types: company.document_types,
    coverage_label: company.coverage,
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
