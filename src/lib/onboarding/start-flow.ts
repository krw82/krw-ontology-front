import type { Locale } from "@/i18n/config";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";
import { normalizeTicker } from "@/lib/ontology/ticker";

export const ONBOARDING_START_ENTRY = "onboarding_v2";

export function isOnboardingStartEntry(
  value: string | null | undefined,
): boolean {
  return value === ONBOARDING_START_ENTRY;
}

export function isFirstEvidenceEntry(
  value: string | null | undefined,
): boolean {
  return value === "first_value" || isOnboardingStartEntry(value);
}

export function startCompanyHref(locale: Locale, rawTicker: string): string | null {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const params = new URLSearchParams({ entry: ONBOARDING_START_ENTRY });
  return `${localizedPath(locale, `/companies/${encodeURIComponent(ticker)}`)}?${params.toString()}`;
}

/** The caller persists the explicit interest choice before opening this route. */
export function startCompanyChatHref(
  locale: Locale,
  rawTicker: string,
): string | null {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const params = new URLSearchParams({
    ticker,
    entry: ONBOARDING_START_ENTRY,
  });
  if (locale !== DEFAULT_LOCALE) params.set("locale", locale);
  return `/chat/new?${params.toString()}`;
}

export function onboardingCompaniesHref(locale: Locale): string {
  const params = new URLSearchParams({ entry: ONBOARDING_START_ENTRY });
  return `${localizedPath(locale, "/companies")}?${params.toString()}`;
}

export function startChatHref({
  locale,
  question,
  ticker,
}: {
  locale: Locale;
  question: string;
  ticker?: string | null;
}): string | null {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) return null;

  const params = new URLSearchParams({
    query: normalizedQuestion,
    entry: ONBOARDING_START_ENTRY,
  });
  const normalizedTicker = ticker ? normalizeTicker(ticker) : null;
  if (normalizedTicker) params.set("ticker", normalizedTicker);
  if (locale !== DEFAULT_LOCALE) params.set("locale", locale);
  return `/chat/new?${params.toString()}`;
}

export function normalizedCompanyMatchText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function isExactCompanyPrompt(
  prompt: string,
  company: {
    ticker: string;
    name?: string | null;
    companyNameKo?: string | null;
  },
): boolean {
  const normalizedPrompt = normalizedCompanyMatchText(prompt);
  if (!normalizedPrompt) return false;
  return [company.ticker, company.name, company.companyNameKo]
    .map(normalizedCompanyMatchText)
    .filter(Boolean)
    .includes(normalizedPrompt);
}
