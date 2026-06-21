import { createElement } from "react";
import { ImageResponse } from "next/og";
import { ShareOgImage } from "@/components/ShareOgImage";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getPublicShareForPage } from "@/lib/share/share-page";
import {
  buildShareOgCopy,
  SHARE_OG_IMAGE_SIZE,
} from "@/lib/share/share-og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenPattern = /^[A-Za-z0-9_-]{16,80}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!tokenPattern.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  const share = await getPublicShareForPage(token);
  if (!share) {
    return new Response("Not found", { status: 404 });
  }

  const companyName = await resolveShareCompanyName(share.tickers?.[0]);
  const copy = buildShareOgCopy(share, companyName);

  return new ImageResponse(createElement(ShareOgImage, { copy }), {
    ...SHARE_OG_IMAGE_SIZE,
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

async function resolveShareCompanyName(
  ticker: string | null | undefined,
): Promise<string | null> {
  const normalizedTicker = normalizeTicker(ticker ?? "");
  if (!normalizedTicker) return null;

  try {
    const company = await getIndexedCompany(normalizedTicker);
    return company?.name?.trim() || null;
  } catch {
    return null;
  }
}
