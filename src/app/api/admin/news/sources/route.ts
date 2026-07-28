import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { isMarketIssueAdmin } from "@/lib/market-issues/access";
import {
  createMarketIssueSource,
  listMarketIssueSources,
} from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthUser().catch(() => null);
  if (!user || !isMarketIssueAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      sources: await listMarketIssueSources(getMarketIssueServiceClient()),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("market_issue_sources_list_failed", error);
    return NextResponse.json({ error: "market_issue_sources_list_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getAuthUser().catch(() => null);
  if (!user || !isMarketIssueAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const sourceClass = body.sourceClass;
  if (
    typeof body.accountHandle !== "string" ||
    typeof body.displayName !== "string" ||
    !["government", "regulator", "company_official", "exchange", "registered_media", "journalist", "expert"].includes(String(sourceClass))
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const source = await createMarketIssueSource({
      db: getMarketIssueServiceClient(),
      actorUserId: user.id,
      accountHandle: body.accountHandle,
      displayName: body.displayName,
      sourceClass: sourceClass as "government" | "regulator" | "company_official" | "exchange" | "registered_media" | "journalist" | "expert",
      sourceTags: Array.isArray(body.sourceTags)
        ? body.sourceTags.filter((item): item is string => typeof item === "string")
        : [],
    });
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    console.error("market_issue_source_create_failed", error);
    return NextResponse.json({ error: "market_issue_source_create_failed" }, { status: 400 });
  }
}
