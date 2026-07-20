import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  UserCompanyMarkRow,
  UserCompanyMonitoringRuleRow,
  UserCompanyQuestionRow,
  UserCompanyThesisRow,
  UserFilingJudgmentRevisionRow,
  UserThesisCheckRow,
} from "@/types/database";
import { FilingReaderError } from "./on-demand-filing-reader";

export const PERSONAL_MCP_LIST_DEFAULT_LIMIT = 8;
export const PERSONAL_MCP_LIST_MAX_LIMIT = 20;
export const PERSONAL_MCP_TIMELINE_DEFAULT_LIMIT = 10;
export const PERSONAL_MCP_TIMELINE_MAX_LIMIT = 24;
export const PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT = 12;
export const PERSONAL_MCP_MAX_RESPONSE_CHARS = 48_000;
export const PERSONAL_MCP_MAX_RESPONSE_BYTES = 64 * 1_024;

const TRUNCATION_MARKER = "…[TRUNCATED]";
const TEXT_LIMITS = {
  coverageInterestReason: 800,
  coverageTag: 80,
  monitoringRuleValue: 320,
  thesisTitle: 320,
  thesisText: 1_600,
  thesisVariable: 240,
  thesisCounterEvidence: 1_200,
  thesisDecisionChangeCondition: 1_000,
  judgmentSummary: 800,
  judgmentRationale: 1_600,
  question: 1_200,
  thesisCheckSummary: 1_000,
  thesisCheckPoint: 360,
} as const;

const THESIS_CHECK_POINT_LIMIT = 6;

type CoverageView = Pick<
  UserCompanyMarkRow,
  | "ticker"
  | "coverage_status"
  | "priority"
  | "interest_reason"
  | "tags"
  | "last_activity_at"
  | "created_at"
  | "updated_at"
>;

type MonitoringRuleView = Pick<
  UserCompanyMonitoringRuleRow,
  | "id"
  | "ticker"
  | "rule_type"
  | "operator"
  | "value"
  | "next_review_at"
  | "enabled"
  | "created_at"
  | "updated_at"
>;

type ThesisMemoryView = Pick<
  UserCompanyThesisRow,
  | "id"
  | "ticker"
  | "title"
  | "thesis_text"
  | "monitored_variables"
  | "counter_evidence"
  | "decision_change_condition"
  | "status"
  | "updated_at"
>;

type JudgmentRevisionView = Pick<
  UserFilingJudgmentRevisionRow,
  | "id"
  | "judgment_id"
  | "filing_event_id"
  | "ticker"
  | "revision_number"
  | "impact"
  | "next_action"
  | "summary"
  | "rationale"
  | "is_current"
  | "created_at"
>;

type OpenQuestionView = Pick<
  UserCompanyQuestionRow,
  | "id"
  | "ticker"
  | "question"
  | "status"
  | "source"
  | "answered_at"
  | "visible_after_at"
  | "created_at"
  | "updated_at"
>;

type ThesisCheckView = Pick<
  UserThesisCheckRow,
  | "id"
  | "thesis_id"
  | "ticker"
  | "result_status"
  | "summary"
  | "strengthening_points"
  | "weakening_points"
  | "neutral_points"
  | "next_questions"
  | "basis_release_id"
  | "basis_period"
  | "created_at"
>;

interface FieldTruncation {
  truncated_fields: string[];
}

interface PersonalResponseTruncation {
  fields_truncated: boolean;
  truncated_field_count: number;
  response_truncated: boolean;
  dropped_item_count: number;
  max_response_chars: number;
  max_response_bytes: number;
}

interface PersonalPageMetadata {
  limit: number;
  returned_count: number;
  has_more: boolean;
}

type BoundedJudgmentRevisionView = JudgmentRevisionView & FieldTruncation;
type BoundedOpenQuestionView = OpenQuestionView & FieldTruncation;
type BoundedThesisCheckView = ThesisCheckView & FieldTruncation;

export type PersonalDecisionTimelineItem =
  | ({ type: "filing_judgment_revision"; occurred_at: string } & BoundedJudgmentRevisionView)
  | ({ type: "company_question"; occurred_at: string } & BoundedOpenQuestionView)
  | ({ type: "thesis_check"; occurred_at: string } & BoundedThesisCheckView);

