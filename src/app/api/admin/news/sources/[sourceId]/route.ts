import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { isMarketIssueAdmin } from "@/lib/market-issues/access";
import { updateMarketIssueSource } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ sourceId: string }> },
) {
  const user = await getAuthUser().catch(() => null);
  if (!user || !isMarketIssueAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const { sourceId } = await context.params;
  try {
    const source = await updateMarketIssueSource({
      db: getMarketIssueServiceClient(),
      actorUserId: user.id,
      sourceId,
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
      ...(Array.isArray(body.sourceTags)
        ? { sourceTags: body.sourceTags.filter((item): item is string => typeof item === "string") }
        : {}),
      ...(typeof body.allowSingleSourcePublish === "boolean"
        ? { allowSingleSourcePublish: body.allowSingleSourcePublish }
        : {}),
    });
    return NextResponse.json({ source }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_source_update_failed", error);
    return NextResponse.json({ error: "market_issue_source_update_failed" }, { status: 500 });
  }
}
