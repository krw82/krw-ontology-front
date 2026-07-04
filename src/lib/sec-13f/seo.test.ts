import { describe, expect, it } from "vitest";
import {
  allCurated13FManagerSlugs,
  findCurated13FManagerPageByCik,
  findCurated13FManagerPageBySlug,
  listCurated13FManagerPages,
} from "./seo";
import { KNOWN_13F_MANAGERS } from "./types";

describe("13F SEO manager pages", () => {
  it("defines one stable slug for every curated 13F manager", () => {
    const pages = listCurated13FManagerPages();
    const slugs = pages.map((page) => page.slug);

    expect(pages).toHaveLength(KNOWN_13F_MANAGERS.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("national-pension-service");
    expect(slugs).toContain("berkshire-hathaway");
  });

  it("resolves pages by slug and CIK", () => {
    const berkshire = findCurated13FManagerPageBySlug(
      "berkshire-hathaway",
      "ko",
    );
    const nps = findCurated13FManagerPageByCik("0001608046", "en");

    expect(berkshire?.manager.cik).toBe("0001067983");
    expect(berkshire?.personName).toBe("워런 버핏");
    expect(nps?.slug).toBe("national-pension-service");
    expect(nps?.shortName).toBe("National Pension Service");
  });

  it("provides manager-specific content blocks for public pages", () => {
    const berkshire = findCurated13FManagerPageBySlug(
      "berkshire-hathaway",
      "ko",
    );

    expect(berkshire?.profile).toContain("집중형 장기 포트폴리오");
    expect(berkshire?.watchPoints.length).toBeGreaterThanOrEqual(3);
    expect(berkshire?.questions.length).toBeGreaterThanOrEqual(4);
    expect(berkshire?.limits.length).toBeGreaterThanOrEqual(2);
    expect(berkshire?.questions.join(" ")).toContain("현금흐름");
  });

  it("exposes slugs for static params and sitemap generation", () => {
    expect(allCurated13FManagerSlugs()).toEqual(
      listCurated13FManagerPages().map((page) => page.slug),
    );
  });
});
