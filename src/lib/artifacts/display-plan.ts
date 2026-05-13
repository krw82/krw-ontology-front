import type {
  AnswerBlock,
  ArtifactConfidence,
  CanonicalAnswerUnitType,
  DisplayPlanBlock,
  DisplayPlanOutput,
  ResearchAgentOutput,
  ResearchArtifactEvidenceRef,
  ResearchArtifactQuality,
  ResearchSynthesis,
} from "@/types/api-contracts";

const DISPLAY_BLOCK_TYPES = [
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
] as const satisfies readonly AnswerBlock["type"][];

const CONFIDENCE_VALUES = [
  "direct",
  "indirect",
  "inferred",
  "unsupported",
] as const satisfies readonly ArtifactConfidence[];

const CANONICAL_ANSWER_UNIT_TYPES = [
  "heading",
  "paragraph",
  "metric",
  "period_delta",
  "business_segment",
  "premise",
  "impact_channel",
  "risk_item",
  "driver_item",
  "headwind_item",
  "watch_item",
  "timeline_event",
  "comparison_row",
  "caveat",
  "glossary_term",
  "evidence_note",
] as const satisfies readonly CanonicalAnswerUnitType[];

const CANONICAL_UNIT_RENDER_REQUIREMENTS = [
  renderRequirement("heading", ["text"]),
  renderRequirement("paragraph", ["text"]),
  renderRequirement("metric", ["label", "value"]),
  renderRequirement("period_delta", [
    "label",
    "from",
    "to",
    "interpretation",
  ]),
  renderRequirement("business_segment", ["name", "role", "why_it_matters"]),
  renderRequirement("premise", ["label", "text"]),
  renderRequirement("impact_channel", [
    "channel",
    "direction",
    "mechanism",
    "confidence",
  ]),
  renderRequirement("risk_item", ["label", "text"]),
  renderRequirement("driver_item", ["label", "text"]),
  renderRequirement("headwind_item", ["label", "text"]),
  renderRequirement("watch_item", ["label", "text"]),
  renderRequirement("timeline_event", ["label", "date_or_period", "text"]),
  renderRequirement("comparison_row", ["label", "values"]),
  renderRequirement("caveat", ["text"]),
  renderRequirement("glossary_term", ["term", "definition"]),
  renderRequirement("evidence_note", ["text"]),
] as const;

const FORBIDDEN_DISPLAY_PLAN_FIELDS = new Set([
  "text",
  "content",
  "body",
  "value",
  "metrics",
  "rows",
  "items",
  "events",
  "segments",
  "channels",
  "evidence_refs",
]);

