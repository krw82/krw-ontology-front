import { isFirstEvidenceEntry } from "@/lib/onboarding/start-flow";

export const FIRST_VALUE_ENTRY = "first_value";

export const FIRST_VALUE_INTENTS = [
  "earnings",
  "risk",
  "growth",
  "valuation",
] as const;

export type FirstValueIntent = (typeof FIRST_VALUE_INTENTS)[number];

export function parseFirstValueIntent(
  value: string | null | undefined,
): FirstValueIntent | null {
  return FIRST_VALUE_INTENTS.includes(value as FirstValueIntent)
    ? (value as FirstValueIntent)
    : null;
}

export function isFirstValueEntry(
  value: string | null | undefined,
): boolean {
  return isFirstEvidenceEntry(value);
}

export function withFirstValueEntry(destination: string): string {
  const url = new URL(destination, "https://krwontology.com");
  url.searchParams.set("entry", FIRST_VALUE_ENTRY);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function firstValuePulseHref(intent?: FirstValueIntent | null): string {
  const params = new URLSearchParams({ entry: FIRST_VALUE_ENTRY });
  if (intent) params.set("intent", intent);
  return `/pulse?${params.toString()}`;
}
