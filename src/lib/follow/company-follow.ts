import {
  CoverageLimitError,
  setCompanyCoverageLevelWithEvent,
  type CompanyCoverageMutationResult,
} from "@/lib/coverage/repository";
import {
  disableFilingSubscription,
  enableFilingSubscription,
} from "@/lib/filing-notifications/subscription-service";
import { setMarketIssueCompanyFollow } from "@/lib/market-issues/repository";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";
import { getIndexedCompanyBrowseCards } from "@/lib/ontology/catalog";
import { normalizeTicker, normalizeTickers } from "@/lib/ontology/ticker";
import { recordRetentionMilestone } from "@/lib/retention/milestones";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UserCompanyMark } from "@/types/api-contracts";

export type FollowAlertsStatus = "on" | "no_sec_id";

export type FollowedCompanySummary = {
  ticker: string;
  name: string;
  sector: string | null;
  followed_at: string;
};

/**
 * 관심 마킹 전체 조회(모든 플랜). 리서치 노트북용 listWatchlistOverview와
 * 달리 노트·질문까지 묻지 않고, 카드 목록에 필요한 회사 메타데이터만
 * 붙인다. 인덱스에 없는 티커는 이름을 티커로 대체한다.
 */
export async function listUserCompanyFollows(
  userId: string,
): Promise<FollowedCompanySummary[]> {
  const { data: marks, error } = await getSupabaseAdmin()
    .from("user_company_marks")
    .select("ticker, coverage_level, updated_at")
    .eq("user_id", userId)
    .not("coverage_level", "is", null)
    .order("updated_at", { ascending: false })
    .returns<{ ticker: string; coverage_level: string; updated_at: string }[]>();

  if (error) {
    throw new Error(`Failed to load followed companies: ${error.message}`);
  }

  const tickers = normalizeTickers((marks ?? []).map((mark) => mark.ticker));
  const companies = await getIndexedCompanyBrowseCards(tickers);
  const cardByTicker = new Map(
    companies.map((company) => [company.ticker, company]),
  );

  return (marks ?? []).flatMap((mark) => {
    const ticker = normalizeTicker(mark.ticker);
    if (!ticker) return [];
    const card = cardByTicker.get(ticker);
    return [
      {
        ticker,
        name: card?.name ?? ticker,
        sector: card?.sector ?? null,
        followed_at: mark.updated_at,
      },
    ];
  });
}

export type FollowCompanyResult =
  | {
      ok: true;
      mark: UserCompanyMark | null;
      alerts: FollowAlertsStatus;
      newsFollow: boolean;
      coverageResult: CompanyCoverageMutationResult;
    }
  | { ok: false; reason: "limit_reached" | "error" };

/**
 * 관심 = 알림. 관심 마킹을 앞세우고(한도·멱등의 원천) 공시 구독과 뉴스
 * 팔로우를 뒤따른다. 구독·팔로우의 부분 실패는 관심 자체를 무효화하지
 * 않는다 — 알림만 좁혀질 뿐이다.
 */
export async function followCompanyServer(input: {
  userId: string;
  userEmail?: string | null;
  ticker: string;
  source?: string;
}): Promise<FollowCompanyResult> {
  try {
    let coverageResult: CompanyCoverageMutationResult;
    try {
      coverageResult = await setCompanyCoverageLevelWithEvent({
        userId: input.userId,
        userEmail: input.userEmail,
        ticker: input.ticker,
        coverageLevel: "interest",
        source: input.source ?? "company_follow",
      });
    } catch (error) {
      if (error instanceof CoverageLimitError) {
        return { ok: false, reason: "limit_reached" };
      }
      throw error;
    }
    if (
      coverageResult.changed &&
      !coverageResult.idempotentReplay &&
      coverageResult.previousLevel === null
    ) {
      await recordRetentionMilestone(input.userId, "first_company_followed", {
        ticker: input.ticker,
      });
    }
    const [alerts, newsFollow] = await Promise.all([
      enableFilingSubscription({ userId: input.userId, ticker: input.ticker }),
      setMarketIssueCompanyFollow({
        db: getMarketIssueServiceClient(),
        userId: input.userId,
        ticker: input.ticker,
        following: true,
      })
        .then(() => true)
        .catch(() => false),
    ]);
    if (alerts.status === "on") {
      await recordRetentionMilestone(input.userId, "first_filing_subscription", {
        ticker: input.ticker,
      });
    }
    return {
      ok: true,
      mark: coverageResult.mark,
      alerts: alerts.status === "on" ? "on" : "no_sec_id",
      newsFollow,
      coverageResult,
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function unfollowCompanyServer(input: {
  userId: string;
  userEmail?: string | null;
  ticker: string;
}): Promise<{ ok: boolean }> {
  try {
    await setCompanyCoverageLevelWithEvent({
      userId: input.userId,
      userEmail: input.userEmail,
      ticker: input.ticker,
      coverageLevel: null,
      source: "company_unfollow",
    });
    await disableFilingSubscription({
      userId: input.userId,
      ticker: input.ticker,
    }).catch(() => null);
    await setMarketIssueCompanyFollow({
      db: getMarketIssueServiceClient(),
      userId: input.userId,
      ticker: input.ticker,
      following: false,
    }).catch(() => null);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
