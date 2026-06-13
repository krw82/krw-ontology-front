import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SharedAnswerPageContent from "@/components/SharedAnswerPageContent";
import {
  getPublicShareForPage,
  sharePageMetadataCopy,
} from "@/lib/share/share-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await getPublicShareForPage(token);

  if (!share) {
    return {
      title: sharePageMetadataCopy("ko").notFoundTitle,
      robots: { index: false, follow: false },
    };
  }

  const metadataCopy = sharePageMetadataCopy(share.locale);
  return {
    title: `${share.title} | KRW Ontology`,
    description: metadataCopy.description,
    robots: { index: false, follow: false },
  };
}

export default async function SharedAnswerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await getPublicShareForPage(token);

  if (!share) notFound();

  return <SharedAnswerPageContent share={share} locale={share.locale} />;
}
