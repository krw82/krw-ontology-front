import type {
  DisplayPlanOutput,
  ResearchAgentOutput,
  ResearchArtifactBlock,
  ResearchArtifactEnvelope,
  ResearchArtifactEvidenceRef,
  ResearchSynthesis,
  StreamingCitation,
} from "@/types/api-contracts";
import type { AccumulatedRun } from "@/lib/agent/accumulated-run";
import { generateArtifactHtml } from "./html-export";
import { RESEARCH_ARTIFACT_VERSION } from "./schema";

type UnknownRecord = Record<string, unknown>;

export interface ResearchArtifactInsert {
  session_id: string;
  run_id: string;
  message_id: string;
  artifact_version: typeof RESEARCH_ARTIFACT_VERSION;
  artifact_type: ResearchArtifactEnvelope["artifact_type"];
  title: string;
  summary: string;
  tickers: string[];
  source_scope: ResearchArtifactEnvelope["source_scope"] | null;
  answer_alignment: ResearchArtifactEnvelope["answer_alignment"] | null;
  artifact_json: ResearchArtifactEnvelope;
  blocks_json: ResearchArtifactBlock[];
  evidence_refs: ResearchArtifactEvidenceRef[];
  quality_json: ResearchArtifactEnvelope["quality"];
  source_json: Record<string, unknown>;
  html_snapshot: string | null;
}

interface BuildResearchArtifactParams {
  sessionId: string;
  runId: string;
  messageId: string;
  finalText: string;
  defaultTickers: string[];
  toolCalls: AccumulatedRun["toolCalls"];
  citations: StreamingCitation[];
  structuredAnswer?: ResearchAgentOutput | null;
  researchSynthesis?: ResearchSynthesis | null;
  displayPlan?: DisplayPlanOutput | null;
  fallbackWhenMissing?: boolean;
}

export function buildResearchArtifacts({
  sessionId,
  runId,
  messageId,
  finalText,
  defaultTickers,
  toolCalls,
  citations,
  structuredAnswer,
  researchSynthesis,
  displayPlan,
  fallbackWhenMissing = true,
}: BuildResearchArtifactParams): ResearchArtifactInsert[] {
  const hasCanonicalSource = Boolean(researchSynthesis?.canonical_answer.units.length);
  const structuredArtifact = structuredAnswer
    ? buildArtifactFromStructuredAnswer({
        answer: structuredAnswer,
        finalText,
        defaultTickers,
        toolCalls,
        citations,
      })
    : null;
  const shouldReplaceStructuredArtifact =
    structuredArtifact && !hasCanonicalSource
      ? isThinStructuredArtifact(structuredArtifact)
      : false;
  const artifactBase =
    structuredArtifact && !shouldReplaceStructuredArtifact
      ? structuredArtifact
      : !hasCanonicalSource && (fallbackWhenMissing || shouldReplaceStructuredArtifact)
        ? buildFallbackArtifact({
            finalText,
            defaultTickers,
            toolCalls,
            citations,
          })
        : null;

  if (!artifactBase) return [];

  const artifact = hasCanonicalSource
    ? artifactBase
    : enhanceArtifactWithEvidence({
        artifact: artifactBase,
        defaultTickers,
        toolCalls,
        citations,
      });

  return [
    toInsert({
      sessionId,
      runId,
      messageId,
      artifact,
      toolCalls,
      citations,
      researchSynthesis,
      displayPlan,
    }),
  ];
}

function buildArtifactFromStructuredAnswer(params: {
  answer: ResearchAgentOutput;
  finalText: string;
  defaultTickers: string[];
  toolCalls: AccumulatedRun["toolCalls"];
  citations: StreamingCitation[];
}): ResearchArtifactEnvelope | null {
  const { answer, finalText, defaultTickers, toolCalls, citations } = params;
  const blocks = answer.answer_blocks.slice(0, 12);
  if (blocks.length === 0) return null;

  const tickers = buildTickers(defaultTickers, citations, toolCalls);
  const title = extractTitleFromBlocks(blocks) ?? extractTitle(finalText) ?? buildTitle(tickers);
  const summary = summarizeBlocks(blocks) || title;

  return {
    artifact_version: RESEARCH_ARTIFACT_VERSION,
    artifact_type: "company_overview",
    title,
    summary,
    tickers,
    source_scope: buildSourceScope(citations),
    answer_alignment: {
      visible_answer_summary: summary,
      no_new_thesis: true,
    },
    blocks,
    evidence_refs: answer.evidence_refs ?? buildEvidenceRefs(citations),
    quality: answer.quality,
  };
}

