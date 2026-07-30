import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { isMarketIssueAdmin } from "@/lib/market-issues/access";
import {
  getMarketIssueSettings,
  updateMarketIssueSettings,
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
      settings: await getMarketIssueSettings(getMarketIssueServiceClient()),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("market_issue_settings_read_failed", error);
    return NextResponse.json({ error: "market_issue_settings_read_failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser().catch(() => null);
  if (!user || !isMarketIssueAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  try {
    const settings = await updateMarketIssueSettings(
      getMarketIssueServiceClient(),
      user.id,
      {
        ...(typeof body.feedEnabled === "boolean" ? { feedEnabled: body.feedEnabled } : {}),
        ...(typeof body.ingestionEnabled === "boolean" ? { ingestionEnabled: body.ingestionEnabled } : {}),
        ...(typeof body.manualReviewRequired === "boolean"
          ? { manualReviewRequired: body.manualReviewRequired }
          : {}),
        ...(typeof body.maxPublishedPerDay === "number"
          ? { maxPublishedPerDay: body.maxPublishedPerDay }
          : {}),
      },
    );
    return NextResponse.json({ settings }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("market_issue_settings_update_failed", error);
    return NextResponse.json({ error: "market_issue_settings_update_failed" }, { status: 500 });
  }
}
