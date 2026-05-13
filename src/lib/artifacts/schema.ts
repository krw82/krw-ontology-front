import type {
  AnswerBlock,
  ArtifactConfidence,
  ArtifactEvidenceGrade,
  ResearchAgentOutput,
  ResearchArtifactEnvelope,
  ResearchArtifactEvidenceRef,
  ResearchArtifactQuality,
  ResearchArtifactSourceScope,
  ResearchArtifactType,
} from "@/types/api-contracts";

export const RESEARCH_ARTIFACT_VERSION = "krw-artifact/v1" as const;

export const RESEARCH_ARTIFACT_TYPES = [
  "company_overview",
  "financial_snapshot",
  "scenario_impact",
  "market_report_impact",
  "risk_review",
  "filing_timeline",
  "comparison",
  "evidence_path",
] as const satisfies readonly ResearchArtifactType[];

export const RESEARCH_ARTIFACT_BLOCK_TYPES = [
  "markdown",
  "metric_grid",
  "period_delta",
  "business_segments",
  "premise_card",
  "impact_channels",
  "risk_driver_map",
  "timeline",
  "comparison_table",
  "evidence_chain",
  "caveat_list",
  "glossary",
] as const;

const CONFIDENCE_VALUES = [
  "direct",
  "indirect",
  "inferred",
  "unsupported",
] as const satisfies readonly ArtifactConfidence[];

const EVIDENCE_GRADE_VALUES = [
  "direct",
  "indirect",
  "derived",
  "unsupported",
] as const satisfies readonly ArtifactEvidenceGrade[];

