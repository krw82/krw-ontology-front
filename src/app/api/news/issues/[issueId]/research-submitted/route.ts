import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { recordMarketIssueEvent } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ issueId: string }> },
) {
  const user = await getAuthUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { issueId } = await context.params;
  try {
    await recordMarketIssueEvent(getMarketIssueServiceClient(), {
      userId: user.id,
      issueId,
      eventName: "market_issue_research_submitted",
    });
    return NextResponse.json({ ok: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_research_submitted_failed", error);
    return NextResponse.json({ error: "market_issue_research_submitted_failed" }, { status: 500 });
  }
}
