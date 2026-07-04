import type { MetadataRoute } from "next";
import {
  hasCompanyLandingCopyForTicker,
  listCompanyLandingCopyTickers,
} from "@/lib/companies/landing-copy";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import { absoluteUrl } from "@/lib/marketing/site";
import {
  type IndexedCompany,
  listIndexedCompanies,
} from "@/lib/ontology/catalog";
import { listCurated13FManagerPages } from "@/lib/sec-13f/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SitemapCompany = Pick<IndexedCompany, "ticker" | "generated_at">;
type SitemapEntry = MetadataRoute.Sitemap[number];
type SitemapChangeFrequency = NonNullable<SitemapEntry["changeFrequency"]>;

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
  const managers = listCurated13FManagerPages();
  const lastModified = (value: string | null | undefined) => {
    if (!value) return now;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : now;
  };

  const localizedEntries = ({
    path,
    lastModified: entryLastModified,
    changeFrequency,
    priority,
  }: {
    path: string;
    lastModified: Date;
    changeFrequency: SitemapChangeFrequency;
    priority: number;
  }): SitemapEntry[] => {
    const languages = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        absoluteUrl(localizedPath(locale, path)),
      ]),
    ) as Record<Locale, string>;

    return SUPPORTED_LOCALES.map((locale) => ({
      url: absoluteUrl(localizedPath(locale, path)),
      lastModified: entryLastModified,
      changeFrequency,
      priority,
      alternates: {
        languages: {
          ...languages,
          "x-default": absoluteUrl(localizedPath(DEFAULT_LOCALE, path)),
        },
      },
    }));
  };

  return [
    ...localizedEntries({
      path: "/",
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    }),
    ...localizedEntries({
      path: "/companies",
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    }),
    ...localizedEntries({
      path: "/13f",
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.85,
    }),
    ...localizedEntries({
      path: "/pricing",
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    }),
    ...localizedEntries({
      path: "/privacy",
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    }),
    ...localizedEntries({
      path: "/terms",
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    }),
    ...localizedEntries({
      path: "/refund",
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    }),
    ...companies.flatMap((company) =>
      localizedEntries({
        path: `/companies/${encodeURIComponent(company.ticker)}`,
        lastModified: lastModified(company.generated_at),
        changeFrequency: "weekly",
        priority: 0.75,
      }),
    ),
    ...managers.flatMap((manager) =>
      localizedEntries({
        path: `/13f/managers/${manager.slug}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.7,
      }),
    ),
  ];
}
