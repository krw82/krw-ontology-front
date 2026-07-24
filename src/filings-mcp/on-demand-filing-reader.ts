import "server-only";

import { createHash } from "node:crypto";
import { readIntEnv } from "@/lib/env";
import { toPublicFilingBrief } from "@/lib/filing-briefs/public";
import {
  parseFilingIndexDocuments,
  type FilingDocumentCandidate,
} from "@/lib/filing-notifications/sec-filing-index";
import { parseSecFilingSections, type FilingSection, type ParsedFilingSections } from "@/lib/filing-notifications/sec-filing-sections";
import { fetchSecText, SecRequestError } from "@/lib/filing-notifications/sec-client";
import { reserveSecRequestSlot } from "@/lib/filing-notifications/sec-request-limiter";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  SecFilingDocumentRow,
  SecFilingBriefRow,
  SecFilingEventRow,
  SecForm4EventSummaryRow,
  SecForm4ReportingOwnerRow,
  SecForm4TransactionRow,
} from "@/types/database";

const ON_DEMAND_DOCUMENT_MAX_BYTES = readIntEnv("FILINGS_MCP_MAX_DOCUMENT_BYTES", 10 * 1024 * 1024, {
  min: 128 * 1024,
  max: 25 * 1024 * 1024,
});
const ON_DEMAND_DOCUMENT_MAX_CHARS = readIntEnv("FILINGS_MCP_MAX_DOCUMENT_CHARS", 1_500_000, {
  min: 50_000,
  max: 3_000_000,
});
const ON_DEMAND_CACHE_TTL_MS = readIntEnv("FILINGS_MCP_CACHE_TTL_MS", 5 * 60 * 1000, {
  min: 10_000,
  max: 15 * 60 * 1000,
});
const ON_DEMAND_CACHE_MAX_ENTRIES = readIntEnv("FILINGS_MCP_CACHE_MAX_ENTRIES", 16, {
  min: 1,
  max: 64,
});
const ON_DEMAND_SEC_MIN_INTERVAL_MS = readIntEnv("SEC_GLOBAL_MIN_REQUEST_INTERVAL_MS", 150, {
  min: 100,
  max: 10_000,
});

export class FilingReaderError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FilingReaderError";
  }
}

export type FilingMcpMetadata = {
  filing_event_id: string;
  ticker: string;
  cik: string;
  accession_number: string;
  form_type: SecFilingEventRow["form_type"];
  filing_date: string;
  report_date: string | null;
  accepted_at: string | null;
  sec_items: string[];
  event_tags: string[];
  filing_detail_url: string;
  primary_document_url: string | null;
  enrichment_status: SecFilingEventRow["enrichment_status"];
};

export type FilingSectionDescriptor = Pick<FilingSection, "key" | "kind" | "heading" | "itemCode" | "confidence"> & {
  text_length: number;
};

/**
 * Metadata from the verified SEC submission index. This is deliberately not a
 * persisted document record: it exists only in the on-demand MCP response and
 * the process-local cache used to serve the active request.
 */
export type FilingDocumentDescriptor = {
  document_key: string;
  document_name: string;
  document_type: string | null;
  description: string | null;
  document_url: string;
  sequence: number | null;
  size_bytes: number | null;
  is_primary: boolean;
  recommendation_score: number;
  readable: boolean;
};

export type FilingDocumentCitation = {
  source: "SEC EDGAR";
  filing_event_id: string;
  accession_number: string;
  filing_detail_url: string;
  document_url: string;
  section_key: string;
  section_heading: string;
  extraction: "deterministic_html" | "stored_structured_form4";
  fetched_at: string;
  document_key?: string;
  document_name?: string;
  document_type?: string | null;
};

type ActiveCatalogFiling = {
  filing: SecFilingEventRow;
  releaseId: string;
};

type CachedDocument = {
  expiresAt: number;
  parsed: ParsedFilingSections;
  documentUrl: string;
  fetchedAt: string;
};

type ListedFilingDocument = FilingDocumentDescriptor;

type CachedDocumentList = {
  expiresAt: number;
  documents: ListedFilingDocument[];
  fetchedAt: string;
};

