import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PulseLinkedThesis,
  UserFilingJudgmentSummary,
} from "@/types/api-contracts";
import type {
  Database,
  UserCompanyThesisRow,
  UserFilingJudgmentRevisionRow,
  UserFilingJudgmentThesisLinkRow,
} from "@/types/database";

type DecisionContext = {
  judgment: UserFilingJudgmentSummary;
  linked_thesis: PulseLinkedThesis | null;
};

interface CurrentThesisLinkRow extends UserFilingJudgmentThesisLinkRow {
  user_company_theses: Pick<UserCompanyThesisRow, "id" | "title" | "status" | "user_id">;
}
export async function getPulseFilingDecisionContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  eventIds: string[],
): Promise<Map<string, DecisionContext>> {
  const boundedEventIds = Array.from(
    new Set(eventIds.filter((id) => typeof id === "string" && id.length > 0)),
  ).slice(0, 200);
  if (!userId || boundedEventIds.length === 0) return new Map();

  const [revisionResult, thesisResult] = await Promise.all([
    supabase
      .from("user_filing_judgment_revisions")
      .select("id,judgment_id,user_id,filing_event_id,ticker,revision_number,impact,next_action,summary,rationale,is_current,idempotency_key,created_at")
      .eq("user_id", userId)
      .eq("is_current", true)
      .in("filing_event_id", boundedEventIds)
      .returns<UserFilingJudgmentRevisionRow[]>(),
    supabase
      .from("user_filing_judgment_thesis_links")
      .select("revision_id,judgment_id,user_id,filing_event_id,ticker,thesis_id,impact,position,is_current,created_at,user_company_theses!inner(id,title,status,user_id)")
      .eq("user_id", userId)
      .eq("is_current", true)
      .in("filing_event_id", boundedEventIds)
      .eq("user_company_theses.user_id", userId)
      .order("position", { ascending: true })
      .returns<CurrentThesisLinkRow[]>(),
  ]);

  if (revisionResult.error) {
    throw new Error(`Failed to batch-load filing judgments: ${revisionResult.error.message}`);
  }
  if (thesisResult.error) {
    throw new Error(`Failed to batch-load linked theses: ${thesisResult.error.message}`);
  }

  const firstThesisByRevision = new Map<string, PulseLinkedThesis>();
  for (const link of thesisResult.data ?? []) {
    if (firstThesisByRevision.has(link.revision_id)) continue;
    firstThesisByRevision.set(link.revision_id, {
      id: link.user_company_theses.id,
      title: link.user_company_theses.title,
      status: link.user_company_theses.status,
    });
  }

  const result = new Map<string, DecisionContext>();
  for (const revision of revisionResult.data ?? []) {
    result.set(revision.filing_event_id, {
      judgment: {
        id: revision.judgment_id,
        filing_event_id: revision.filing_event_id,
        ticker: revision.ticker,
        current_revision_id: revision.id,
        revision_number: revision.revision_number,
        impact: revision.impact,
        next_action: revision.next_action,
        summary: revision.summary,
        updated_at: revision.created_at,
      },
      linked_thesis: firstThesisByRevision.get(revision.id) ?? null,
    });
  }
  return result;
}
