import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
  isLocale,
} from "@/i18n/config";

export const PUBLIC_LOCALIZED_PATH_PREFIXES = [
  "/start",
  "/companies",
  "/13f",
  "/questions",
  "/use-cases",
  "/pricing",
  "/privacy",
  "/terms",
  "/refund",
] as const;

export function localizedPath(locale: Locale, pathname = "/"): string {
  const normalizedPathname = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;

  if (normalizedPathname === "/") return `/${locale}`;
  return `/${locale}${normalizedPathname}`;
}

export function getPathLocale(pathname: string): Locale | null {
  const [, maybeLocale] = pathname.split("/");
  return isLocale(maybeLocale) ? maybeLocale : null;
}

export function resolveRouteLocale(
  pathname: string,
  localeParam?: string | null,
): Locale {
  return getPathLocale(pathname) ??
    (isLocale(localeParam) ? localeParam : DEFAULT_LOCALE);
}

export function hasLocalePrefix(pathname: string): boolean {
  return getPathLocale(pathname) !== null;
}

export function stripLocalePrefix(pathname: string): string {
  const locale = getPathLocale(pathname);
  if (!locale) return pathname;

  const stripped = pathname.slice(locale.length + 1);
  return stripped.startsWith("/") && stripped.length > 0 ? stripped : "/";
}

export function localizedAlternates(pathname: string): Record<string, string> {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      localizedPath(locale, pathname),
    ]),
  );
}

export function isPublicLocalizedPathname(pathname: string): boolean {
  const unlocalizedPathname = stripLocalePrefix(pathname);

  return (
    unlocalizedPathname === "/" ||
    PUBLIC_LOCALIZED_PATH_PREFIXES.some(
      (prefix) =>
        unlocalizedPathname === prefix ||
        unlocalizedPathname.startsWith(`${prefix}/`),
    )
  );
}

function appendSearchParams(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function localeSwitchHref(
  locale: Locale,
  pathname: string,
  query = "",
): string {
  const params = new URLSearchParams(query);
  const unlocalizedPathname = stripLocalePrefix(pathname);

  if (isPublicLocalizedPathname(pathname)) {
    params.delete("locale");
    return appendSearchParams(
      localizedPath(locale, unlocalizedPathname),
      params,
    );
  }

  if (locale === DEFAULT_LOCALE) {
    params.delete("locale");
  } else {
    params.set("locale", locale);
  }
  return appendSearchParams(unlocalizedPathname, params);
}

export function queryLocalizedPath(locale: Locale, pathname: string): string {
  return localeSwitchHref(locale, pathname);
}

export function defaultLocalizedPath(pathname = "/"): string {
  return localizedPath(DEFAULT_LOCALE, pathname);
}
