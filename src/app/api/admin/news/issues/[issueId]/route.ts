import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { isMarketIssueAdmin } from "@/lib/market-issues/access";
import {
  isMarketIssueStatusLabel,
  parseMarketIssueResearchPaths,
  type MarketIssueStatusLabel,
} from "@/lib/market-issues/contract";
import {
  updateMarketIssueByAdmin,
  type MarketIssueAdminUpdate,
} from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

function parseUpdate(value: unknown): MarketIssueAdminUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const result: MarketIssueAdminUpdate = {};
  if (typeof body.state === "string" && ["draft", "review", "published", "hidden", "archived"].includes(body.state)) {
    result.state = body.state as MarketIssueAdminUpdate["state"];
  }
  if (typeof body.title === "string") result.title = body.title;
  if (typeof body.summary === "string") result.summary = body.summary;
  if (Array.isArray(body.impactPath)) result.impactPath = body.impactPath.filter((item): item is string => typeof item === "string");
  if (Array.isArray(body.confirmedFacts)) result.confirmedFacts = body.confirmedFacts.filter((item): item is string => typeof item === "string");
  if (Array.isArray(body.unconfirmedFacts)) result.unconfirmedFacts = body.unconfirmedFacts.filter((item): item is string => typeof item === "string");
  if (Array.isArray(body.researchPaths)) result.researchPaths = parseMarketIssueResearchPaths(body.researchPaths);
  if (Array.isArray(body.statusLabels)) {
    result.statusLabels = body.statusLabels.filter(
      (item): item is MarketIssueStatusLabel => isMarketIssueStatusLabel(item),
    );
  }
  if (body.riskLevel === "low" || body.riskLevel === "medium" || body.riskLevel === "high") {
    result.riskLevel = body.riskLevel;
  }
  if (typeof body.reason === "string") result.reason = body.reason;
  return Object.keys(result).length > 0 ? result : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ issueId: string }> },
) {
  const user = await getAuthUser().catch(() => null);
  if (!user || !isMarketIssueAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const update = parseUpdate(await request.json().catch(() => null));
  if (!update) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { issueId } = await context.params;
  try {
    const issue = await updateMarketIssueByAdmin(
      getMarketIssueServiceClient(),
      user.id,
      issueId,
      update,
    );
    return NextResponse.json({ issue }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_admin_update_failed", error);
    return NextResponse.json({ error: "market_issue_admin_update_failed" }, { status: 500 });
  }
}
