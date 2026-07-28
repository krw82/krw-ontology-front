import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createMarketIssueResearchDraft } from "@/lib/market-issues/repository";
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
    const draft = await createMarketIssueResearchDraft({
      db: getMarketIssueServiceClient(),
      userId: user.id,
      issueId,
    });
    return NextResponse.json({ draft }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_research_draft_failed", error);
    return NextResponse.json({ error: "market_issue_research_draft_failed" }, { status: 500 });
  }
}
