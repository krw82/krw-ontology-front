import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { Database, UserCompanyMonitoringRuleRow } from "@/types/database";

const MAX_RULES_PER_FEED = 200;

export async function getPulseMonitoringRules(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserCompanyMonitoringRuleRow[]> {
  const { data, error } = await supabase
    .from("user_company_monitoring_rules")
    .select("id,user_id,ticker,rule_type,operator,value,next_review_at,dedupe_key,enabled,created_by_judgment_revision_id,created_at,updated_at")
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("updated_at", { ascending: false })
    .limit(MAX_RULES_PER_FEED)
    .returns<UserCompanyMonitoringRuleRow[]>();
  if (error) throw error;
  return data ?? [];
}

export function applyPulseMonitoringRules(
  candidates: PulseCandidate[],
  rules: UserCompanyMonitoringRuleRow[],
): PulseCandidate[] {
  const rulesByTicker = new Map<string, UserCompanyMonitoringRuleRow[]>();
  for (const rule of rules) {
    if (rule.rule_type === "scheduled_review") continue;
    const ticker = normalize(rule.ticker);
    if (!ticker) continue;
    const bucket = rulesByTicker.get(ticker) ?? [];
    bucket.push(rule);
    rulesByTicker.set(ticker, bucket);
  }

  return candidates.map((candidate) => {
    if (candidate.kind !== "filing") return candidate;
    const tickers = coveredCandidateTickers(candidate);
    if (tickers.length === 0) return candidate;
    const candidateRules = Array.from(
      new Map(
        tickers
          .flatMap((ticker) => rulesByTicker.get(ticker) ?? [])
          .map((rule) => [rule.id, rule] as const),
      ).values(),
    );
    const matches = candidateRules.filter((rule) =>
      monitoringRuleMatches(rule, candidate),
    );
    if (matches.length === 0) return candidate;
    const first = matches[0];
    const reasonTicker = normalize(first.ticker) ?? tickers[0];
    return {
      ...candidate,
      reason_code: "monitoring_rule_matched",
      reason_label: ruleReasonLabel(reasonTicker, first),
      metadata: {
        ...candidate.metadata,
        monitoring_rule_match_count: matches.length,
        monitoring_rule_type: first.rule_type,
      },
    };
  });
}

export function buildDueMonitoringCandidates(
  rules: UserCompanyMonitoringRuleRow[],
  now: Date,
): PulseCandidate[] {
  const nowMs = now.getTime();
  return rules.flatMap((rule) => {
    if (rule.rule_type !== "scheduled_review" || !rule.next_review_at) return [];
    const reviewAt = Date.parse(rule.next_review_at);
    if (Number.isNaN(reviewAt) || reviewAt > nowMs) return [];
    return [{
      item_key: makePulseItemKey("resurface", `monitoring:${rule.id}`),
      kind: "resurface" as const,
      trigger: "schedule" as const,
      source_type: "resurface" as const,
      source_id: `monitoring:${rule.id}`,
      ticker: normalize(rule.ticker),
      coverage_level: null,
      judgment: null,
      linked_thesis: null,
      eyebrow: "판단 다시 보기",
      title: `${normalize(rule.ticker) ?? rule.ticker} 판단을 다시 확인할 시간입니다`,
      body: "직접 정한 검토 시점입니다. 이전 판단과 그 이후의 실제 공시를 비교해보세요.",
      reason_code: "scheduled_coverage_review",
      reason_label: "이 회사의 다음 검토 시점을 직접 설정했습니다.",
      priority: "normal" as const,
      occurred_at: rule.next_review_at,
      available_at: rule.next_review_at,
      expires_at: null,
      reviewed_at: null,
      saved_at: null,
      snoozed_until: null,
      group_key: `monitoring:${normalize(rule.ticker) ?? rule.ticker}`,
      primary_action: {
        type: "link" as const,
        label: "이전 판단과 비교",
        href: `/watchlist/${encodeURIComponent(normalize(rule.ticker) ?? rule.ticker)}?tab=history`,
      },
      secondary_actions: [
        { type: "mutation" as const, label: "검토 완료", action: "review" as const },
        { type: "mutation" as const, label: "내일 다시 보기", action: "snooze" as const },
      ],
      metadata: {
        monitoring_rule_id: rule.id,
        monitoring_rule_type: rule.rule_type,
      },
    }];
  });
}

export function monitoringRuleMatches(
  rule: UserCompanyMonitoringRuleRow,
  candidate: PulseCandidate,
): boolean {
  if (!rule.enabled || candidate.kind !== "filing" || rule.rule_type === "scheduled_review") return false;
  const ruleTicker = normalize(rule.ticker);
  if (!ruleTicker || !coveredCandidateTickers(candidate).includes(ruleTicker)) return false;
  const needle = normalizeText(rule.value);
  if (!needle) return false;

  if (rule.rule_type === "filing_form") {
    return compareValue(normalizeText(candidate.metadata.form_type), needle, rule.operator);
  }
  if (rule.rule_type === "filing_item") {
    return compareValue(normalizeText(candidate.metadata.primary_event_tag), needle, rule.operator);
  }
  const haystack = normalizeText([
    candidate.title,
    candidate.body,
    candidate.metadata.primary_event_tag,
    candidate.metadata.form_type,
  ].filter(Boolean).join(" "));
  return rule.operator === "matches" ? haystack === needle : haystack.includes(needle);
}

function coveredCandidateTickers(candidate: PulseCandidate): string[] {
  const values = [
    candidate.ticker,
    ...(typeof candidate.metadata.covered_tickers_csv === "string"
      ? candidate.metadata.covered_tickers_csv.split(",")
      : []),
  ];
  return Array.from(
    new Set(values.map((value) => normalize(value)).filter((value): value is string => Boolean(value))),
  );
}

function compareValue(
  haystack: string,
  needle: string,
  operator: UserCompanyMonitoringRuleRow["operator"],
): boolean {
  if (operator === "matches") return haystack === needle;
  if (operator === "contains") return haystack.includes(needle);
  return false;
}

function ruleReasonLabel(ticker: string, rule: UserCompanyMonitoringRuleRow): string {
  if (rule.rule_type === "filing_form") return `${ticker}에 설정한 공시 종류 규칙과 일치합니다.`;
  if (rule.rule_type === "filing_item") return `${ticker}에 설정한 중요 사건 규칙과 일치합니다.`;
  return `${ticker}에 설정한 핵심 변화 키워드와 일치합니다.`;
}

function normalize(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
