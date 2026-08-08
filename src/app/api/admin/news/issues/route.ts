import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { isMarketIssueAdmin } from "@/lib/market-issues/access";
import { listMarketIssueAdminIssues } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getAuthUser().catch(() => null);
  if (!user || !isMarketIssueAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const issues = await listMarketIssueAdminIssues(
      getMarketIssueServiceClient(),
      request.nextUrl.searchParams.get("state"),
    );
    return NextResponse.json({ issues }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_admin_list_failed", error);
    return NextResponse.json({ error: "market_issue_admin_list_failed" }, { status: 500 });
  }
}
