import "server-only";

import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { marketIssueEnvironment } from "@/lib/market-issues/config";

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 12;
const MAX_MATCHED_ISSUES = 100;

type CompanyMarketNewsEntityRow = {
  issue_id: string;
};

type CompanyMarketNewsIssueRow = {
  id: string;
  title_ko: string;
  summary_ko: string;
  impact_path: string[] | null;
  published_at: string | null;
  updated_at: string | null;
};

export type CompanyMarketNews = {
  id: string;
  title: string;
  summary: string;
  impactPath: string[];
  publishedAt: string | null;
  updatedAt: string | null;
};

/**
 * Returns public market issues whose entity map explicitly includes a company.
 * This is a canonical company-reference surface, independent of a user's
 * personalized news feed or hidden-state preferences.
 */
export async function getRecentCompanyMarketNews(
  rawTicker: string,
  requestedLimit = DEFAULT_LIMIT,
): Promise<CompanyMarketNews[]> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return [];

  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), MAX_LIMIT))
    : DEFAULT_LIMIT;
  const admin = getSupabaseAdmin();
  const { data: entityRows, error: entityError } = await admin
    .from("market_issue_entities")
    .select("issue_id")
    .eq("ticker", ticker)
    .limit(MAX_MATCHED_ISSUES)
    .returns<CompanyMarketNewsEntityRow[]>();

  if (entityError) {
    throw new Error(`Failed to load linked market news for ${ticker}: ${entityError.message}`);
  }

  const issueIds = Array.from(new Set(
    (entityRows ?? []).map((entity) => entity.issue_id).filter(Boolean),
  ));
  if (issueIds.length === 0) return [];

  const { data: issueRows, error: issuesError } = await admin
    .from("market_issues")
    .select("id,title_ko,summary_ko,impact_path,published_at,updated_at")
    .eq("env", marketIssueEnvironment())
    .eq("state", "published")
    .is("merged_into_issue_id", null)
    .in("id", issueIds)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<CompanyMarketNewsIssueRow[]>();

  if (issuesError) {
    throw new Error(`Failed to load market news details for ${ticker}: ${issuesError.message}`);
  }

  return (issueRows ?? []).map((issue) => ({
    id: issue.id,
    title: issue.title_ko.trim() || "시장 이슈 정리 중",
    summary: issue.summary_ko.trim() || "한국어 맥락을 정리 중입니다.",
    impactPath: Array.isArray(issue.impact_path)
      ? issue.impact_path.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
      : [],
    publishedAt: issue.published_at,
    updatedAt: issue.updated_at,
  }));
}
