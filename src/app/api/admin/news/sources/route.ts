import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { isMarketIssueAdmin } from "@/lib/market-issues/access";
import {
  createMarketIssueSource,
  createMarketIssueWebSource,
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
  const validSourceClass = ["government", "regulator", "company_official", "exchange", "registered_media", "journalist", "expert"];
  if (
    typeof body.displayName !== "string" ||
    (typeof body.sourceType === "string" && !["x", "web", "sec"].includes(body.sourceType)) ||
    !validSourceClass.includes(String(sourceClass))
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const webSourceType = body.sourceType === "web" || body.sourceType === "sec"
      ? body.sourceType
      : null;
    if (webSourceType && (
      typeof body.sourceKey !== "string"
      || typeof body.adapterType !== "string"
      || typeof body.discoveryUrl !== "string"
      || typeof body.canonicalHost !== "string"
    )) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    if (!webSourceType && typeof body.accountHandle !== "string") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const common = {
      db: getMarketIssueServiceClient(),
      actorUserId: user.id,
      displayName: body.displayName,
      sourceClass: sourceClass as "government" | "regulator" | "company_official" | "exchange" | "registered_media" | "journalist" | "expert",
      sourceTags: Array.isArray(body.sourceTags)
        ? body.sourceTags.filter((item): item is string => typeof item === "string")
        : [],
    };
    const source = webSourceType
      ? await createMarketIssueWebSource({
        ...common,
        sourceKey: body.sourceKey as string,
        sourceType: webSourceType,
        adapterType: body.adapterType as "rss" | "atom" | "json_feed" | "sitemap" | "html_list" | "json_api" | "sec_catalog",
        discoveryUrl: body.discoveryUrl as string,
        canonicalHost: body.canonicalHost as string,
        ...(typeof body.channelType === "string" ? { channelType: body.channelType } : {}),
        ...(typeof body.pollIntervalSeconds === "number" ? { pollIntervalSeconds: body.pollIntervalSeconds } : {}),
        ...(typeof body.priority === "number" ? { priority: body.priority } : {}),
        ...(typeof body.maxItemsPerPoll === "number" ? { maxItemsPerPoll: body.maxItemsPerPoll } : {}),
        ...(typeof body.requiresBrowser === "boolean" ? { requiresBrowser: body.requiresBrowser } : {}),
        ...(isRecord(body.adapterConfig) ? { adapterConfig: body.adapterConfig } : {}),
      })
      : await createMarketIssueSource({ ...common, accountHandle: body.accountHandle as string });
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    console.error("market_issue_source_create_failed", error);
    return NextResponse.json({ error: "market_issue_source_create_failed" }, { status: 400 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