const documentCache = new Map<string, CachedDocument>();
const inFlightDocumentReads = new Map<string, Promise<CachedDocument>>();
const documentListCache = new Map<string, CachedDocumentList>();
const inFlightDocumentListReads = new Map<string, Promise<CachedDocumentList>>();

export function filingsMcpEnv(): "dev" | "staging" | "prod" {
  const value = (process.env.FILINGS_MCP_ENV ?? process.env.FILING_WORKER_ENV ?? "prod").trim().toLowerCase();
  if (value === "dev" || value === "staging" || value === "prod") return value;
  throw new Error("FILINGS_MCP_ENV must be dev, staging, or prod");
}

export async function getFilingMetadata(filingEventId: string): Promise<FilingMcpMetadata> {
  const { filing } = await loadActiveCatalogFiling(filingEventId);
  return toMetadata(filing);
}

/**
 * Returns the cached source-grounded brief when one has passed validation.
 * This is a discovery aid only; a follow-up answer must still re-read SEC
 * sections with read_filing_section for the full source context.
 */
export async function getFilingBrief(filingEventId: string): Promise<{
  filing: FilingMcpMetadata;
  status: "ready" | "not_available";
  brief: ReturnType<typeof toPublicFilingBrief>;
  machine_generated: true;
  note: string;
}> {
  const { filing } = await loadActiveCatalogFiling(filingEventId);
  const { data, error } = await getSupabaseAdmin()
    .from("sec_filing_briefs")
    .select("*")
    .eq("filing_event_id", filing.id)
    .maybeSingle<SecFilingBriefRow>();
  if (error) throw new FilingReaderError("filing_brief_unavailable", "The source-grounded filing brief could not be read.");
  const brief = toPublicFilingBrief(data ?? null);
  return {
    filing: toMetadata(filing),
    status: brief ? "ready" : "not_available",
    brief,
    machine_generated: true,
    note: brief
      ? "This is a source-grounded automatic summary, not an investment conclusion. Re-read cited SEC sections before answering a question."
      : "No validated automatic brief is available. Use list_filing_sections and read_filing_section instead.",
  };
}

export async function searchCatalogFilings(params: {
  ticker: string;
  formType?: SecFilingEventRow["form_type"];
  limit?: number;
}): Promise<FilingMcpMetadata[]> {
  const ticker = params.ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/.test(ticker)) {
    throw new FilingReaderError("invalid_ticker", "Ticker must be an uppercase US listing symbol.");
  }
  const env = filingsMcpEnv();
  const admin = getSupabaseAdmin();
  const { data: release, error: releaseError } = await admin
    .from("ontology_catalog_releases")
    .select("release_id")
    .eq("env", env)
    .eq("active", true)
    .maybeSingle<{ release_id: string }>();
  if (releaseError) throw new FilingReaderError("catalog_unavailable", "The active ontology catalog could not be read.");
  if (!release) return [];

  const { data: company, error: companyError } = await admin
    .from("ontology_companies")
    .select("sec_cik")
    .eq("env", env)
    .eq("release_id", release.release_id)
    .eq("ticker", ticker)
    .maybeSingle<{ sec_cik: string | null }>();
  if (companyError) throw new FilingReaderError("catalog_unavailable", "The requested catalog company could not be read.");
  if (!company?.sec_cik) return [];

  let query = admin
    .from("sec_filing_events")
    .select("*")
    .eq("env", env)
    .eq("cik", normalizedCik(company.sec_cik))
    .order("occurred_at", { ascending: false })
    .limit(clampLimit(params.limit));
  if (params.formType) query = query.eq("form_type", params.formType);
  const { data, error } = await query.returns<SecFilingEventRow[]>();
  if (error) throw new FilingReaderError("filing_search_unavailable", "Catalog filing metadata could not be read.");

  // A stale event for a CIK that remains in the catalog is still harmless
  // metadata, but only events with active-release coverage become MCP results.
  const events = data ?? [];
  if (events.length === 0) return [];
  const { data: coverage, error: coverageError } = await admin
    .from("sec_filing_event_catalog_coverage")
    .select("filing_event_id")
    .eq("env", env)
    .eq("release_id", release.release_id)
    .in("filing_event_id", events.map((event) => event.id))
    .returns<Array<{ filing_event_id: string }>>();
  if (coverageError) throw new FilingReaderError("catalog_unavailable", "Catalog filing coverage could not be read.");
  const coveredIds = new Set((coverage ?? []).map((row) => row.filing_event_id));
  return events.filter((event) => coveredIds.has(event.id)).map(toMetadata);
}

