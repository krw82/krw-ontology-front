/**
 * The visualization contract deliberately describes intent and verified output,
 * not renderer-specific instructions.  It is shared by the agent runtime,
 * persistence layer, and React UI.
 */

export const KRW_VISUALIZATION_ARTIFACT_FORMAT = "krw-visualization" as const;
// This is a single breaking cutover. Readers intentionally accept only this
// artifact shape; old chart-token and v1 artifact paths are not retained.
export const KRW_VISUALIZATION_SCHEMA_VERSION = 4 as const;

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

const MAX_ARTIFACT_VIEWS = 4;
const MAX_SERIES_PER_VIEW = 8;
const MAX_POINTS_PER_SERIES = 12;
const MAX_EVIDENCE_REFS = 128;
const MAX_LABEL_LENGTH = 512;
const MAX_FORMATTED_VALUE_LENGTH = 256;
const MAX_EVENT_COUNT = 16;

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
  dimension?: string | null;
  composition_eligible?: boolean;
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
  period_basis?: "FY" | "CY" | string | null;
  period_sort_key?: number | null;
  fiscal_year?: number | null;
  fiscal_quarter?: number | null;
  period_start?: string | null;
  period_end?: string | null;
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
  if ("html" in value || "markup" in value || "svg" in value || "jsx" in value) {
    return false;
  }
  return (
    value.artifact_format === KRW_VISUALIZATION_ARTIFACT_FORMAT &&
    value.schema_version === KRW_VISUALIZATION_SCHEMA_VERSION &&
    isBoundedString(value.artifact_ref, 128) &&
    isBoundedString(value.semantic_fingerprint, 128) &&
    isVisualizationIntent(value.intent) &&
    isBoundedString(value.title, MAX_LABEL_LENGTH) &&
    Array.isArray(value.views) &&
    value.views.length > 0 &&
    value.views.length <= MAX_ARTIFACT_VIEWS &&
    value.views.every(isVisualizationView) &&
    isVisualizationProvenance(value.provenance) &&
    isVisualizationQuality(value.quality)
  );
}

function isVisualizationView(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.view_id, 128) &&
    isBoundedString(value.title, MAX_LABEL_LENGTH) &&
    typeof value.chart_type === "string" &&
    VISUALIZATION_VIEW_TYPE_SET.has(value.chart_type as VisualizationViewType) &&
    Array.isArray(value.series) &&
    value.series.length > 0 &&
    value.series.length <= MAX_SERIES_PER_VIEW &&
    value.series.every(isVisualizationSeries) &&
    isVisualizationDataset(value.dataset, value.chart_type as VisualizationViewType) &&
    (value.subtitle === undefined || value.subtitle === null || isBoundedString(value.subtitle, MAX_LABEL_LENGTH)) &&
    (value.unit === undefined || value.unit === null || isBoundedString(value.unit, 128)) &&
    (value.events === undefined ||
      (Array.isArray(value.events) &&
        value.events.length <= MAX_EVENT_COUNT &&
        value.events.every(isVisualizationEvent)))
  );
}

