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
import { recordRetentionMilestone } from "@/lib/retention/milestones";
import type { UserCompanyMark } from "@/types/api-contracts";

export type FollowAlertsStatus = "on" | "no_sec_id";

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
