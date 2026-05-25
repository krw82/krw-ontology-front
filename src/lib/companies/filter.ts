export type CompanySortMode = "relevance" | "ticker";

export interface CompanySearchRecord {
  ticker: string;
  name: string;
  companyNameKo?: string;
  sector?: string | null;
  description: string;
  coverage?: string | null;
  core_strength?: string;
  critical_risk?: string;
}

export function filterAndSortCompanies<T extends CompanySearchRecord>(
  companies: T[],
  search: string,
  sortBy: CompanySortMode = "relevance",
): T[] {
  let nextCompanies = companies;
  const query = search.trim().toLowerCase();

  if (query) {
    nextCompanies = nextCompanies.filter((company) =>
      [
        company.ticker,
        company.name,
        company.companyNameKo ?? "",
        company.sector ?? "",
        company.description,
        company.coverage ?? "",
        company.core_strength ?? "",
        company.critical_risk ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  if (sortBy === "ticker") {
    return [...nextCompanies].sort((a, b) =>
      a.ticker.localeCompare(b.ticker),
    );
  }

  return nextCompanies;
}
