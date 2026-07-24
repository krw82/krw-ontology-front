/**
 * The visualization contract deliberately describes intent and verified output,
 * not renderer-specific instructions.  It is shared by the agent runtime,
 * persistence layer, and React UI.
 */

export const KRW_VISUALIZATION_ARTIFACT_FORMAT = "krw-visualization" as const;
export const KRW_VISUALIZATION_SCHEMA_VERSION = 1 as const;

const VISUALIZATION_VIEW_TYPES = new Set<VisualizationViewType>([
  "line",
  "area",
  "bar",
  "stacked_bar",
  "stacked_100",
  "scatter",
  "waterfall",
  "table",
]);

export type VisualizationRelationship =
  | "auto"
  | "trend"
  | "comparison"
  | "composition"
  | "relationship"
  | "decomposition"
  | "exact_values";

export type VisualizationTransform =
  | "identity"
  | "yoy_percent"
  | "qoq_percent"
  | "index_to_100"
  | "share_of_total"
  | "cumulative";

export type VisualizationViewType =
  | "line"
  | "area"
  | "bar"
  | "stacked_bar"
  | "stacked_100"
  | "scatter"
  | "waterfall"
  | "table";

export type VisualizationSourceKind = "ontology" | "filing" | "news" | "derived";

/**
 * This is the intentionally small, forgiving payload the model may submit.
 * Numeric values, evidence ids, units, and renderer specs are runtime-owned.
 */
export interface VisualizationIntent {
  goal: string;
  measures?: string[];
  time_scope?: string | null;
  relationship?: VisualizationRelationship;
  transform_hints?: VisualizationTransform[];
  event_overlay?: Array<"8-K" | "6-K" | "filing" | "news">;
  preferred_form?: "auto" | VisualizationViewType;
  title_hint?: string | null;
}

export interface VisualizationPoint {
  period: string;
  value: number;
  formatted_value?: string | null;
  evidence_ref: string;
  /** Additional source observations used by a deterministic calculation. */
  derived_from_evidence_refs?: string[];
}

export interface VisualizationSeries {
  series_key: string;
  label: string;
  metric_name?: string | null;
  canonical_metric?: string | null;
  unit?: string | null;
  currency?: string | null;
  points: VisualizationPoint[];
}

export interface VisualizationEvent {
  date: string;
  label: string;
  source_kind: "filing" | "news";
  evidence_ref: string;
  href?: string | null;
}

export interface VisualizationView {
  view_id: string;
  chart_type: VisualizationViewType;
  title: string;
  subtitle?: string | null;
  unit?: string | null;
  series: VisualizationSeries[];
  events?: VisualizationEvent[];
}

export interface VisualizationProvenance {
  source_tool_call_ids: string[];
  evidence_refs: string[];
  source_kinds: VisualizationSourceKind[];
}

export interface VisualizationQuality {
  series_count: number;
  point_count: number;
  warnings: string[];
}

export interface KrwVisualizationArtifact {
  artifact_format: typeof KRW_VISUALIZATION_ARTIFACT_FORMAT;
  schema_version: typeof KRW_VISUALIZATION_SCHEMA_VERSION;
  artifact_ref: string;
  intent: VisualizationIntent;
  title: string;
  views: VisualizationView[];
  provenance: VisualizationProvenance;
  quality: VisualizationQuality;
}

export type VisualizationResultStatus = "created" | "partial" | "skipped";

export interface VisualizationToolResult {
  kind: "compose_visualization_result";
  status: VisualizationResultStatus;
  artifact_ref?: string;
  artifact?: KrwVisualizationArtifact;
  reason_code?: string;
  explanation?: string;
  warnings: string[];
}

export interface ChatMessageVisualization {
  readonly id: string;
  session_id: string;
  message_id: string;
  run_id: string;
  artifact_ref: string;
  payload_json: KrwVisualizationArtifact;
  readonly created_at: string;
}

export type PresentationBlock =
  | {
      id: string;
      type: "markdown";
      content: string;
    }
  | {
      id: string;
      type: "visualization";
      artifact_ref: string;
    };

export interface ChatMessagePresentation {
  message_id: string;
  session_id: string;
  run_id: string;
  blocks: PresentationBlock[];
  readonly created_at: string;
  readonly updated_at: string;
}

export function isKrwVisualizationArtifact(
  value: unknown,
): value is KrwVisualizationArtifact {
  if (!isRecord(value)) return false;
  return (
    value.artifact_format === KRW_VISUALIZATION_ARTIFACT_FORMAT &&
    value.schema_version === KRW_VISUALIZATION_SCHEMA_VERSION &&
    typeof value.artifact_ref === "string" &&
    isRecord(value.intent) &&
    typeof value.intent.goal === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.views) && value.views.every(isVisualizationView) &&
    isVisualizationProvenance(value.provenance) &&
    isVisualizationQuality(value.quality)
  );
}

function isVisualizationView(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.view_id === "string" &&
    typeof value.title === "string" &&
    typeof value.chart_type === "string" &&
    VISUALIZATION_VIEW_TYPES.has(value.chart_type as VisualizationViewType) &&
    Array.isArray(value.series) &&
    value.series.every(isVisualizationSeries) &&
    (value.events === undefined ||
      (Array.isArray(value.events) && value.events.every(isVisualizationEvent)))
  );
}

function isVisualizationSeries(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.series_key === "string" &&
    typeof value.label === "string" &&
    Array.isArray(value.points) &&
    value.points.every(isVisualizationPoint)
  );
}

function isVisualizationPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.period === "string" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    typeof value.evidence_ref === "string" &&
    (value.derived_from_evidence_refs === undefined ||
      isStringArray(value.derived_from_evidence_refs))
  );
}

function isVisualizationEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.date === "string" &&
    typeof value.label === "string" &&
    (value.source_kind === "filing" || value.source_kind === "news") &&
    typeof value.evidence_ref === "string"
  );
}

function isVisualizationProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArray(value.source_tool_call_ids) &&
    isStringArray(value.evidence_refs) &&
    Array.isArray(value.source_kinds) &&
    value.source_kinds.every(
      (sourceKind) =>
        sourceKind === "ontology" ||
        sourceKind === "filing" ||
        sourceKind === "news" ||
        sourceKind === "derived",
    )
  );
}

function isVisualizationQuality(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.series_count === "number" &&
    typeof value.point_count === "number" &&
    isStringArray(value.warnings)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
