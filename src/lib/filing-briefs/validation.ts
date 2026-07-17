import { ZodError } from "zod";
import {
  filingBriefModelOutputSchema,
  type FilingBriefModelOutput,
  type FilingBriefSourceEvidence,
  type FilingBriefSourceSection,
  type ValidatedFilingBrief,
} from "./contract";

const INVESTMENT_LANGUAGE = /(?:\b(?:buy|sell|hold|overweight|underweight|price\s*target|investment\s*recommendation)\b|매수\s*의견|매도\s*의견|보유\s*의견|목표\s*주가|투자\s*의견|투자\s*추천)/iu;

export class FilingBriefValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FilingBriefValidationError";
  }
}

/** Parses a model response with one bounded extraction repair for code fences. */
export function parseFilingBriefJson(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) throw new FilingBriefValidationError("empty_response", "The filing brief model returned empty JSON content.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new FilingBriefValidationError("invalid_json", "The filing brief model did not return a JSON object.");
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new FilingBriefValidationError("invalid_json", "The filing brief model returned malformed JSON after one repair attempt.");
    }
  }
}

export function validateFilingBriefOutput(
  content: string,
  sourceSections: FilingBriefSourceSection[],
  sourceEvidence: FilingBriefSourceEvidence[],
): ValidatedFilingBrief {
  let output: FilingBriefModelOutput;
  try {
    output = filingBriefModelOutputSchema.parse(parseFilingBriefJson(content));
  } catch (error) {
    if (error instanceof FilingBriefValidationError) throw error;
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0];
      const path = firstIssue?.path
        .filter((segment) => typeof segment === "string" || typeof segment === "number")
        .join(".");
      // Preserve just the structural field path and validator message for
      // operations. Do not include model content or SEC source text in logs.
      throw new FilingBriefValidationError(
        "schema_invalid",
        `${path ? `${path}: ` : ""}${firstIssue?.message ?? "The filing brief JSON did not match the schema."}`,
      );
    }
    throw error;
  }

  const sourceByKey = new Map(sourceSections.map((section) => [section.key, section]));
  const evidenceById = new Map(sourceEvidence.map((evidence) => [evidence.id, evidence]));
  const allText = [
    output.headline_ko,
    ...output.summary_sentences_ko,
    ...output.facts.map((fact) => fact.fact_ko),
    ...output.question_suggestions_ko,
    ...output.uncertainty_notes_ko,
  ].join("\n");
  if (INVESTMENT_LANGUAGE.test(allText)) {
    throw new FilingBriefValidationError("investment_language", "The filing brief contained investment advice or a recommendation.");
  }

  const facts = output.facts.map((fact) => {
    const evidence = evidenceById.get(fact.evidence_id);
    if (!evidence) {
      throw new FilingBriefValidationError("unknown_evidence", `The brief cited unknown evidence ${fact.evidence_id}.`);
    }
    const source = sourceByKey.get(evidence.sectionKey);
    if (!source || !normalizedContains(source.text, evidence.text)) {
      throw new FilingBriefValidationError("evidence_not_in_source", `The brief evidence ${fact.evidence_id} was not part of its selected SEC section.`);
    }
    return {
      fact_ko: fact.fact_ko,
      section_key: evidence.sectionKey,
      source_quote: evidence.text,
      section_heading: source.heading,
      source_document_url: source.documentUrl,
    };
  });

  return {
    headlineKo: output.headline_ko,
    summarySentences: output.summary_sentences_ko,
    facts,
    questionSuggestions: output.question_suggestions_ko,
    uncertaintyNotes: output.uncertainty_notes_ko,
  };
}

export function normalizedContains(source: string, quote: string): boolean {
  const normalize = (value: string) => value
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, "\"")
    .replace(/[\u2010-\u2015]/g, "-")
    .toLocaleLowerCase("en-US")
    // SEC HTML normalization can vary punctuation, quotation marks, and
    // non-breaking spaces. Compare contiguous words instead, while keeping
    // the section boundary as the hard evidence boundary.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedQuote = normalize(quote);
  return normalizedQuote.length >= 12 && normalize(source).includes(normalizedQuote);
}
