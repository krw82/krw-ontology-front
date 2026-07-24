import type { StreamingCitation } from "@/types/api-contracts";
import type { AccumulatedToolCall } from "./stream-handler";

const ON_DEMAND_FILING_BODY_TOOLS = new Set([
  "read_filing_section",
  "read_filing_document",
]);

const PERSISTED_FILING_RESULT_VERSION = "on-demand-sec-body-read/v1";

type UnknownRecord = Record<string, unknown>;

/**
 * The model needs the source body while the agent is running, but the durable
 * tool-call audit trail must not become a second SEC-document store.
 */
export function isOnDemandFilingBodyTool(toolName: string): boolean {
  return ON_DEMAND_FILING_BODY_TOOLS.has(toolName);
}

export function filingBodyReadSummary(charCount: number): string {
  return `SEC filing source body read (${charCount} characters; body omitted from persistence).`;
}

/**
 * Produces an audit-safe copy for both live persistence and end-of-run
 * backfills. It keeps source identity, document metadata, offsets, and the
 * SEC citation while dropping every source-body field.
 */
export function redactFilingToolCallForPersistence(
  toolCall: AccumulatedToolCall,
): AccumulatedToolCall {
  if (!isOnDemandFilingBodyTool(toolCall.toolName)) return toolCall;

  const parsed = recordFrom(toolCall.resultJson) ?? recordFromJson(toolCall.resultText);
  const bodyCharCount = typeof parsed?.text === "string" ? parsed.text.length : 0;
  return {
    ...toolCall,
    resultSummary: filingBodyReadSummary(bodyCharCount),
    resultJson: compactFilingReadAudit(parsed, bodyCharCount),
    resultText: null,
  };
}

/**
 * Filing citations normally use the first source characters as a quote. Keep
 * only structural citation metadata for on-demand SEC document reads so the
 * citations table cannot retain the original filing body either.
 */
export function redactFilingCitationForPersistence(
  citation: StreamingCitation,
): StreamingCitation {
  if (!isOnDemandFilingCitation(citation)) return citation;
  return { ...citation, quote_text: null };
}

function compactFilingReadAudit(
  result: UnknownRecord | null,
  bodyCharCount: number,
): Record<string, unknown> {
  return {
    schema_version: PERSISTED_FILING_RESULT_VERSION,
    source_body_persisted: false,
    body_char_count: bodyCharCount,
    filing: pickRecord(result?.filing, [
      "filing_event_id",
      "ticker",
      "cik",
      "accession_number",
      "form_type",
      "filing_date",
      "report_date",
      "filing_detail_url",
      "primary_document_url",
    ]),
    document: pickRecord(result?.document, [
      "document_key",
      "document_name",
      "document_type",
      "description",
      "document_url",
      "sequence",
      "size_bytes",
      "is_primary",
      "recommendation_score",
      "readable",
    ]),
    section: pickRecord(result?.section, [
      "key",
      "kind",
      "heading",
      "itemCode",
      "confidence",
      "text_length",
    ]),
    citation: pickRecord(result?.citation, [
      "source",
      "filing_event_id",
      "accession_number",
      "filing_detail_url",
      "document_url",
      "section_key",
      "section_heading",
      "extraction",
      "fetched_at",
      "document_key",
      "document_name",
      "document_type",
    ]),
    offset: safeScalar(result?.offset),
    next_offset: safeScalar(result?.next_offset),
    document_truncated: safeScalar(result?.document_truncated),
  };
}

function isOnDemandFilingCitation(citation: StreamingCitation): boolean {
  const trace = recordFrom(citation.trace_json);
  return trace?.extraction === "deterministic_html"
    && typeof trace.filing_event_id === "string";
}

function pickRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, string | number | boolean | null> | null {
  const source = recordFrom(value);
  if (!source) return null;
  const picked: Record<string, string | number | boolean | null> = {};
  for (const key of keys) {
    const safe = safeScalar(source[key]);
    if (safe !== undefined) picked[key] = safe;
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

function safeScalar(
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordFrom(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function recordFromJson(value: string | null): UnknownRecord | null {
  if (!value) return null;
  try {
    return recordFrom(JSON.parse(value));
  } catch {
    return null;
  }
}
