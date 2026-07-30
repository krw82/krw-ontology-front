import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getMarketIssueStatus } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getMarketIssueStatus(getMarketIssueServiceClient()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_status_failed", error);
    return NextResponse.json({ error: "market_issue_status_failed" }, { status: 500 });
  }
}
