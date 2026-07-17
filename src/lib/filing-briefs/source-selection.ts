import "server-only";

import { createHash } from "node:crypto";
import { parseSecFilingSections, type FilingSection, type ParsedFilingSections } from "@/lib/filing-notifications/sec-filing-sections";
import { fetchSecText } from "@/lib/filing-notifications/sec-client";
import { reserveSecRequestSlot } from "@/lib/filing-notifications/sec-request-limiter";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingDocumentRow, SecFilingEventRow } from "@/types/database";
import type {
  FilingBriefSource,
  FilingBriefSourceEvidence,
  FilingBriefSourceSection,
} from "./contract";

export const DEFAULT_FILING_BRIEF_MAX_INPUT_CHARS = 24_000;
export const DEFAULT_FILING_BRIEF_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_SELECTED_SECTIONS = 4;
const EXHIBIT_FALLBACK_MIN_CHARS = 1_200;
const MAX_EVIDENCE_CHARS = 600;
const MIN_EVIDENCE_CHARS = 12;

export type FilingBriefSourceOptions = {
  maxInputChars?: number;
  maxDocumentBytes?: number;
  secMinRequestIntervalMs?: number;
};

export class FilingBriefSourceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FilingBriefSourceError";
  }
}

type SourceDocument = {
  documentUrl: string;
  documentName: string | null;
  documentType: string | null;
  description: string | null;
  isPrimary: boolean;
  recommendationScore: number;
};

type SelectedSource = {
  sections: FilingBriefSourceSection[];
  truncated: boolean;
};

/**
 * Fetches only the narrowly selected SEC sections required for a brief. The
 * returned strings stay in the worker process and are never written to the DB.
 */
