import { createElement } from "react";
import { ImageResponse } from "next/og";
import { ShareOgImage } from "@/components/ShareOgImage";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getPublicSessionShareForPage } from "@/lib/share/session-share-page";
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

  const share = await getPublicSessionShareForPage(token);
  if (!share) {
    return new Response("Not found", { status: 404 });
  }

  const companyName = await resolveShareCompanyName(share.tickers?.[0]);

  // buildShareOgCopy는 PublicMessageShare를 입력받으므로 호환 형태로 변환 (Task 5와 동일)
  const firstAnswer =
    share.messages.find((m) => m.role === "assistant")?.content ?? "";
  const ogInput = {
    title: share.title,
    question_content:
      share.messages.find((m) => m.role === "user")?.content ?? null,
    answer_content: firstAnswer,
    tickers: share.tickers,
    share_context: share.share_context,
    locale: share.locale,
  } as Parameters<typeof buildShareOgCopy>[0];

  const copy = buildShareOgCopy(ogInput, companyName);

  return new ImageResponse(createElement(ShareOgImage, { copy }), {
    ...SHARE_OG_IMAGE_SIZE,
    headers: {
      "Cache-Control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
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
