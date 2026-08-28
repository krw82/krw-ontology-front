import { getOptionalAuthUser, handleAuthError } from "@/lib/auth";
import {
  getMarketIssueSettings,
} from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";
import {
  buildPulseResumeItems,
  resolveResumeScan,
  type ResumeCandidateEntityRow,
  type ResumeCandidateIssueRow,
  type ResumeSeenEntityRow,
  type ResumeSeenIssueRow,
  type ResumeSeenStateRow,
  type ResumeUserStateRow,
  type ResumeWatchlistMarkRow,
} from "@/lib/pulse/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SEEN_ISSUES = 3;
const MAX_CANDIDATE_ISSUES = 200;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

const EMPTY_RESPONSE = {
  items: [],
  overflow_count: 0,
};

/**
 * "관심 기업" tray payload for the Pulse feed: the union of watchlist
 * companies and companies from the user's most recently opened news issues.
 * Watchlist companies always appear; recent companies only when they have
 * news published since the visit. Anonymous visitors and users with no
 * companies get an empty list so the tray stays hidden.
 */
export async function GET() {
  let user;
  try {
    user = await getOptionalAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) {
    return Response.json(EMPTY_RESPONSE, { headers: PRIVATE_HEADERS });
  }

  try {
    const db = getMarketIssueServiceClient();
    const settings = await getMarketIssueSettings(db);
    if (!settings.feedEnabled) {
      return Response.json(EMPTY_RESPONSE, { headers: PRIVATE_HEADERS });
    }

    const watchlistResult = await db
      .from("user_company_marks")
      .select("ticker, created_at")
      .eq("user_id", user.id)
      .not("coverage_level", "is", null);
    if (watchlistResult.error) {
      throw new Error(watchlistResult.error.message);
    }
    const seenStatesResult = await db
      .from("market_issue_user_states")
      .select("issue_id, last_seen_at")
      .eq("user_id", user.id)
      .eq("is_hidden", false)
      .order("last_seen_at", { ascending: false })
      .limit(MAX_SEEN_ISSUES);
    if (seenStatesResult.error) {
      throw new Error(seenStatesResult.error.message);
    }
    const watchlistMarks = (watchlistResult.data ??
      []) as ResumeWatchlistMarkRow[];
    const seenStates = (seenStatesResult.data ??
      []) as ResumeSeenStateRow[];

    const activeSeenIds = seenStates
      .map((row) => row.issue_id)
      .filter((issueId): issueId is string => Boolean(issueId));
    if (watchlistMarks.length === 0 && activeSeenIds.length === 0) {
      return Response.json(EMPTY_RESPONSE, { headers: PRIVATE_HEADERS });
    }

    const seenIssuesResult = activeSeenIds.length
      ? await db
          .from("market_issues")
          .select("id, title_ko")
          .eq("env", settings.env)
          .eq("state", "published")
          .in("id", activeSeenIds)
      : { data: [], error: null };
    if (seenIssuesResult.error) throw new Error(seenIssuesResult.error.message);

    const seenEntityResult = activeSeenIds.length
      ? await db
          .from("market_issue_entities")
          .select("issue_id, ticker, entity_name")
          .in("issue_id", activeSeenIds)
      : { data: [], error: null };
    if (seenEntityResult.error) throw new Error(seenEntityResult.error.message);

    const scan = resolveResumeScan({
      watchlistMarks,
      seenStates,
      seenIssues: (seenIssuesResult.data ?? []) as ResumeSeenIssueRow[],
      seenEntities: (seenEntityResult.data ?? []) as ResumeSeenEntityRow[],
    });
    if (scan.scan_tickers.length === 0) {
      return Response.json(EMPTY_RESPONSE, { headers: PRIVATE_HEADERS });
    }

    const knownCutoffs = [...scan.cutoff_by_ticker.values()].filter(
      (cutoff): cutoff is Date => cutoff instanceof Date,
    );
    if (knownCutoffs.length === 0) {
      return Response.json(EMPTY_RESPONSE, { headers: PRIVATE_HEADERS });
    }
    const minCutoff = new Date(
      Math.min(...knownCutoffs.map((date) => date.getTime())),
    );

    const tickerEntitiesResult = await db
      .from("market_issue_entities")
      .select("issue_id, ticker, entity_name")
      .in("ticker", scan.scan_tickers);
    if (tickerEntitiesResult.error) {
      throw new Error(tickerEntitiesResult.error.message);
    }
    const candidateEntities = (tickerEntitiesResult.data ?? []) as ResumeCandidateEntityRow[];
    const candidateIssueIds = [
      ...new Set(
        candidateEntities
          .map((entity) => entity.issue_id)
          .filter((issueId): issueId is string => Boolean(issueId)),
      ),
    ];
    if (candidateIssueIds.length === 0) {
      return Response.json(EMPTY_RESPONSE, { headers: PRIVATE_HEADERS });
    }

    const userStatesResult = await db
      .from("market_issue_user_states")
      .select("issue_id, opened_at, is_hidden")
      .eq("user_id", user.id)
      .in("issue_id", candidateIssueIds);
    if (userStatesResult.error) {
      throw new Error(userStatesResult.error.message);
    }
    const userStates = (userStatesResult.data ?? []) as ResumeUserStateRow[];

    const candidatesResult = await db
      .from("market_issues")
      .select("id, title_ko, published_at")
      .eq("env", settings.env)
      .eq("state", "published")
      .in("id", candidateIssueIds)
      .gt("published_at", minCutoff.toISOString())
      .order("published_at", { ascending: false })
      .limit(MAX_CANDIDATE_ISSUES);
    if (candidatesResult.error) throw new Error(candidatesResult.error.message);

    const result = buildPulseResumeItems({
      scan,
      candidateIssues: (candidatesResult.data ?? []) as ResumeCandidateIssueRow[],
      candidateEntities,
      userStates,
    });

    return Response.json(result, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error("pulse_resume_failed", error);
    return Response.json(
      { error: { code: "service_unavailable", message: "이어보기 정보를 불러오지 못했습니다." } },
      { status: 503 },
    );
  }
}
