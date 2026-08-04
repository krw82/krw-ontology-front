import type { SupabaseClient } from "@supabase/supabase-js";

import { marketIssueEnvironment } from "@/lib/market-issues/config";

type Db = SupabaseClient<any>;
type Row = Record<string, unknown>;

export class MarketIssueAgentContextError extends Error {}

export async function buildMarketIssueAgentContext(input: {
  db: Db;
  issueId: string;
}): Promise<Record<string, unknown>> {
  const environment = marketIssueEnvironment();
  const { data: issueData, error: issueError } = await input.db
    .from("market_issues")
    .select("id, title_ko, summary_ko, confirmed_facts, active_research_packet_id")
    .eq("id", input.issueId)
    .eq("env", environment)
    .eq("state", "published")
    .maybeSingle();
  if (issueError) throw issueError;
  const issue = asRow(issueData);
  if (!issue.id) throw new MarketIssueAgentContextError("market_issue_not_available");

  const packetId = stringValue(issue.active_research_packet_id);
  if (!packetId) throw new MarketIssueAgentContextError("market_issue_packet_not_ready");
  const { data: packetData, error: packetError } = await input.db
    .from("market_issue_research_packets")
    .select("payload")
    .eq("id", packetId)
    .eq("env", environment)
    .maybeSingle();
  if (packetError) throw packetError;
  const payload = asRow(asRow(packetData).payload);
  const researchContext = asRow(payload.research_context);
  const tickers = stringArray(researchContext.primaryTickers)
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(ticker));
  // Macro/policy issues (USTradeRep, USTreasury, macro commentators) may not
  // resolve to a specific company ticker. Instead of blocking, let them flow
  // through as a ticker-less context — the chat route routes these to wide
  // research (idea_generation) instead of company_research.
  const isMacroEvent = tickers.length === 0;

  const claims = rows(payload.claims).map((claim) => ({
    id: stringValue(claim.id),
    claim_ko: stringValue(claim.claim_ko),
    source_quote: stringValue(claim.source_quote),
    raw_value: stringValue(claim.raw_value),
  })).filter((claim) => claim.claim_ko || claim.source_quote);
  const sourcePreviews = rows(researchContext.sources).map((source) => ({
    title: stringValue(source.publisher) || "공식 원문",
    url: stringValue(source.canonicalUrl),
    published_at: stringValue(source.publishedAt),
  })).filter((source) => source.url);
  const originalText = claims.map((claim) => claim.source_quote || claim.claim_ko)
    .join("\n")
    .slice(0, 12_000);
  const confirmedFacts = stringArray(issue.confirmed_facts).join("; ");
  const ontologySearchBriefEn = isMacroEvent
    ? [
        `Macro market event: ${stringValue(issue.title_ko)}.`,
        "Interpret the market/macro event. Focus on sector impact, rate/currency/inflation implications, and which companies or industries are most affected.",
        originalText ? `Official source claims: ${originalText}` : `Confirmed facts: ${confirmedFacts}`,
      ].join("\n")
    : [
        `Official company event for ${tickers.join(", ")}.`,
        "Interpret the event against the latest filing baseline. Focus on revenue growth quality, gross margin, operating cash flow, capital expenditures, and management commentary.",
        originalText ? `Official source claims: ${originalText}` : `Confirmed facts: ${confirmedFacts}`,
      ].join("\n");

  return {
    version: "market-issue-research-context/v1",
    id: issue.id,
    event_title: stringValue(issue.title_ko),
    event_summary: stringValue(issue.summary_ko),
    primary_tickers: tickers,
    is_macro_event: isMacroEvent,
    claim_ids: claims.map((claim) => claim.id).filter(Boolean),
    selected_event: {
      id: issue.id,
      event_title: stringValue(issue.title_ko),
      summary: stringValue(issue.summary_ko),
      tickers,
      claims,
      source_previews: sourcePreviews,
    },
    source_pack: {
      source_read_status: "read",
      original_text_for_ontology: originalText || confirmedFacts,
      ontology_search_brief_en: ontologySearchBriefEn,
      source_urls: sourcePreviews.map((source) => source.url),
    },
  };
}

function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(asRow).filter((row) => Object.keys(row).length > 0) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
