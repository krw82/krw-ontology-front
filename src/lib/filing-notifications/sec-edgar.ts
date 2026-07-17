import { isAmendedFilingForm, isFilingFormType } from "@/lib/filing-notifications/contract";
import { normalizeSecItems } from "@/lib/filing-notifications/classification";
import type { SecFilingFormType } from "@/types/database";

const SEC_ARCHIVES_ORIGIN = "https://www.sec.gov";

export interface SecCompanyTickerRecord {
  cik_str: number | string;
  ticker: string;
  title: string;
}

export interface SecSubmissionsRecent {
  accessionNumber?: unknown;
  form?: unknown;
  filingDate?: unknown;
  reportDate?: unknown;
  acceptanceDateTime?: unknown;
  primaryDocument?: unknown;
  primaryDocDescription?: unknown;
  items?: unknown;
}

export interface SecFilingCandidate {
  cik: string;
  accessionNumber: string;
  formType: SecFilingFormType;
  isAmendment: boolean;
  filingDate: string;
  reportDate: string | null;
  acceptedAt: string | null;
  primaryDocumentName: string | null;
  filingDetailUrl: string;
  primaryDocumentUrl: string | null;
  sourceMetadata: {
    primaryDocDescription: string | null;
    secItems: string[];
  };
}

export function normalizeCik(value: number | string): string | null {
  const digits = String(value).replace(/\D/g, "");
  if (!digits || digits.length > 10) return null;
  return digits.padStart(10, "0");
}

export function filingUrls(cik: string, accessionNumber: string, primaryDocument: string | null) {
  const accessionPath = accessionNumber.replace(/-/g, "");
  const directory = `${SEC_ARCHIVES_ORIGIN}/Archives/edgar/data/${Number(cik)}/${accessionPath}`;
  return {
    filingDetailUrl: `${directory}/${accessionNumber}-index.html`,
    primaryDocumentUrl: primaryDocument ? `${directory}/${encodeURIComponent(primaryDocument)}` : null,
  };
}

export function parseRecentFilingCandidates(
  cik: string,
  recent: SecSubmissionsRecent | null | undefined,
): SecFilingCandidate[] {
  if (!recent || typeof recent !== "object") return [];
  const accessions = arrayOfStrings(recent.accessionNumber);
  const forms = arrayOfStrings(recent.form);
  const filingDates = arrayOfStrings(recent.filingDate);
  const reportDates = arrayOfStrings(recent.reportDate);
  const acceptedDates = arrayOfStrings(recent.acceptanceDateTime);
  const primaryDocuments = arrayOfStrings(recent.primaryDocument);
  const descriptions = arrayOfStrings(recent.primaryDocDescription);
  const items = arrayOfStrings(recent.items);
  const candidates: SecFilingCandidate[] = [];

  for (let index = 0; index < accessions.length; index += 1) {
    const accessionNumber = accessions[index];
    const form = forms[index];
    const filingDate = filingDates[index];
    if (!accessionNumber || !form || !filingDate || !isFilingFormType(form)) continue;
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) continue;

    const primaryDocumentName = primaryDocuments[index] || null;
    const urls = filingUrls(cik, accessionNumber, primaryDocumentName);
    candidates.push({
      cik,
      accessionNumber,
      formType: form,
      isAmendment: isAmendedFilingForm(form),
      filingDate,
      reportDate: validDate(reportDates[index]) ? reportDates[index] : null,
      acceptedAt: validDateTime(acceptedDates[index]),
      primaryDocumentName,
      filingDetailUrl: urls.filingDetailUrl,
      primaryDocumentUrl: urls.primaryDocumentUrl,
      sourceMetadata: {
        primaryDocDescription: descriptions[index] || null,
        secItems: normalizeSecItems(items[index]),
      },
    });
  }

  return candidates;
}

/**
 * The catalog feed retains ninety days of events. Reconciliation may return
 * up to a thousand historical submissions for one CIK, so older records must
 * not be inserted into the live processing queue during the initial baseline.
 */
export function isFilingCandidateWithinLookback(candidate: SecFilingCandidate, cutoff: Date): boolean {
  const occurredAt = candidate.acceptedAt ?? `${candidate.filingDate}T23:59:59.999Z`;
  const timestamp = Date.parse(occurredAt);
  return Number.isFinite(timestamp) && timestamp >= cutoff.getTime();
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : "")) : [];
}

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function validDateTime(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(value)) return null;
  const normalized = value.endsWith("Z") ? value : `${value}Z`;
  return Number.isNaN(Date.parse(normalized)) ? null : new Date(normalized).toISOString();
}
