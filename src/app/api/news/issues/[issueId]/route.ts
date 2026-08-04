import { NextRequest, NextResponse } from "next/server";
import { getOptionalAuthUser } from "@/lib/auth";
import { getMarketIssueDetail } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ issueId: string }> },
) {
  const user = await getOptionalAuthUser();
  const { issueId } = await context.params;
  try {
    const payload = await getMarketIssueDetail({
      db: getMarketIssueServiceClient(),
      userId: user?.id ?? null,
      issueId,
    });
    if (!payload) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_detail_failed", error);
    return NextResponse.json({ error: "market_issue_detail_failed" }, { status: 500 });
  }
}
