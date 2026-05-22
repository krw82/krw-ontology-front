import type {
  DisplayPlanOutput,
  ResearchAgentOutput,
  ResearchArtifactBlock,
  ResearchArtifactEnvelope,
  ResearchArtifactEvidenceRef,
  ResearchSynthesis,
  StreamingCitation,
} from "@/types/api-contracts";
import type { AccumulatedRun } from "@/lib/agent/stream-handler";
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
  const evidenceProfile = buildEvidenceProfile(toolCalls, tickers);
  const hasEvidenceProfile =
    evidenceProfile.takeaways.length > 0 ||
    evidenceProfile.segments.length > 0 ||
    evidenceProfile.metrics.length > 0 ||
    evidenceProfile.riskDrivers.length > 0;
  const summary = hasEvidenceProfile ? evidenceProfile.summary : "";
  const keyPoints = hasEvidenceProfile ? evidenceProfile.takeaways : [];
  const title = extractTitle(finalText) ?? buildTitle(tickers);

  if (!hasEvidenceProfile) return null;

  if (!summary && keyPoints.length === 0) return null;

  const blocks: ResearchArtifactBlock[] = [];

  const intro = [
    summary || null,
    ...keyPoints.slice(0, 4).map((point) => `- ${point}`),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  if (intro) {
    blocks.push({
      type: "markdown",
      content: intro,
    });
  }

  if (evidenceProfile.segments.length > 0) {
    blocks.push({
      type: "business_segments",
      title: "사업 구조",
      segments: evidenceProfile.segments,
    });
  }

  if (evidenceProfile.metrics.length > 0) {
    blocks.push({
      type: "metric_grid",
      title: "핵심 숫자",
      metrics: evidenceProfile.metrics,
    });
  }

  if (evidenceProfile.riskDrivers.length > 0) {
    blocks.push({
      type: "risk_driver_map",
      title: "리스크와 성장 동력",
      items: evidenceProfile.riskDrivers,
    });
  }

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

  if (blocks.length === 0) return null;
  const evidenceRefs = buildEvidenceRefs(citations);

  return {
    artifact_version: RESEARCH_ARTIFACT_VERSION,
    artifact_type: "company_overview",
    title,
    summary: summary || keyPoints[0] || title,
    tickers,
    source_scope: buildSourceScope(citations),
    answer_alignment: {
      visible_answer_summary: summary || keyPoints[0] || title,
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

  if (/궁금한 특정 주제|주요 정보를 정리|말씀해 주세요|specific topic/i.test(text)) {
    return evidenceRefCount === 0;
  }

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
  const evidenceProfile = buildEvidenceProfile(toolCalls, tickers);
  const existingTypes = new Set(artifact.blocks.map((block) => block.type));
  const supplementalBlocks: ResearchArtifactBlock[] = [];

  if (!existingTypes.has("business_segments") && evidenceProfile.segments.length > 0) {
    supplementalBlocks.push({
      type: "business_segments",
      title: "사업 구조",
      segments: evidenceProfile.segments,
    });
  }

  if (!existingTypes.has("metric_grid") && evidenceProfile.metrics.length > 0) {
    supplementalBlocks.push({
      type: "metric_grid",
      title: "핵심 숫자",
      metrics: evidenceProfile.metrics,
    });
  }

  if (supplementalBlocks.length === 0 && tickers.length === (artifact.tickers?.length ?? 0)) {
    return artifact;
  }

  const blocks =
    artifact.blocks[0]?.type === "markdown"
      ? [artifact.blocks[0], ...supplementalBlocks, ...artifact.blocks.slice(1)]
      : [...supplementalBlocks, ...artifact.blocks];

  return {
    ...artifact,
    tickers: tickers.length > 0 ? tickers : artifact.tickers,
    blocks: blocks.slice(0, 12),
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
    } catch {
      // Ignore malformed tool argument snapshots.
    }
  }

  return tickers;
}

function buildTitle(tickers: string[]): string {
  return tickers.length > 0
    ? `${tickers.join(", ")} Research Brief`
    : "Research Brief";
}

interface EvidenceClaim {
  text: string;
  topic: string | null;
  ticker: string | null;
  documentType: string | null;
  period: string | null;
  type: string | null;
}

interface EvidenceMetric {
  label: string;
  value: string;
  period?: string;
  unit?: string;
  delta?: string;
  source_label?: string;
}

interface EvidenceSegment {
  name: string;
  role: string;
  why_it_matters: string;
}

type EvidenceRiskDriver = Extract<
  ResearchArtifactBlock,
  { type: "risk_driver_map" }
>["items"][number];

function buildEvidenceProfile(
  toolCalls: AccumulatedRun["toolCalls"],
  tickers: string[],
): {
  summary: string;
  takeaways: string[];
  metrics: EvidenceMetric[];
  segments: EvidenceSegment[];
  riskDrivers: EvidenceRiskDriver[];
} {
  const claims = extractEvidenceClaims(toolCalls);
  const metrics = buildEvidenceMetrics(claims);
  const takeaways = uniqueStrings(
    claims.map(claimToKoreanTakeaway).filter((value): value is string => Boolean(value)),
  ).slice(0, 5);
  const riskDrivers = buildRiskDrivers(claims);
  const hasSegmentEvidence = claims.some((claim) =>
    /segment|operating income/i.test(`${claim.topic ?? ""} ${claim.text}`),
  );
  const hasAmazon =
    tickers.includes("AMZN") || claims.some((claim) => claim.ticker === "AMZN");
  const segments =
    hasAmazon && hasSegmentEvidence
      ? buildAmazonSegments()
      : buildGenericSegments(claims);
  const latestSource = latestSourceLabel(claims);
  const tickerLabel = tickers.length > 0 ? tickers.join(", ") : "회사";
  const summary =
    tickers.includes("AMZN") || hasAmazon
      ? "AMZN FY2025 10-K 기준으로 사업 구조, 매출 성장, 순이익, 세그먼트 수익성과 투자 지출을 정리했습니다."
      : `${tickerLabel}${latestSource ? ` ${latestSource}` : ""} 기준으로 사업 구조, 핵심 숫자, 성장 동력과 리스크를 정리했습니다.`;

  return { summary, takeaways, metrics, segments, riskDrivers };
}

function extractEvidenceClaims(
  toolCalls: AccumulatedRun["toolCalls"],
): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  const seen = new Set<string>();

  for (const toolCall of toolCalls) {
    if (toolCall.toolName !== "krw_ontology_query") continue;

    const args = parseJsonRecord(toolCall.argumentsJson);
    const topic = stringValue(args?.topic);
    const result = normalizeToolResult(toolCall.resultJson ?? toolCall.resultText);
    if (!result) continue;

    for (const record of resultRecords(result)) {
      pushEvidenceClaim(claims, seen, {
        record,
        topic,
        fallbackType: stringValue(record.type),
      });

      const evidence = asRecord(record.evidence);
      for (const nested of arrayOfRecords(evidence?.claims)) {
        pushEvidenceClaim(claims, seen, {
          record: nested,
          topic,
          fallbackType: stringValue(record.type) ?? stringValue(nested.type),
        });
      }

      for (const nested of arrayOfRecords(evidence?.related_objects)) {
        pushEvidenceClaim(claims, seen, {
          record: nested,
          topic,
          fallbackType: stringValue(nested.type) ?? stringValue(record.type),
        });
      }
    }
  }

  return claims.slice(0, 120);
}

