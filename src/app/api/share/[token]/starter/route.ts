import type { NextRequest } from "next/server";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { findPublicShareStarter } from "@/lib/share/message-share";

export const runtime = "nodejs";

const tokenPattern = /^[A-Za-z0-9_-]{16,80}$/;

function notFoundError() {
  return Response.json(
    {
      error: {
        code: "not_found" as const,
        message: "공유된 질문을 찾지 못했습니다.",
      },
    },
    { status: 404 },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!tokenPattern.test(token)) return notFoundError();

  const starter = await findPublicShareStarter(token);
  if (!starter) return notFoundError();

  await recordAnalyticsEventFromRequest(request, {
    eventName: "share_starter_loaded",
    properties: {
      token_present: true,
      ticker_count: starter.tickers?.length ?? 0,
      question_length: starter.question_content.length,
    },
  });

  return Response.json({
    question_content: starter.question_content,
    tickers: starter.tickers ?? [],
    title: starter.title,
  });
}
