import type { MetadataRoute } from "next";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import { absoluteUrl, getSiteOrigin } from "@/lib/marketing/site";

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin();
  const privatePaths = ["/chat", "/settings", "/share/", "/login"];

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/internal",
        ...privatePaths,
        ...SUPPORTED_LOCALES.flatMap((locale) =>
          privatePaths.map((path) => localizedPath(locale, path)),
        ),
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: new URL(origin).host,
  };
}