function isVisualizationIntent(value: unknown): value is VisualizationIntent & Record<string, unknown> {
  if (!isRecord(value) || !isBoundedString(value.goal, MAX_LABEL_LENGTH)) return false;
  const relationships = [
    "auto",
    "trend",
    "comparison",
    "composition",
    "composition_snapshot",
    "relationship",
    "decomposition",
    "bridge",
    "matrix",
    "exact_values",
  ];
  return (
    (value.measures === undefined || isStringArray(value.measures, 16, 128)) &&
    (value.time_scope === undefined || value.time_scope === null || isBoundedString(value.time_scope, 128)) &&
    (value.relationship === undefined || relationships.includes(String(value.relationship))) &&
    (value.scope_mode === undefined || ["auto", "total", "breakdown", "explicit"].includes(String(value.scope_mode))) &&
    (value.group_by === undefined || value.group_by === null || isBoundedString(value.group_by, 128)) &&
    (value.include_scopes === undefined || isStringArray(value.include_scopes, 32, 256)) &&
    (value.exclude_scopes === undefined || isStringArray(value.exclude_scopes, 32, 256)) &&
    (value.transform_hints === undefined || isStringArray(value.transform_hints, 8, 64)) &&
    (value.event_overlay === undefined || isStringArray(value.event_overlay, 8, 32)) &&
    (value.preferred_form === undefined || isBoundedString(value.preferred_form, 32)) &&
    (value.title_hint === undefined || value.title_hint === null || isBoundedString(value.title_hint, MAX_LABEL_LENGTH)) &&
    (value.metric_label_hint === undefined || value.metric_label_hint === null || isBoundedString(value.metric_label_hint, MAX_LABEL_LENGTH)) &&
    (value.group_label_hint === undefined || value.group_label_hint === null || isBoundedString(value.group_label_hint, MAX_LABEL_LENGTH)) &&
    (value.series_label_hints === undefined || (
      Array.isArray(value.series_label_hints) &&
      value.series_label_hints.length <= MAX_SERIES_PER_VIEW &&
      value.series_label_hints.every((hint) =>
        isRecord(hint) &&
        isBoundedString(hint.source, 256) &&
        isBoundedString(hint.label, MAX_LABEL_LENGTH),
      )
    ))
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
      isBoundedString(value.period, 128) &&
      Array.isArray(value.slices) &&
      value.slices.length > 0 &&
      value.slices.length <= MAX_SERIES_PER_VIEW &&
      value.slices.every(isCompositionSlice)
    );
  }
  if (value.kind === "xy") {
    return (
      chartType === "scatter" &&
      isBoundedString(value.x_label, MAX_LABEL_LENGTH) &&
      isBoundedString(value.y_label, MAX_LABEL_LENGTH) &&
      (value.x_unit === undefined || value.x_unit === null || isBoundedString(value.x_unit, 128)) &&
      (value.y_unit === undefined || value.y_unit === null || isBoundedString(value.y_unit, 128)) &&
      Array.isArray(value.points) &&
      value.points.length > 0 &&
      value.points.length <= MAX_SERIES_PER_VIEW * MAX_POINTS_PER_SERIES &&
      value.points.every(isXYPoint)
    );
  }
  if (value.kind === "matrix") {
    return (
      chartType === "heatmap" &&
      isStringArray(value.columns, MAX_SERIES_PER_VIEW, MAX_LABEL_LENGTH) &&
      Array.isArray(value.rows) &&
      value.rows.length > 0 &&
      value.rows.length <= MAX_SERIES_PER_VIEW &&
      value.rows.every(isMatrixRow)
    );
  }
  if (value.kind === "bridge") {
    return (
      chartType === "waterfall" &&
      Array.isArray(value.steps) &&
      value.steps.length > 0 &&
      value.steps.length <= MAX_SERIES_PER_VIEW * MAX_POINTS_PER_SERIES &&
      value.steps.every(isBridgeStep)
    );
  }
  return false;
}

function isCompositionSlice(value: unknown): boolean {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 128) &&
    isBoundedString(value.label, MAX_LABEL_LENGTH) &&
    isFiniteNumber(value.value) &&
    (value.formatted_value === undefined || value.formatted_value === null || isBoundedString(value.formatted_value, MAX_FORMATTED_VALUE_LENGTH)) &&
    isStringArray(value.evidence_refs, MAX_EVIDENCE_REFS, 128)
  );
}

function isXYPoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 128) &&
    isBoundedString(value.label, MAX_LABEL_LENGTH) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    (value.x_formatted_value === undefined || value.x_formatted_value === null || isBoundedString(value.x_formatted_value, MAX_FORMATTED_VALUE_LENGTH)) &&
    (value.y_formatted_value === undefined || value.y_formatted_value === null || isBoundedString(value.y_formatted_value, MAX_FORMATTED_VALUE_LENGTH)) &&
    isStringArray(value.evidence_refs, MAX_EVIDENCE_REFS, 128)
  );
}

function isMatrixRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 128) &&
    isBoundedString(value.label, MAX_LABEL_LENGTH) &&
    Array.isArray(value.cells) &&
    value.cells.length > 0 &&
    value.cells.length <= MAX_POINTS_PER_SERIES &&
    value.cells.every(isMatrixCell)
  );
}

function isMatrixCell(value: unknown): boolean {
  return (
    isRecord(value) &&
    isBoundedString(value.column, MAX_LABEL_LENGTH) &&
    isFiniteNumber(value.value) &&
    (value.formatted_value === undefined || value.formatted_value === null || isBoundedString(value.formatted_value, MAX_FORMATTED_VALUE_LENGTH)) &&
    isStringArray(value.evidence_refs, MAX_EVIDENCE_REFS, 128)
  );
}

function isBridgeStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  const isEndpoint = kind === "start" || kind === "end";
  const isDelta = kind === "increase" || kind === "decrease";
  return (
    isBoundedString(value.id, 128) &&
    isBoundedString(value.label, MAX_LABEL_LENGTH) &&
    (isEndpoint || isDelta) &&
    (!isEndpoint || isFiniteNumber(value.value)) &&
    (!isDelta || isFiniteNumber(value.delta)) &&
    (value.formatted_value === undefined || value.formatted_value === null || isBoundedString(value.formatted_value, MAX_FORMATTED_VALUE_LENGTH)) &&
    isStringArray(value.evidence_refs, MAX_EVIDENCE_REFS, 128)
  );
}

function isVisualizationSeries(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.series_key, 256) &&
    isBoundedString(value.label, MAX_LABEL_LENGTH) &&
    (value.source_label === undefined || value.source_label === null || isBoundedString(value.source_label, MAX_LABEL_LENGTH)) &&
    (value.ticker === undefined || value.ticker === null || isBoundedString(value.ticker, 64)) &&
    (value.metric_name === undefined || value.metric_name === null || isBoundedString(value.metric_name, 128)) &&
    (value.canonical_metric === undefined || value.canonical_metric === null || isBoundedString(value.canonical_metric, 128)) &&
    (value.unit === undefined || value.unit === null || isBoundedString(value.unit, 128)) &&
    (value.currency === undefined || value.currency === null || isBoundedString(value.currency, 16)) &&
    (value.period_type === undefined || value.period_type === null || isBoundedString(value.period_type, 32)) &&
    (value.duration === undefined || value.duration === null || isBoundedString(value.duration, 32)) &&
    isVisualizationScope(value.scope) &&
    Array.isArray(value.points) &&
    value.points.length > 0 &&
    value.points.length <= MAX_POINTS_PER_SERIES &&
    value.points.every(isVisualizationPoint)
  );
}

function isVisualizationScope(value: unknown): boolean {
  return (
    isRecord(value) &&
    isBoundedString(value.kind, 128) &&
    isBoundedString(value.key, 256) &&
    (value.label === undefined || value.label === null || isBoundedString(value.label, MAX_LABEL_LENGTH)) &&
    (value.dimension === undefined || value.dimension === null || isBoundedString(value.dimension, 128)) &&
    (value.composition_eligible === undefined || typeof value.composition_eligible === "boolean")
  );
}

function isVisualizationPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.period, 128) &&
    (value.period_basis === undefined || value.period_basis === null || isBoundedString(value.period_basis, 32)) &&
    (value.period_sort_key === undefined || value.period_sort_key === null || isFiniteNumber(value.period_sort_key)) &&
    (value.fiscal_year === undefined || value.fiscal_year === null || Number.isInteger(value.fiscal_year)) &&
    (value.fiscal_quarter === undefined || value.fiscal_quarter === null || Number.isInteger(value.fiscal_quarter)) &&
    (value.period_start === undefined || value.period_start === null || isBoundedString(value.period_start, 64)) &&
    (value.period_end === undefined || value.period_end === null || isBoundedString(value.period_end, 64)) &&
    isFiniteNumber(value.value) &&
    isBoundedString(value.evidence_ref, 256) &&
    (value.formatted_value === undefined || value.formatted_value === null || isBoundedString(value.formatted_value, MAX_FORMATTED_VALUE_LENGTH)) &&
    (value.derived_from_evidence_refs === undefined ||
      isStringArray(value.derived_from_evidence_refs, MAX_EVIDENCE_REFS, 256))
  );
}

function isVisualizationEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.date, 64) &&
    isBoundedString(value.label, MAX_LABEL_LENGTH) &&
    (value.source_kind === "filing" || value.source_kind === "news") &&
    isBoundedString(value.evidence_ref, 256) &&
    (value.href === undefined || value.href === null || isBoundedString(value.href, 2048))
  );
}

function isVisualizationProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArray(value.source_tool_call_ids, MAX_EVIDENCE_REFS, 256) &&
    isStringArray(value.evidence_refs, MAX_EVIDENCE_REFS, 256) &&
    Array.isArray(value.source_kinds) &&
    value.source_kinds.length <= 8 &&
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
    isNonNegativeInteger(value.series_count) &&
    value.series_count <= MAX_ARTIFACT_VIEWS * MAX_SERIES_PER_VIEW &&
    isNonNegativeInteger(value.point_count) &&
    value.point_count <= MAX_ARTIFACT_VIEWS * MAX_SERIES_PER_VIEW * MAX_POINTS_PER_SERIES &&
    isStringArray(value.warnings, 16, MAX_LABEL_LENGTH)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(
  value: unknown,
  maxItems = MAX_EVIDENCE_REFS,
  maxLength = MAX_LABEL_LENGTH,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === "string" && item.length <= maxLength)
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