export async function loadFilingBriefSource(
  filingEventId: string,
  options: FilingBriefSourceOptions = {},
): Promise<FilingBriefSource> {
  const maxInputChars = clampInteger(
    options.maxInputChars,
    DEFAULT_FILING_BRIEF_MAX_INPUT_CHARS,
    4_000,
    60_000,
  );
  const maxDocumentBytes = clampInteger(
    options.maxDocumentBytes,
    DEFAULT_FILING_BRIEF_MAX_DOCUMENT_BYTES,
    256 * 1024,
    25 * 1024 * 1024,
  );
  const secMinRequestIntervalMs = clampInteger(options.secMinRequestIntervalMs, 150, 100, 10_000);
  const admin = getSupabaseAdmin();
  const [{ data: filing, error: filingError }, { data: documents, error: documentsError }] = await Promise.all([
    admin.from("sec_filing_events").select("*").eq("id", filingEventId).maybeSingle<SecFilingEventRow>(),
    admin.from("sec_filing_documents").select("*").eq("filing_event_id", filingEventId).returns<SecFilingDocumentRow[]>(),
  ]);
  if (filingError || !filing) {
    throw new FilingBriefSourceError("filing_unavailable", "The filing event could not be loaded for a brief.");
  }
  if (documentsError) {
    throw new FilingBriefSourceError("document_metadata_unavailable", "The filing document metadata could not be loaded.");
  }
  if (!isNarrativeFiling(filing.form_type)) {
    throw new FilingBriefSourceError("not_narrative_filing", "Filing briefs are limited to 8-K and 6-K filings.");
  }

  const sourceDocuments = toSourceDocuments(filing, documents ?? []);
  const primary = choosePrimaryDocument(filing, sourceDocuments);
  const primaryHtml = await fetchBriefDocument(primary.documentUrl, secMinRequestIntervalMs, maxDocumentBytes);
  const primaryParsed = parseSecFilingSections(primaryHtml, { form: filing.form_type });
  let selected = selectFilingBriefSections({
    parsed: primaryParsed,
    secItems: filing.sec_items,
    documentUrl: primary.documentUrl,
  });

  // Some current reports only say "see Exhibit 99.1". In that case use one
  // SEC-indexed narrative exhibit as a bounded fallback, never a blind crawl.
  if (selected.sections.reduce((total, section) => total + section.text.length, 0) < EXHIBIT_FALLBACK_MIN_CHARS) {
    const exhibit = chooseNarrativeExhibit(sourceDocuments, primary.documentUrl);
    if (exhibit) {
      try {
        const exhibitHtml = await fetchBriefDocument(exhibit.documentUrl, secMinRequestIntervalMs, maxDocumentBytes);
        const exhibitParsed = parseSecFilingSections(exhibitHtml, { form: "EX-99" });
        const exhibitText = exhibitParsed.normalizedText.trim();
        if (exhibitText) {
          selected = {
            sections: [
              ...selected.sections,
              {
                key: `exhibit:${normalizeDocumentKey(exhibit.documentName ?? exhibit.documentUrl)}`,
                heading: exhibit.description || exhibit.documentType || "SEC exhibit",
                text: exhibitText,
                documentUrl: exhibit.documentUrl,
              },
            ],
            truncated: selected.truncated || exhibitParsed.truncated,
          };
        }
      } catch (error) {
        // The primary filing remains a safe source. An optional exhibit should
        // not make the whole job fail merely because SEC omitted or changed it.
        console.warn("[filing-brief] exhibit fallback unavailable", {
          filingEventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const bounded = boundSourceSections(selected.sections, maxInputChars);
  if (!bounded.sections.length || !bounded.input.trim()) {
    throw new FilingBriefSourceError("source_empty", "The selected SEC filing sections had no readable text.");
  }
  const sourceEvidence = createFilingBriefEvidence(bounded.sections);
  if (!sourceEvidence.length) {
    throw new FilingBriefSourceError("source_empty", "The selected SEC filing sections had no citable evidence fragments.");
  }
  const input = renderFilingBriefEvidenceInput(bounded.sections, sourceEvidence);
  const sourceDocumentUrl = bounded.sections[0]?.documentUrl ?? primary.documentUrl;
  const sourceSha256 = createHash("sha256")
    .update(bounded.sections.map((section) => `${section.documentUrl}\n${section.key}\n${section.text}`).join("\n\n"))
    .digest("hex");
  return {
    filingEventId: filing.id,
    ticker: filing.ticker,
    formType: filing.form_type,
    filingDate: filing.filing_date,
    sourceDocumentUrl,
    sourceSha256,
    sourceSections: bounded.sections,
    sourceEvidence,
    input,
    inputCharCount: input.length,
    sourceTruncated: selected.truncated || bounded.truncated,
  };
}

export function isNarrativeFiling(formType: string): formType is FilingBriefSource["formType"] {
  return formType === "8-K" || formType === "8-K/A" || formType === "6-K" || formType === "6-K/A";
}

export function selectFilingBriefSections(params: {
  parsed: ParsedFilingSections;
  secItems: string[];
  documentUrl: string;
}): SelectedSource {
  const preferredKeys = new Set(
    params.secItems
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `item:${item}`.toLowerCase()),
  );
  const usable = params.parsed.sections.filter((section) => section.text.trim().length > 0);
  const preferred = usable.filter((section) => preferredKeys.has(section.key.toLowerCase()));
  const chosen = (preferred.length ? preferred : rankFallbackSections(usable))
    .slice(0, MAX_SELECTED_SECTIONS)
    .map((section) => toSourceSection(section, params.documentUrl));
  return {
    sections: chosen,
    truncated: params.parsed.truncated,
  };
}

export function boundSourceSections(
  sections: FilingBriefSourceSection[],
  maxInputChars: number,
): { sections: FilingBriefSourceSection[]; input: string; truncated: boolean } {
  const boundedMax = clampInteger(maxInputChars, DEFAULT_FILING_BRIEF_MAX_INPUT_CHARS, 4_000, 60_000);
  let remaining = boundedMax;
  let truncated = false;
  const selected: FilingBriefSourceSection[] = [];
  for (const section of sections.slice(0, MAX_SELECTED_SECTIONS)) {
    const header = `[SECTION ${section.key} | ${section.heading} | ${section.documentUrl}]\n`;
    const footer = "\n\n";
    const availableText = Math.max(0, remaining - header.length - footer.length);
    if (availableText < 120) {
      truncated = true;
      break;
    }
    const text = section.text.slice(0, availableText).trim();
    if (!text) continue;
    if (text.length < section.text.length) truncated = true;
    selected.push({ ...section, text });
    remaining -= header.length + text.length + footer.length;
    if (remaining <= 0) break;
  }
  const input = selected
    .map((section) => `[SECTION ${section.key} | ${section.heading} | ${section.documentUrl}]\n${section.text}`)
    .join("\n\n");
  return { sections: selected, input, truncated };
}

/**
 * Builds short, exact SEC text fragments that the model can reference by ID.
 * The model never has to reproduce punctuation or spacing, while the stored
 * quote remains an exact substring of the chosen source section.
 */
export function createFilingBriefEvidence(
  sections: FilingBriefSourceSection[],
): FilingBriefSourceEvidence[] {
  const evidence: FilingBriefSourceEvidence[] = [];
  let ordinal = 1;
  for (const section of sections) {
    for (const text of splitEvidenceText(section.text)) {
      if (text.length < MIN_EVIDENCE_CHARS) continue;
      evidence.push({ id: `e${ordinal}`, sectionKey: section.key, text });
      ordinal += 1;
    }
  }
  return evidence;
}

export function renderFilingBriefEvidenceInput(
  sections: FilingBriefSourceSection[],
  evidence: FilingBriefSourceEvidence[],
): string {
  const evidenceBySection = new Map<string, FilingBriefSourceEvidence[]>();
  for (const fragment of evidence) {
    const current = evidenceBySection.get(fragment.sectionKey) ?? [];
    current.push(fragment);
    evidenceBySection.set(fragment.sectionKey, current);
  }
  return sections
    .map((section) => {
      const fragments = evidenceBySection.get(section.key) ?? [];
      return [
        `[SECTION ${section.key} | ${section.heading} | ${section.documentUrl}]`,
        ...fragments.map((fragment) => `[EVIDENCE ${fragment.id}] ${fragment.text}`),
      ].join("\n");
    })
    .join("\n\n");
}

function toSourceDocuments(filing: SecFilingEventRow, documents: SecFilingDocumentRow[]): SourceDocument[] {
  const rows: SourceDocument[] = documents.map((document) => ({
    documentUrl: document.document_url,
    documentName: document.document_name,
    documentType: document.document_type,
    description: document.description,
    isPrimary: document.is_primary,
    recommendationScore: document.recommendation_score,
  }));
  if (filing.primary_document_url && !rows.some((row) => row.documentUrl === filing.primary_document_url)) {
    rows.push({
      documentUrl: filing.primary_document_url,
      documentName: filing.primary_document_name,
      documentType: null,
      description: null,
      isPrimary: true,
      recommendationScore: 60,
    });
  }
  return rows.filter((row) => isVerifiedFilingDocumentUrl(row.documentUrl, filing));
}

function choosePrimaryDocument(filing: SecFilingEventRow, documents: SourceDocument[]): SourceDocument {
  const primary = documents.find((document) => document.isPrimary)
    ?? documents.find((document) => document.documentName === filing.primary_document_name)
    ?? documents[0]
    ?? null;
  if (!primary) {
    throw new FilingBriefSourceError("document_unavailable", "A verified primary SEC filing document is not available.");
  }
  return primary;
}

function chooseNarrativeExhibit(documents: SourceDocument[], primaryUrl: string): SourceDocument | null {
  return documents
    .filter((document) => document.documentUrl !== primaryUrl)
    .filter((document) => /^EX-99/i.test(document.documentType ?? ""))
    .sort((left, right) => right.recommendationScore - left.recommendationScore || left.documentUrl.localeCompare(right.documentUrl))[0] ?? null;
}

async function fetchBriefDocument(
  documentUrl: string,
  secMinRequestIntervalMs: number,
  maxDocumentBytes: number,
): Promise<string> {
  await reserveSecRequestSlot({ minIntervalMs: secMinRequestIntervalMs });
  return fetchSecText(documentUrl, 30_000, { maxBytes: maxDocumentBytes });
}

function rankFallbackSections(sections: FilingSection[]): FilingSection[] {
  return [...sections].sort((left, right) => right.text.length - left.text.length || left.key.localeCompare(right.key));
}

function toSourceSection(section: FilingSection, documentUrl: string): FilingBriefSourceSection {
  return {
    key: section.key,
    heading: section.heading,
    text: section.text.trim(),
    documentUrl,
  };
}

function splitEvidenceText(value: string): string[] {
  const text = value.trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const maximumEnd = Math.min(start + MAX_EVIDENCE_CHARS, text.length);
    let end = maximumEnd;
    if (maximumEnd < text.length) {
      const window = text.slice(start, maximumEnd);
      const sentenceEnd = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
        window.lastIndexOf("; "),
      );
      const wordEnd = window.lastIndexOf(" ");
      if (sentenceEnd >= MIN_EVIDENCE_CHARS) end = start + sentenceEnd + 1;
      else if (wordEnd >= MIN_EVIDENCE_CHARS) end = start + wordEnd;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
    while (start < text.length && /\s/.test(text[start] ?? "")) start += 1;
  }
  return chunks;
}

function normalizeDocumentKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "narrative";
}

export function isVerifiedFilingDocumentUrl(
  value: string,
  filing: Pick<SecFilingEventRow, "cik" | "accession_number">,
): boolean {
  try {
    const url = new URL(value);
    const cikNumber = Number(filing.cik.replace(/\D/g, ""));
    if (!Number.isSafeInteger(cikNumber) || cikNumber < 1) return false;
    const cik = String(cikNumber);
    const accessionDirectory = filing.accession_number.replaceAll("-", "");
    return url.protocol === "https:"
      && url.hostname === "www.sec.gov"
      && url.pathname.startsWith(`/Archives/edgar/data/${cik}/`)
      && url.pathname.includes(`/${accessionDirectory}/`);
  } catch {
    return false;
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = value === undefined ? fallback : Math.floor(value);
  return Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
}