export async function listFilingSections(filingEventId: string): Promise<{
  filing: FilingMcpMetadata;
  sections: FilingSectionDescriptor[];
  document_url: string;
  fetched_at: string;
  document_truncated: boolean;
}> {
  const active = await loadActiveCatalogFiling(filingEventId);
  assertNarrativeFiling(active.filing);
  const document = await loadPrimaryParsedDocument(active.filing);
  return {
    filing: toMetadata(active.filing),
    sections: [
      {
        key: "document:primary",
        kind: "primary_document",
        heading: "Primary filing document",
        itemCode: null,
        confidence: "fallback",
        text_length: document.parsed.normalizedText.length,
      },
      ...document.parsed.sections
        .filter((section) => section.key !== "document:primary")
        .map(toSectionDescriptor),
    ],
    document_url: document.documentUrl,
    fetched_at: document.fetchedAt,
    document_truncated: document.parsed.truncated,
  };
}

export async function readFilingSection(params: {
  filingEventId: string;
  sectionKey: string;
  offset?: number;
  maxChars?: number;
}): Promise<{
  filing: FilingMcpMetadata;
  section: FilingSectionDescriptor;
  text: string;
  offset: number;
  next_offset: number | null;
  document_truncated: boolean;
  citation: FilingDocumentCitation;
}> {
  const active = await loadActiveCatalogFiling(params.filingEventId);
  assertNarrativeFiling(active.filing);
  const document = await loadPrimaryParsedDocument(active.filing);
  const section = resolveSection(document.parsed, params.sectionKey);
  if (!section) {
    throw new FilingReaderError("section_not_found", `No section named ${params.sectionKey} exists in this filing.`);
  }

  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  const maxChars = Math.max(1_000, Math.min(Math.floor(params.maxChars ?? 24_000), 120_000));
  const text = section.text.slice(offset, offset + maxChars);
  const nextOffset = offset + text.length < section.text.length ? offset + text.length : null;
  return {
    filing: toMetadata(active.filing),
    section: toSectionDescriptor(section),
    text,
    offset,
    next_offset: nextOffset,
    document_truncated: document.parsed.truncated,
    citation: {
      source: "SEC EDGAR",
      filing_event_id: active.filing.id,
      accession_number: active.filing.accession_number,
      filing_detail_url: active.filing.filing_detail_url,
      document_url: document.documentUrl,
      section_key: section.key,
      section_heading: section.heading,
      extraction: "deterministic_html",
      fetched_at: document.fetchedAt,
    },
  };
}

/**
 * Lists files from the source filing's SEC submission index without writing
 * the document list or any body to Supabase. A caller must use a returned
 * document_key; raw SEC URLs are never accepted as read inputs.
 */
export async function listFilingDocuments(filingEventId: string): Promise<{
  filing: FilingMcpMetadata;
  documents: FilingDocumentDescriptor[];
  fetched_at: string;
}> {
  const active = await loadActiveCatalogFiling(filingEventId);
  assertNarrativeFiling(active.filing);
  const documentList = await loadFilingDocumentList(active.filing);
  return {
    filing: toMetadata(active.filing),
    documents: documentList.documents,
    fetched_at: documentList.fetchedAt,
  };
}

/**
 * Reads a bounded plain-text slice of one verified, text-like attachment in
 * the source filing. It fetches from SEC on demand and retains the body only
 * in the existing bounded process-memory cache.
 */