export function deriveVisibleAnswer(
  finalText: string,
  title?: string,
  structuredVisibleAnswer?: string | null,
  artifactSummary?: string | null,
): string {
  const visible = cleanVisibleAnswer(structuredVisibleAnswer, title, artifactSummary);
  if (visible) return visible;

  const finalKeyPoints = extractKeyPoints(finalText);
  const useArtifactSummary =
    isThinArtifactText(finalText, finalKeyPoints) && artifactSummary;
  const summary = useArtifactSummary
    ? truncateAtWord(cleanInlineMarkdown(artifactSummary), 420)
    : summarizeAnswer(finalText);
  const keyPoints = (useArtifactSummary ? [] : finalKeyPoints)
    .filter((point) => !isNearDuplicate(point, summary))
    .slice(0, 4);

  if (!summary && keyPoints.length === 0) {
    return stripMarkdown(finalText).slice(0, 800).trim();
  }

  const lines = [
    title ? `**${cleanInlineMarkdown(title)}**` : null,
    summary || null,
    ...keyPoints.map((point) => `- ${point}`),
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n").trim();
}

function toInsert(params: {
  sessionId: string;
  runId: string;
  messageId: string;
  artifact: ResearchArtifactEnvelope;
  toolCalls: AccumulatedRun["toolCalls"];
  citations: StreamingCitation[];
  researchSynthesis?: ResearchSynthesis | null;
  displayPlan?: DisplayPlanOutput | null;
}): ResearchArtifactInsert {
  const {
    sessionId,
    runId,
    messageId,
    artifact,
    toolCalls,
    citations,
    researchSynthesis,
    displayPlan,
  } = params;
  const now = new Date().toISOString();
  const htmlSnapshot = generateArtifactHtml({
    ...artifact,
    blocks_json: artifact.blocks,
    created_at: now,
  });

  return {
    session_id: sessionId,
    run_id: runId,
    message_id: messageId,
    artifact_version: artifact.artifact_version,
    artifact_type: artifact.artifact_type,
    title: artifact.title,
    summary: artifact.summary,
    tickers: artifact.tickers ?? [],
    source_scope: artifact.source_scope ?? null,
    answer_alignment: artifact.answer_alignment ?? null,
    artifact_json: artifact,
    blocks_json: artifact.blocks,
    evidence_refs: artifact.evidence_refs ?? [],
    quality_json: artifact.quality,
    source_json: {
      research_synthesis: researchSynthesis ?? null,
      display_plan: displayPlan ?? null,
      tool_calls: toolCalls.map((toolCall) => ({
        tool_use_id: toolCall.id,
        tool_name: toolCall.toolName,
        has_result_json: toolCall.resultJson !== null,
        has_result_text: Boolean(toolCall.resultText),
      })),
      citation_count: citations.length,
    },
    html_snapshot: htmlSnapshot,
  };
}

function buildFallbackArtifact(params: {
  finalText: string;
  defaultTickers: string[];
  toolCalls: AccumulatedRun["toolCalls"];
  citations: StreamingCitation[];
}): ResearchArtifactEnvelope | null {
  const { finalText, defaultTickers, toolCalls, citations } = params;
  const qualityWarnings = collectQualityNotes(toolCalls);
  const tickers = buildTickers(defaultTickers, citations, toolCalls);
  const answer = finalText.trim();
  const keyPoints = extractKeyPoints(answer);
  const title = extractTitle(finalText) ?? buildTitle(tickers);
  const evidenceRefs = mergeEvidenceRefs(
    buildEvidenceRefs(citations),
    buildResearchStateEvidenceRefs(toolCalls),
  );

  if (!answer) return null;
  if (isThinArtifactText(answer, keyPoints) && evidenceRefs.length === 0) return null;

  const blocks: ResearchArtifactBlock[] = [
    {
      type: "markdown",
      content: answer,
      evidence_refs: evidenceRefs.map((reference) => reference.id),
    },
  ];

  if (qualityWarnings.length > 0) {
    blocks.push({
      type: "caveat_list",
      title: "주의할 점",
      items: qualityWarnings.map((warning) => ({
        text: warning,
        severity: "warning",
      })),
    });
  }

  const summary = summarizeAnswer(answer) || title;

  return {
    artifact_version: RESEARCH_ARTIFACT_VERSION,
    artifact_type: "company_overview",
    title,
    summary,
    tickers,
    source_scope: buildSourceScope(citations),
    answer_alignment: {
      visible_answer_summary: summary,
      no_new_thesis: true,
    },
    blocks,
    evidence_refs: evidenceRefs,
    quality: {
      overall:
        qualityWarnings.length > 0
          ? "medium"
          : evidenceRefs.length > 0
            ? "high"
            : "medium",
      warnings: qualityWarnings,
    },
  };
}

function isThinStructuredArtifact(artifact: ResearchArtifactEnvelope): boolean {
  const evidenceRefCount =
    (artifact.evidence_refs?.length ?? 0) +
    artifact.blocks.reduce(
      (count, block) => count + (block.evidence_refs?.length ?? 0),
      0,
    );
  const text = [
    artifact.title,
    artifact.summary,
    ...artifact.blocks.flatMap(blockTextParts),
  ].join(" ");

  return (
    evidenceRefCount === 0 &&
    artifact.blocks.length <= 1 &&
    isThinArtifactText(text, extractKeyPoints(text))
  );
}

function blockTextParts(block: ResearchArtifactBlock): string[] {
  switch (block.type) {
    case "markdown":
      return [block.content];
    case "metric_grid":
      return block.metrics.flatMap((metric) => [metric.label, metric.value]);
    case "business_segments":
      return block.segments.flatMap((segment) => [
        segment.name,
        segment.role,
        segment.why_it_matters,
      ]);
    case "risk_driver_map":
      return block.items.flatMap((item) => [item.label, item.text]);
    case "caveat_list":
      return block.items.map((item) => item.text);
    default:
      return [];
  }
}

function enhanceArtifactWithEvidence(params: {
  artifact: ResearchArtifactEnvelope;
  defaultTickers: string[];
  toolCalls: AccumulatedRun["toolCalls"];
  citations: StreamingCitation[];
}): ResearchArtifactEnvelope {
  const { artifact, defaultTickers, toolCalls, citations } = params;
  const tickers = buildTickers(
    artifact.tickers && artifact.tickers.length > 0
      ? artifact.tickers
      : defaultTickers,
    citations,
    toolCalls,
  );
  const evidenceRefs = mergeEvidenceRefs(
    artifact.evidence_refs ?? [],
    buildEvidenceRefs(citations),
    buildResearchStateEvidenceRefs(toolCalls),
  );
  if (
    tickers.length === (artifact.tickers?.length ?? 0) &&
    evidenceRefs.length === (artifact.evidence_refs?.length ?? 0)
  ) {
    return artifact;
  }

  return {
    ...artifact,
    tickers: tickers.length > 0 ? tickers : artifact.tickers,
    evidence_refs: evidenceRefs,
  };
}

function cleanVisibleAnswer(
  value: string | null | undefined,
  title?: string,
  artifactSummary?: string | null,
): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.startsWith("{") || cleaned.startsWith("```")) return null;
  const bulletCount = cleaned.split("\n").filter((line) => /^\s*[-*]\s+/.test(line)).length;
  const headingCount = cleaned.split("\n").filter((line) => /^\s{0,3}#{1,6}\s+/.test(line)).length;

  if (cleaned.length <= 700 && bulletCount <= 4 && headingCount <= 1) {
    return cleaned;
  }

  const summary =
    artifactSummary && artifactSummary.trim()
      ? truncateAtWord(cleanInlineMarkdown(artifactSummary), 420)
      : summarizeAnswer(cleaned);
  const keyPoints = extractKeyPoints(cleaned)
    .filter((point) => !isNearDuplicate(point, summary))
    .slice(0, 3);
  const lines = [
    title ? `**${cleanInlineMarkdown(title)}**` : null,
    summary || null,
    ...keyPoints.map((point) => `- ${point}`),
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n").trim().slice(0, 900);
}

function buildTickers(
  defaultTickers: string[],
  citations: StreamingCitation[],
  toolCalls: AccumulatedRun["toolCalls"],
): string[] {
  return Array.from(
    new Set(
      [
        ...defaultTickers,
        ...citations.map((citation) => citation.ticker ?? ""),
        ...extractToolArgumentTickers(toolCalls),
        ...extractResearchStateTickers(toolCalls),
      ]
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, 6);
}

function extractToolArgumentTickers(
  toolCalls: AccumulatedRun["toolCalls"],
): string[] {
  const tickers: string[] = [];

  for (const toolCall of toolCalls) {
    try {
      const args = JSON.parse(toolCall.argumentsJson) as Record<string, unknown>;
      const singleTicker = stringValue(args.ticker);
      if (singleTicker) tickers.push(singleTicker);
      if (Array.isArray(args.tickers)) {
        tickers.push(
          ...args.tickers.filter((ticker): ticker is string => typeof ticker === "string"),
        );
      }
      const searchPlan = asRecord(args.search_plan);
      if (Array.isArray(searchPlan?.tickers)) {
        tickers.push(
          ...searchPlan.tickers.filter(
            (ticker): ticker is string => typeof ticker === "string",
          ),
        );
      }
    } catch {
      // Ignore malformed tool argument snapshots.
    }
  }

  return tickers;
}

function extractResearchStateTickers(
  toolCalls: AccumulatedRun["toolCalls"],
): string[] {
  const tickers: string[] = [];
  for (const toolCall of toolCalls) {
    const result = normalizeToolResult(toolCall.resultJson ?? toolCall.resultText);
    if (result?.contract_version !== "research-state/v2") continue;
    const scope = asRecord(result.resolved_scope);
    for (const value of [scope?.resolved_tickers, scope?.requested_tickers]) {
      if (!Array.isArray(value)) continue;
      tickers.push(
        ...value.filter((ticker): ticker is string => typeof ticker === "string"),
      );
    }
  }
  return tickers;
}

function buildTitle(tickers: string[]): string {
  return tickers.length > 0
    ? `${tickers.join(", ")} Research Brief`
    : "Research Brief";
}

function extractTitle(text: string): string | null {
  const match = text.match(/^\s{0,3}#{1,2}\s+(.+)$/m);
  const title = match ? cleanInlineMarkdown(match[1] ?? "") : "";
  return title && title.length <= 120 ? title : null;
}

function extractTitleFromBlocks(blocks: ResearchArtifactBlock[]): string | null {
  for (const block of blocks) {
    if (block.type !== "markdown") continue;
    const title = extractTitle(block.content);
    if (title) return title;
  }
  return null;
}

function summarizeBlocks(blocks: ResearchArtifactBlock[]): string {
  const markdownSummary = blocks
    .filter((block): block is Extract<ResearchArtifactBlock, { type: "markdown" }> =>
      block.type === "markdown",
    )
    .map((block) => summarizeAnswer(block.content))
    .find(Boolean);
  if (markdownSummary) return markdownSummary;

  const firstRichBlock = blocks.find((block) => block.type !== "markdown");
  return firstRichBlock && "title" in firstRichBlock
    ? cleanInlineMarkdown(firstRichBlock.title)
    : "";
}

function summarizeAnswer(text: string): string {
  const sections = extractSections(text);
  const paragraph =
    sections
      .flatMap((section) => section.body.split(/\n{2,}/))
      .map(cleanInlineMarkdown)
      .find((item) => isUsefulSummary(item)) ??
    stripMarkdown(text)
      .split(/\n{2,}/)
      .map(cleanInlineMarkdown)
      .find((item) => isUsefulSummary(item)) ??
    "";

  return truncateAtWord(paragraph, 420);
}

function extractKeyPoints(text: string): string[] {
  const bulletMatches = text
    .split("\n")
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => cleanInlineMarkdown(line.replace(/^\s*[-*]\s+/, "")))
    .filter(isUsefulPoint);

  if (bulletMatches.length > 0) return bulletMatches.slice(0, 5);

  return stripMarkdown(text)
    .split(/(?<=[.!?。])\s+/)
    .map(cleanInlineMarkdown)
    .filter(isUsefulPoint)
    .slice(0, 5);
}

function buildSourceScope(
  citations: StreamingCitation[],
): ResearchArtifactEnvelope["source_scope"] {
  const documentTypes = uniqueStrings(citations.map((citation) => citation.document_type));
  const periods = uniqueStrings(citations.map((citation) => citation.period));
  const sourceLabels = citations
    .map((citation) =>
      [citation.ticker, citation.period, citation.document_type]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean);

  if (documentTypes.length === 0 && periods.length === 0 && sourceLabels.length === 0) {
    return undefined;
  }

  return {
    document_types: documentTypes,
    periods,
    source_label: sourceLabels[0],
    external_sources: [],
  };
}

function buildEvidenceRefs(
  citations: StreamingCitation[],
): ResearchArtifactEvidenceRef[] {
  const seen = new Set<string>();

  return citations
    .map((citation, index) => {
      const id = citation.object_id
        ? `ref_${citation.object_id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`
        : `ref_${index + 1}`;
      const sourceLabel =
        [citation.ticker, citation.period, citation.document_type]
          .filter(Boolean)
          .join(" ") || "Company filing evidence";
      const key = `${id}:${sourceLabel}`;
      return {
        key,
        ref: {
          id,
          source_label: sourceLabel,
          object_type: citation.section ?? undefined,
          evidence_grade: mapEvidenceGrade(citation.evidence_grade),
          trace_id: citation.object_id,
          quote_text: null,
          chain_summary: citation.trace_json ?? null,
        } satisfies ResearchArtifactEvidenceRef,
      };
    })
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .slice(0, 12)
    .map((item) => item.ref);
}

function buildResearchStateEvidenceRefs(
  toolCalls: AccumulatedRun["toolCalls"],
): ResearchArtifactEvidenceRef[] {
  const refs: ResearchArtifactEvidenceRef[] = [];

  for (const toolCall of toolCalls) {
    const result = normalizeToolResult(toolCall.resultJson ?? toolCall.resultText);
    if (result?.contract_version !== "research-state/v2") continue;

    for (const unit of arrayOfRecords(result.evidence_units)) {
      const source = asRecord(unit.source);
      const sourceObjectIds = asStringArray(source?.object_ids);
      const evidenceId = stringValue(unit.evidence_id);
      const objectId = stringValue(unit.object_id) ?? sourceObjectIds[0] ?? null;
      if (!evidenceId || !objectId) continue;

      refs.push({
        id: evidenceId,
        source_label:
          stringValue(source?.source_label) ??
          ([unit.ticker, unit.period, unit.document_type]
            .filter(
              (value): value is string =>
                typeof value === "string" && Boolean(value),
            )
            .join(" ") || "Ontology evidence"),
        object_type: stringValue(unit.object_type) ?? undefined,
        evidence_grade: mapResearchStateEvidenceGrade(
          stringValue(unit.evidence_grade),
        ),
        trace_id: objectId,
        quote_text: null,
        chain_summary: {
          evidence_id: evidenceId,
          object_ids: sourceObjectIds,
          quote_ids: asStringArray(source?.quote_ids),
          span_ids: asStringArray(source?.span_ids),
        },
      });
    }
  }

  return mergeEvidenceRefs(refs).slice(0, 24);
}

function mergeEvidenceRefs(
  ...groups: ResearchArtifactEvidenceRef[][]
): ResearchArtifactEvidenceRef[] {
  const refs: ResearchArtifactEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const reference of groups.flat()) {
    const key = reference.id || reference.trace_id || reference.source_label;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    refs.push(reference);
  }
  return refs;
}

function mapResearchStateEvidenceGrade(
  value: string | null,
): ResearchArtifactEvidenceRef["evidence_grade"] {
  if (value === "strong") return "direct";
  if (value === "medium") return "indirect";
  if (value === "weak") return "derived";
  return "unsupported";
}

function mapEvidenceGrade(value: StreamingCitation["evidence_grade"]) {
  if (value === "high") return "direct";
  if (value === "medium") return "indirect";
  if (value === "low") return "derived";
  return "unsupported";
}

function collectQualityNotes(toolCalls: AccumulatedRun["toolCalls"]): string[] {
  const notes: string[] = [];

  for (const toolCall of toolCalls) {
    if (
      toolCall.toolName !== "krw_ontology_quality" &&
      toolCall.toolName !== "krw_ontology_chain"
    ) {
      continue;
    }

    const record = normalizeToolResult(toolCall.resultJson);
    const warnings = asStringArray(record?.warnings);
    const qualityWarnings = asStringArray(record?.quality_warnings);
    const note = stringValue(record?.warning) ?? stringValue(record?.note);

    notes.push(...warnings, ...qualityWarnings);
    if (note) notes.push(note);
  }

  return Array.from(new Set(notes.map((note) => note.trim()).filter(Boolean))).slice(
    0,
    6,
  );
}

function extractSections(text: string): Array<{ title: string | null; body: string }> {
  const sections: Array<{ title: string | null; body: string[] }> = [
    { title: null, body: [] },
  ];

  for (const line of text.split("\n")) {
    const heading = line.match(/^\s{0,3}#{1,3}\s+(.+)$/);
    if (heading) {
      sections.push({
        title: cleanInlineMarkdown(heading[1] ?? ""),
        body: [],
      });
      continue;
    }

    sections[sections.length - 1]?.body.push(line);
  }

  return sections
    .map((section) => ({
      title: section.title,
      body: section.body.join("\n").trim(),
    }))
    .filter((section) => section.body);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}

function cleanInlineMarkdown(value: string): string {
  return stripMarkdown(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function isUsefulSummary(value: string): boolean {
  if (!value) return false;
  if (value.length < 18 || value.length > 520) return false;
  if (/^\|/.test(value)) return false;
  if (/^\{/.test(value) || /^\[/.test(value)) return false;
  return true;
}

function isUsefulPoint(value: string): boolean {
  if (!value) return false;
  if (value.length < 8 || value.length > 240) return false;
  if (/^\|/.test(value)) return false;
  if (/^\{/.test(value) || /^\[/.test(value)) return false;
  if (/^[-–—]+$/.test(value)) return false;
  return true;
}

function isThinArtifactText(text: string, keyPoints: string[]): boolean {
  const cleaned = stripMarkdown(text);
  return cleaned.length < 160 && keyPoints.length <= 2;
}

function isNearDuplicate(point: string, summary: string): boolean {
  if (!summary) return false;
  const normalizedPoint = normalizeComparableText(point);
  const normalizedSummary = normalizeComparableText(summary);
  return (
    normalizedPoint === normalizedSummary ||
    normalizedSummary.includes(normalizedPoint) ||
    normalizedPoint.includes(normalizedSummary)
  );
}

function normalizeComparableText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()[\]{}'"`*_~-]/g, "")
    .trim()
    .toLowerCase();
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const truncated = value.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 220 ? lastSpace : maxLength).trim()}...`;
}

function normalizeToolResult(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return normalizeToolResult(JSON.parse(value));
    } catch {
      return null;
    }
  }

  const record = asRecord(value);
  if (!record) return null;

  const nestedResult = record.result;
  if (typeof nestedResult === "string") {
    try {
      const parsed = JSON.parse(nestedResult);
      return asRecord(parsed) ?? record;
    } catch {
      return record;
    }
  }

  return record;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function arrayOfRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is UnknownRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
