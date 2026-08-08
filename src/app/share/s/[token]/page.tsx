import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SharedSessionPageContent from "@/components/SharedSessionPageContent";
import {
  buildPublicSessionShareMetadata,
  getPublicSessionShareForPage,
} from "@/lib/share/session-share-page";
import { sharePageMetadataCopy } from "@/lib/share/share-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await getPublicSessionShareForPage(token);

  if (!share) {
    return {
      title: sharePageMetadataCopy("ko").notFoundTitle,
      robots: { index: false, follow: false },
    };
  }

  return buildPublicSessionShareMetadata(share, share.locale);
}

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await getPublicSessionShareForPage(token);

  if (!share) notFound();

  return <SharedSessionPageContent share={share} locale={share.locale} />;
}
