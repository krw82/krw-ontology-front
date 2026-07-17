import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { Database, Json, SecFilingFormType } from "@/types/database";

type PulseFilingRowV3 = Database["public"]["Functions"]["get_catalog_pulse_filing_candidates_v3"]["Returns"][number];
type PulseFilingRowV2 = Database["public"]["Functions"]["get_catalog_pulse_filing_candidates_v2"]["Returns"][number];
type LegacyGlobalFilingRow = Database["public"]["Functions"]["get_catalog_global_filing_feed"]["Returns"][number];
type FilingRow = PulseFilingRowV3 | PulseFilingRowV2 | LegacyGlobalFilingRow;

type FilingBriefPreview = {
  headline: string;
  summary: string[];
  question: string | null;
  factCount: number;
  generatedAt: string | null;
};

const LEGACY_FILING_READ_BATCH_SIZE = 200;
export const MAX_PULSE_FILING_CANDIDATES = 300;

/**
 * Global, catalog-scoped filing source. The v2 RPC returns a bounded blend of
 * urgent, high-priority, preferred-company, and discovery candidates. It keeps
 * the source cheap while the shared composer applies user state and final rank.
 */
export async function getFilingCandidates(
  supabase: SupabaseClient<Database>,
  now: Date,
  preferredTickers: string[] = [],
): Promise<PulseCandidate[]> {
  const env = filingCatalogEnv();
  const snapshotAt = now.toISOString();
  const params = {
    p_env: env,
    p_snapshot_at: snapshotAt,
    p_preferred_tickers: preferredTickers.slice(0, 100),
    p_urgent_limit: 80,
    p_priority_limit: 100,
    p_preferred_limit: 80,
    p_discovery_limit: 40,
  };
  const v3 = await supabase.rpc("get_catalog_pulse_filing_candidates_v3", params);
  if (!v3.error) return (v3.data ?? []).slice(0, MAX_PULSE_FILING_CANDIDATES).map(toCandidate);
  if (!isMissingCandidateRpc(v3.error, "get_catalog_pulse_filing_candidates_v3")) throw v3.error;

  const v2 = await supabase.rpc("get_catalog_pulse_filing_candidates_v2", params);
  if (!v2.error) return (v2.data ?? []).slice(0, MAX_PULSE_FILING_CANDIDATES).map(toCandidate);
  if (!isMissingCandidateRpc(v2.error, "get_catalog_pulse_filing_candidates_v2")) throw v2.error;

  // Additive migrations are deployed before the web image. This bounded
  // fallback keeps Pulse readable during the brief schema-cache propagation
  // window without reintroducing the historical unbounded traversal.
  return getLegacyBoundedCandidates(supabase, env, snapshotAt);
}

async function getLegacyBoundedCandidates(
  supabase: SupabaseClient<Database>,
  env: "dev" | "staging" | "prod",
  snapshotAt: string,
): Promise<PulseCandidate[]> {
  const rows: LegacyGlobalFilingRow[] = [];
  let beforeOccurredAt: string | null = null;
  let beforeFilingEventId: string | null = null;

  while (rows.length < MAX_PULSE_FILING_CANDIDATES) {
    const result = await supabase.rpc("get_catalog_global_filing_feed", {
      p_env: env,
      p_snapshot_at: snapshotAt,
      p_before_occurred_at: beforeOccurredAt,
      p_before_filing_event_id: beforeFilingEventId,
      p_limit: Math.min(LEGACY_FILING_READ_BATCH_SIZE, MAX_PULSE_FILING_CANDIDATES - rows.length),
    }) as unknown as { data: LegacyGlobalFilingRow[] | null; error: { message?: string; code?: string } | null };
    if (result.error) throw result.error;
    const page: LegacyGlobalFilingRow[] = result.data ?? [];
    rows.push(...page);
    if (page.length < LEGACY_FILING_READ_BATCH_SIZE) break;
    const boundary = page.at(-1);
    if (!boundary) break;
    beforeOccurredAt = boundary.occurred_at;
    beforeFilingEventId = boundary.filing_event_id;
  }

  return rows.map(toCandidate);
}

/**
 * Compatibility helper for legacy notification-card grouping. Global catalog
 * feed cards intentionally no longer call it: one durable filing-event UUID
 * maps to one user-state key.
 */
export function filingGroupKey(
  event: { alert_priority: "urgent" | "normal" | "digest"; cik: string },
  notificationId: string,
  eventTime: number,
): string {
  return event.alert_priority === "urgent"
    ? `urgent:${notificationId}`
    : `${event.cik}:${Math.floor(eventTime / 600_000)}`;
}

function filingCatalogEnv(): "dev" | "staging" | "prod" {
  const value = process.env.FILING_WORKER_ENV?.trim().toLowerCase() || "prod";
  return value === "dev" || value === "staging" || value === "prod" ? value : "prod";
}

