import type {
  ResearchArtifact,
  ResearchArtifactBlock,
  ResearchArtifactEnvelope,
} from "@/types/api-contracts";

type ArtifactForPresentation = Pick<
  ResearchArtifactEnvelope,
  "artifact_type" | "quality" | "evidence_refs" | "blocks"
> &
  Partial<Pick<ResearchArtifact, "blocks_json" | "source_json">>;

export type ArtifactEvidenceTone = "strong" | "medium" | "limited";

export interface ArtifactEvidenceStatus {
  label: string;
  detail: string;
  tone: ArtifactEvidenceTone;
}

const ARTIFACT_TYPE_LABELS: Record<ResearchArtifactEnvelope["artifact_type"], string> = {
  company_overview: "회사 개요",
  financial_snapshot: "재무 스냅샷",
  scenario_impact: "시나리오 영향",
  market_report_impact: "시장 리포트 영향",
  risk_review: "리스크 리뷰",
  filing_timeline: "공시 타임라인",
  comparison: "비교 분석",
  evidence_path: "근거 경로",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  direct: "직접 근거",
  indirect: "간접 근거",
  inferred: "추론",
  unsupported: "근거 부족",
};

const DIRECTION_LABELS: Record<string, string> = {
  positive: "긍정",
  negative: "부정",
  mixed: "혼재",
  uncertain: "불확실",
  neutral: "중립",
};

const RISK_KIND_LABELS: Record<string, string> = {
  risk: "리스크",
  driver: "동력",
  headwind: "역풍",
  offset: "상쇄 요인",
  watch_item: "관찰 항목",
};

const SEVERITY_LABELS: Record<string, string> = {
  high: "높음",
  medium: "중간",
  low: "낮음",
  unknown: "미확인",
  info: "참고",
  warning: "주의",
  critical: "중요",
};

export function getArtifactBlocks(
  artifact: Pick<ResearchArtifactEnvelope, "blocks"> &
    Partial<Pick<ResearchArtifact, "blocks_json">>,
): ResearchArtifactBlock[] {
  return artifact.blocks.length > 0 ? artifact.blocks : (artifact.blocks_json ?? []);
}

export function getArtifactTypeLabel(
  type: ResearchArtifactEnvelope["artifact_type"] | string,
): string {
  return ARTIFACT_TYPE_LABELS[type as ResearchArtifactEnvelope["artifact_type"]] ?? type.replace(/_/g, " ");
}

export function getConfidenceLabel(value: string): string {
  return CONFIDENCE_LABELS[value] ?? value;
}

export function getDirectionLabel(value: string): string {
  return DIRECTION_LABELS[value] ?? value;
}

export function getRiskKindLabel(value: string): string {
  return RISK_KIND_LABELS[value] ?? value;
}

export function getSeverityLabel(value: string): string {
  return SEVERITY_LABELS[value] ?? value;
}

export function getArtifactEvidenceStatus(
  artifact: ArtifactForPresentation,
): ArtifactEvidenceStatus {
  const blocks = getArtifactBlocks(artifact);
  const evidenceRefCount =
    (artifact.evidence_refs?.length ?? 0) +
    blocks.reduce((count, block) => count + countBlockEvidenceRefs(block), 0);
  const hasToolEvidence = hasStoredToolEvidence(artifact.source_json);
  const warningCount = artifact.quality?.warnings.length ?? 0;

  if (evidenceRefCount > 0 && artifact.quality?.overall === "high" && warningCount === 0) {
    return {
      label: "근거 충분",
      detail: "연결된 citation과 품질 경고를 기준으로 표시합니다.",
      tone: "strong",
    };
  }

  if (evidenceRefCount > 0 || hasToolEvidence) {
    return {
      label: warningCount > 0 ? "근거 확인" : "근거 보통",
      detail:
        warningCount > 0
          ? "근거는 있지만 품질 경고가 있어 확인이 필요합니다."
          : "저장된 tool evidence를 기준으로 구성했습니다.",
      tone: warningCount > 0 ? "limited" : "medium",
    };
  }

  return {
    label: "근거 제한",
    detail: "연결된 citation이나 tool evidence가 부족합니다.",
    tone: "limited",
  };
}

function countBlockEvidenceRefs(block: ResearchArtifactBlock): number {
  const ownRefs = block.evidence_refs?.length ?? 0;

  switch (block.type) {
    case "markdown":
      return ownRefs;
    case "metric_grid":
      return ownRefs + block.metrics.reduce((count, metric) => count + (metric.evidence_refs?.length ?? 0), 0);
    case "period_delta":
      return ownRefs + block.changes.reduce((count, change) => count + (change.evidence_refs?.length ?? 0), 0);
    case "business_segments":
      return ownRefs + block.segments.reduce((count, segment) => count + (segment.evidence_refs?.length ?? 0), 0);
    case "premise_card":
      return ownRefs + block.premises.reduce((count, premise) => count + (premise.evidence_refs?.length ?? 0), 0);
    case "impact_channels":
      return ownRefs + block.channels.reduce((count, channel) => count + (channel.evidence_refs?.length ?? 0), 0);
    case "risk_driver_map":
      return ownRefs + block.items.reduce((count, item) => count + (item.evidence_refs?.length ?? 0), 0);
    case "timeline":
      return ownRefs + block.events.reduce((count, event) => count + (event.evidence_refs?.length ?? 0), 0);
    case "comparison_table":
      return ownRefs + block.rows.reduce((count, row) => count + (row.evidence_refs?.length ?? 0), 0);
    case "evidence_chain":
      return ownRefs + block.chains.reduce((count, chain) => count + (chain.evidence_refs?.length ?? 0), 0);
    case "caveat_list":
      return ownRefs + block.items.reduce((count, item) => count + (item.evidence_refs?.length ?? 0), 0);
    case "glossary":
      return ownRefs;
  }
}

function hasStoredToolEvidence(sourceJson: unknown): boolean {
  if (!sourceJson || typeof sourceJson !== "object" || Array.isArray(sourceJson)) {
    return false;
  }

  const toolCalls = (sourceJson as Record<string, unknown>).tool_calls;
  return Array.isArray(toolCalls)
    ? toolCalls.some((toolCall) => {
        if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
          return false;
        }
        const record = toolCall as Record<string, unknown>;
        return record.has_result_json === true || record.has_result_text === true;
      })
    : false;
}
