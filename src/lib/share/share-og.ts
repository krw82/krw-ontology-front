import type { Locale } from "@/i18n/config";
import { absoluteUrl, SITE_NAME } from "@/lib/marketing/site";
import type { PublicMessageShare } from "@/lib/share/message-share";
import { buildSharePath } from "@/lib/share/share-locale";

export const SHARE_OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
} as const;

const MAX_OG_TITLE_CHARS = 74;
const MAX_OG_DESCRIPTION_CHARS = 118;

export interface ShareOgCopy {
  title: string;
  description: string;
  kicker: string;
  footer: string;
  brandName: string;
  primaryTicker: string | null;
  companyName: string | null;
  tickerLine: string;
  alt: string;
}

export function buildShareOgImagePath(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/og`;
}

export function buildShareOgImageUrl(token: string): string {
  return absoluteUrl(buildShareOgImagePath(token));
}

export function buildShareCanonicalUrl(token: string, locale: Locale): string {
  return absoluteUrl(buildSharePath(token, locale));
}

export function buildShareOgCopy(
  share: PublicMessageShare,
  companyName?: string | null,
): ShareOgCopy {
  const locale = share.locale;
  const primaryTicker = share.tickers?.[0] ?? null;
  const cleanCompanyName = normalizeCompanyName(companyName, primaryTicker);
  const title = truncateText(compactText(share.title) || fallbackTitle(locale), MAX_OG_TITLE_CHARS);
  const description = buildDescription(share);
  const tickerLine = [primaryTicker, cleanCompanyName].filter(Boolean).join(" · ");

  return {
    title,
    description,
    kicker: locale === "en" ? "SHARED RESEARCH ANSWER" : "공유 리서치 답변",
    footer: locale === "en" ? "Shared answer · Filing-grounded research" : "공유 답변 · 공시 기반 리서치",
    brandName: SITE_NAME,
    primaryTicker,
    companyName: cleanCompanyName || null,
    tickerLine: tickerLine || (locale === "en" ? "Filing-grounded research" : "공시 기반 리서치"),
    alt: `${title} | ${SITE_NAME}`,
  };
}

function buildDescription(share: PublicMessageShare): string {
  const question = compactText(share.question_content ?? "");
  if (question) return truncateText(question, MAX_OG_DESCRIPTION_CHARS);

  return share.locale === "en"
    ? "A shared filing-grounded research answer from KRW Ontology."
    : "KRW Ontology에서 공유된 공시 기반 리서치 답변입니다.";
}

function fallbackTitle(locale: Locale): string {
  return locale === "en" ? "Shared research answer" : "공유 리서치 답변";
}

function compactText(value: string): string {
  return value
    .replace(/[#*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyName(
  companyName: string | null | undefined,
  ticker: string | null,
): string {
  const cleanCompanyName = compactText(companyName ?? "");
  if (!cleanCompanyName) return "";
  if (ticker && cleanCompanyName.toUpperCase() === ticker.toUpperCase()) {
    return "";
  }
  return cleanCompanyName;
}

function truncateText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, maxLength - 1).join("").trimEnd()}...`;
}