function toCandidate(event: FilingRow): PulseCandidate {
  const form4 = event.form_type === "4" || event.form_type === "4/A";
  const brief = form4 ? null : filingBriefPreview(event);
  const priority = event.alert_priority === "urgent"
    ? "urgent"
    : event.alert_priority === "normal" ? "high" : "normal";
  const label = filingEventLabel(event);
  const prompt = new URLSearchParams({
    ticker: event.ticker,
    filing_event_id: event.filing_event_id,
    query: brief?.question ?? `${event.ticker} ${event.form_type} ${label} SEC 공시의 사실과 원문 근거를 확인해줘`,
  });
  return {
    item_key: makePulseItemKey("filing", event.filing_event_id),
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: event.filing_event_id,
    ticker: event.ticker,
    eyebrow: form4
      ? (event.is_amendment ? "내부자 거래 정정" : "내부자 거래")
      : (event.is_amendment ? `${event.form_type} 정정 공시` : `${event.form_type} 새 공시`),
    title: brief?.headline ?? filingTitle(event),
    body: brief?.summary.join(" ") ?? filingBody(event),
    reason_code: "catalog_sec_filing",
    reason_label: "현재 온톨로지 카탈로그가 커버하는 기업의 SEC 공시입니다.",
    priority,
    occurred_at: event.occurred_at,
    available_at: event.feed_available_at ?? event.first_seen_at,
    expires_at: event.feed_expires_at,
    read_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "공시 보기", href: `/filings/${encodeURIComponent(event.filing_event_id)}?source=pulse` },
    secondary_actions: [
      { type: "link", label: brief ? "이 요약으로 질문" : "이 공시로 질문", href: `/chat/new?${prompt}`, analytics_name: "pulse_answer_prefilled" },
      { type: "mutation", label: "검토 완료", action: "review" },
      { type: "mutation", label: "내일 다시 보기", action: "snooze" },
    ],
    metadata: {
      form_type: event.form_type,
      alert_priority: event.alert_priority,
      primary_event_tag: event.primary_event_tag,
      covered_ticker_count: event.covered_tickers.length,
      is_amendment: event.is_amendment,
      form4_has_reported_open_market_trade: event.form4_has_reported_open_market_trade,
      form4_reported_purchase_value: event.form4_reported_purchase_value,
      form4_reported_sale_value: event.form4_reported_sale_value,
      form4_tenb5_one_status: event.form4_tenb5_one_status,
      candidate_bucket: "candidate_bucket" in event ? event.candidate_bucket : "legacy_bounded",
      filing_brief_ready: Boolean(brief),
      filing_brief_fact_count: brief?.factCount ?? 0,
      filing_brief_generated_at: brief?.generatedAt ?? null,
    },
    is_pinned: false,
  };
}

function filingTitle(event: FilingRow): string {
  if (event.form_type === "4" || event.form_type === "4/A") {
    if (event.form4_has_reported_open_market_trade) {
      const purchase = formatUsd(event.form4_reported_purchase_value);
      const sale = formatUsd(event.form4_reported_sale_value);
      const activity = [purchase ? `매수 ${purchase}` : null, sale ? `매도 ${sale}` : null]
        .filter((value): value is string => Boolean(value))
        .join(" · ");
      return `${event.ticker} 내부자 거래${activity ? `: ${activity}` : ""}`;
    }
    return `${event.ticker} 내부자 거래 신고가 제출되었습니다`;
  }
  const label = filingEventLabel(event);
  return label === event.form_type
    ? `${event.ticker} ${event.form_type} 공시가 제출되었습니다`
    : `${event.ticker} ${label} 관련 ${event.form_type} 공시`;
}

function filingBody(event: FilingRow): string {
  if (event.form_type === "4" || event.form_type === "4/A") {
    if (event.form4_has_reported_open_market_trade) {
      const plan = event.form4_tenb5_one_status === "yes"
        ? "10b5-1 계획 표시"
        : event.form4_tenb5_one_status === "no" ? "10b5-1 계획 미표시" : "10b5-1 계획 정보 없음";
      return `SEC Form 4의 보고된 P/S 거래만 금액으로 표시합니다. ${plan}.`;
    }
    return "P/S로 보고된 공개시장 거래가 없거나 금액 정보가 없어 추정하지 않습니다.";
  }
  if (event.primary_event_tag) return `${event.primary_event_tag.replaceAll("_", " ")} 관련 SEC 제출입니다.`;
  if (event.sec_items.length) return `SEC Item ${event.sec_items.join(", ")} 제출입니다.`;
  return "SEC에 새 공시가 제출되었습니다. 원문과 제출 정보를 확인하세요.";
}

function filingEventLabel(event: Pick<FilingRow, "form_type" | "primary_event_tag" | "sec_items">): string {
  if (event.primary_event_tag) return event.primary_event_tag.replaceAll("_", " ");
  if (event.sec_items.length) return `Item ${event.sec_items.join(", ")}`;
  return event.form_type;
}

function filingBriefPreview(event: FilingRow): FilingBriefPreview | null {
  if (!("filing_brief_headline_ko" in event)) return null;
  const headline = stringValue(event.filing_brief_headline_ko);
  const summary = stringArray(event.filing_brief_summary_sentences, 2, 340);
  if (!headline || summary.length === 0) return null;
  const questions = stringArray(event.filing_brief_question_suggestions, 2, 220);
  const facts = arrayValue(event.filing_brief_facts);
  return {
    headline,
    summary,
    question: questions[0] ?? null,
    factCount: Math.min(4, facts.length),
    generatedAt: stringValue(event.filing_brief_generated_at),
  };
}

function stringArray(value: Json | null | undefined, max: number, maxLength: number): string[] {
  const values = arrayValue(value);
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxLength)
    .slice(0, max);
}

function arrayValue(value: Json | null | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatUsd(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function isGlobalFilingForm(value: string): value is SecFilingFormType {
  return ["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"].includes(value);
}

function isMissingCandidateRpc(
  error: { code?: string | null; message?: string | null },
  functionName: string,
): boolean {
  return error.code === "PGRST202"
    || Boolean(error.message?.includes(functionName));
}
