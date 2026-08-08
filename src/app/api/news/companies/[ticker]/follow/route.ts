import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { setMarketIssueCompanyFollow } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

async function changeFollow(
  _request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
  following: boolean,
) {
  const user = await getAuthUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { ticker } = await context.params;
  try {
    await setMarketIssueCompanyFollow({
      db: getMarketIssueServiceClient(),
      userId: user.id,
      ticker,
      following,
    });
    return NextResponse.json({ following }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_company_follow_failed", error);
    return NextResponse.json({ error: "market_issue_company_follow_failed" }, { status: 400 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  return changeFollow(request, context, true);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  return changeFollow(request, context, false);
}
