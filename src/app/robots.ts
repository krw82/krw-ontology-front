import type { MetadataRoute } from "next";
import { absoluteUrl, getSiteOrigin } from "@/lib/marketing/site";

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/chat",
        "/settings",
        "/internal",
        "/share/",
        "/login",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: new URL(origin).host,
  };
}
