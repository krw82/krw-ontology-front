import type { SecFilingFormType } from "@/types/database";
import { filingEventTagLabel } from "@/lib/filing-notifications/classification";

export const FILING_FORM_TYPES = ["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"] as const;

export type FilingNotificationKind = "filing_received" | "analysis_ready" | "filing_digest";

export interface FilingPushPayload {
  schemaVersion: 1;
  notificationId: string;
  filingEventId: string;
  kind: FilingNotificationKind;
  title: string;
  body: string;
  destinationPath: string;
  tag: string;
  unreadCount?: number;
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

export function safeInternalDestinationPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/filings";
  }
  return value;
}