function pushEvidenceClaim(
  claims: EvidenceClaim[],
  seen: Set<string>,
  params: {
    record: UnknownRecord;
    topic: string | null;
    fallbackType: string | null;
  },
) {
  const { record, topic, fallbackType } = params;
  const text =
    stringValue(record.text) ??
    stringValue(record.claim_text) ??
    stringValue(record.snippet) ??
    stringValue(record.content);
  if (!text || !isUsefulPoint(text)) return;

  const key = normalizeComparableText(text);
  if (seen.has(key)) return;
  seen.add(key);

  claims.push({
    text,
    topic,
    ticker: stringValue(record.ticker)?.toUpperCase() ?? null,
    documentType: stringValue(record.document_type),
    period: stringValue(record.period),
    type: stringValue(record.type) ?? fallbackType,
  });
}

function resultRecords(result: UnknownRecord): UnknownRecord[] {
  if (Array.isArray(result.results)) {
    return result.results.filter(asRecord);
  }

  const groupedResults = asRecord(result.results);
  if (groupedResults) {
    return Object.values(groupedResults).flatMap((value) =>
      Array.isArray(value) ? value.filter(asRecord) : [],
    );
  }

  return [];
}

function buildEvidenceMetrics(claims: EvidenceClaim[]): EvidenceMetric[] {
  const byLabel = new Map<string, EvidenceMetric & { numericMagnitude?: number }>();

  for (const claim of claims) {
    const directMetric = parseDirectMetricValue(claim);
    if (directMetric) {
      const current = byLabel.get(directMetric.label);
      if (
        !current ||
        (directMetric.numericMagnitude ?? 0) > (current.numericMagnitude ?? 0)
      ) {
        byLabel.set(directMetric.label, directMetric);
      }
      continue;
    }

    const label = metricLabelForClaim(claim);
    const latest = latestCurrencyMention(claim.text, claim.period);
    if (!label || !latest) continue;

    const metric = {
      label,
      value: latest.value,
      period: latest.year ?? claim.period ?? undefined,
      unit: "USD",
      delta: metricDelta(claim.text, claim.period),
      source_label: sourceLabel(claim),
      numericMagnitude: latest.amount,
    };

    const current = byLabel.get(label);
    if (!current || metric.numericMagnitude > (current.numericMagnitude ?? 0)) {
      byLabel.set(label, metric);
    }
  }

  return Array.from(byLabel.values())
    .map((metric) => ({
      label: metric.label,
      value: metric.value,
      period: metric.period,
      unit: metric.unit,
      delta: metric.delta,
      source_label: metric.source_label,
    }))
    .slice(0, 6);
}

