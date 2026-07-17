import type { SecFilingBriefRow } from "@/types/database";
import { filingBriefPublicSchema, type FilingBriefPublic } from "./contract";

/**
 * Turns a stored brief into the narrow, display-safe contract shared by the
 * filing API and MCP. Invalid historical rows fail closed rather than leaking
 * unvalidated model output into the product.
 */
export function toPublicFilingBrief(
  row: Pick<
    SecFilingBriefRow,
    | "filing_event_id"
    | "locale"
    | "headline_ko"
    | "summary_sentences"
    | "facts"
    | "question_suggestions"
    | "uncertainty_notes"
    | "source_document_url"
    | "source_section_keys"
    | "source_truncated"
    | "generator_model"
    | "prompt_version"
    | "schema_version"
    | "generated_at"
  > | null | undefined,
): FilingBriefPublic | null {
  if (!row) return null;
  const parsed = filingBriefPublicSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}