export const RESEARCH_SYNTHESIS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["synthesis_version", "canonical_answer", "quality"],
  properties: {
    synthesis_version: { const: "krw-research-synthesis/v1" },
    question: { type: "string" },
    scope: {
      type: "object",
      additionalProperties: true,
    },
    thesis: { type: "string" },
    canonical_answer: {
      type: "object",
      additionalProperties: true,
      required: ["default_order", "units"],
      properties: {
        language: { type: "string" },
        default_order: {
          type: "array",
          minItems: 1,
          maxItems: 80,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 80 },
        },
        units: {
          type: "array",
          minItems: 1,
          maxItems: 80,
          items: {
            type: "object",
            additionalProperties: true,
            required: ["id", "type"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              type: { enum: CANONICAL_ANSWER_UNIT_TYPES },
              importance: { enum: ["required", "supporting", "optional"] },
              confidence: { enum: CONFIDENCE_VALUES },
              display_policy: { enum: ["show", "hidden_by_default"] },
              evidence_refs: {
                type: "array",
                items: { type: "string" },
              },
              text: { type: "string", minLength: 1 },
              analysis: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1 },
              label: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1 },
              value: { type: "string", minLength: 1 },
              period: { type: "string", minLength: 1 },
              unit: { type: "string", minLength: 1 },
              delta: { type: "string", minLength: 1 },
              source_label: { type: "string", minLength: 1 },
              from: { type: "string", minLength: 1 },
              to: { type: "string", minLength: 1 },
              interpretation: { type: "string", minLength: 1 },
              role: { type: "string", minLength: 1 },
              why_it_matters: { type: "string", minLength: 1 },
              channel: { type: "string", minLength: 1 },
              direction: {
                enum: [
                  "positive",
                  "negative",
                  "mixed",
                  "uncertain",
                  "neutral",
                  "up",
                  "down",
                  "flat",
                  "unknown",
                ],
              },
              mechanism: { type: "string", minLength: 1 },
              affected_metrics: {
                type: "array",
                items: { type: "string" },
              },
              severity: {
                enum: [
                  "high",
                  "medium",
                  "low",
                  "unknown",
                  "info",
                  "warning",
                  "critical",
                ],
              },
              date_or_period: { type: "string", minLength: 1 },
              status: {
                enum: [
                  "reported",
                  "targeted",
                  "expected",
                  "completed",
                  "delayed",
                  "unknown",
                ],
              },
              columns: {
                type: "array",
                items: { type: "string" },
              },
              values: {
                type: "array",
                minItems: 1,
                items: { type: "string" },
              },
              winner: { type: "string" },
              note: { type: "string" },
              term: { type: "string", minLength: 1 },
              definition: { type: "string", minLength: 1 },
              chain_steps: {
                type: "array",
                items: { type: "string" },
              },
              quality_warnings: {
                type: "array",
                items: { type: "string" },
              },
            },
            allOf: [
              {
                oneOf: CANONICAL_UNIT_RENDER_REQUIREMENTS,
              },
            ],
          },
        },
      },
    },
    research_facts: {
      type: "object",
      additionalProperties: true,
    },
    display_guidance: {
      type: "object",
      additionalProperties: true,
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

export const DISPLAY_PLAN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["display_plan_version", "source_synthesis_version", "display_plan", "quality"],
  properties: {
    display_plan_version: { const: "krw-display-plan/v1" },
    source_synthesis_version: { type: "string" },
    display_plan: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["block_id", "block_type", "source_ids"],
        properties: {
          block_id: { type: "string", minLength: 1, maxLength: 80 },
          block_type: { enum: DISPLAY_BLOCK_TYPES },
          source_ids: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
          title: { type: ["string", "null"], maxLength: 100 },
          options: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
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

export function parseResearchSynthesisOutput(value: unknown): ResearchSynthesis | null {
  if (typeof value === "string") {
    return parseResearchSynthesisOutputText(value);
  }

  return parseResearchSynthesisRecord(asRecord(value));
}

export function parseResearchSynthesisOutputText(text: string): ResearchSynthesis | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const output = parseResearchSynthesisOutput(parsed);
      if (output) return output;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

export function parseDisplayPlanOutput(value: unknown): DisplayPlanOutput | null {
  if (typeof value === "string") {
    return parseDisplayPlanOutputText(value);
  }

  return parseDisplayPlanRecord(asRecord(value));
}

export function parseDisplayPlanOutputText(text: string): DisplayPlanOutput | null {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const output = parseDisplayPlanOutput(parsed);
      if (output) return output;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

export function compileDisplayPlanAnswer(
  synthesis: ResearchSynthesis | null,
  displayPlan: DisplayPlanOutput | null,
): ResearchAgentOutput | null {
  if (!synthesis) return null;

  const units = visibleUnits(synthesis);
  if (units.length === 0) return null;

  const unitMap = new Map(units.map((unit) => [unit.id, unit]));
  const referencedIds = new Set<string>();
  const plannedBlocks = displayPlan
    ? displayPlan.display_plan
        .map((block) => compilePlannedBlock(block, unitMap, referencedIds))
        .filter((block): block is AnswerBlock => Boolean(block))
    : [];

  const missingRequired = orderedUnits(synthesis, units).filter(
    (unit) =>
      unit.importance === "required" &&
      unit.display_policy !== "hidden_by_default" &&
      !referencedIds.has(unit.id),
  );

  const blocks =
    plannedBlocks.length > 0
      ? appendMissingRequiredBlocks(plannedBlocks, missingRequired)
      : fallbackMarkdownBlocks(synthesis, units);

  if (blocks.length === 0) return null;

  return {
    answer_blocks: blocks.slice(0, 12),
    evidence_refs: synthesis.evidence_refs ?? [],
    quality: mergeQuality(synthesis.quality, displayPlan?.quality),
  };
}

function compilePlannedBlock(
  block: DisplayPlanBlock,
  unitMap: Map<string, ResearchSynthesis["canonical_answer"]["units"][number]>,
  referencedIds: Set<string>,
): AnswerBlock | null {
  const units = block.source_ids
    .map((id) => unitMap.get(id))
    .filter((unit): unit is ResearchSynthesis["canonical_answer"]["units"][number] =>
      Boolean(unit),
    );
  if (units.length === 0) return null;

  const compiled =
    compileRichBlock(block.block_type, block.title ?? null, units) ??
    compileMarkdownBlock(block.title ?? null, units);
  if (!compiled) return null;

  for (const unit of units) referencedIds.add(unit.id);
  return compiled;
}

function compileRichBlock(
  blockType: AnswerBlock["type"],
  title: string | null,
  units: ResearchSynthesis["canonical_answer"]["units"],
): AnswerBlock | null {
  switch (blockType) {
    case "markdown":
      return compileMarkdownBlock(title, units);
    case "metric_grid":
      return compileMetricGrid(title ?? "핵심 숫자", units);
    case "period_delta":
      return compilePeriodDelta(title ?? "변화", units);
    case "business_segments":
      return compileBusinessSegments(title ?? "사업 구조", units);
    case "premise_card":
      return compilePremiseCard(title ?? "전제", units);
    case "impact_channels":
      return compileImpactChannels(title ?? "영향 경로", units);
    case "risk_driver_map":
      return compileRiskDriverMap(title ?? "리스크와 동력", units);
    case "timeline":
      return compileTimeline(title ?? "일정", units);
    case "comparison_table":
      return compileComparisonTable(title ?? "비교", units);
    case "evidence_chain":
      return compileEvidenceChain(title ?? "근거 흐름", units);
    case "caveat_list":
      return compileCaveatList(title ?? "주의할 점", units);
    case "glossary":
      return compileGlossary(title ?? "용어", units);
  }
}

function compileMarkdownBlock(
  title: string | null,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "markdown" }> | null {
  const lines = units
    .map(unitToMarkdown)
    .filter((line): line is string => Boolean(line));
  if (lines.length === 0) return null;

  return {
    type: "markdown",
    content: [title ? `### ${title}` : null, ...lines].filter(Boolean).join("\n\n"),
    evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
  };
}

function compileMetricGrid(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "metric_grid" }> | null {
  const metrics = units
    .filter((unit) => unit.type === "metric")
    .map((unit) => {
      const label = stringValue(unit.label) ?? stringValue(unit.name);
      const value = stringValue(unit.value);
      if (!label || !value) return null;
      return {
        label,
        value,
        period: stringValue(unit.period) ?? undefined,
        unit: stringValue(unit.unit) ?? undefined,
        delta: stringValue(unit.delta) ?? undefined,
        source_label: stringValue(unit.source_label) ?? undefined,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return metrics.length > 0
    ? {
        type: "metric_grid",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        metrics,
      }
    : null;
}

function compilePeriodDelta(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "period_delta" }> | null {
  const changes = units
    .filter((unit) => unit.type === "period_delta")
    .map((unit) => {
      const label = stringValue(unit.label);
      const from = stringValue(unit.from) ?? stringValue(unit.from_value);
      const to = stringValue(unit.to) ?? stringValue(unit.to_value);
      const interpretation = stringValue(unit.interpretation) ?? stringValue(unit.analysis);
      if (!label || !from || !to || !interpretation) return null;
      return {
        label,
        from,
        to,
        direction: enumValue(unit.direction, [
          "up",
          "down",
          "flat",
          "mixed",
          "unknown",
        ] as const) ?? undefined,
        interpretation,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return changes.length > 0
    ? {
        type: "period_delta",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        changes,
      }
    : null;
}

function compileBusinessSegments(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "business_segments" }> | null {
  const segments = units
    .filter((unit) => unit.type === "business_segment")
    .map((unit) => {
      const name = stringValue(unit.name) ?? stringValue(unit.label);
      const role = stringValue(unit.role);
      const whyItMatters =
        stringValue(unit.why_it_matters) ??
        stringValue(unit.economics) ??
        stringValue(unit.analysis);
      if (!name || !role || !whyItMatters) return null;
      return {
        name,
        role,
        why_it_matters: whyItMatters,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return segments.length > 0
    ? {
        type: "business_segments",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        segments,
      }
    : null;
}

function compilePremiseCard(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "premise_card" }> | null {
  const premises = units
    .filter((unit) => unit.type === "premise")
    .map((unit) => {
      const label = stringValue(unit.label) ?? stringValue(unit.name);
      const text = stringValue(unit.text) ?? stringValue(unit.analysis);
      if (!label || !text) return null;
      return {
        label,
        text,
        source_label: stringValue(unit.source_label) ?? undefined,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return premises.length > 0
    ? {
        type: "premise_card",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        source_kind: enumValue(units[0]?.source_kind, [
          "filing",
          "external_report",
          "user_provided",
          "web",
          "mixed",
        ] as const) ?? undefined,
        premises,
      }
    : null;
}

function compileImpactChannels(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "impact_channels" }> | null {
  const channels = units
    .filter((unit) => unit.type === "impact_channel")
    .map((unit) => {
      const name = stringValue(unit.channel) ?? stringValue(unit.factor) ?? stringValue(unit.label);
      const direction = enumValue(unit.direction, [
        "positive",
        "negative",
        "mixed",
        "uncertain",
        "neutral",
      ] as const);
      const mechanism = stringValue(unit.mechanism) ?? stringValue(unit.analysis);
      const confidence = enumValue(unit.confidence, CONFIDENCE_VALUES);
      if (!name || !direction || !mechanism || !confidence) return null;
      return {
        name,
        direction,
        mechanism,
        affected_metrics: stringArray(unit.affected_metrics),
        confidence,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return channels.length > 0
    ? {
        type: "impact_channels",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        channels,
      }
    : null;
}

function compileRiskDriverMap(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "risk_driver_map" }> | null {
  const items = units
    .filter((unit) =>
      ["risk_item", "driver_item", "headwind_item", "watch_item"].includes(unit.type),
    )
    .map((unit) => {
      const label = stringValue(unit.label) ?? stringValue(unit.name);
      const text = stringValue(unit.analysis) ?? stringValue(unit.text);
      const severity = enumValue(unit.severity, [
        "high",
        "medium",
        "low",
        "unknown",
      ] as const) ?? "unknown";
      if (!label || !text) return null;
      return {
        label,
        kind: riskKindForUnit(unit.type),
        text,
        severity,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return items.length > 0
    ? {
        type: "risk_driver_map",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        items,
      }
    : null;
}

function compileTimeline(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "timeline" }> | null {
  const events = units
    .filter((unit) => unit.type === "timeline_event")
    .map((unit) => {
      const label = stringValue(unit.label);
      const dateOrPeriod = stringValue(unit.date_or_period);
      const text = stringValue(unit.analysis) ?? stringValue(unit.text);
      if (!label || !dateOrPeriod || !text) return null;
      return {
        label,
        date_or_period: dateOrPeriod,
        text,
        status: enumValue(unit.status, [
          "reported",
          "targeted",
          "expected",
          "completed",
          "delayed",
          "unknown",
        ] as const) ?? undefined,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return events.length > 0
    ? {
        type: "timeline",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        events,
      }
    : null;
}

function compileComparisonTable(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "comparison_table" }> | null {
  const comparisonUnits = units.filter((unit) => unit.type === "comparison_row");
  const columns =
    stringArray(comparisonUnits[0]?.columns).length > 0
      ? stringArray(comparisonUnits[0]?.columns)
      : ["항목", "내용"];
  const rows = comparisonUnits
    .map((unit) => {
      const label = stringValue(unit.label) ?? stringValue(unit.name);
      const values = stringArray(unit.values);
      const fallbackValue = stringValue(unit.value) ?? stringValue(unit.text);
      if (!label || (values.length === 0 && !fallbackValue)) return null;
      return {
        label,
        values: values.length > 0 ? values : [fallbackValue as string],
        winner: stringValue(unit.winner),
        note: stringValue(unit.note) ?? stringValue(unit.analysis) ?? undefined,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return rows.length > 0
    ? {
        type: "comparison_table",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        columns,
        rows,
      }
    : null;
}

function compileEvidenceChain(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "evidence_chain" }> | null {
  const chains = units
    .filter((unit) => unit.type === "evidence_note")
    .map((unit) => {
      const claim = stringValue(unit.claim) ?? stringValue(unit.text) ?? stringValue(unit.analysis);
      const sourceLabel = stringValue(unit.source_label) ?? "Filing evidence";
      const confidence = enumValue(unit.confidence, CONFIDENCE_VALUES) ?? "indirect";
      if (!claim) return null;
      return {
        claim,
        source_label: sourceLabel,
        confidence,
        chain_steps: stringArray(unit.chain_steps),
        quality_warnings: stringArray(unit.quality_warnings),
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return chains.length > 0
    ? {
        type: "evidence_chain",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        chains,
      }
    : null;
}

function compileCaveatList(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "caveat_list" }> | null {
  const items = units
    .filter((unit) => unit.type === "caveat")
    .map((unit) => {
      const text = stringValue(unit.text) ?? stringValue(unit.analysis);
      const severity = enumValue(unit.severity, [
        "info",
        "warning",
        "critical",
      ] as const) ?? "warning";
      if (!text) return null;
      return {
        text,
        severity,
        evidence_refs: unitEvidenceRefs(unit),
      };
    })
    .filter(nonNullable);
  return items.length > 0
    ? {
        type: "caveat_list",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        items,
      }
    : null;
}

function compileGlossary(
  title: string,
  units: ResearchSynthesis["canonical_answer"]["units"],
): Extract<AnswerBlock, { type: "glossary" }> | null {
  const terms = units
    .filter((unit) => unit.type === "glossary_term")
    .map((unit) => {
      const term = stringValue(unit.term);
      const definition = stringValue(unit.definition);
      if (!term || !definition) return null;
      return { term, definition };
    })
    .filter(nonNullable);
  return terms.length > 0
    ? {
        type: "glossary",
        title,
        evidence_refs: uniqueStrings(units.flatMap(unitEvidenceRefs)),
        terms,
      }
    : null;
}

function appendMissingRequiredBlocks(
  blocks: AnswerBlock[],
  missingUnits: ResearchSynthesis["canonical_answer"]["units"],
): AnswerBlock[] {
  if (missingUnits.length === 0) return blocks;
  const missingBlock = compileMarkdownBlock("추가 핵심 내용", missingUnits);
  return missingBlock ? [...blocks, missingBlock].slice(0, 12) : blocks;
}

function fallbackMarkdownBlocks(
  synthesis: ResearchSynthesis,
  units: ResearchSynthesis["canonical_answer"]["units"],
): AnswerBlock[] {
  const ordered = orderedUnits(synthesis, units);
  const block = compileMarkdownBlock(null, ordered);
  return block ? [block] : [];
}

function visibleUnits(synthesis: ResearchSynthesis): ResearchSynthesis["canonical_answer"]["units"] {
  return synthesis.canonical_answer.units.filter(
    (unit) => unit.display_policy !== "hidden_by_default",
  );
}

function orderedUnits(
  synthesis: ResearchSynthesis,
  units: ResearchSynthesis["canonical_answer"]["units"],
): ResearchSynthesis["canonical_answer"]["units"] {
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));
  const ordered = synthesis.canonical_answer.default_order
    .map((id) => unitMap.get(id))
    .filter((unit): unit is ResearchSynthesis["canonical_answer"]["units"][number] =>
      Boolean(unit),
    );
  const orderedIds = new Set(ordered.map((unit) => unit.id));
  return [...ordered, ...units.filter((unit) => !orderedIds.has(unit.id))];
}

function unitToMarkdown(unit: ResearchSynthesis["canonical_answer"]["units"][number]): string | null {
  switch (unit.type) {
    case "heading":
      return stringValue(unit.text) ?? stringValue(unit.label) ?? stringValue(unit.title);
    case "paragraph":
    case "caveat":
    case "evidence_note":
      return stringValue(unit.text) ?? stringValue(unit.analysis);
    case "metric": {
      const label = stringValue(unit.label) ?? stringValue(unit.name);
      const value = stringValue(unit.value);
      if (!label || !value) return null;
      const period = stringValue(unit.period);
      return `- **${label}**: ${value}${period ? ` (${period})` : ""}`;
    }
    case "period_delta": {
      const label = stringValue(unit.label);
      const from = stringValue(unit.from) ?? stringValue(unit.from_value);
      const to = stringValue(unit.to) ?? stringValue(unit.to_value);
      const interpretation = stringValue(unit.interpretation) ?? stringValue(unit.analysis);
      return [label && from && to ? `- **${label}**: ${from} -> ${to}` : null, interpretation]
        .filter(Boolean)
        .join(" ");
    }
    case "business_segment": {
      const name = stringValue(unit.name) ?? stringValue(unit.label);
      const role = stringValue(unit.role);
      const whyItMatters =
        stringValue(unit.why_it_matters) ??
        stringValue(unit.economics) ??
        stringValue(unit.analysis);
      return [name ? `- **${name}**` : null, role, whyItMatters]
        .filter(Boolean)
        .join(": ");
    }
    case "premise":
    case "impact_channel":
    case "risk_item":
    case "driver_item":
    case "headwind_item":
    case "watch_item":
    case "timeline_event":
    case "comparison_row":
    case "glossary_term": {
      const label =
        stringValue(unit.label) ??
        stringValue(unit.name) ??
        stringValue(unit.term) ??
        stringValue(unit.channel) ??
        stringValue(unit.factor);
      const text =
        stringValue(unit.text) ??
        stringValue(unit.analysis) ??
        stringValue(unit.mechanism) ??
        stringValue(unit.definition);
      if (label && text) return `- **${label}**: ${text}`;
      return text ?? label;
    }
    default:
      return stringValue(unit.text) ?? stringValue(unit.analysis) ?? stringValue(unit.label);
  }
}

function parseResearchSynthesisRecord(record: Record<string, unknown> | null): ResearchSynthesis | null {
  if (!record) return null;
  if (record.synthesis_version !== "krw-research-synthesis/v1") return null;
  const canonicalAnswer = asRecord(record.canonical_answer);
  const rawUnits = arrayOfRecords(canonicalAnswer?.units);
  const defaultOrder = stringArray(canonicalAnswer?.default_order);
  if (rawUnits.length === 0 || defaultOrder.length === 0) return null;

  const units = rawUnits
    .map((unit) => {
      const id = stringValue(unit.id);
      const type = enumValue(unit.type, CANONICAL_ANSWER_UNIT_TYPES);
      if (!id || !type) return null;
      const normalized = {
        ...unit,
        id,
        type,
        importance: enumValue(unit.importance, [
          "required",
          "supporting",
          "optional",
        ] as const) ?? undefined,
        confidence: enumValue(unit.confidence, CONFIDENCE_VALUES) ?? undefined,
        display_policy: enumValue(unit.display_policy, [
          "show",
          "hidden_by_default",
        ] as const) ?? undefined,
        evidence_refs: stringArray(unit.evidence_refs),
      };
      return isRenderableCanonicalUnit(normalized) ? normalized : null;
    })
    .filter(nonNullable);

  if (units.length !== rawUnits.length) return null;

  const unitIds = new Set(units.map((unit) => unit.id));
  if (defaultOrder.some((id) => !unitIds.has(id))) return null;

  return {
    synthesis_version: "krw-research-synthesis/v1",
    question: stringValue(record.question) ?? undefined,
    scope: asRecord(record.scope) ?? undefined,
    thesis: stringValue(record.thesis) ?? undefined,
    canonical_answer: {
      language: stringValue(canonicalAnswer?.language) ?? undefined,
      default_order: defaultOrder,
      units,
    },
    research_facts: asRecord(record.research_facts) ?? undefined,
    display_guidance: asRecord(record.display_guidance) ?? undefined,
    evidence_refs: parseEvidenceRefs(record.evidence_refs),
    quality: parseQuality(record.quality),
  };
}

function parseDisplayPlanRecord(record: Record<string, unknown> | null): DisplayPlanOutput | null {
  if (!record) return null;
  if (record.display_plan_version !== "krw-display-plan/v1") return null;

  const blocks = arrayOfRecords(record.display_plan)
    .map((block) => {
      if (hasForbiddenDisplayPlanFields(block)) return null;
      const blockId = stringValue(block.block_id);
      const blockType = enumValue(block.block_type, DISPLAY_BLOCK_TYPES);
      const sourceIds = stringArray(block.source_ids);
      if (!blockId || !blockType || sourceIds.length === 0) return null;
      return {
        block_id: blockId,
        block_type: blockType,
        source_ids: sourceIds.slice(0, 12),
        title: stringValue(block.title),
        options: asRecord(block.options) ?? undefined,
      };
    })
    .filter(nonNullable)
    .slice(0, 12);

  if (blocks.length === 0) return null;

  return {
    display_plan_version: "krw-display-plan/v1",
    source_synthesis_version:
      stringValue(record.source_synthesis_version) ?? "krw-research-synthesis/v1",
    display_plan: blocks,
    quality: parseQuality(record.quality),
  };
}

function hasForbiddenDisplayPlanFields(record: Record<string, unknown>): boolean {
  return Object.keys(record).some((key) => FORBIDDEN_DISPLAY_PLAN_FIELDS.has(key));
}

function mergeQuality(
  synthesisQuality: ResearchArtifactQuality,
  displayQuality?: ResearchArtifactQuality,
): ResearchArtifactQuality {
  return {
    overall: lowestQuality(synthesisQuality.overall, displayQuality?.overall),
    warnings: uniqueStrings([
      ...synthesisQuality.warnings,
      ...(displayQuality?.warnings ?? []),
    ]),
  };
}

function lowestQuality(
  left: ResearchArtifactQuality["overall"],
  right?: ResearchArtifactQuality["overall"],
): ResearchArtifactQuality["overall"] {
  if (!right) return left;
  if (left === "low" || right === "low") return "low";
  if (left === "medium" || right === "medium") return "medium";
  return "high";
}

function riskKindForUnit(
  unitType: string,
): Extract<AnswerBlock, { type: "risk_driver_map" }>["items"][number]["kind"] {
  if (unitType === "driver_item") return "driver";
  if (unitType === "headwind_item") return "headwind";
  if (unitType === "watch_item") return "watch_item";
  return "risk";
}

function unitEvidenceRefs(unit: ResearchSynthesis["canonical_answer"]["units"][number]): string[] {
  return stringArray(unit.evidence_refs);
}

function parseEvidenceRefs(value: unknown): ResearchArtifactEvidenceRef[] {
  return arrayOfRecords(value)
    .map((item) => {
      const id = stringValue(item.id);
      const sourceLabel = stringValue(item.source_label);
      const evidenceGrade = enumValue(item.evidence_grade, [
        "direct",
        "indirect",
        "derived",
        "unsupported",
      ] as const);
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
  return {
    overall: enumValue(record?.overall, ["high", "medium", "low"] as const) ?? "medium",
    warnings: stringArray(record?.warnings),
  };
}

function isRenderableCanonicalUnit(
  unit: ResearchSynthesis["canonical_answer"]["units"][number],
): boolean {
  switch (unit.type) {
    case "heading":
    case "paragraph":
    case "caveat":
    case "evidence_note":
      return hasString(unit, "text");
    case "metric":
      return hasAllStrings(unit, ["label", "value"]);
    case "period_delta":
      return hasAllStrings(unit, ["label", "from", "to", "interpretation"]);
    case "business_segment":
      return hasAllStrings(unit, ["name", "role", "why_it_matters"]);
    case "premise":
      return hasAllStrings(unit, ["label", "text"]);
    case "impact_channel":
      return (
        hasAllStrings(unit, ["channel", "direction", "mechanism"]) &&
        Boolean(enumValue(unit.confidence, CONFIDENCE_VALUES))
      );
    case "risk_item":
    case "driver_item":
    case "headwind_item":
    case "watch_item":
      return hasAllStrings(unit, ["label", "text"]);
    case "timeline_event":
      return hasAllStrings(unit, ["label", "date_or_period", "text"]);
    case "comparison_row":
      return hasString(unit, "label") && stringArray(unit.values).length > 0;
    case "glossary_term":
      return hasAllStrings(unit, ["term", "definition"]);
  }
}

function hasString(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return Boolean(stringValue(record[key]));
}

function hasAllStrings(
  record: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.every((key) => hasString(record, key));
}

function renderRequirement(
  type: CanonicalAnswerUnitType,
  required: string[],
): Record<string, unknown> {
  return {
    properties: {
      type: { const: type },
    },
    required,
  };
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function nonNullable<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
