import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import { SITE_NAME } from "@/lib/marketing/site";
import { findPublicMessageShare, type PublicMessageShare } from "@/lib/share/message-share";
import {
  buildShareCanonicalUrl,
  buildShareOgCopy,
  buildShareOgImageUrl,
  SHARE_OG_IMAGE_SIZE,
} from "@/lib/share/share-og";

const tokenPattern = /^[A-Za-z0-9_-]{16,80}$/;

export async function getPublicShareForPage(token: string) {
  if (!tokenPattern.test(token)) return null;
  return findPublicMessageShare(token);
}

export function sharePageMetadataCopy(locale: Locale) {
  return locale === "en"
    ? {
        notFoundTitle: "Shared answer not found | KRW Ontology",
        description: "A shared research answer from KRW Ontology.",
      }
    : {
        notFoundTitle: "공유 답변을 찾지 못했습니다 | KRW Ontology",
        description: "KRW Ontology에서 공유된 리서치 답변입니다.",
      };
}

export function buildPublicShareMetadata(
  share: PublicMessageShare,
  locale: Locale,
): Metadata {
  const pageTitle = `${share.title} | ${SITE_NAME}`;
  const ogCopy = buildShareOgCopy(share);
  const imageUrl = buildShareOgImageUrl(share.token);
  const pageUrl = buildShareCanonicalUrl(share.token, locale);

  return {
    title: pageTitle,
    description: ogCopy.description,
    alternates: {
      canonical: pageUrl,
    },
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
