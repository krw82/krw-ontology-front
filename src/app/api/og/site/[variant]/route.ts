import { createElement } from "react";
import { ImageResponse } from "next/og";
import { PageOgImage } from "@/components/PageOgImage";
import { PAGE_OG_IMAGE_SIZE } from "@/lib/marketing/site";
import { buildSitePageOgCopy, parseOgLocale } from "@/lib/og/page-og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ variant: string }> },
) {
  const { variant } = await params;
  const locale = parseOgLocale(new URL(request.url).searchParams.get("locale"));
  const copy = buildSitePageOgCopy(variant, locale);

  return new ImageResponse(createElement(PageOgImage, { copy }), {
    ...PAGE_OG_IMAGE_SIZE,
    headers: {
      "Cache-Control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