export async function readFilingDocument(params: {
  filingEventId: string;
  documentKey: string;
  offset?: number;
  maxChars?: number;
}): Promise<{
  filing: FilingMcpMetadata;
  document: FilingDocumentDescriptor;
  text: string;
  offset: number;
  next_offset: number | null;
  document_truncated: boolean;
  citation: FilingDocumentCitation;
}> {
  const active = await loadActiveCatalogFiling(params.filingEventId);
  assertNarrativeFiling(active.filing);
  const documentList = await loadFilingDocumentList(active.filing);
  const descriptor = documentList.documents.find(
    (candidate) => candidate.document_key === params.documentKey,
  );
  if (!descriptor) {
    throw new FilingReaderError(
      "document_not_found",
      "The requested document is not present in this filing's verified SEC index.",
    );
  }
  if (!descriptor.readable) {
    throw new FilingReaderError(
      "unsupported_document_format",
      "This SEC attachment is not a supported text document for on-demand reading.",
    );
  }
  if (!isVerifiedFilingDocumentUrl(descriptor.document_url, active.filing)) {
    throw new FilingReaderError(
      "document_unavailable",
      "The requested document is outside the verified SEC filing directory.",
    );
  }

  const source = await loadParsedDocumentForUrl(
    active.filing,
    descriptor.document_url,
  );
  const slice = readTextSlice(source.parsed.normalizedText, params.offset, params.maxChars);
  return {
    filing: toMetadata(active.filing),
    document: descriptor,
    text: slice.text,
    offset: slice.offset,
    next_offset: slice.nextOffset,
    document_truncated: source.parsed.truncated,
    citation: {
      source: "SEC EDGAR",
      filing_event_id: active.filing.id,
      accession_number: active.filing.accession_number,
      filing_detail_url: active.filing.filing_detail_url,
      document_url: descriptor.document_url,
      section_key: descriptor.document_key,
      section_heading: documentHeading(descriptor),
      extraction: "deterministic_html",
      fetched_at: source.fetchedAt,
      document_key: descriptor.document_key,
      document_name: descriptor.document_name,
      document_type: descriptor.document_type,
    },
  };
}

export async function getForm4InsiderTransactions(filingEventId: string): Promise<{
  filing: FilingMcpMetadata;
  summary: SecForm4EventSummaryRow | null;
  reporting_owners: SecForm4ReportingOwnerRow[];
  transactions: SecForm4TransactionRow[];
  source: "stored_structured_form4_facts";
  citation: FilingDocumentCitation;
}> {
  const { filing } = await loadActiveCatalogFiling(filingEventId);
  if (filing.form_type !== "4" && filing.form_type !== "4/A") {
    throw new FilingReaderError("not_form4", "Insider transaction facts are available only for Form 4 filings.");
  }
  const admin = getSupabaseAdmin();
  const [summaryResult, ownersResult, transactionsResult] = await Promise.all([
    admin
      .from("sec_form4_event_summaries")
      .select("*")
      .eq("filing_event_id", filing.id)
      .maybeSingle<SecForm4EventSummaryRow>(),
    admin
      .from("sec_form4_reporting_owners")
      .select("*")
      .eq("filing_event_id", filing.id)
      .order("reporting_owner_index", { ascending: true })
      .returns<SecForm4ReportingOwnerRow[]>(),
    admin
      .from("sec_form4_transactions")
      .select("*")
      .eq("filing_event_id", filing.id)
      .order("reporting_owner_index", { ascending: true })
      .order("transaction_index", { ascending: true })
      .returns<SecForm4TransactionRow[]>(),
  ]);
  if (summaryResult.error || ownersResult.error || transactionsResult.error) {
    throw new FilingReaderError("form4_facts_unavailable", "Structured Form 4 facts could not be read.");
  }
  return {
    filing: toMetadata(filing),
    summary: summaryResult.data ?? null,
    reporting_owners: ownersResult.data ?? [],
    transactions: transactionsResult.data ?? [],
    source: "stored_structured_form4_facts",
    citation: {
      source: "SEC EDGAR",
      filing_event_id: filing.id,
      accession_number: filing.accession_number,
      filing_detail_url: filing.filing_detail_url,
      document_url: filing.primary_document_url ?? filing.filing_detail_url,
      section_key: "form4:transactions",
      section_heading: "Structured Form 4 insider transactions",
      extraction: "stored_structured_form4",
      fetched_at: new Date().toISOString(),
    },
  };
}

