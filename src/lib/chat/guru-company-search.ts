import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";
import type { CompanyMeta } from "@/lib/chat/company-meta";
import { normalizeTicker } from "@/lib/ontology/ticker";

export type { CompanyMeta } from "@/lib/chat/company-meta";

function normalizeGuruCompanySearchText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function getGuruCompanyPrimaryLabel(
  company: CompanyMeta,
  locale: string,
): string {
  const ticker = normalizeTicker(company.ticker) ?? company.ticker;
  const displayCopy = getCompanyDisplayCopyForTicker(
    locale === "en" ? "en" : "ko",
    ticker,
  );
  if (locale === "ko") {
    return (
      displayCopy.companyNameKo?.trim() ||
      displayCopy.name?.trim() ||
      company.companyNameKo?.trim() ||
      company.name?.trim() ||
      ticker
    );
  }

  return displayCopy.name?.trim() || company.name?.trim() || ticker;
}

export function getGuruCompanySecondaryLabel(
  company: CompanyMeta,
  locale: string,
): string {
  const ticker = normalizeTicker(company.ticker) ?? company.ticker;
  const displayCopy = getCompanyDisplayCopyForTicker(
    locale === "en" ? "en" : "ko",
    ticker,
  );
  const sector = displayCopy.sector?.trim() || company.sector?.trim() || null;
  return [ticker, sector].filter(Boolean).join(" · ");
}

function guruCompanySearchHaystack(company: CompanyMeta, locale: string): string {
  const ticker = normalizeTicker(company.ticker) ?? company.ticker;
  const koCopy = getCompanyDisplayCopyForTicker("ko", ticker);
  const enCopy = getCompanyDisplayCopyForTicker("en", ticker);
  return [
    ticker,
    company.name,
    company.companyNameKo,
    company.sector,
    company.description,
    company.core_strength,
    company.critical_risk,
    koCopy.name,
    koCopy.companyNameKo,
    koCopy.sector,
    koCopy.description,
    koCopy.core_strength,
    koCopy.critical_risk,
    enCopy.name,
    enCopy.sector,
    enCopy.description,
    enCopy.core_strength,
    enCopy.critical_risk,
    getGuruCompanyPrimaryLabel(company, locale),
    getGuruCompanySecondaryLabel(company, locale),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export function filterGuruCompanies(
  companies: readonly CompanyMeta[],
  query: string,
  locale: string,
): CompanyMeta[] {
  const normalizedQuery = normalizeGuruCompanySearchText(query);
  if (!normalizedQuery) return [...companies];
  return companies.filter((company) =>
    guruCompanySearchHaystack(company, locale).includes(normalizedQuery),
  );
}
