import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
  isLocale,
} from "@/i18n/config";

export const PUBLIC_LOCALIZED_PATH_PREFIXES = [
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

export function defaultLocalizedPath(pathname = "/"): string {
  return localizedPath(DEFAULT_LOCALE, pathname);
}
