import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import { SITE_NAME, absoluteUrl } from "@/lib/marketing/site";
import {
  findPublicSessionShare,
  type PublicSessionShare,
} from "@/lib/share/session-share";
import { tokenPattern } from "@/lib/share/share-page";
import {
  SHARE_OG_IMAGE_SIZE,
  buildShareCanonicalUrl,
  buildShareOgCopy,
} from "@/lib/share/share-og";

export async function getPublicSessionShareForPage(token: string) {
  if (!tokenPattern.test(token)) return null;
  return findPublicSessionShare(token);
}

export function buildSessionSharePath(token: string, locale: Locale): string {
  const encoded = encodeURIComponent(token);
  return locale === "en" ? `/en/share/s/${encoded}` : `/share/s/${encoded}`;
}

export function buildSessionShareCanonicalUrl(
  token: string,
  locale: Locale,
): string {
  return absoluteUrl(buildSessionSharePath(token, locale));
}

export function buildSessionShareOgImagePath(token: string): string {
  return `/api/share/s/${encodeURIComponent(token)}/og`;
}

export function buildSessionShareOgImageUrl(token: string): string {
  return absoluteUrl(buildSessionShareOgImagePath(token));
}

export function buildPublicSessionShareMetadata(
  share: PublicSessionShare,
  locale: Locale,
): Metadata {
  // share-og.ts의 buildShareOgCopy는 PublicMessageShare를 입력받으므로
  // 호환되는 형태로 변환 (첫 assistant 답변을 answer_content로 사용)
  const firstAnswer =
    share.messages.find((m) => m.role === "assistant")?.content ?? "";
  const ogInput = {
    title: share.title,
    question_content: share.messages.find((m) => m.role === "user")?.content ?? null,
    answer_content: firstAnswer,
    tickers: share.tickers,
    share_context: share.share_context,
    locale: share.locale,
  } as Parameters<typeof buildShareOgCopy>[0];

  const ogCopy = buildShareOgCopy(ogInput);
  const pageTitle = `${ogCopy.title} | ${SITE_NAME}`;
  const imageUrl = buildSessionShareOgImageUrl(share.token);
  const pageUrl = buildSessionShareCanonicalUrl(share.token, locale);

  return {
    title: pageTitle,
    description: ogCopy.description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title: pageTitle,
      description: ogCopy.description,
      url: pageUrl,
      siteName: SITE_NAME,
      type: "article",
      locale: locale === "en" ? "en_US" : "ko_KR",
      images: [
        {
          url: imageUrl,
          width: SHARE_OG_IMAGE_SIZE.width,
          height: SHARE_OG_IMAGE_SIZE.height,
          alt: ogCopy.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: ogCopy.description,
      images: [imageUrl],
    },
    robots: { index: false, follow: false },
  };
}
