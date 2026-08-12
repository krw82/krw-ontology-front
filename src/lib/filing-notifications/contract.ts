import type { SecFilingFormType } from "@/types/database";
import { filingEventTagLabel } from "@/lib/filing-notifications/classification";

export const FILING_FORM_TYPES = ["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"] as const;

export type FilingNotificationKind =
  | "filing_received"
  | "analysis_ready"
  | "filing_digest"
  | "market_issue_received"
  | "market_issue_digest";

export interface FilingPushPayload {
  schemaVersion: 1;
  notificationId: string;
  filingEventId?: string;
  marketIssueId?: string;
  kind: FilingNotificationKind;
  title: string;
  body: string;
  destinationPath: string;
  tag: string;
  unreadCount?: number;
}

export interface FilingDecisionNotificationContext {
  hasPreviousJudgment: boolean;
  activeMonitoringRuleCount: number;
}

export function isFilingFormType(value: string): value is SecFilingFormType {
  return (FILING_FORM_TYPES as readonly string[]).includes(value);
}

export function isAmendedFilingForm(value: SecFilingFormType): boolean {
  return value.endsWith("/A");
}

export function filingNotificationCopy(params: {
  ticker: string;
  formType: SecFilingFormType;
  isAmendment: boolean;
  primaryEventTag?: string | null;
  keywordPhrases?: string[];
}): { title: string; body: string } {
  const amended = params.isAmendment ? " 정정" : "";
  const eventLabel = filingEventTagLabel(params.primaryEventTag);
  const phrases = Array.from(new Set((params.keywordPhrases ?? []).filter(Boolean))).slice(0, 2);
  const keywordReason = phrases.length ? `“${phrases.join("”, “")}” 규칙 일치` : null;
  return {
    title: keywordReason
      ? `${params.ticker} · ${params.formType}${amended} · ${keywordReason}`
      : eventLabel
      ? `${params.ticker} · ${params.formType}${amended} · ${eventLabel}`
      : `${params.ticker} 새 ${params.formType}${amended} 공시`,
    body: keywordReason
      ? `${keywordReason} 공시입니다. 일치 문맥과 원문을 확인하세요.`
      : eventLabel
      ? `${eventLabel} 관련 SEC 공시가 제출됐습니다. 분류 근거와 원문을 확인하세요.`
      : "SEC에 새 공시가 제출됐습니다. 원문과 제출 정보를 확인하세요.",
  };
}

/**
 * Adds only bounded, deterministic decision context to lock-screen copy.
 * Personal judgment/rule prose and generated filing briefs are deliberately
 * not accepted by this contract.
 */
export function filingDecisionContextCopy(
  copy: { title: string; body: string },
  context: FilingDecisionNotificationContext,
): { title: string; body: string } {
  const ruleCount = Math.max(0, Math.min(99, Math.trunc(context.activeMonitoringRuleCount)));
  const contextLabel = context.hasPreviousJudgment && ruleCount > 0
    ? `이전 판단과 활성 모니터링 규칙 ${ruleCount}개에 연결됩니다.`
    : context.hasPreviousJudgment
      ? "이전 판단과 연결해 다시 확인할 수 있습니다."
      : ruleCount > 0
        ? `활성 모니터링 규칙 ${ruleCount}개에 연결됩니다.`
        : null;

  return contextLabel
    ? { title: copy.title, body: `${copy.body} ${contextLabel}` }
    : copy;
}

export function filingDecisionDestinationPath(
  filingEventId: string,
  context: FilingDecisionNotificationContext,
): string {
  if (!isUuid(filingEventId)) return "/filings";
  const hasDecisionContext = context.hasPreviousJudgment || context.activeMonitoringRuleCount > 0;
  return safeInternalDestinationPath(
    `/filings/${encodeURIComponent(filingEventId)}${hasDecisionContext ? "?context=decision" : ""}`,
  );
}

export function safeInternalDestinationPath(value: string | null | undefined): string {
  if (
    !value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "/filings";
  }
  try {
    const base = new URL("https://krwontology.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return "/filings";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/filings";
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
