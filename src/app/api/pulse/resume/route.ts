import { getOptionalAuthUser, handleAuthError } from "@/lib/auth";
import {
  getMarketIssueSettings,
} from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SEEN_ISSUES = 3;
const MAX_TICKERS = 5;
const MAX_CANDIDATE_ISSUES = 200;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

interface PulseResumeItem {
  ticker: string;
  company_name: string | null;
  last_issue_id: string;
  last_issue_title: string | null;
  new_count: number;
  latest_issue_id: string | null;
}

interface SeenStateRow {
  issue_id: string | null;
  last_seen_at: string | null;
}

interface IssueRow {
  id: string | null;
  title_ko: string | null;
  published_at: string | null;
}

interface EntityRow {
  issue_id: string | null;
  ticker: string | null;
  entity_name: string | null;
}

/**
 * "Resume where you left off" payload for the Pulse feed: the issues the
 * user most recently opened, and how many newer published issues involve the
 * same companies since each visit. Anonymous visitors and users with nothing
 * new get an empty list so the banner can stay hidden.
 */
export async function GET() {
  let user;
  try {
    user = await getOptionalAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) {
    return Response.json({ items: [] }, { headers: PRIVATE_HEADERS });
  }

  try {
    const db = getMarketIssueServiceClient();
    const settings = await getMarketIssueSettings(db);
    if (!settings.feedEnabled) {
      return Response.json({ items: [] }, { headers: PRIVATE_HEADERS });
    }

    const { data: seenStates, error: seenError } = await db
      .from("market_issue_user_states")
      .select("issue_id, last_seen_at")
      .eq("user_id", user.id)
      .eq("is_hidden", false)
      .order("last_seen_at", { ascending: false })
      .limit(MAX_SEEN_ISSUES);
    if (seenError) throw seenError;
    const seenRows = (seenStates ?? []).filter(
      (row): row is SeenStateRow & { issue_id: string; last_seen_at: string } =>
        Boolean(row?.issue_id && row?.last_seen_at),
    );
    if (seenRows.length === 0) {
      return Response.json({ items: [] }, { headers: PRIVATE_HEADERS });
    }
    const lastSeenByIssueId = new Map(
      seenRows.map((row) => [row.issue_id, new Date(row.last_seen_at)]),
    );

    const { data: seenIssues, error: seenIssuesError } = await db
      .from("market_issues")
      .select("id, title_ko, published_at")
      .eq("env", settings.env)
      .eq("state", "published")
      .in("id", seenRows.map((row) => row.issue_id));
    if (seenIssuesError) throw seenIssuesError;
    const activeSeenIssues = (seenIssues ?? []).filter(
      (row): row is IssueRow & { id: string } => Boolean(row?.id),
    );
    if (activeSeenIssues.length === 0) {
      return Response.json({ items: [] }, { headers: PRIVATE_HEADERS });
    }

    const { data: seenEntities, error: seenEntitiesError } = await db
      .from("market_issue_entities")
      .select("issue_id, ticker, entity_name")
      .in("issue_id", activeSeenIssues.map((issue) => issue.id));
    if (seenEntitiesError) throw seenEntitiesError;

    // Latest visit per ticker wins as the "since" cutoff; company name from
    // the most recently seen issue carrying that ticker.
    const cutoffByTicker = new Map<string, Date>();
    const companyNameByTicker = new Map<string, string>();
    const seenIssueByTicker = new Map<string, { id: string; title: string | null }>();
    for (const entity of (seenEntities ?? []) as EntityRow[]) {
      const ticker = entity?.ticker?.trim().toUpperCase();
      const issueId = entity?.issue_id;
      if (!ticker || !issueId) continue;
      const cutoffCandidate = lastSeenByIssueId.get(issueId);
      if (!cutoffCandidate) continue;
      const existing = cutoffByTicker.get(ticker);
      if (!existing || cutoffCandidate > existing) {
        cutoffByTicker.set(ticker, cutoffCandidate);
        companyNameByTicker.set(ticker, entity.entity_name ?? ticker);
        const seenIssue = activeSeenIssues.find((issue) => issue.id === issueId);
        seenIssueByTicker.set(ticker, {
          id: issueId,
          title: seenIssue?.title_ko ?? null,
        });
      }
    }
    const tickers = [...cutoffByTicker.keys()].slice(0, MAX_TICKERS);
    if (tickers.length === 0) {
      return Response.json({ items: [] }, { headers: PRIVATE_HEADERS });
    }

    const { data: tickerEntities, error: tickerEntitiesError } = await db
      .from("market_issue_entities")
      .select("issue_id, ticker")
      .in("ticker", tickers);
    if (tickerEntitiesError) throw tickerEntitiesError;
    const tickersByIssueId = new Map<string, Set<string>>();
    for (const entity of (tickerEntities ?? []) as EntityRow[]) {
      const issueId = entity?.issue_id;
      const ticker = entity?.ticker?.trim().toUpperCase();
      if (!issueId || !ticker || !cutoffByTicker.has(ticker)) continue;
      const set = tickersByIssueId.get(issueId) ?? new Set<string>();
      set.add(ticker);
      tickersByIssueId.set(issueId, set);
    }

    const minCutoff = new Date(
      Math.min(...[...cutoffByTicker.values()].map((date) => date.getTime())),
    );
    const { data: candidates, error: candidatesError } = await db
      .from("market_issues")
      .select("id, title_ko, published_at")
      .eq("env", settings.env)
      .eq("state", "published")
      .in("id", [...tickersByIssueId.keys()])
      .gt("published_at", minCutoff.toISOString())
      .order("published_at", { ascending: false })
      .limit(MAX_CANDIDATE_ISSUES);
    if (candidatesError) throw candidatesError;

    const newCountByTicker = new Map<string, number>(tickers.map((t) => [t, 0]));
    const latestIssueIdByTicker = new Map<string, string>();
    for (const issue of (candidates ?? []) as IssueRow[]) {
      const issueId = issue?.id;
      const publishedAt = issue?.published_at ? new Date(issue.published_at) : null;
      if (!issueId || !publishedAt) continue;
      for (const ticker of tickersByIssueId.get(issueId) ?? []) {
        const cutoff = cutoffByTicker.get(ticker);
        if (!cutoff || publishedAt <= cutoff) continue;
        newCountByTicker.set(ticker, (newCountByTicker.get(ticker) ?? 0) + 1);
        if (!latestIssueIdByTicker.has(ticker)) {
          latestIssueIdByTicker.set(ticker, issueId);
        }
      }
    }

    const items: PulseResumeItem[] = tickers
      .map((ticker) => ({
        ticker,
        company_name: companyNameByTicker.get(ticker) ?? ticker,
        last_issue_id: seenIssueByTicker.get(ticker)?.id ?? "",
        last_issue_title: seenIssueByTicker.get(ticker)?.title ?? null,
        new_count: newCountByTicker.get(ticker) ?? 0,
        latest_issue_id: latestIssueIdByTicker.get(ticker) ?? null,
      }))
      .filter((item) => item.new_count > 0 && item.latest_issue_id)
      .sort((a, b) => b.new_count - a.new_count);

    return Response.json({ items }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error("pulse_resume_failed", error);
    return Response.json(
      { error: { code: "service_unavailable", message: "이어보기 정보를 불러오지 못했습니다." } },
      { status: 503 },
    );
  }
}
