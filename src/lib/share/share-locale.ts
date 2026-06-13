import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

const HANGUL_PATTERN = /[가-힣]/g;
const LATIN_PATTERN = /[A-Za-z]/g;

export function inferShareLocale(params: {
  questionContent?: string | null;
  answerContent?: string | null;
}): Locale {
  const text = `${params.questionContent ?? ""}\n${params.answerContent ?? ""}`
    .slice(0, 6_000);
  const hangulCount = text.match(HANGUL_PATTERN)?.length ?? 0;
  const latinCount = text.match(LATIN_PATTERN)?.length ?? 0;

  if (latinCount >= 80 && latinCount >= hangulCount * 2) {
    return "en";
  }

  return DEFAULT_LOCALE;
}

export function buildSharePath(token: string, locale: Locale): string {
  const encodedToken = encodeURIComponent(token);
  return locale === "en" ? `/en/share/${encodedToken}` : `/share/${encodedToken}`;
}
