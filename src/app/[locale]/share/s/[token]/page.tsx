import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SharedSessionPageContent from "@/components/SharedSessionPageContent";
import {
  buildPublicSessionShareMetadata,
  getPublicSessionShareForPage,
} from "@/lib/share/session-share-page";
import { sharePageMetadataCopy } from "@/lib/share/share-page";
import { isLocale, type Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { token, locale } = await params;
  if (!isLocale(locale)) {
    return {
      title: sharePageMetadataCopy("ko").notFoundTitle,
      robots: { index: false, follow: false },
    };
  }
  const share = await getPublicSessionShareForPage(token);
  if (!share) {
    return {
      title: sharePageMetadataCopy(locale as Locale).notFoundTitle,
      robots: { index: false, follow: false },
    };
  }
  return buildPublicSessionShareMetadata(share, locale as Locale);
}

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token, locale } = await params;
  if (!isLocale(locale)) notFound();
  const share = await getPublicSessionShareForPage(token);
  if (!share) notFound();
  return <SharedSessionPageContent share={share} locale={locale as Locale} />;
}
