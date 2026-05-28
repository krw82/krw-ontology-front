import type { MetadataRoute } from "next";
import {
  hasCompanyLandingCopyForTicker,
  listCompanyLandingCopyTickers,
} from "@/lib/companies/landing-copy";
import { absoluteUrl } from "@/lib/marketing/site";
import {
  type IndexedCompany,
  listIndexedCompanies,
} from "@/lib/ontology/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SitemapCompany = Pick<IndexedCompany, "ticker" | "generated_at">;

async function listSitemapCompanies(): Promise<SitemapCompany[]> {
  const indexedCompanies = await listIndexedCompanies().catch(() => []);
  const indexedWithCopy = indexedCompanies.filter((company) =>
    hasCompanyLandingCopyForTicker(company.ticker),
  );

  if (indexedWithCopy.length > 0) {
    return indexedWithCopy.map((company) => ({
      ticker: company.ticker,
      generated_at: company.generated_at,
    }));
  }

  return listCompanyLandingCopyTickers().map((ticker) => ({
    ticker,
    generated_at: null,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const companies = await listSitemapCompanies();
  const lastModified = (value: string | null | undefined) => {
    if (!value) return now;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : now;
  };

  return [
    {
      url: absoluteUrl("/"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/companies"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/pricing"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/privacy"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: absoluteUrl("/terms"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    ...companies.map((company) => ({
      url: absoluteUrl(`/companies/${encodeURIComponent(company.ticker)}`),
      lastModified: lastModified(company.generated_at),
      changeFrequency: "weekly" as const,
      priority: 0.75,
    })),
  ];
}
