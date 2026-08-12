import type { SupabaseClient } from "@supabase/supabase-js";

import type { MarketIssueEnvironment } from "@/lib/market-issues/config";
import type { LocalNewsPublishMode } from "@/lib/local-news/config";

type Db = SupabaseClient;

export type LocalNewsPublicIssue = {
  titleKo: string;
  summaryKo: string;
  impactPath: string[];
  confirmedFacts: string[];
  riskLevel: "low" | "medium" | "high";
  stage: "ai_verified";
};

/**
 * Writes only the public projection. Provider, original URL, article ID,
 * source timestamp, source hash, and evidence quotes stay in LocalNewsVault.
 */
export async function publishLocalNewsIssue(input: {
  db: Db;
  environment: MarketIssueEnvironment;
  eventKey: string;
  ticker: string;
  issue: LocalNewsPublicIssue;
  publishMode: LocalNewsPublishMode;
  original: { headline: string; summary: string };
}): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await input.db
    .from("market_issues")
    .upsert(buildLocalNewsPublicIssueRow({ ...input, now }), { onConflict: "env,event_key" })
    .select("id")
    .single();
  if (error) throw error;
  const issueId = typeof data?.id === "string" ? data.id : "";
  if (!issueId) throw new Error("local_news_public_issue_missing_id");

  const { error: materialError } = await input.db
    .from("market_local_news_private_materials")
    .upsert({
      issue_id: issueId,
      original_headline: input.original.headline,
      original_summary: input.original.summary,
      original_language: "en",
      updated_at: now,
    }, { onConflict: "issue_id" });
  if (materialError) throw materialError;

  const { error: deleteError } = await input.db
    .from("market_issue_entities")
    .delete()
    .eq("issue_id", issueId);
  if (deleteError) throw deleteError;

  const { error: entityError } = await input.db.from("market_issue_entities").insert({
    issue_id: issueId,
    entity_type: "company",
    ticker: input.ticker,
    entity_name: input.ticker,
    relationship: "direct",
    relationship_reason: "뉴스에서 언급된 종목",
    confidence: 1,
  });
  if (entityError) throw entityError;
  return issueId;
}

export function buildLocalNewsPublicIssueRow(input: {
  environment: MarketIssueEnvironment;
  eventKey: string;
  issue: LocalNewsPublicIssue;
  publishMode: LocalNewsPublishMode;
  now: string;
}): Record<string, unknown> {
  const published = input.publishMode === "publish";
  return {
    env: input.environment,
    event_key: input.eventKey,
    state: published ? "published" : "review",
    summary_status: "ready",
    title_ko: input.issue.titleKo,
    summary_ko: input.issue.summaryKo,
    impact_path: input.issue.impactPath,
    confirmed_facts: input.issue.confirmedFacts,
    unconfirmed_facts: [],
    status_labels: ["추가 확인 필요"],
    source_summary: {},
    source_count: 0,
    market_score: 0,
    risk_level: input.issue.riskLevel,
    local_news_stage: input.issue.stage,
    requires_manual_review: !published,
    update_count: 0,
    first_observed_at: input.now,
    published_at: published ? input.now : null,
    last_published_at: published ? input.now : null,
    updated_at: input.now,
  };
}

export async function promoteLocalNewsIssue(input: {
  db: Db;
  environment: MarketIssueEnvironment;
  eventKey: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await input.db
    .from("market_issues")
    .update({
      state: "published",
      requires_manual_review: false,
      published_at: now,
      last_published_at: now,
      updated_at: now,
    })
    .eq("env", input.environment)
    .eq("event_key", input.eventKey)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("local_news_review_projection_missing");
}
