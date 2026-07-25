/**
 * The visualization contract deliberately describes intent and verified output,
 * not renderer-specific instructions.  It is shared by the agent runtime,
 * persistence layer, and React UI.
 */

export const KRW_VISUALIZATION_ARTIFACT_FORMAT = "krw-visualization" as const;
// This is a single breaking cutover. Readers intentionally accept only this
// artifact shape; old chart-token and v1 artifact paths are not retained.
export const KRW_VISUALIZATION_SCHEMA_VERSION = 3 as const;

export const VISUALIZATION_VIEW_TYPES = [
  "line",
  "area",
  "bar",
  "stacked_bar",
  "stacked_100",
  "pie",
  "donut",
  "scatter",
  "heatmap",
  "waterfall",
  "table",
] as const;

const VISUALIZATION_VIEW_TYPE_SET = new Set<VisualizationViewType>(
  VISUALIZATION_VIEW_TYPES,
);

export type VisualizationRelationship =
  | "auto"
  | "trend"
  | "comparison"
  | "composition"
  | "composition_snapshot"
  | "relationship"
  | "decomposition"
  | "bridge"
  | "matrix"
  | "exact_values";

export type VisualizationTransform =
  | "identity"
  | "yoy_percent"
  | "qoq_percent"
  | "index_to_100"
  | "share_of_total"
  | "cumulative";

export type VisualizationViewType = (typeof VISUALIZATION_VIEW_TYPES)[number];

export type VisualizationSourceKind = "ontology" | "filing" | "news" | "derived";

export type VisualizationScopeMode = "auto" | "total" | "breakdown" | "explicit";

export interface VisualizationScope {
  /** e.g. company_total, geography, segment, product, or a future ontology dimension. */
  kind: string;
  /** Stable source-owned identifier. Never derive this by parsing a series key. */
  key: string;
  /** Source-owned display text used only as a safe fallback. */
  label?: string | null;
}

export interface VisualizationSeriesLabelHint {
  /** A selected source scope key or source label; never a renderer key. */
  source: string;
  /** Presentation-only text. It cannot alter values or source selection. */
  label: string;
}

/**
 * This is the intentionally small, forgiving payload the model may submit.
 * Numeric values, evidence ids, units, and renderer specs are runtime-owned.
 */
export interface VisualizationIntent {
  goal: string;
  measures?: string[];
  time_scope?: string | null;
  relationship?: VisualizationRelationship;
  scope_mode?: VisualizationScopeMode;
  group_by?: string | null;
  include_scopes?: string[];
  exclude_scopes?: string[];
  transform_hints?: VisualizationTransform[];
  event_overlay?: Array<"8-K" | "6-K" | "filing" | "news">;
  preferred_form?: "auto" | VisualizationViewType;
  title_hint?: string | null;
  metric_label_hint?: string | null;
  group_label_hint?: string | null;
  series_label_hints?: VisualizationSeriesLabelHint[];
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
  /** Final renderer-safe display label. */
  label: string;
  /** Original ontology label retained for provenance and semantic dedupe. */
  source_label?: string | null;
  ticker?: string | null;
  metric_name?: string | null;
  canonical_metric?: string | null;
  unit?: string | null;
  currency?: string | null;
  period_type?: string | null;
  duration?: string | null;
  scope: VisualizationScope;
  points: VisualizationPoint[];
}

/**
 * The underlying verified series are kept on every view for provenance and
 * the accessible data table. A dataset only contains a deterministic display
 * projection of those values; it never introduces model-authored numbers.
 */
export interface VisualizationSeriesDataset {
  kind: "series";
}

export interface VisualizationCompositionSlice {
  id: string;
  label: string;
  value: number;
  formatted_value?: string | null;
  evidence_refs: string[];
}

export interface VisualizationCompositionDataset {
  kind: "composition";
  period: string;
  slices: VisualizationCompositionSlice[];
}

export interface VisualizationXYPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  x_formatted_value?: string | null;
  y_formatted_value?: string | null;
  evidence_refs: string[];
}

export interface VisualizationXYDataset {
  kind: "xy";
  x_label: string;
  y_label: string;
  x_unit?: string | null;
  y_unit?: string | null;
  points: VisualizationXYPoint[];
}

export interface VisualizationMatrixCell {
  column: string;
  value: number;
  formatted_value?: string | null;
  evidence_refs: string[];
}

export interface VisualizationMatrixRow {
  id: string;
  label: string;
  cells: VisualizationMatrixCell[];
}

export interface VisualizationMatrixDataset {
  kind: "matrix";
  columns: string[];
  rows: VisualizationMatrixRow[];
}