async function loadActiveCatalogFiling(filingEventId: string): Promise<ActiveCatalogFiling> {
  const env = filingsMcpEnv();
  const admin = getSupabaseAdmin();
  const { data: filing, error: filingError } = await admin
    .from("sec_filing_events")
    .select("*")
    .eq("id", filingEventId)
    .eq("env", env)
    .maybeSingle<SecFilingEventRow>();
  if (filingError) throw new FilingReaderError("filing_unavailable", "Filing metadata could not be read.");
  if (!filing) throw new FilingReaderError("filing_not_found", "This filing is not available in the active catalog.");

  const { data: release, error: releaseError } = await admin
    .from("ontology_catalog_releases")
    .select("release_id")
    .eq("env", env)
    .eq("active", true)
    .maybeSingle<{ release_id: string }>();
  if (releaseError) throw new FilingReaderError("catalog_unavailable", "The active ontology catalog could not be read.");
  if (!release) throw new FilingReaderError("catalog_unavailable", "No active ontology catalog is available.");

  const { data: coverage, error: coverageError } = await admin
    .from("sec_filing_event_catalog_coverage")
    .select("filing_event_id")
    .eq("filing_event_id", filing.id)
    .eq("env", env)
    .eq("release_id", release.release_id)
    .maybeSingle<{ filing_event_id: string }>();
  if (coverageError) throw new FilingReaderError("catalog_unavailable", "Catalog filing coverage could not be read.");
  if (!coverage) throw new FilingReaderError("filing_not_covered", "This filing is no longer covered by the active catalog.");
  return { filing, releaseId: release.release_id };
}

function assertNarrativeFiling(filing: SecFilingEventRow): void {
  if (!["8-K", "8-K/A", "6-K", "6-K/A"].includes(filing.form_type)) {
    throw new FilingReaderError("unsupported_form", "Original-document sections are available only for 8-K and 6-K filings.");
  }
}

async function loadPrimaryParsedDocument(filing: SecFilingEventRow): Promise<CachedDocument> {
  const documentUrl = await selectPrimaryDocumentUrl(filing);
  return loadParsedDocumentForUrl(filing, documentUrl);
}

async function loadParsedDocumentForUrl(
  filing: SecFilingEventRow,
  documentUrl: string,
): Promise<CachedDocument> {
  const cacheKey = `${filing.id}:${documentUrl}`;
  const cached = documentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (cached) documentCache.delete(cacheKey);

  const pending = inFlightDocumentReads.get(cacheKey);
  if (pending) return pending;
  const read = fetchAndParseDocument(filing, documentUrl, cacheKey).finally(() => {
    inFlightDocumentReads.delete(cacheKey);
  });
  inFlightDocumentReads.set(cacheKey, read);
  return read;
}

async function loadFilingDocumentList(
  filing: SecFilingEventRow,
): Promise<CachedDocumentList> {
  const cacheKey = `${filing.id}:${filing.filing_detail_url}`;
  const cached = documentListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (cached) documentListCache.delete(cacheKey);

  const pending = inFlightDocumentListReads.get(cacheKey);
  if (pending) return pending;
  const read = fetchAndListFilingDocuments(filing, cacheKey).finally(() => {
    inFlightDocumentListReads.delete(cacheKey);
  });
  inFlightDocumentListReads.set(cacheKey, read);
  return read;
}

