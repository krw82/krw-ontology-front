import { NextRequest, NextResponse } from "next/server";
import { getOptionalAuthUser } from "@/lib/auth";
import { isMarketIssueScope } from "@/lib/market-issues/contract";
import { listMarketIssues } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getOptionalAuthUser();

  const scopeParam = request.nextUrl.searchParams.get("scope");
  const scope = isMarketIssueScope(scopeParam) ? scopeParam : "market";
  try {
    const payload = await listMarketIssues({
      db: getMarketIssueServiceClient(),
      userId: user?.id ?? null,
      scope,
      cursor: request.nextUrl.searchParams.get("cursor"),
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_list_failed", error);
    return NextResponse.json({ error: "market_issue_list_failed" }, { status: 500 });
  }
}
