import type { MetadataRoute } from "next";
import {
  absoluteUrl,
  QUESTION_TOPIC_PAGES,
  USE_CASE_PAGES,
} from "@/lib/marketing/site";
import { listIndexedCompanies } from "@/lib/ontology/catalog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const companies = await listIndexedCompanies().catch(() => []);
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
    ...QUESTION_TOPIC_PAGES.map((topic) => ({
      url: absoluteUrl(`/questions/${topic.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.65,
    })),
    ...USE_CASE_PAGES.map((useCase) => ({
      url: absoluteUrl(`/use-cases/${useCase.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.72,
    })),
  ];
}
