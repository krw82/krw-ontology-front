import type { Metadata } from "next";
import {
  DEFAULT_LOCALE,
  type Locale,
  localeToOpenGraphLocale,
} from "@/i18n/config";
import { localizedAlternates, localizedPath } from "@/i18n/routing";
import {
  absoluteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/marketing/site";

export function localizedPageMetadata({
  locale,
  title,
  description = SITE_DESCRIPTION,
  path = "/",
  noIndex = false,
}: {
  locale: Locale;
  title: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
}): Metadata {
  const canonicalPath = localizedPath(locale, path);
  const languages = localizedAlternates(path);

  return {
    title,
    description,
    alternates: {
      canonical: absoluteUrl(canonicalPath),
      languages: {
        ...Object.fromEntries(
          Object.entries(languages).map(([language, pathname]) => [
            language,
            absoluteUrl(pathname),
          ]),
        ),
        "x-default": absoluteUrl(localizedPath(DEFAULT_LOCALE, path)),
      },
    },
    openGraph: {
      title,
      description,
      url: absoluteUrl(canonicalPath),
      siteName: SITE_NAME,
      locale: localeToOpenGraphLocale(locale),
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : {
          index: true,
          follow: true,
        },
  };
}