export const RESEARCH_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer_blocks", "quality"],
  properties: {
    answer_blocks: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["type"],
        properties: {
          type: { enum: RESEARCH_ARTIFACT_BLOCK_TYPES },
          title: { type: "string", minLength: 1, maxLength: 100 },
          content: { type: "string", minLength: 1, maxLength: 2400 },
        },
      },
    },
    evidence_refs: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    quality: {
      type: "object",
      additionalProperties: true,
      required: ["overall", "warnings"],
      properties: {
        overall: { enum: ["high", "medium", "low"] },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const satisfies Record<string, unknown>;

export function parseResearchAgentOutput(value: unknown): ResearchAgentOutput | null {
  const record = asRecord(value);
  if (!record) return null;

  const answerBlocks = parseAnswerBlocks(record.answer_blocks);
  if (answerBlocks.length > 0) {
    return {
      answer_blocks: answerBlocks,
      evidence_refs: parseEvidenceRefs(record.evidence_refs),
      quality: parseQuality(record.quality),
    };
  }

  return parseLegacyResearchAgentOutput(record);
}

export function parseResearchAgentOutputText(text: string): ResearchAgentOutput | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const output = parseResearchAgentOutput(parsed);
      if (output) return output;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

export function parseResearchArtifact(value: unknown): ResearchArtifactEnvelope | null {
  const record = asRecord(value);
  if (!record) return null;

  const artifactVersion = record.artifact_version;
  const artifactType = enumValue(record.artifact_type, RESEARCH_ARTIFACT_TYPES);
  const title = stringValue(record.title);
  const summary = stringValue(record.summary);
  const rawBlocks = Array.isArray(record.blocks) ? record.blocks : [];

  if (artifactVersion !== RESEARCH_ARTIFACT_VERSION) return null;
  if (!artifactType || !title || !summary || rawBlocks.length === 0) return null;

  const blocks = parseAnswerBlocks(rawBlocks)
    .slice(0, 8);

  if (blocks.length === 0) return null;

  return {
    artifact_version: RESEARCH_ARTIFACT_VERSION,
    artifact_type: artifactType,
    title,
    summary,
    tickers: stringArray(record.tickers).map((ticker) => ticker.toUpperCase()),
    source_scope: parseSourceScope(record.source_scope),
    answer_alignment: parseAnswerAlignment(record.answer_alignment),
    blocks,
    evidence_refs: parseEvidenceRefs(record.evidence_refs),
    quality: parseQuality(record.quality),
  };
}

function parseLegacyResearchAgentOutput(
  record: Record<string, unknown>,
): ResearchAgentOutput | null {
  const visibleAnswer = stringValue(record.visible_answer);
  const artifact =
    record.artifact === null || record.artifact === undefined
      ? null
      : parseResearchArtifact(record.artifact);
  if (!visibleAnswer && !artifact) return null;

  const answerBlocks: AnswerBlock[] = [];
  if (visibleAnswer) {
    answerBlocks.push({ type: "markdown", content: visibleAnswer });
  }
  if (artifact) {
    answerBlocks.push(...artifact.blocks);
  }
  if (answerBlocks.length === 0) return null;

  return {
    answer_blocks: answerBlocks.slice(0, 12),
    evidence_refs: artifact?.evidence_refs ?? [],
    quality: artifact?.quality ?? { overall: "medium", warnings: [] },
  };
}

export function parseAnswerBlocks(value: unknown): AnswerBlock[] {
  return Array.isArray(value)
    ? value
        .map(parseAnswerBlock)
        .filter((block): block is AnswerBlock => Boolean(block))
        .slice(0, 12)
    : [];
}

function parseAnswerBlock(value: unknown): AnswerBlock | null {
  const record = asRecord(value);
  if (!record) return null;

  const title = stringValue(record.title);
  const evidenceRefs = parseEvidenceRefIds(record.evidence_refs);

  if (record.type === "markdown") {
    const content = stringValue(record.content);
    return content ? { type: "markdown", content, evidence_refs: evidenceRefs } : null;
  }

  switch (record.type) {
    case "key_takeaways": {
      const items = arrayOfRecords(record.items)
        .map((item) => {
          const label = stringValue(item.label);
          const text = stringValue(item.text);
          if (!label || !text) return null;
          return `- **${label}**: ${text}`;
        })
        .filter(nonNullable)
        .slice(0, 6);
      return items.length > 0
        ? {
            type: "markdown",
            content: [title ? `### ${title}` : null, ...items]
              .filter(Boolean)
              .join("\n"),
            evidence_refs: evidenceRefs,
          }
        : null;
    }
    case "metric_grid": {
      if (!title) return null;
      const metrics = arrayOfRecords(record.metrics)
        .map((metric) => {
          const label = stringValue(metric.label);
          const valueText = stringValue(metric.value);
          if (!label || !valueText) return null;
          return {
            label,
            value: valueText,
            period: stringValue(metric.period) ?? undefined,
            unit: stringValue(metric.unit) ?? undefined,
            delta: stringValue(metric.delta) ?? undefined,
            source_label: stringValue(metric.source_label) ?? undefined,
            evidence_refs: parseEvidenceRefIds(metric.evidence_refs),
          };
        })
        .filter(nonNullable)
        .slice(0, 12);
      return metrics.length > 0
        ? { type: "metric_grid", title, evidence_refs: evidenceRefs, metrics }
        : null;
    }
    case "period_delta": {
      if (!title) return null;
      const changes = arrayOfRecords(record.changes)
        .map((change) => {
          const label = stringValue(change.label);
          const from = stringValue(change.from);
          const to = stringValue(change.to);
          const interpretation = stringValue(change.interpretation);
          if (!label || !from || !to || !interpretation) return null;
          return {
            label,
            from,
            to,
            direction: enumValue(change.direction, [
              "up",
              "down",
              "flat",
              "mixed",
              "unknown",
            ] as const) ?? undefined,
            interpretation,
            evidence_refs: parseEvidenceRefIds(change.evidence_refs),
          };
        })
        .filter(nonNullable);
      return changes.length > 0
        ? { type: "period_delta", title, evidence_refs: evidenceRefs, changes }
        : null;
    }
    case "business_segments": {
      if (!title) return null;
      const segments = arrayOfRecords(record.segments)
        .map((segment) => {
          const name = stringValue(segment.name);
          const role = stringValue(segment.role);
          const whyItMatters = stringValue(segment.why_it_matters);
          if (!name || !role || !whyItMatters) return null;
          return {
            name,
            role,
            why_it_matters: whyItMatters,
            evidence_refs: parseEvidenceRefIds(segment.evidence_refs),
          };
        })
        .filter(nonNullable);
      return segments.length > 0
        ? { type: "business_segments", title, evidence_refs: evidenceRefs, segments }
        : null;
    }
    case "premise_card": {
      if (!title) return null;
      const premises = arrayOfRecords(record.premises)
        .map((premise) => {
          const label = stringValue(premise.label);
          const text = stringValue(premise.text);
          if (!label || !text) return null;
          return {
            label,
            text,
            source_label: stringValue(premise.source_label) ?? undefined,
            evidence_refs: parseEvidenceRefIds(premise.evidence_refs),
          };
        })
        .filter(nonNullable)
        .slice(0, 6);
      const sourceKind = enumValue(record.source_kind, [
        "filing",
        "external_report",
        "user_provided",
        "web",
        "mixed",
      ] as const);
      return premises.length > 0
        ? {
            type: "premise_card",
            title,
            evidence_refs: evidenceRefs,
            source_kind: sourceKind ?? undefined,
            premises,
          }
        : null;
    }
    case "impact_channels": {
      if (!title) return null;
      const channels = arrayOfRecords(record.channels)
        .map((channel) => {
          const name = stringValue(channel.name);
          const direction = enumValue(channel.direction, [
            "positive",
            "negative",
            "mixed",
            "uncertain",
            "neutral",
          ] as const);
          const mechanism = stringValue(channel.mechanism);
          const confidence = enumValue(channel.confidence, CONFIDENCE_VALUES);
          if (!name || !direction || !mechanism || !confidence) return null;
          return {
            name,
            direction,
            mechanism,
            affected_metrics: stringArray(channel.affected_metrics),
            confidence,
            evidence_refs: parseEvidenceRefIds(channel.evidence_refs),
          };
        })
        .filter(nonNullable)
        .slice(0, 8);
      return channels.length > 0
        ? { type: "impact_channels", title, evidence_refs: evidenceRefs, channels }
        : null;
    }
    case "risk_driver_map": {
      if (!title) return null;
      const items = arrayOfRecords(record.items)
        .map((item) => {
          const label = stringValue(item.label);
          const kind = enumValue(item.kind, [
            "risk",
            "driver",
            "headwind",
            "offset",
            "watch_item",
          ] as const);
          const text = stringValue(item.text);
          const severity = enumValue(item.severity, [
            "high",
            "medium",
            "low",
            "unknown",
          ] as const);
          if (!label || !kind || !text || !severity) return null;
          return {
            label,
            kind,
            text,
            severity,
            evidence_refs: parseEvidenceRefIds(item.evidence_refs),
          };
        })
        .filter(nonNullable);
      return items.length > 0
        ? { type: "risk_driver_map", title, evidence_refs: evidenceRefs, items }
        : null;
    }
    case "timeline": {
      if (!title) return null;
      const events = arrayOfRecords(record.events)
        .map((event) => {
          const label = stringValue(event.label);
          const dateOrPeriod = stringValue(event.date_or_period);
          const text = stringValue(event.text);
          if (!label || !dateOrPeriod || !text) return null;
          return {
            label,
            date_or_period: dateOrPeriod,
            text,
            status: enumValue(event.status, [
              "reported",
              "targeted",
              "expected",
              "completed",
              "delayed",
              "unknown",
            ] as const) ?? undefined,
            evidence_refs: parseEvidenceRefIds(event.evidence_refs),
          };
        })
        .filter(nonNullable)
        .slice(0, 12);
      return events.length > 0
        ? { type: "timeline", title, evidence_refs: evidenceRefs, events }
        : null;
    }
    case "comparison":
    case "comparison_table": {
      if (!title) return null;
      const columns = stringArray(record.columns).slice(0, 6);
      const rows = arrayOfRecords(record.rows)
        .map((row) => {
          const label = stringValue(row.label);
          const values = stringArray(row.values);
          if (!label || values.length === 0) return null;
          return {
            label,
            values,
            winner: stringValue(row.winner),
            note: stringValue(row.note) ?? undefined,
            evidence_refs: parseEvidenceRefIds(row.evidence_refs),
          };
        })
        .filter(nonNullable)
        .slice(0, 12);
      return columns.length > 0 && rows.length > 0
        ? { type: "comparison_table", title, evidence_refs: evidenceRefs, columns, rows }
        : null;
    }
    case "evidence_chain": {
      if (!title) return null;
      const chains = arrayOfRecords(record.chains)
        .map((chain) => {
          const claim = stringValue(chain.claim);
          const sourceLabel = stringValue(chain.source_label);
          const confidence = enumValue(chain.confidence, CONFIDENCE_VALUES);
          if (!claim || !sourceLabel || !confidence) return null;
          return {
            claim,
            source_label: sourceLabel,
            confidence,
            chain_steps: stringArray(chain.chain_steps),
            quality_warnings: stringArray(chain.quality_warnings),
            evidence_refs: parseEvidenceRefIds(chain.evidence_refs),
          };
        })
        .filter(nonNullable)
        .slice(0, 6);
      return chains.length > 0
        ? { type: "evidence_chain", title, evidence_refs: evidenceRefs, chains }
        : null;
    }
    case "caveats":
    case "caveat_list": {
      if (!title) return null;
      const items = arrayOfRecords(record.items)
        .map((item) => {
          const text = stringValue(item.text);
          const severity = enumValue(item.severity, [
            "info",
            "warning",
            "critical",
          ] as const);
          if (!text || !severity) return null;
          return {
            text,
            severity,
            evidence_refs: parseEvidenceRefIds(item.evidence_refs),
          };
        })
        .filter(nonNullable);
      return items.length > 0
        ? { type: "caveat_list", title, evidence_refs: evidenceRefs, items }
        : null;
    }
    case "glossary": {
      if (!title) return null;
      const terms = arrayOfRecords(record.terms)
        .map((term) => {
          const termText = stringValue(term.term);
          const definition = stringValue(term.definition);
          if (!termText || !definition) return null;
          return { term: termText, definition };
        })
        .filter(nonNullable);
      return terms.length > 0
        ? { type: "glossary", title, evidence_refs: evidenceRefs, terms }
        : null;
    }
    default:
      return null;
  }
}

function parseSourceScope(value: unknown): ResearchArtifactSourceScope | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    document_types: stringArray(record.document_types),
    periods: stringArray(record.periods),
    source_label: stringValue(record.source_label) ?? undefined,
    external_sources: stringArray(record.external_sources),
  };
}