export interface VisualizationBridgeStep {
  id: string;
  label: string;
  kind: "start" | "increase" | "decrease" | "end";
  /** Absolute value for start/end bars. */
  value?: number;
  /** Signed increment for intermediate bars. */
  delta?: number;
  formatted_value?: string | null;
  evidence_refs: string[];
}

export interface VisualizationBridgeDataset {
  kind: "bridge";
  steps: VisualizationBridgeStep[];
}

export type VisualizationDataset =
  | VisualizationSeriesDataset
  | VisualizationCompositionDataset
  | VisualizationXYDataset
  | VisualizationMatrixDataset
  | VisualizationBridgeDataset;

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
  /** Source-owned, verified numerical observations used by this view. */
  series: VisualizationSeries[];
  /** Renderer-facing projection deterministically compiled from `series`. */
  dataset: VisualizationDataset;
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
  /** Stable selected-data identity, independent of title wording or call order. */
  semantic_fingerprint: string;
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
    typeof value.semantic_fingerprint === "string" &&
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
    VISUALIZATION_VIEW_TYPE_SET.has(value.chart_type as VisualizationViewType) &&
    Array.isArray(value.series) &&
    value.series.every(isVisualizationSeries) &&
    isVisualizationDataset(value.dataset, value.chart_type as VisualizationViewType) &&
    (value.events === undefined ||
      (Array.isArray(value.events) && value.events.every(isVisualizationEvent)))
  );
}

function isVisualizationDataset(value: unknown, chartType: VisualizationViewType): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "series") {
    return ["line", "area", "bar", "stacked_bar", "stacked_100", "table"].includes(chartType);
  }
  if (value.kind === "composition") {
    return (
      (chartType === "pie" || chartType === "donut") &&
      typeof value.period === "string" &&
      Array.isArray(value.slices) &&
      value.slices.every(isCompositionSlice)
    );
  }
  if (value.kind === "xy") {
    return (
      chartType === "scatter" &&
      typeof value.x_label === "string" &&
      typeof value.y_label === "string" &&
      (value.x_unit === undefined || value.x_unit === null || typeof value.x_unit === "string") &&
      (value.y_unit === undefined || value.y_unit === null || typeof value.y_unit === "string") &&
      Array.isArray(value.points) &&
      value.points.every(isXYPoint)
    );
  }
  if (value.kind === "matrix") {
    return (
      chartType === "heatmap" &&
      isStringArray(value.columns) &&
      Array.isArray(value.rows) &&
      value.rows.every(isMatrixRow)
    );
  }
  if (value.kind === "bridge") {
    return (
      chartType === "waterfall" &&
      Array.isArray(value.steps) &&
      value.steps.every(isBridgeStep)
    );
  }
  return false;
}

function isCompositionSlice(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    isFiniteNumber(value.value) &&
    (value.formatted_value === undefined || value.formatted_value === null || typeof value.formatted_value === "string") &&
    isStringArray(value.evidence_refs)
  );
}

function isXYPoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    (value.x_formatted_value === undefined || value.x_formatted_value === null || typeof value.x_formatted_value === "string") &&
    (value.y_formatted_value === undefined || value.y_formatted_value === null || typeof value.y_formatted_value === "string") &&
    isStringArray(value.evidence_refs)
  );
}

function isMatrixRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    Array.isArray(value.cells) &&
    value.cells.every(isMatrixCell)
  );
}

function isMatrixCell(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.column === "string" &&
    isFiniteNumber(value.value) &&
    (value.formatted_value === undefined || value.formatted_value === null || typeof value.formatted_value === "string") &&
    isStringArray(value.evidence_refs)
  );
}

function isBridgeStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  const isEndpoint = kind === "start" || kind === "end";
  const isDelta = kind === "increase" || kind === "decrease";
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (isEndpoint || isDelta) &&
    (!isEndpoint || isFiniteNumber(value.value)) &&
    (!isDelta || isFiniteNumber(value.delta)) &&
    (value.formatted_value === undefined || value.formatted_value === null || typeof value.formatted_value === "string") &&
    isStringArray(value.evidence_refs)
  );
}

function isVisualizationSeries(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.series_key === "string" &&
    typeof value.label === "string" &&
    isVisualizationScope(value.scope) &&
    Array.isArray(value.points) &&
    value.points.every(isVisualizationPoint)
  );
}

function isVisualizationScope(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.key === "string" &&
    (value.label === undefined || value.label === null || typeof value.label === "string")
  );
}

function isVisualizationPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.period === "string" &&
    isFiniteNumber(value.value) &&
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
