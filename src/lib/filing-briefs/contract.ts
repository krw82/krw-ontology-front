import { z } from "zod";

export const FILING_BRIEF_PROMPT_VERSION = "filing-brief-ko-v4";
export const FILING_BRIEF_SCHEMA_VERSION = 1;
export const FILING_BRIEF_LOCALE = "ko-KR" as const;

const briefText = (max: number) => z.string().trim().min(1).max(max);

const factSchema = z.object({
  fact_ko: briefText(260),
  // The model selects a deterministic evidence fragment rather than trying to
  // reproduce raw EDGAR punctuation. The worker attaches the exact fragment
  // and section after validating the fragment.
  evidence_id: z.string().trim().min(1).max(180),
});

function normalizeRequiredStringArray(value: unknown): unknown {
  const values = typeof value === "string" ? [value] : value;
  return Array.isArray(values)
    ? values.filter((entry) => typeof entry !== "string" || entry.trim().length > 0).slice(0, 2)
    : values;
}

function normalizeOptionalStringArray(max: number) {
  return (value: unknown): unknown => {
    if (value === null || value === undefined) return [];
    const values = typeof value === "string" ? (value.trim() ? [value] : []) : value;
    // Dropping blank or surplus optional values preserves the intended absence
    // and product length limit without relaxing required headline/fact checks.
    return Array.isArray(values)
      ? values.filter((entry) => typeof entry !== "string" || entry.trim().length > 0).slice(0, max)
      : values;
  };
}

function normalizeFacts(value: unknown): unknown {
  const values = value !== null && typeof value === "object" && !Array.isArray(value) ? [value] : value;
  return Array.isArray(values) ? values.slice(0, 4) : values;
}

export const filingBriefModelOutputSchema = z.object({
  headline_ko: briefText(240),
  // DeepSeek occasionally returns one otherwise-valid string/object instead
  // of a one-element JSON array. Normalize equivalent shapes and discard only
  // surplus optional items; required text and evidence validation remain mandatory.
  summary_sentences_ko: z.preprocess(
    normalizeRequiredStringArray,
    z.array(briefText(340)).min(1).max(2),
  ),
  facts: z.preprocess(normalizeFacts, z.array(factSchema).min(1).max(4)),
  question_suggestions_ko: z.preprocess(
    normalizeOptionalStringArray(2),
    z.array(briefText(220)).max(2),
  ),
  uncertainty_notes_ko: z.preprocess(
    normalizeOptionalStringArray(3),
    z.array(briefText(240)).max(3),
  ),
}).strict();

export type FilingBriefModelOutput = z.infer<typeof filingBriefModelOutputSchema>;

export type FilingBriefSourceSection = {
  key: string;
  heading: string;
  text: string;
  documentUrl: string;
};

export type FilingBriefSourceEvidence = {
  id: string;
  sectionKey: string;
  text: string;
};

export type FilingBriefSource = {
  filingEventId: string;
  ticker: string;
  formType: "8-K" | "8-K/A" | "6-K" | "6-K/A";
  filingDate: string;
  sourceDocumentUrl: string;
  sourceSha256: string;
  sourceSections: FilingBriefSourceSection[];
  sourceEvidence: FilingBriefSourceEvidence[];
  input: string;
  inputCharCount: number;
  sourceTruncated: boolean;
};

export type FilingBriefStoredFact = {
  fact_ko: string;
  section_key: string;
  source_quote: string;
  section_heading: string;
  source_document_url: string;
};

export type ValidatedFilingBrief = {
  headlineKo: string;
  summarySentences: string[];
  facts: FilingBriefStoredFact[];
  questionSuggestions: string[];
  uncertaintyNotes: string[];
};

export const filingBriefStoredFactSchema = z.object({
  fact_ko: briefText(260),
  section_key: z.string().trim().min(1).max(180),
  source_quote: briefText(700),
  section_heading: briefText(300),
  source_document_url: z.string().url().max(2_000),
}).strict();

export const filingBriefPublicSchema = z.object({
  filing_event_id: z.string().uuid(),
  locale: z.literal(FILING_BRIEF_LOCALE),
  headline_ko: briefText(240),
  summary_sentences: z.array(briefText(340)).min(1).max(2),
  facts: z.array(filingBriefStoredFactSchema).min(1).max(4),
  question_suggestions: z.array(briefText(220)).max(2),
  uncertainty_notes: z.array(briefText(240)).max(3),
  source_document_url: z.string().url().max(2_000),
  source_section_keys: z.array(z.string().min(1).max(180)).min(1).max(4),
  source_truncated: z.boolean(),
  generator_model: z.string().min(1).max(160),
  prompt_version: z.string().min(1).max(80),
  schema_version: z.number().int().positive(),
  // PostgREST can serialize UTC values as either `Z` or `+00:00`; both are
  // safe server timestamps here, so avoid rejecting an otherwise valid brief.
  generated_at: z.string().trim().min(1).max(64),
});

export type FilingBriefPublic = z.infer<typeof filingBriefPublicSchema>;
