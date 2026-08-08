import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  createMarketIssueResearchDraft,
  MarketIssueResearchPathError,
} from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ issueId: string }> },
) {
  const user = await getAuthUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { issueId } = await context.params;
  const payload = await request.json().catch(() => null);
  const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const researchPathId = typeof payloadRecord?.researchPathId === "string"
    ? payloadRecord.researchPathId
    : null;
  try {
    const draft = await createMarketIssueResearchDraft({
      db: getMarketIssueServiceClient(),
      userId: user.id,
      issueId,
      researchPathId,
    });
    return NextResponse.json({ draft }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof MarketIssueResearchPathError) {
      return NextResponse.json({ error: "invalid_research_path" }, { status: 400 });
    }
    console.error("market_issue_research_draft_failed", error);
    return NextResponse.json({ error: "market_issue_research_draft_failed" }, { status: 500 });
  }
}
