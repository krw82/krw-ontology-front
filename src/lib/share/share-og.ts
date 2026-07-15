import type { Locale } from "@/i18n/config";
import {
  getGuruLens,
  getGuruLensDisplayName,
  type GuruLensKey,
} from "@/lib/guru-lenses";
import { absoluteUrl, SITE_NAME } from "@/lib/marketing/site";
import type { PublicMessageShare } from "@/lib/share/message-share";
import { buildSharePath } from "@/lib/share/share-locale";

export const SHARE_OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
} as const;

const MAX_OG_TITLE_CHARS = 74;
const MAX_OG_DESCRIPTION_CHARS = 118;
const DOCUMENT_BASIS_HINT =
  /(?:기준|basis|10-[KQ]|20-F|40-F|6-K|8-K|S-1|FY20\d{2}|CY20\d{2}|공시|보고서|filing|annual report|quarterly report)/i;
const TRAILING_DOCUMENT_BASIS =
  /\s*(?:[-–—|·:]\s*)?(?:문서|공시|보고서|filing|(?:CY|FY)?20\d{2}|10-[KQ]|20-F|40-F|6-K|8-K|S-1)[^()（）\[\]]{0,96}(?:10-[KQ]|20-F|40-F|6-K|8-K|S-1|공시|보고서|filing)[^()（）\[\]]{0,96}(?:기준|basis)\s*$/i;

export interface ShareOgCopy {
  locale: Locale;
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
  const guruLensName = getGuruShareLensName(
    share.share_context.guru_lens,
    locale,
  );
  const baseTitle = buildPreviewTitle(share.title, locale);
  const title = truncateText(
    guruLensName
      ? buildGuruPreviewTitle(baseTitle, guruLensName, locale)
      : baseTitle,
    MAX_OG_TITLE_CHARS,
  );
  const description = buildDescription(share);
  const tickerLine = [
    guruLensName ? buildGuruLensLine(guruLensName, locale) : null,
    primaryTicker,
    cleanCompanyName,
  ].filter(Boolean).join(" · ");
  const guruShare = isGuruShare(share);

  return {
    locale,
    title,
    description,
    kicker: guruShare
      ? locale === "en"
        ? "PERSPECTIVE ANALYSIS"
        : "관점별 분석"
      : locale === "en"
        ? "SHARED RESEARCH ANSWER"
        : "공유 리서치 답변",
    footer: guruShare
      ? locale === "en"
        ? "Shared consultation · Public investing-principle lens"
        : "공유 리서치 · 공개 원칙 기반 AI 분석"
      : locale === "en"
        ? "Shared answer · Filing-grounded research"
        : "공유 답변 · 공시 기반 리서치",
    brandName: SITE_NAME,
    primaryTicker,
    companyName: cleanCompanyName || null,
    tickerLine:
      tickerLine ||
      (guruShare
        ? locale === "en"
          ? "Perspective analysis"
          : "관점별 분석"
        : locale === "en"
          ? "Filing-grounded research"
          : "공시 기반 리서치"),
    alt: `${title} | ${SITE_NAME}`,
  };
}

function buildDescription(share: PublicMessageShare): string {
  const question = compactText(share.question_content ?? "");
  if (question) return truncateText(question, MAX_OG_DESCRIPTION_CHARS);

  return share.locale === "en"
    ? "A shared filing-grounded research answer from KRW.O."
    : "KRW.O에서 공유된 공시 기반 리서치 답변입니다.";
}

function fallbackTitle(locale: Locale): string {
  return locale === "en" ? "Shared research answer" : "공유 리서치 답변";
}

function buildPreviewTitle(rawTitle: string, locale: Locale): string {
  const sourceTitle = compactText(rawTitle);
  if (!sourceTitle) return fallbackTitle(locale);

  const cleaned = removeDocumentBasis(sourceTitle);
  if (!cleaned.removed) return cleaned.title || fallbackTitle(locale);

  return appendResearchAnswerLabel(cleaned.title || fallbackTitle(locale), locale);
}

function removeDocumentBasis(title: string): { title: string; removed: boolean } {
  let nextTitle = title;
  let removed = false;

  for (let index = 0; index < 3; index += 1) {
    const withoutTrailingParenthetical = nextTitle.replace(
      /\s*[\(（\[][^\)）\]]+[\)）\]]\s*$/u,
      (match) => {
        if (!DOCUMENT_BASIS_HINT.test(match)) return match;
        removed = true;
        return "";
      },
    ).trim();

    if (withoutTrailingParenthetical !== nextTitle) {
      nextTitle = withoutTrailingParenthetical;
      continue;
    }

    const withoutTrailingDocumentBasis = nextTitle.replace(TRAILING_DOCUMENT_BASIS, "").trim();
    if (withoutTrailingDocumentBasis !== nextTitle) {
      removed = true;
      nextTitle = withoutTrailingDocumentBasis;
      continue;
    }

    break;
  }

  return { title: nextTitle, removed };
}

function appendResearchAnswerLabel(title: string, locale: Locale): string {
  if (locale === "en") {
    return /\b(?:research|answer|analysis)\b/i.test(title)
      ? title
      : `${title} research answer`;
  }

  return /(?:리서치|답변|분석)\s*$/.test(title)
    ? title
    : `${title} 리서치 답변`;
}

function isGuruShare(share: PublicMessageShare): boolean {
  return share.share_context.run_kind === "guru_advisor";
}

function getGuruShareLensName(
  guruLensKey: GuruLensKey | null,
  locale: Locale,
): string | null {
  if (!guruLensKey || guruLensKey === "auto") {
    return null;
  }
  return getGuruLensDisplayName(getGuruLens(guruLensKey), locale);
}

function buildGuruPreviewTitle(
  title: string,
  guruLensName: string,
  locale: Locale,
): string {
  if (locale === "en") {
    return title.toLowerCase().includes(guruLensName.toLowerCase())
      ? title
      : `${guruLensName} lens · ${title}`;
  }

  return title.includes(guruLensName) || title.includes("렌즈")
    ? title
    : `${guruLensName} 렌즈 · ${title}`;
}

function buildGuruLensLine(guruLensName: string, locale: Locale): string {
  return locale === "en" ? `${guruLensName} lens` : `${guruLensName} 렌즈`;
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