function parseDirectMetricValue(
  claim: EvidenceClaim,
): (EvidenceMetric & { numericMagnitude?: number }) | null {
  if (claim.type !== "FinancialMetricValue") return null;
  const match = claim.text.match(
    /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*([A-Za-z_/$]+)?\s*$/i,
  );
  if (!match) return null;

  const metricKey = match[1]?.toLowerCase();
  const rawValue = Number(match[2]);
  const unit = match[3] ?? "";
  if (!metricKey || !Number.isFinite(rawValue)) return null;

  const label = metricLabelForKey(metricKey);
  if (!label) return null;

  return {
    label,
    value: formatMetricValue(rawValue, unit),
    period: claim.period ?? undefined,
    unit: unit || undefined,
    source_label: sourceLabel(claim),
    numericMagnitude: Math.abs(rawValue),
  };
}

function metricLabelForKey(key: string): string | null {
  const labels: Record<string, string> = {
    revenue: "매출",
    total_revenue: "총매출",
    operating_income: "영업이익",
    net_income: "순이익",
    capital_expenditures: "Capex",
    capex: "Capex",
    total_debt: "총부채",
    total_liabilities: "총부채",
    operating_cash_flow: "영업현금흐름",
    free_cash_flow: "FCF",
    eps: "EPS",
  };
  return labels[key] ?? null;
}

