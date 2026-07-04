import { describe, expect, it } from "vitest";
import { buildSiteOgImagePath, SITE_NAME } from "@/lib/marketing/site";
import { localizedPageMetadata } from "./metadata";

describe("localizedPageMetadata", () => {
  it("adds localized large OG and Twitter images", () => {
    const metadata = localizedPageMetadata({
      locale: "en",
      title: "Companies available for analysis",
      description: "Browse supported public companies.",
      path: "/companies",
      image: {
        url: buildSiteOgImagePath("companies", "en"),
      },
    });

    expect(metadata.alternates?.canonical).toContain("/en/companies");
    expect(metadata.openGraph).toMatchObject({
      locale: "en_US",
      images: [
        {
          url: expect.stringContaining("/api/og/site/companies?locale=en"),
          width: 1200,
          height: 630,
          alt: `Companies available for analysis | ${SITE_NAME}`,
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [expect.stringContaining("/api/og/site/companies?locale=en")],
    });
  });
});
