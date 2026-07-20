import "server-only";

import {
  resolveFilingAccess,
  resolveFilingContextTicker,
} from "@/lib/filing-notifications/filing-access";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  UserCompanyMonitoringRule,
  UserFilingJudgment,
  UserFilingJudgmentThesisLink,
} from "@/types/api-contracts";
import type {
  UserCompanyMonitoringRuleRow,
  UserCompanyThesisRow,
  SecFilingEventRow,
  UserFilingJudgmentRevisionRow,
  UserFilingJudgmentRow,
  UserFilingJudgmentThesisLinkRow,
} from "@/types/database";
import type { SaveFilingJudgmentInput } from "./contracts";

interface JudgmentRpcResult {
  judgment_id: string;
  revision_id: string;
  revision_number: number;
  idempotent_replay: boolean;
  created_rule_ids?: string[];
}

interface ThesisLinkJoinRow extends UserFilingJudgmentThesisLinkRow {
  user_company_theses: Pick<UserCompanyThesisRow, "id" | "title" | "status" | "user_id">;
}

interface MonitoringRuleJoinRow {
  revision_id: string;
  rule_id: string;
  user_id: string;
  position: number;
  user_company_monitoring_rules: UserCompanyMonitoringRuleRow;
}

export async function saveFilingJudgment(
  userId: string,
  filingEventId: string,
  input: SaveFilingJudgmentInput,
): Promise<{
  judgment: UserFilingJudgment;
  idempotent_replay: boolean;
  created_rule_ids: string[];
}> {
  const admin = getSupabaseAdmin();
  const { data: filing, error: filingError } = await admin
    .from("sec_filing_events")
    .select("*")
    .eq("id", filingEventId)
    .maybeSingle<SecFilingEventRow>();
  if (filingError) throw new Error("filing_access_unavailable");
  if (!filing) throw new Error("filing_event_not_found");
  const access = await resolveFilingAccess({ userId, filing });
  if (!access) throw new Error("filing_access_forbidden");
  const contextTicker = await resolveFilingContextTicker({
    userId,
    filing,
    access,
    requestedTicker: input.context_ticker,
  });
  const { data, error } = await admin.rpc("save_user_filing_judgment_revision", {
    p_user_id: userId,
    p_filing_event_id: filingEventId,
    p_ticker: contextTicker,
    p_impact: input.impact,
    p_next_action: input.next_action,
    p_summary: input.summary,
    p_rationale: input.rationale,
    p_thesis_links: input.thesis_links,
    p_monitoring_rules: input.monitoring_rules,
    p_idempotency_key: input.client_mutation_id,
    p_expected_revision_number: input.expected_revision_number ?? null,
  });
  if (error) throw new Error(`Failed to save filing judgment: ${error.message}`);

  const rpcResult = data as unknown as JudgmentRpcResult;
  const judgment = await getFilingJudgment(
    userId,
    filingEventId,
    rpcResult.revision_id,
  );
  if (!judgment) {
    throw new Error("Failed to read saved filing judgment");
  }
  return {
    judgment,
    idempotent_replay: Boolean(rpcResult.idempotent_replay),
    created_rule_ids: Array.isArray(rpcResult.created_rule_ids)
      ? rpcResult.created_rule_ids.filter((value): value is string =>
          typeof value === "string",
        )
      : [],
  };
}

export async function getFilingJudgment(
  userId: string,
  filingEventId: string,
  revisionId?: string,
): Promise<UserFilingJudgment | null> {
  const admin = getSupabaseAdmin();
  const { data: judgment, error: judgmentError } = await admin
    .from("user_filing_judgments")
    .select("id,user_id,filing_event_id,ticker,current_revision_id,created_at,updated_at")
    .eq("user_id", userId)
    .eq("filing_event_id", filingEventId)
    .maybeSingle<UserFilingJudgmentRow>();
  if (judgmentError) throw new Error(`Failed to load filing judgment: ${judgmentError.message}`);
  const selectedRevisionId = revisionId ?? judgment?.current_revision_id;
  if (!judgment || !selectedRevisionId) return null;

  const [revisionResult, thesisResult, monitoringResult] = await Promise.all([
    admin
      .from("user_filing_judgment_revisions")
      .select("id,judgment_id,user_id,filing_event_id,ticker,revision_number,impact,next_action,summary,rationale,is_current,idempotency_key,created_at")
      .eq("user_id", userId)
      .eq("id", selectedRevisionId)
      .single<UserFilingJudgmentRevisionRow>(),
    admin
      .from("user_filing_judgment_thesis_links")
      .select("revision_id,judgment_id,user_id,filing_event_id,ticker,thesis_id,impact,position,is_current,created_at,user_company_theses!inner(id,title,status,user_id)")
      .eq("user_id", userId)
      .eq("revision_id", selectedRevisionId)
      .eq("user_company_theses.user_id", userId)
      .order("position", { ascending: true })
      .returns<ThesisLinkJoinRow[]>(),
    admin
      .from("user_filing_judgment_monitoring_rules")
      .select("revision_id,rule_id,user_id,position,user_company_monitoring_rules!inner(id,user_id,ticker,rule_type,operator,value,next_review_at,dedupe_key,enabled,created_by_judgment_revision_id,created_at,updated_at)")
      .eq("user_id", userId)
      .eq("revision_id", selectedRevisionId)
      .eq("user_company_monitoring_rules.user_id", userId)
      .order("position", { ascending: true })
      .returns<MonitoringRuleJoinRow[]>(),
  ]);

  if (revisionResult.error || !revisionResult.data) {
    throw new Error(`Failed to load filing judgment revision: ${revisionResult.error?.message ?? "missing"}`);
  }
  if (thesisResult.error) throw new Error(`Failed to load judgment theses: ${thesisResult.error.message}`);
  if (monitoringResult.error) throw new Error(`Failed to load monitoring rules: ${monitoringResult.error.message}`);

  const revision = revisionResult.data;
  return {
    id: judgment.id,
    filing_event_id: judgment.filing_event_id,
    ticker: judgment.ticker,
    current_revision_id: revision.id,
    revision_number: revision.revision_number,
    impact: revision.impact,
    next_action: revision.next_action,
    summary: revision.summary,
    rationale: revision.rationale,
    thesis_links: (thesisResult.data ?? []).map(thesisLinkFromRow),
    monitoring_rules: (monitoringResult.data ?? []).map((row) =>
      monitoringRuleFromRow(row.user_company_monitoring_rules),
    ),
    created_at: judgment.created_at,
    updated_at: judgment.updated_at,
    revision_created_at: revision.created_at,
  };
}

function thesisLinkFromRow(row: ThesisLinkJoinRow): UserFilingJudgmentThesisLink {
  return {
    id: row.user_company_theses.id,
    title: row.user_company_theses.title,
    status: row.user_company_theses.status,
    impact: row.impact,
    position: row.position,
  };
}

function monitoringRuleFromRow(row: UserCompanyMonitoringRuleRow): UserCompanyMonitoringRule {
  return {
    id: row.id,
    user_id: row.user_id,
    ticker: row.ticker,
    rule_type: row.rule_type,
    operator: row.operator,
    value: row.value,
    next_review_at: row.next_review_at,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
