import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SharedAnswerPageContent from "@/components/SharedAnswerPageContent";
import { isLocale } from "@/i18n/config";
import {
  buildPublicShareMetadata,
  getPublicShareForPage,
  sharePageMetadataCopy,
} from "@/lib/share/share-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { locale: localeParam, token } = await params;
  const locale = isLocale(localeParam) ? localeParam : "ko";
  const share = await getPublicShareForPage(token);

  if (!share) {
    return {
      title: sharePageMetadataCopy(locale).notFoundTitle,
      robots: { index: false, follow: false },
    };
  }

  return buildPublicShareMetadata(share, locale);
}

export default async function LocalizedSharedAnswerPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: localeParam, token } = await params;
  if (!isLocale(localeParam)) notFound();

  const share = await getPublicShareForPage(token);
  if (!share) notFound();

  return <SharedAnswerPageContent share={share} locale={localeParam} />;
}
