import type { SecFilingEventRow, SecFilingFormType } from "@/types/database";

export type AmendmentMatchReason = "amendment_text" | "same_report_date" | "single_recent_original";

export type AmendmentOriginalMatch = {
  filing: SecFilingEventRow;
  reason: AmendmentMatchReason;
};

export type TextDiffPreview = {
  addedLines: number;
  removedLines: number;
  comparedOriginalLines: number;
  comparedAmendmentLines: number;
  lines: Array<{ kind: "added" | "removed"; text: string }>;
};

const MAX_COMPARED_LINES = 1_000;
const MAX_PREVIEW_LINES = 48;

export function originalFormType(formType: SecFilingFormType): SecFilingFormType {
  return (formType.endsWith("/A") ? formType.slice(0, -2) : formType) as SecFilingFormType;
}

/**
 * SEC submissions JSON does not expose an amendment-to-original accession
 * relationship. We only select an original when the amendment text names its
 * filing date, the report date agrees, or there is exactly one recent candidate.
 */
export function findAmendedOriginal(params: {
  amendment: SecFilingEventRow;
  candidates: SecFilingEventRow[];
  amendmentText: string;
}): AmendmentOriginalMatch | null {
  const matchingForm = originalFormType(params.amendment.form_type);
  const eligible = params.candidates
    .filter((candidate) => !candidate.is_amendment && candidate.form_type === matchingForm)
    .sort((left, right) => filingTimestamp(right) - filingTimestamp(left));
  if (!eligible.length) return null;

  const namedDates = referencedFilingDates(params.amendmentText);
  const explicit = eligible.find((candidate) => namedDates.has(candidate.filing_date));
  if (explicit) return { filing: explicit, reason: "amendment_text" };

  if (params.amendment.report_date) {
    const sameReportDate = eligible.filter((candidate) => candidate.report_date === params.amendment.report_date);
    if (sameReportDate.length === 1) return { filing: sameReportDate[0], reason: "same_report_date" };
  }

  const amendmentTime = filingTimestamp(params.amendment);
  const recent = eligible.filter((candidate) => amendmentTime - filingTimestamp(candidate) <= 45 * 24 * 60 * 60 * 1_000);
  return recent.length === 1 ? { filing: recent[0], reason: "single_recent_original" } : null;
}

export function diffFilingText(originalHtml: string, amendmentHtml: string): TextDiffPreview {
  const original = normalizedLines(originalHtml);
  const amendment = normalizedLines(amendmentHtml);
  const matrix = lcsMatrix(original, amendment);
  const changes: Array<{ kind: "added" | "removed"; text: string }> = [];
  let addedLines = 0;
  let removedLines = 0;
  let left = original.length;
  let right = amendment.length;

  while (left > 0 || right > 0) {
    if (left > 0 && right > 0 && original[left - 1] === amendment[right - 1]) {
      left -= 1;
      right -= 1;
    } else if (right > 0 && (left === 0 || matrix[left][right - 1] >= matrix[left - 1][right])) {
      addedLines += 1;
      if (changes.length < MAX_PREVIEW_LINES) changes.push({ kind: "added", text: amendment[right - 1] });
      right -= 1;
    } else {
      removedLines += 1;
      if (changes.length < MAX_PREVIEW_LINES) changes.push({ kind: "removed", text: original[left - 1] });
      left -= 1;
    }
  }

  return {
    addedLines,
    removedLines,
    comparedOriginalLines: original.length,
    comparedAmendmentLines: amendment.length,
    lines: changes.reverse(),
  };
}

function referencedFilingDates(value: string): Set<string> {
  const text = toPlainText(value);
  const dates = new Set<string>();
  for (const match of text.matchAll(/(?:filed|submitted)[^.]{0,80}?\bon\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/gi)) {
    const timestamp = Date.parse(`${match[1]} UTC`);
    if (!Number.isNaN(timestamp)) dates.add(new Date(timestamp).toISOString().slice(0, 10));
  }
  for (const match of text.matchAll(/(?:filed|submitted)[^.]{0,80}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{4})/g)) {
    const [month, day, year] = match[1].split("/").map(Number);
    if (month && day && year) dates.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function normalizedLines(value: string): string[] {
  return toPlainText(value)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2)
    .slice(0, MAX_COMPARED_LINES);
}

function toPlainText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\r/g, "");
}

function lcsMatrix(left: string[], right: string[]): number[][] {
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      matrix[leftIndex][rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? matrix[leftIndex - 1][rightIndex - 1] + 1
        : Math.max(matrix[leftIndex - 1][rightIndex], matrix[leftIndex][rightIndex - 1]);
    }
  }
  return matrix;
}

function filingTimestamp(filing: SecFilingEventRow): number {
  return Date.parse(filing.accepted_at ?? `${filing.filing_date}T00:00:00Z`);
}