export async function getCoverageState(
  userId: string,
  input: { ticker: string },
) {
  const ticker = normalizedTicker(input.ticker);
  const admin = getSupabaseAdmin();
  const [coverageResult, rulesResult, questionsResult, thesesResult] = await Promise.all([
    admin
      .from("user_company_marks")
      .select("ticker, coverage_status, priority, interest_reason, tags, last_activity_at, created_at, updated_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .maybeSingle<CoverageView>(),
    admin
      .from("user_company_monitoring_rules")
      .select("id, ticker, rule_type, operator, value, next_review_at, enabled, created_at, updated_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .eq("enabled", true)
      .order("created_at", { ascending: false })
      .limit(PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT + 1)
      .returns<MonitoringRuleView[]>(),
    admin
      .from("user_company_questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .eq("status", "open")
      .lte("visible_after_at", new Date().toISOString()),
    admin
      .from("user_company_theses")
      .select("id,ticker,title,thesis_text,monitored_variables,counter_evidence,decision_change_condition,status,updated_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT + 1)
      .returns<ThesisMemoryView[]>(),
  ]);

  assertQuerySucceeded(coverageResult.error);
  assertQuerySucceeded(rulesResult.error);
  assertQuerySucceeded(questionsResult.error);
  assertQuerySucceeded(thesesResult.error);

  const coverage = coverageResult.data
    ? boundCoverage(coverageResult.data)
    : null;
  const activeMonitoringRules = (rulesResult.data ?? [])
    .slice(0, PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT)
    .map(boundMonitoringRule);
  const activeTheses = (thesesResult.data ?? [])
    .slice(0, PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT)
    .map(boundThesisMemory);

  return {
    scope: "personal" as const,
    ticker,
    coverage,
    active_monitoring_rules: activeMonitoringRules,
    active_theses: activeTheses,
    open_question_count: questionsResult.count ?? 0,
    collections: {
      active_monitoring_rules: pageMetadata(
        PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT,
        activeMonitoringRules.length,
        (rulesResult.data?.length ?? 0) > PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT,
      ),
      active_theses: pageMetadata(
        PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT,
        activeTheses.length,
        (thesesResult.data?.length ?? 0) > PERSONAL_MCP_COVERAGE_COLLECTION_LIMIT,
      ),
    },
    truncation: truncationMetadata([
      ...(coverage ? [coverage] : []),
      ...activeMonitoringRules,
      ...activeTheses,
    ]),
  };
}

export async function listFilingJudgments(
  userId: string,
  input: { ticker?: string; filingEventId?: string; limit?: number },
) {
  const ticker = input.ticker ? normalizedTicker(input.ticker) : null;
  const filingEventId = input.filingEventId
    ? validatedUuid(input.filingEventId, "filing_event_id")
    : null;
  const limit = boundedLimit(
    input.limit,
    PERSONAL_MCP_LIST_MAX_LIMIT,
    PERSONAL_MCP_LIST_DEFAULT_LIMIT,
  );
  let query = getSupabaseAdmin()
    .from("user_filing_judgment_revisions")
    .select("id, judgment_id, filing_event_id, ticker, revision_number, impact, next_action, summary, rationale, is_current, created_at")
    .eq("user_id", userId)
    .eq("is_current", true);
  if (ticker) query = query.eq("ticker", ticker);
  if (filingEventId) query = query.eq("filing_event_id", filingEventId);
  const result = await query
    .order("created_at", { ascending: false })
    .limit(limit + 1)
    .returns<JudgmentRevisionView[]>();
  assertQuerySucceeded(result.error);

  const items = (result.data ?? []).slice(0, limit).map(boundJudgmentRevision);

  return {
    scope: "personal" as const,
    ticker,
    filing_event_id: filingEventId,
    items,
    pagination: pageMetadata(limit, items.length, (result.data?.length ?? 0) > limit),
    truncation: truncationMetadata(items),
  };
}

export async function getDecisionTimeline(
  userId: string,
  input: { ticker: string; limit?: number },
) {
  const ticker = normalizedTicker(input.ticker);
  const limit = boundedLimit(
    input.limit,
    PERSONAL_MCP_TIMELINE_MAX_LIMIT,
    PERSONAL_MCP_TIMELINE_DEFAULT_LIMIT,
  );
  const admin = getSupabaseAdmin();
  const [judgmentsResult, questionsResult, thesisChecksResult] = await Promise.all([
    admin
      .from("user_filing_judgment_revisions")
      .select("id, judgment_id, filing_event_id, ticker, revision_number, impact, next_action, summary, rationale, is_current, created_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(limit + 1)
      .returns<JudgmentRevisionView[]>(),
    admin
      .from("user_company_questions")
      .select("id, ticker, question, status, source, answered_at, visible_after_at, created_at, updated_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(limit + 1)
      .returns<OpenQuestionView[]>(),
    admin
      .from("user_thesis_checks")
      .select("id, thesis_id, ticker, result_status, summary, strengthening_points, weakening_points, neutral_points, next_questions, basis_release_id, basis_period, created_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .order("created_at", { ascending: false })
      .limit(limit + 1)
      .returns<ThesisCheckView[]>(),
  ]);

  assertQuerySucceeded(judgmentsResult.error);
  assertQuerySucceeded(questionsResult.error);
  assertQuerySucceeded(thesisChecksResult.error);

  const items: PersonalDecisionTimelineItem[] = [
    ...(judgmentsResult.data ?? []).map((row) => ({
      ...boundJudgmentRevision(row),
      type: "filing_judgment_revision" as const,
      occurred_at: row.created_at,
    })),
    ...(questionsResult.data ?? []).map((row) => ({
      ...boundOpenQuestion(row),
      type: "company_question" as const,
      occurred_at: row.created_at,
    })),
    ...(thesisChecksResult.data ?? []).map((row) => ({
      ...boundThesisCheck(row),
      type: "thesis_check" as const,
      occurred_at: row.created_at,
    })),
  ];
  items.sort((left, right) =>
    right.occurred_at.localeCompare(left.occurred_at) || right.id.localeCompare(left.id),
  );

  const selectedItems = items.slice(0, limit);
  return {
    scope: "personal" as const,
    ticker,
    items: selectedItems,
    pagination: pageMetadata(limit, selectedItems.length, items.length > limit),
    truncation: truncationMetadata(selectedItems),
  };
}

export async function listOpenQuestions(
  userId: string,
  input: { ticker?: string; limit?: number },
) {
  const ticker = input.ticker ? normalizedTicker(input.ticker) : null;
  const limit = boundedLimit(
    input.limit,
    PERSONAL_MCP_LIST_MAX_LIMIT,
    PERSONAL_MCP_LIST_DEFAULT_LIMIT,
  );
  let query = getSupabaseAdmin()
    .from("user_company_questions")
    .select("id, ticker, question, status, source, answered_at, visible_after_at, created_at, updated_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .lte("visible_after_at", new Date().toISOString());
  if (ticker) query = query.eq("ticker", ticker);
  const result = await query
    .order("created_at", { ascending: false })
    .limit(limit + 1)
    .returns<OpenQuestionView[]>();
  assertQuerySucceeded(result.error);

  const items = (result.data ?? []).slice(0, limit).map(boundOpenQuestion);

  return {
    scope: "personal" as const,
    ticker,
    items,
    pagination: pageMetadata(limit, items.length, (result.data?.length ?? 0) > limit),
    truncation: truncationMetadata(items),
  };
}

/**
 * Final safety boundary for every personal MCP tool result. Reader-level row
 * and field limits keep useful context dense; this serializer additionally
 * guarantees that multi-byte text can never exceed the process response cap.
 */
export function serializePersonalMcpResult(result: unknown): string {
  const initial = JSON.stringify(result);
  if (typeof initial !== "string") return oversizedResponseFallback(0);
  if (fitsResponseBudget(initial)) return initial;

  let payload: unknown;
  try {
    payload = JSON.parse(initial);
  } catch {
    return oversizedResponseFallback(0);
  }
  if (!isRecord(payload)) return oversizedResponseFallback(0);

  const collectionKeys = [
    "items",
    "active_theses",
    "active_monitoring_rules",
  ] as const;
  const droppedByCollection = new Map<string, number>();
  let serialized = initial;

  while (!fitsResponseBudget(serialized)) {
    const candidate = collectionKeys
      .flatMap((key) => {
        const collection = payload[key];
        if (!Array.isArray(collection) || collection.length === 0) return [];
        const lastItem = collection[collection.length - 1];
        return [{ key, collection, bytes: byteLength(JSON.stringify(lastItem)) }];
      })
      .sort((left, right) => right.bytes - left.bytes)[0];
    if (!candidate) {
      return oversizedResponseFallback(
        [...droppedByCollection.values()].reduce((total, count) => total + count, 0),
      );
    }

    candidate.collection.pop();
    droppedByCollection.set(
      candidate.key,
      (droppedByCollection.get(candidate.key) ?? 0) + 1,
    );
    markResponseTruncated(payload, droppedByCollection);
    serialized = JSON.stringify(payload);
  }

  return serialized;
}

function normalizedTicker(value: string): string {
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) {
    throw new FilingReaderError("invalid_ticker", "Ticker must be a catalog-style symbol.");
  }
  return ticker;
}

function validatedUuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new FilingReaderError(`invalid_${field}`, `${field} must be a UUID.`);
  }
  return normalized;
}

function boundedLimit(
  value: number | undefined,
  maximum: number,
  defaultLimit: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return defaultLimit;
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
}

function assertQuerySucceeded(error: { message: string } | null): void {
  if (error) {
    throw new FilingReaderError(
      "personal_data_unavailable",
      "Personal filing data is temporarily unavailable.",
    );
  }
}

function boundCoverage(row: CoverageView): CoverageView & FieldTruncation {
  const truncatedFields: string[] = [];
  return {
    ...row,
    interest_reason: truncateNullableText(
      row.interest_reason,
      TEXT_LIMITS.coverageInterestReason,
      "interest_reason",
      truncatedFields,
    ),
    tags: truncateStringArray(
      row.tags,
      12,
      TEXT_LIMITS.coverageTag,
      "tags",
      truncatedFields,
    ),
    truncated_fields: truncatedFields,
  };
}

function boundMonitoringRule(
  row: MonitoringRuleView,
): MonitoringRuleView & FieldTruncation {
  const truncatedFields: string[] = [];
  return {
    ...row,
    value: truncateNullableText(
      row.value,
      TEXT_LIMITS.monitoringRuleValue,
      "value",
      truncatedFields,
    ),
    truncated_fields: truncatedFields,
  };
}

function boundThesisMemory(row: ThesisMemoryView): ThesisMemoryView & FieldTruncation {
  const truncatedFields: string[] = [];
  return {
    ...row,
    title: truncateText(row.title, TEXT_LIMITS.thesisTitle, "title", truncatedFields),
    thesis_text: truncateText(
      row.thesis_text,
      TEXT_LIMITS.thesisText,
      "thesis_text",
      truncatedFields,
    ),
    monitored_variables: truncateStringArray(
      row.monitored_variables,
      3,
      TEXT_LIMITS.thesisVariable,
      "monitored_variables",
      truncatedFields,
    ),
    counter_evidence: truncateText(
      row.counter_evidence,
      TEXT_LIMITS.thesisCounterEvidence,
      "counter_evidence",
      truncatedFields,
    ),
    decision_change_condition: truncateText(
      row.decision_change_condition,
      TEXT_LIMITS.thesisDecisionChangeCondition,
      "decision_change_condition",
      truncatedFields,
    ),
    truncated_fields: truncatedFields,
  };
}

function boundJudgmentRevision(
  row: JudgmentRevisionView,
): BoundedJudgmentRevisionView {
  const truncatedFields: string[] = [];
  return {
    ...row,
    summary: truncateText(
      row.summary,
      TEXT_LIMITS.judgmentSummary,
      "summary",
      truncatedFields,
    ),
    rationale: truncateText(
      row.rationale,
      TEXT_LIMITS.judgmentRationale,
      "rationale",
      truncatedFields,
    ),
    truncated_fields: truncatedFields,
  };
}

function boundOpenQuestion(row: OpenQuestionView): BoundedOpenQuestionView {
  const truncatedFields: string[] = [];
  return {
    ...row,
    question: truncateText(
      row.question,
      TEXT_LIMITS.question,
      "question",
      truncatedFields,
    ),
    truncated_fields: truncatedFields,
  };
}

function boundThesisCheck(row: ThesisCheckView): BoundedThesisCheckView {
  const truncatedFields: string[] = [];
  return {
    ...row,
    summary: truncateText(
      row.summary,
      TEXT_LIMITS.thesisCheckSummary,
      "summary",
      truncatedFields,
    ),
    strengthening_points: truncateStringArray(
      row.strengthening_points,
      THESIS_CHECK_POINT_LIMIT,
      TEXT_LIMITS.thesisCheckPoint,
      "strengthening_points",
      truncatedFields,
    ),
    weakening_points: truncateStringArray(
      row.weakening_points,
      THESIS_CHECK_POINT_LIMIT,
      TEXT_LIMITS.thesisCheckPoint,
      "weakening_points",
      truncatedFields,
    ),
    neutral_points: truncateStringArray(
      row.neutral_points,
      THESIS_CHECK_POINT_LIMIT,
      TEXT_LIMITS.thesisCheckPoint,
      "neutral_points",
      truncatedFields,
    ),
    next_questions: truncateStringArray(
      row.next_questions,
      THESIS_CHECK_POINT_LIMIT,
      TEXT_LIMITS.thesisCheckPoint,
      "next_questions",
      truncatedFields,
    ),
    truncated_fields: truncatedFields,
  };
}

function truncateNullableText(
  value: string | null | undefined,
  maxCharacters: number,
  field: string,
  truncatedFields: string[],
): string | null {
  if (typeof value !== "string") return null;
  return truncateText(value, maxCharacters, field, truncatedFields);
}

function truncateText(
  value: string | null | undefined,
  maxCharacters: number,
  field: string,
  truncatedFields: string[],
): string {
  const normalized = typeof value === "string" ? value : "";
  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) return normalized;
  markFieldTruncated(truncatedFields, field);
  const marker = Array.from(TRUNCATION_MARKER);
  return characters
    .slice(0, Math.max(0, maxCharacters - marker.length))
    .concat(marker)
    .join("");
}

function truncateStringArray(
  value: string[] | null | undefined,
  maxItems: number,
  maxCharacters: number,
  field: string,
  truncatedFields: string[],
): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) markFieldTruncated(truncatedFields, field);
  return value.slice(0, maxItems).map((entry) =>
    truncateText(entry, maxCharacters, field, truncatedFields));
}

function markFieldTruncated(fields: string[], field: string): void {
  if (!fields.includes(field)) fields.push(field);
}

function pageMetadata(
  limit: number,
  returnedCount: number,
  hasMore: boolean,
): PersonalPageMetadata {
  return { limit, returned_count: returnedCount, has_more: hasMore };
}

function truncationMetadata(
  values: Array<FieldTruncation | null | undefined>,
): PersonalResponseTruncation {
  const truncatedFieldCount = values.reduce(
    (count, value) => count + (value?.truncated_fields.length ?? 0),
    0,
  );
  return {
    fields_truncated: truncatedFieldCount > 0,
    truncated_field_count: truncatedFieldCount,
    response_truncated: false,
    dropped_item_count: 0,
    max_response_chars: PERSONAL_MCP_MAX_RESPONSE_CHARS,
    max_response_bytes: PERSONAL_MCP_MAX_RESPONSE_BYTES,
  };
}

function fitsResponseBudget(serialized: string): boolean {
  return serialized.length <= PERSONAL_MCP_MAX_RESPONSE_CHARS
    && byteLength(serialized) <= PERSONAL_MCP_MAX_RESPONSE_BYTES;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function markResponseTruncated(
  payload: Record<string, unknown>,
  droppedByCollection: Map<string, number>,
): void {
  const droppedItemCount = [...droppedByCollection.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const currentTruncation = isRecord(payload.truncation)
    ? payload.truncation
    : {};
  payload.truncation = {
    ...currentTruncation,
    response_truncated: true,
    dropped_item_count: droppedItemCount,
    max_response_chars: PERSONAL_MCP_MAX_RESPONSE_CHARS,
    max_response_bytes: PERSONAL_MCP_MAX_RESPONSE_BYTES,
  };

  const items = payload.items;
  if (Array.isArray(items) && isRecord(payload.pagination)) {
    payload.pagination.returned_count = items.length;
    payload.pagination.has_more = true;
  }
  if (isRecord(payload.collections)) {
    for (const collectionKey of [
      "active_theses",
      "active_monitoring_rules",
    ]) {
      const collection = payload[collectionKey];
      const metadata = payload.collections[collectionKey];
      if (!Array.isArray(collection) || !isRecord(metadata)) continue;
      metadata.returned_count = collection.length;
      if ((droppedByCollection.get(collectionKey) ?? 0) > 0) {
        metadata.has_more = true;
      }
    }
  }
}

function oversizedResponseFallback(droppedItemCount: number): string {
  return JSON.stringify({
    scope: "personal",
    error: {
      code: "personal_response_too_large",
      message: "Personal data exceeded the safe MCP response budget. Retry with a narrower ticker, filing_event_id, or limit.",
    },
    truncation: {
      fields_truncated: true,
      truncated_field_count: 0,
      response_truncated: true,
      dropped_item_count: droppedItemCount,
      max_response_chars: PERSONAL_MCP_MAX_RESPONSE_CHARS,
      max_response_bytes: PERSONAL_MCP_MAX_RESPONSE_BYTES,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
