import { createElement } from "react";
import { ImageResponse } from "next/og";
import { PageOgImage } from "@/components/PageOgImage";
import { PAGE_OG_IMAGE_SIZE } from "@/lib/marketing/site";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { buildCompanyPageOgCopy, parseOgLocale } from "@/lib/og/page-og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const locale = parseOgLocale(new URL(request.url).searchParams.get("locale"));
  const ticker = normalizeTicker(rawTicker) || rawTicker.toUpperCase();
  const company = await getCompanyForOg(ticker);
  const copy = buildCompanyPageOgCopy(ticker, locale, company);

  return new ImageResponse(createElement(PageOgImage, { copy }), {
    ...PAGE_OG_IMAGE_SIZE,
    headers: {
      "Cache-Control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

async function getCompanyForOg(ticker: string) {
  try {
    return await getIndexedCompany(ticker);
  } catch {
    return null;
  }
}
