import type { Json, ResearchArtifactRow } from "@/types/database";
import type {
  ResearchArtifact,
  ResearchArtifactBlock,
  ResearchArtifactEnvelope,
  ResearchArtifactEvidenceRef,
  ResearchArtifactQuality,
} from "@/types/api-contracts";
import {
  RESEARCH_ARTIFACT_VERSION,
  parseAnswerBlocks,
  parseResearchArtifact,
} from "./schema";

export function toResearchArtifact(row: ResearchArtifactRow): ResearchArtifact {
  const artifactJson = parseResearchArtifact(row.artifact_json);
  const blocks = artifactJson?.blocks ?? jsonArray(row.blocks_json);
  const quality = artifactJson?.quality ?? parseQuality(row.quality_json);
  const evidenceRefs =
    artifactJson?.evidence_refs ?? parseEvidenceRefs(row.evidence_refs);
  const artifactEnvelope: ResearchArtifactEnvelope = artifactJson ?? {
    artifact_version: row.artifact_version ?? RESEARCH_ARTIFACT_VERSION,
    artifact_type: row.artifact_type,
    title: row.title,
    summary: row.summary,
    tickers: row.tickers ?? [],
    source_scope: parseSourceScope(row.source_scope),
    answer_alignment: parseAnswerAlignment(row.answer_alignment),
    blocks,
    evidence_refs: evidenceRefs,
    quality,
  };

  return {
    ...artifactEnvelope,
    id: row.id,
    session_id: row.session_id,
    run_id: row.run_id,
    message_id: row.message_id,
    artifact_json: artifactJson,
    blocks_json: artifactEnvelope.blocks,
    quality_json: quality,
    source_json: jsonRecord(row.source_json),
    html_snapshot: row.html_snapshot,
    created_at: row.created_at,
  };
}

function jsonArray(value: Json | null): ResearchArtifactBlock[] {
  return parseAnswerBlocks(value);
}

function parseEvidenceRefs(value: Json | null): ResearchArtifactEvidenceRef[] {
  return Array.isArray(value)
    ? (value as unknown as ResearchArtifactEvidenceRef[])
    : [];
}

function parseSourceScope(value: Json | null): ResearchArtifact["source_scope"] {
  const record = jsonRecord(value);
  if (!record) return undefined;

  return {
    document_types: stringArray(record.document_types),
    periods: stringArray(record.periods),
    source_label: stringValue(record.source_label) ?? undefined,
    external_sources: stringArray(record.external_sources),
  };
}

function parseAnswerAlignment(
  value: Json | null,
): ResearchArtifact["answer_alignment"] {
  const record = jsonRecord(value);
  const visibleAnswerSummary = stringValue(record?.visible_answer_summary);
  if (!visibleAnswerSummary || typeof record?.no_new_thesis !== "boolean") {
    return undefined;
  }

  return {
    visible_answer_summary: visibleAnswerSummary,
    no_new_thesis: record.no_new_thesis,
  };
}

function parseQuality(value: Json | null): ResearchArtifactQuality {
  const record = jsonRecord(value);
  const overall = record?.overall;
  const warnings = record?.warnings;

  return {
    overall:
      overall === "high" || overall === "medium" || overall === "low"
        ? overall
        : "medium",
    warnings: Array.isArray(warnings)
      ? warnings.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function jsonRecord(value: Json | null): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}
