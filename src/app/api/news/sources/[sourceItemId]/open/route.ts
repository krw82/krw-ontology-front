import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getMarketIssueSourceRedirect } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sourceItemId: string }> },
) {
  const user = await getAuthUser().catch(() => null);
  if (!user) return NextResponse.redirect(new URL("/login?next=/news", request.url));
  const { sourceItemId } = await context.params;
  try {
    const href = await getMarketIssueSourceRedirect({
      db: getMarketIssueServiceClient(),
      userId: user.id,
      sourceItemId,
    });
    if (!href) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.redirect(href, { status: 302 });
  } catch (error) {
    console.error("market_issue_source_open_failed", error);
    return NextResponse.json({ error: "market_issue_source_open_failed" }, { status: 500 });
  }
}
