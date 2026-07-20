import "server-only";

import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  CompanyCoverageTimelineItem,
  CompanyCoverageTimelineResponse,
} from "@/types/api-contracts";
import type {
  UserCompanyCoverageEventRow,
  UserFilingJudgmentRevisionRow,
} from "@/types/database";

interface TimelineCursor {
  at: string;
  id: string;
}

export async function listCompanyCoverageTimeline(input: {
  userId: string;
  ticker: string;
  limit?: number;
  cursor?: string | null;
}): Promise<CompanyCoverageTimelineResponse> {
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) throw new Error("invalid_ticker");
  const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
  const cursor = decodeCursor(input.cursor);
  const admin = getSupabaseAdmin();

  let coverageQuery = admin
    .from("user_company_coverage_events")
    .select("id,user_id,ticker,previous_coverage_level,coverage_level,changed,source,idempotency_key,created_at")
    .eq("user_id", input.userId)
    .eq("ticker", ticker)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  let judgmentQuery = admin
    .from("user_filing_judgment_revisions")
    .select("id,judgment_id,user_id,filing_event_id,ticker,revision_number,impact,next_action,summary,rationale,is_current,idempotency_key,created_at")
    .eq("user_id", input.userId)
    .eq("ticker", ticker)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    const boundary = `created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`;
    coverageQuery = coverageQuery.or(boundary);
    judgmentQuery = judgmentQuery.or(boundary);
  }

  const [coverageResult, judgmentResult] = await Promise.all([
    coverageQuery.returns<UserCompanyCoverageEventRow[]>(),
    judgmentQuery.returns<UserFilingJudgmentRevisionRow[]>(),
  ]);
  if (coverageResult.error) throw new Error(`Failed to load coverage timeline: ${coverageResult.error.message}`);
  if (judgmentResult.error) throw new Error(`Failed to load judgment timeline: ${judgmentResult.error.message}`);

  const merged: CompanyCoverageTimelineItem[] = [
    ...(coverageResult.data ?? []).map((row) => ({
      type: "coverage_change" as const,
      id: row.id,
      occurred_at: row.created_at,
      previous_coverage_level: row.previous_coverage_level,
      coverage_level: row.coverage_level,
      changed: row.changed,
      source: row.source,
    })),
    ...(judgmentResult.data ?? []).map((row) => ({
      type: "filing_judgment" as const,
      id: row.id,
      occurred_at: row.created_at,
      filing_event_id: row.filing_event_id,
      revision_number: row.revision_number,
      impact: row.impact,
      next_action: row.next_action,
      summary: row.summary,
    })),
  ].sort(compareTimelineItems);
  const hasMore = merged.length > limit;
  const items = merged.slice(0, limit);
  const last = items.at(-1);
  return {
    ticker,
    items,
    next_cursor: hasMore && last ? encodeCursor({ at: last.occurred_at, id: last.id }) : null,
  };
}

function compareTimelineItems(a: CompanyCoverageTimelineItem, b: CompanyCoverageTimelineItem) {
  const byDate = b.occurred_at.localeCompare(a.occurred_at);
  return byDate || b.id.localeCompare(a.id);
}

function encodeCursor(cursor: TimelineCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null | undefined): TimelineCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<TimelineCursor>;
    if (typeof parsed.at !== "string" || !Number.isFinite(Date.parse(parsed.at)) || typeof parsed.id !== "string") {
      return null;
    }
    return { at: new Date(parsed.at).toISOString(), id: parsed.id };
  } catch {
    return null;
  }
}
