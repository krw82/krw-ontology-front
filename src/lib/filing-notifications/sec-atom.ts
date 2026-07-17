import { XMLParser } from "fast-xml-parser";
import { filingUrls, normalizeCik } from "@/lib/filing-notifications/sec-edgar";
import type { SecFilingFormType } from "@/types/database";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  removeNSPrefix: true,
});

export type SecAtomFilingCandidate = {
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
    atomTitle: string | null;
    atomUpdatedAt: string | null;
  };
};

export function atomSourceKeyForForm(formType: SecFilingFormType): string {
  return `atom:${formType}`;
}

export function formTypeFromAtomSourceKey(sourceKey: string): SecFilingFormType | null {
  const formType = sourceKey.startsWith("atom:") ? sourceKey.slice("atom:".length) : "";
  return ["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"].includes(formType)
    ? formType as SecFilingFormType
    : null;
}

/**
 * The SEC current-feed Atom endpoint is only a discovery source. We preserve
 * its title/summary for auditability and take durable filing metadata from the
 * accession URL. All candidates are later checked against the active catalog
 * CIK set before being persisted.
 */
export function parseSecAtomCurrentFeed(xml: string, formType: SecFilingFormType): SecAtomFilingCandidate[] {
  const parsed = parser.parse(xml) as unknown;
  const feed = objectAt(parsed, "feed");
  const entries = asArray(feed?.entry);
  const byAccession = new Map<string, SecAtomFilingCandidate>();

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const links = asArray(entry.link);
    const href = links
      .map((link) => isRecord(link) ? valueOf(link["@_href"]) : null)
      .find((value) => value && isSecArchivesUrl(value));
    if (!href) continue;
    const accessionNumber = href.match(/\b\d{10}-\d{2}-\d{6}\b/)?.[0] ?? null;
    const cik = cikFromSecUrl(href);
    if (!accessionNumber || !cik) continue;
    const updatedAt = asIsoDate(valueOf(entry.updated));
    const summary = stripMarkup(valueOf(entry.summary));
    const filingDate = dateFromSummary(summary) ?? datePart(updatedAt);
    if (!filingDate) continue;
    const primaryDocumentName = documentNameFromSecUrl(href);
    const urls = filingUrls(cik, accessionNumber, primaryDocumentName);
    const title = stripMarkup(valueOf(entry.title));
    const candidate: SecAtomFilingCandidate = {
      cik,
      accessionNumber,
      formType,
      isAmendment: formType.endsWith("/A"),
      filingDate,
      reportDate: null,
      acceptedAt: updatedAt,
      primaryDocumentName,
      filingDetailUrl: isFilingIndexUrl(href) ? href : urls.filingDetailUrl,
      primaryDocumentUrl: isFilingIndexUrl(href) ? urls.primaryDocumentUrl : href,
      sourceMetadata: {
        primaryDocDescription: summary || null,
        secItems: [],
        atomTitle: title || null,
        atomUpdatedAt: updatedAt,
      },
    };
    const existing = byAccession.get(accessionNumber);
    if (!existing || Date.parse(candidate.acceptedAt ?? candidate.filingDate) > Date.parse(existing.acceptedAt ?? existing.filingDate)) {
      byAccession.set(accessionNumber, candidate);
    }
  }

  return [...byAccession.values()].sort((left, right) =>
    Date.parse(right.acceptedAt ?? right.filingDate) - Date.parse(left.acceptedAt ?? left.filingDate)
    || right.accessionNumber.localeCompare(left.accessionNumber),
  );
}

function objectAt(value: unknown, key: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function valueOf(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  if (isRecord(value)) return valueOf(value["#text"] ?? value.value);
  return null;
}

function isSecArchivesUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.sec.gov" && url.pathname.startsWith("/Archives/");
  } catch {
    return false;
  }
}

function cikFromSecUrl(value: string): string | null {
  try {
    const path = new URL(value).pathname;
    const digits = path.match(/\/data\/(\d{1,10})\//)?.[1];
    return digits ? normalizeCik(digits) : null;
  } catch {
    return null;
  }
}

function documentNameFromSecUrl(value: string): string | null {
  try {
    const name = new URL(value).pathname.split("/").at(-1) ?? "";
    return name && !/-index\.html?$/i.test(name) ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

function isFilingIndexUrl(value: string): boolean {
  return /-index\.html?$/i.test(value);
}

function stripMarkup(value: string | null): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function asIsoDate(value: string | null): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function dateFromSummary(value: string): string | null {
  const match = value.match(/(?:filed|filing date)\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  return match?.[1] ?? null;
}

function datePart(value: string | null): string | null {
  return value?.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? value.slice(0, 10) : null;
}