function parseAnswerAlignment(
  value: unknown,
): ResearchArtifactEnvelope["answer_alignment"] {
  const record = asRecord(value);
  if (!record) return undefined;
  const visibleAnswerSummary = stringValue(record.visible_answer_summary);
  if (!visibleAnswerSummary || typeof record.no_new_thesis !== "boolean") {
    return undefined;
  }

  return {
    visible_answer_summary: visibleAnswerSummary,
    no_new_thesis: record.no_new_thesis,
  };
}

function parseEvidenceRefs(value: unknown): ResearchArtifactEvidenceRef[] {
  return arrayOfRecords(value)
    .map((item) => {
      const id = stringValue(item.id);
      const sourceLabel = stringValue(item.source_label);
      const evidenceGrade = enumValue(item.evidence_grade, EVIDENCE_GRADE_VALUES);
      if (!id || !sourceLabel || !evidenceGrade) return null;
      return {
        id,
        source_label: sourceLabel,
        object_type: stringValue(item.object_type) ?? undefined,
        evidence_grade: evidenceGrade,
        trace_id: stringValue(item.trace_id),
        quote_text: stringValue(item.quote_text),
        chain_summary: asRecord(item.chain_summary),
      };
    })
    .filter(nonNullable);
}

function parseQuality(value: unknown): ResearchArtifactQuality {
  const record = asRecord(value);
  const overall = enumValue(record?.overall, ["high", "medium", "low"] as const);
  return {
    overall: overall ?? "medium",
    warnings: stringArray(record?.warnings),
  };
}

function parseEvidenceRefIds(value: unknown): string[] {
  return stringArray(value).slice(0, 12);
}

function extractJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed);

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return Array.from(new Set(candidates));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
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

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function nonNullable<T>(value: T | null): value is T {
  return value !== null;
}