async function fetchAndListFilingDocuments(
  filing: SecFilingEventRow,
  cacheKey: string,
): Promise<CachedDocumentList> {
  await reserveSecRequestSlot({ scope: "global", minIntervalMs: ON_DEMAND_SEC_MIN_INTERVAL_MS });
  let indexHtml: string;
  try {
    indexHtml = await fetchSecText(filing.filing_detail_url, 15_000, {
      maxBytes: ON_DEMAND_DOCUMENT_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof SecRequestError && error.code === "response_too_large") {
      throw new FilingReaderError("document_index_too_large", "SEC's filing document index is too large for a safe on-demand read.");
    }
    throw error;
  }

  const indexed = parseFilingIndexDocuments({
    html: indexHtml,
    filingDetailUrl: filing.filing_detail_url,
    primaryDocumentName: filing.primary_document_name,
  });
  const documents = canonicalFilingDocuments(filing, indexed);
  if (documents.length === 0) {
    throw new FilingReaderError("document_index_unavailable", "No verified readable document metadata is available for this SEC filing.");
  }
  const cached: CachedDocumentList = {
    expiresAt: Date.now() + ON_DEMAND_CACHE_TTL_MS,
    documents,
    fetchedAt: new Date().toISOString(),
  };
  documentListCache.set(cacheKey, cached);
  evictExpiredCacheEntries();
  return cached;
}

async function fetchAndParseDocument(
  filing: SecFilingEventRow,
  documentUrl: string,
  cacheKey: string,
): Promise<CachedDocument> {
  await reserveSecRequestSlot({ scope: "global", minIntervalMs: ON_DEMAND_SEC_MIN_INTERVAL_MS });
  let html: string;
  try {
    html = await fetchSecText(documentUrl, 15_000, { maxBytes: ON_DEMAND_DOCUMENT_MAX_BYTES });
  } catch (error) {
    if (error instanceof SecRequestError && error.code === "response_too_large") {
      throw new FilingReaderError("document_too_large", "SEC's filing document is too large for a safe on-demand read.");
    }
    throw error;
  }
  const parsed = parseSecFilingSections(html, {
    form: filing.form_type,
    maxDocumentChars: ON_DEMAND_DOCUMENT_MAX_CHARS,
  });
  const cached: CachedDocument = {
    expiresAt: Date.now() + ON_DEMAND_CACHE_TTL_MS,
    parsed,
    documentUrl,
    fetchedAt: new Date().toISOString(),
  };
  documentCache.set(cacheKey, cached);
  evictExpiredCacheEntries();
  return cached;
}

async function selectPrimaryDocumentUrl(filing: SecFilingEventRow): Promise<string> {
  const { data: documents, error } = await getSupabaseAdmin()
    .from("sec_filing_documents")
    .select("*")
    .eq("filing_event_id", filing.id)
    .returns<SecFilingDocumentRow[]>();
  if (error) throw new FilingReaderError("document_metadata_unavailable", "Filing document metadata could not be read.");
  const candidate = (documents ?? []).find((document) => document.is_primary)
    ?? (documents ?? []).find((document) => document.document_name === filing.primary_document_name)
    ?? null;
  const documentUrl = candidate?.document_url ?? filing.primary_document_url;
  if (!documentUrl || !isVerifiedFilingDocumentUrl(documentUrl, filing)) {
    throw new FilingReaderError("document_unavailable", "A verified primary SEC document is not available for this filing.");
  }
  return documentUrl;
}

export function isVerifiedFilingDocumentUrl(value: string, filing: Pick<SecFilingEventRow, "cik" | "accession_number">): boolean {
  try {
    const url = new URL(value);
    const cik = normalizedCik(filing.cik);
    const accessionDirectory = filing.accession_number.replaceAll("-", "");
    return url.protocol === "https:"
      && url.hostname === "www.sec.gov"
      && url.pathname.startsWith(`/Archives/edgar/data/${cik}/`)
      && url.pathname.includes(`/${accessionDirectory}/`);
  } catch {
    return false;
  }
}

function resolveSection(parsed: ParsedFilingSections, sectionKey: string): FilingSection | null {
  if (sectionKey === "document:primary") {
    return {
      key: "document:primary",
      kind: "primary_document",
      heading: "Primary filing document",
      itemCode: null,
      text: parsed.normalizedText,
      confidence: "fallback",
    };
  }
  return parsed.sections.find((section) => section.key === sectionKey) ?? null;
}

function canonicalFilingDocuments(
  filing: SecFilingEventRow,
  candidates: FilingDocumentCandidate[],
): ListedFilingDocument[] {
  const byUrl = new Map<string, ListedFilingDocument>();
  for (const candidate of candidates) {
    if (!isVerifiedFilingDocumentUrl(candidate.documentUrl, filing)) continue;
    const descriptor = toDocumentDescriptor(filing, candidate);
    byUrl.set(descriptor.document_url, descriptor);
  }

  const primaryUrl = filing.primary_document_url;
  if (primaryUrl && isVerifiedFilingDocumentUrl(primaryUrl, filing) && !byUrl.has(primaryUrl)) {
    const documentName = filing.primary_document_name
      ?? new URL(primaryUrl).pathname.split("/").pop()
      ?? "primary-document";
    byUrl.set(primaryUrl, toDocumentDescriptor(filing, {
      sequence: null,
      documentName,
      documentType: filing.form_type,
      description: "Primary filing document",
      documentUrl: primaryUrl,
      sizeBytes: null,
      isPrimary: true,
      recommendationScore: 60,
    }));
  }

  return [...byUrl.values()].sort(
    (left, right) => right.recommendation_score - left.recommendation_score
      || Number(right.is_primary) - Number(left.is_primary)
      || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
      || left.document_name.localeCompare(right.document_name),
  );
}

function toDocumentDescriptor(
  filing: SecFilingEventRow,
  candidate: FilingDocumentCandidate,
): ListedFilingDocument {
  const isPrimary = candidate.isPrimary || candidate.documentUrl === filing.primary_document_url;
  return {
    document_key: documentKey(filing.id, candidate.documentUrl),
    document_name: candidate.documentName,
    document_type: candidate.documentType,
    description: candidate.description,
    document_url: candidate.documentUrl,
    sequence: candidate.sequence,
    size_bytes: candidate.sizeBytes,
    is_primary: isPrimary,
    recommendation_score: candidate.recommendationScore,
    readable: isReadableNarrativeDocument(candidate, isPrimary),
  };
}

function documentKey(filingEventId: string, documentUrl: string): string {
  const digest = createHash("sha256")
    .update(`${filingEventId}\n${documentUrl}`)
    .digest("base64url")
    .slice(0, 22);
  return `document:${digest}`;
}

function isReadableNarrativeDocument(
  candidate: FilingDocumentCandidate,
  isPrimary: boolean,
): boolean {
  if (!/\.(?:html?|xml|txt)$/i.test(candidate.documentName)) return false;
  if (isPrimary) return true;
  const type = candidate.documentType?.trim().toUpperCase() ?? "";
  return /^(?:EX-(?:2|10|99)(?:\.\d+)?|EXHIBIT\s+(?:2|10|99)(?:\.\d+)?)$/.test(type);
}

function documentHeading(document: FilingDocumentDescriptor): string {
  const type = document.document_type?.trim();
  return type ? `${type} — ${document.document_name}` : document.document_name;
}

function readTextSlice(
  fullText: string,
  requestedOffset: number | undefined,
  requestedMaxChars: number | undefined,
): { text: string; offset: number; nextOffset: number | null } {
  const offset = Math.max(0, Math.floor(requestedOffset ?? 0));
  const maxChars = Math.max(1_000, Math.min(Math.floor(requestedMaxChars ?? 24_000), 120_000));
  const text = fullText.slice(offset, offset + maxChars);
  return {
    text,
    offset,
    nextOffset: offset + text.length < fullText.length ? offset + text.length : null,
  };
}

function toMetadata(filing: SecFilingEventRow): FilingMcpMetadata {
  return {
    filing_event_id: filing.id,
    ticker: filing.ticker,
    cik: filing.cik,
    accession_number: filing.accession_number,
    form_type: filing.form_type,
    filing_date: filing.filing_date,
    report_date: filing.report_date,
    accepted_at: filing.accepted_at,
    sec_items: filing.sec_items,
    event_tags: filing.event_tags,
    filing_detail_url: filing.filing_detail_url,
    primary_document_url: filing.primary_document_url,
    enrichment_status: filing.enrichment_status,
  };
}

function toSectionDescriptor(section: FilingSection): FilingSectionDescriptor {
  return {
    key: section.key,
    kind: section.kind,
    heading: section.heading,
    itemCode: section.itemCode,
    confidence: section.confidence,
    text_length: section.text.length,
  };
}

function normalizedCik(value: string): string {
  const digits = value.replace(/\D/g, "");
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || number < 1) throw new FilingReaderError("invalid_cik", "Filing metadata has an invalid SEC CIK.");
  return String(number);
}

function clampLimit(value: number | undefined): number {
  return Math.max(1, Math.min(Math.floor(value ?? 10), 25));
}

function evictExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of documentCache) {
    if (entry.expiresAt <= now) documentCache.delete(key);
  }
  while (documentCache.size > ON_DEMAND_CACHE_MAX_ENTRIES) {
    const oldestKey = documentCache.keys().next().value;
    if (!oldestKey) break;
    documentCache.delete(oldestKey);
  }
  for (const [key, entry] of documentListCache) {
    if (entry.expiresAt <= now) documentListCache.delete(key);
  }
  while (documentListCache.size > ON_DEMAND_CACHE_MAX_ENTRIES) {
    const oldestKey = documentListCache.keys().next().value;
    if (!oldestKey) break;
    documentListCache.delete(oldestKey);
  }
}
