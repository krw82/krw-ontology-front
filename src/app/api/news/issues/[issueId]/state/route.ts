import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { updateMarketIssueUserState } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";

function parseBody(value: unknown): { isSaved?: boolean; isHidden?: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.isSaved !== undefined && typeof body.isSaved !== "boolean") return null;
  if (body.isHidden !== undefined && typeof body.isHidden !== "boolean") return null;
  return {
    ...(typeof body.isSaved === "boolean" ? { isSaved: body.isSaved } : {}),
    ...(typeof body.isHidden === "boolean" ? { isHidden: body.isHidden } : {}),
  };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ issueId: string }> },
) {
  const user = await getAuthUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = parseBody(await request.json().catch(() => null));
  if (!body || Object.keys(body).length === 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { issueId } = await context.params;
  try {
    const state = await updateMarketIssueUserState({
      db: getMarketIssueServiceClient(),
      userId: user.id,
      issueId,
      ...body,
    });
    return NextResponse.json({ state }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_state_update_failed", error);
    return NextResponse.json({ error: "market_issue_state_update_failed" }, { status: 500 });
  }
}