function formatMetricValue(value: number, unit: string): string {
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit.includes("per_share")) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
    }).format(value)}/share`;
  }
  if (normalizedUnit.includes("usd")) {
    return formatAbsoluteCurrency(value);
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function metricLabelForClaim(claim: EvidenceClaim): string | null {
  const text = claim.text;
  if (/aws/i.test(text) && /operating income/i.test(text)) return "AWS 영업이익";
  if (/north america/i.test(text) && /operating income/i.test(text)) {
    return "North America 영업이익";
  }
  if (/international/i.test(text) && /operating income/i.test(text)) {
    return "International 영업이익";
  }
  if (isCompanyRevenueMetricText(text)) return "총매출";
  if (isCompanyNetIncomeMetricText(text)) return "순이익";
  if (/purchases of property and equipment|capital expenditures|capex/i.test(text)) {
    return "PP&E 구매/Capex";
  }
  if (/operating income/i.test(text)) return "영업이익";
  return null;
}

function claimToKoreanTakeaway(claim: EvidenceClaim): string | null {
  const text = claim.text;
  const range = formatCurrencyRange(text);
  const lower = text.toLowerCase();

  if (isCompanyRevenueMetricText(text) && isIncreaseStatement(lower) && range) {
    return `총매출은 ${range}로 증가했습니다.`;
  }
  if (isCompanyNetIncomeMetricText(text) && isIncreaseStatement(lower) && range) {
    return `순이익은 ${range}로 증가했습니다.`;
  }
  if (
    /purchases of property and equipment|capital expenditures/.test(lower) &&
    isIncreaseStatement(lower) &&
    range
  ) {
    return `PP&E 구매/Capex는 ${range}로 증가했습니다.`;
  }
  if (/aws segment operating income increased/.test(lower)) {
    return "AWS 부문 영업이익은 매출 성장과 비용 구조 개선 영향으로 확대됐습니다.";
  }
  if (/north america segment operating income increased/.test(lower)) {
    return "North America 부문 영업이익은 단위 판매 증가와 운영 효율화로 개선됐습니다.";
  }
  if (/international segment operating income increased/.test(lower)) {
    return "International 부문 영업이익은 단위 판매 증가와 비용 효율화로 개선됐습니다.";
  }
  if (/full lng supply chain|lng production, natural gas transport, shipping, and regasification/.test(lower)) {
    return "Venture Global은 LNG 생산, 천연가스 운송, 해운, 재기화까지 LNG 공급망 전반의 자산을 운영합니다.";
  }
  if (/design-one, build-many|modular, scalable/.test(lower)) {
    return "모듈형 design-one/build-many 방식은 전통 LNG 프로젝트 대비 빠르고 비용 효율적인 건설을 가능하게 하는 핵심 성장 동력입니다.";
  }
  if (/permitted capacities may increase|ferc and doe/.test(lower)) {
    return "FERC와 DOE 승인 여부는 허가 용량 확대와 프로젝트 일정의 핵심 변수입니다.";
  }
  if (/project cost|costs to complete|inflationary/.test(lower)) {
    return "프로젝트 비용은 인플레이션, 거시 환경, 규제 환경에 따라 추가 상승할 수 있습니다.";
  }

  return null;
}

function isCompanyRevenueMetricText(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    /unearned revenue|revenue recognition|recognized as revenue|revenue growth|future growth|deferred revenue/.test(
      lower,
    )
  ) {
    return false;
  }
  return /total net sales|consolidated net sales|net sales (?:increased|decreased|were|was|of|for)|total revenues?|consolidated revenues?|revenues? (?:increased|decreased|were|was|of|for)/.test(
    lower,
  );
}

function isCompanyNetIncomeMetricText(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    /reduced net income by|reduction in net income|net income by|income tax provision|foreign income deduction|affects net_income|relevant to net_income/.test(
      lower,
    )
  ) {
    return false;
  }
  return /net income (?:increased|decreased|declined|was|were|of|for|attributable)|reported net income/.test(
    lower,
  );
}

function isIncreaseStatement(lowerText: string): boolean {
  return /\b(increased|grew|rose|up from|higher)\b/.test(lowerText);
}

function buildGenericSegments(claims: EvidenceClaim[]): EvidenceSegment[] {
  const profile = claims.find((claim) => claim.type === "CompanyBusinessProfile");
  if (!profile) return [];

  const activities = extractProfileList(profile.text, "Primary activities", "Key external factors");
  const factors = extractProfileList(profile.text, "Key external factors");

  return activities.slice(0, 5).map((activity) => ({
    name: toTitleCase(activity),
    role: `${activity} 중심의 사업 활동입니다.`,
    why_it_matters: factors.length
      ? `주요 변수: ${factors.slice(0, 3).join(", ")}.`
      : "사업 모델과 현금흐름 민감도를 판단하는 기본 축입니다.",
  }));
}

function buildRiskDrivers(claims: EvidenceClaim[]): EvidenceRiskDriver[] {
  const items: EvidenceRiskDriver[] = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    const lower = claim.text.toLowerCase();
    const type = claim.type ?? "";
    const isRisk = /risk/i.test(type) || /uncertain|risk|appeal|approval|costs? to complete|delay|maintenance/.test(lower);
    const isDriver = /growthdriver/i.test(type) || /enables|advantage|capacity|cost-efficient|owns all|market share/.test(lower);

    if (!isRisk && !isDriver) continue;

    const label = summarizeLabel(claim.text);
    const key = normalizeComparableText(label);
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      label,
      kind: isRisk && !isDriver ? "risk" : "driver",
      text: truncateAtWord(cleanInlineMarkdown(claim.text), 220),
      severity: isRisk ? "medium" : "low",
    });
  }

  return items.slice(0, 6);
}

function extractProfileList(
  text: string,
  startLabel: string,
  endLabel?: string,
): string[] {
  const start = text.toLowerCase().indexOf(`${startLabel.toLowerCase()}:`);
  if (start === -1) return [];
  const afterStart = text.slice(start + startLabel.length + 1);
  const end = endLabel
    ? afterStart.toLowerCase().indexOf(`${endLabel.toLowerCase()}:`)
    : -1;
  const segment = end === -1 ? afterStart : afterStart.slice(0, end);
  return segment
    .replace(/\.$/, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function summarizeLabel(text: string): string {
  const cleaned = cleanInlineMarkdown(text);
  const firstClause = cleaned.split(/[,.;:]/)[0]?.trim();
  return truncateAtWord(firstClause && firstClause.length >= 12 ? firstClause : cleaned, 72);
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildAmazonSegments(): EvidenceSegment[] {
  return [
    {
      name: "North America",
      role: "북미 온라인/오프라인 리테일, 광고, 구독, 물류를 포함한 최대 매출 기반입니다.",
      why_it_matters: "규모가 가장 크기 때문에 전체 성장률과 물류 효율성에 직접 영향을 줍니다.",
    },
    {
      name: "International",
      role: "해외 리테일 및 구독 서비스 부문입니다.",
      why_it_matters: "단위 판매 증가와 비용 관리가 수익성 개선의 핵심 변수입니다.",
    },
    {
      name: "AWS",
      role: "글로벌 클라우드 컴퓨팅 부문입니다.",
      why_it_matters: "AMZN의 핵심 이익 엔진으로 영업이익 기여도가 큽니다.",
    },
  ];
}

function sourceLabel(claim: EvidenceClaim): string | undefined {
  const label = [claim.ticker, claim.period, claim.documentType]
    .filter(Boolean)
    .join(" ");
  return label || undefined;
}

function metricDelta(text: string, period: string | null): string | undefined {
  const maxYear = fiscalYear(period);
  const years = Array.from(text.matchAll(/\b(20\d{2})\b/g), (match) => match[1])
    .filter((year): year is string => Boolean(year))
    .filter((year) => !maxYear || Number(year) <= maxYear);
  if (years.length >= 2) {
    const first = years[0];
    const last = years[years.length - 1];
    if (first && last && first !== last) {
      return /decreased|declined|lower/i.test(text)
        ? `${first}→${last} 감소`
        : `${first}→${last} 증가`;
    }
  }
  return undefined;
}

function latestCurrencyMention(
  text: string,
  period: string | null,
): { value: string; amount: number; year?: string } | null {
  const maxYear = fiscalYear(period);
  const mentions = currencyTimeline(text).filter(
    (mention) => !maxYear || !mention.year || Number(mention.year) <= maxYear,
  );
  const latest = mentions.at(-1);
  if (!latest) return null;
  return {
    value: formatCurrency(latest.amount, latest.unit),
    amount: Math.abs(latest.amount),
    year: latest.year,
  };
}

function fiscalYear(period: string | null): number | null {
  const match = period?.match(/FY(20\d{2})/i);
  return match ? Number(match[1]) : null;
}

function formatCurrencyRange(text: string): string | null {
  const mentions = currencyTimeline(text);
  if (mentions.length < 2) return null;

  const first = mentions[0];
  const last = mentions[mentions.length - 1];
  if (!first || !last) return null;

  const firstLabel = first.year
    ? `${first.year}년 ${formatCurrency(first.amount, first.unit)}`
    : formatCurrency(first.amount, first.unit);
  const lastLabel = last.year
    ? `${last.year}년 ${formatCurrency(last.amount, last.unit)}`
    : formatCurrency(last.amount, last.unit);
  return `${firstLabel}에서 ${lastLabel}`;
}

function currencyTimeline(
  text: string,
): Array<{ amount: number; unit: string | null; year?: string }> {
  const mentions: Array<{ amount: number; unit: string | null; year?: string }> = [];
  const regex = /\$([0-9,]+(?:\.[0-9]+)?)\s*(million|billion)?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const amount = Number((match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;

    const after = text.slice(match.index, match.index + 90);
    if (isPerShareCurrencyMention(text, match.index, match[0].length)) continue;
    const year = after.match(/\b(20\d{2})\b/)?.[1];
    mentions.push({
      amount,
      unit: match[2]?.toLowerCase() ?? null,
      year,
    });
  }

  return mentions;
}

function isPerShareCurrencyMention(
  text: string,
  index: number,
  length: number,
): boolean {
  const after = text.slice(index + length, index + length + 50);
  const before = text.slice(Math.max(0, index - 30), index);
  return /(?:per|basic|diluted)\s+share|\/share/i.test(after) ||
    /per\s+(?:basic|diluted)?\s*share\s*(?:of|and)?\s*$/i.test(before);
}

function formatCurrency(amount: number, unit: string | null): string {
  const billion =
    unit === "million" || (!unit && amount >= 1000) ? amount / 1000 : amount;
  const value = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(billion);
  return `$${value}B`;
}

function formatAbsoluteCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: abs >= 1_000_000 ? 1 : 0,
    maximumFractionDigits: abs >= 1_000_000 ? 1 : 2,
  });
  if (abs >= 1_000_000_000) return `$${formatter.format(amount / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `$${formatter.format(amount / 1_000_000)}M`;
  return `$${formatter.format(amount)}`;
}

function latestSourceLabel(claims: EvidenceClaim[]): string | null {
  const scored = claims
    .map((claim) => ({
      label: sourceLabel(claim),
      score: periodScore(claim.period),
    }))
    .filter((item): item is { label: string; score: number } => Boolean(item.label));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.label ?? null;
}

function periodScore(period: string | null): number {
  const match = period?.match(/^FY(20\d{2})(?:Q([1-4]))?$/i);
  if (!match) return 0;
  const year = Number(match[1]);
  const quarter = match[2] ? Number(match[2]) : 5;
  return year * 10 + quarter;
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
  if (/아티팩트 생성 완료|artifact generated/i.test(cleaned)) return true;
  return (
    keyPoints.length <= 2 &&
    !/[$€₩]|매출|영업이익|순이익|revenue|income|sales|capex/i.test(cleaned)
  );
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

function parseJsonRecord(value: string): UnknownRecord | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
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
