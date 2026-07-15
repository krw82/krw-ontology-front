import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";

export type CompaniesResponse = {
  companies?: Array<{
    ticker: string;
    name?: string | null;
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
  }>;
};

type CompaniesResponseCompany = NonNullable<
  CompaniesResponse["companies"]
>[number];

export type CompanyMeta = {
  ticker: string;
  name: string | null;
  companyNameKo?: string;
  sector: string | null;
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
};

export function toCompanyMeta(
  company: CompaniesResponseCompany,
  tickerOverride?: string,
): CompanyMeta {
  const ticker = (tickerOverride ?? company.ticker).trim().toUpperCase();
  const displayCopyKo = getCompanyDisplayCopyForTicker("ko", ticker);
  return {
    ticker,
    name: company.name && company.name !== ticker ? company.name : null,
    companyNameKo: displayCopyKo.companyNameKo,
    sector: company.sector ?? null,
    description: company.description ?? null,
    latest_period: company.latest_period ?? null,
    coverage: company.coverage ?? null,
    core_strength: company.core_strength ?? null,
    critical_risk: company.critical_risk ?? null,
    icon: company.icon ?? null,
    document_count: company.document_count,
    document_types: company.document_types,
    periods: company.periods,
    generated_at: company.generated_at ?? null,
  };
}
