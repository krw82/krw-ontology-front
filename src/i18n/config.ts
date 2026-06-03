export const SUPPORTED_LOCALES = ["ko", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ko";

export function isLocale(value: string | null | undefined): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

export function localeToHtmlLang(locale: Locale): string {
  return locale === "ko" ? "ko" : "en";
}

export function localeToOpenGraphLocale(locale: Locale): string {
  return locale === "ko" ? "ko_KR" : "en_US";
}
