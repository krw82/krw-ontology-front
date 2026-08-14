import "server-only";
import type { VisualizationIntent } from "./contracts";

/**
 * Visualization composition is owned by krw-agent. The web app only keeps
 * the stable public tool name for reading already-persisted artifacts; it no
 * longer constructs an Anthropic SDK MCP server in-process.
 */
export const VISUALIZATION_MCP_SERVER_NAME = "krw_presentation";
export const COMPOSE_VISUALIZATION_TOOL_NAME = "compose_visualization";
export const COMPOSE_VISUALIZATION_SDK_TOOL_NAME =
  `mcp__${VISUALIZATION_MCP_SERVER_NAME}__${COMPOSE_VISUALIZATION_TOOL_NAME}`;

export function createVisualizationMcpServer(): never {
  throw new Error("visualization_composition_owned_by_krw_agent");
}

export function normalizeVisualizationToolIntent(
  args: Record<string, unknown>,
): VisualizationIntent {
  const measures = typeof args.measures === "string"
    ? [args.measures]
    : Array.isArray(args.measures)
      ? args.measures.filter((value): value is string => typeof value === "string")
      : undefined;
  const strings = (value: unknown): string[] | undefined => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
  const includeScopes = strings(args.include_scopes);
  const labels = normalizeSeriesLabelHints(args.series_label_hints, includeScopes);
  return {
    goal: typeof args.goal === "string" ? args.goal : "",
    measures,
    time_scope: stringOrNull(args.time_scope),
    relationship: allowedRelationship(args.relationship),
    scope_mode: allowedScopeMode(args.scope_mode),
    group_by: stringOrNull(args.group_by),
    include_scopes: includeScopes,
    exclude_scopes: strings(args.exclude_scopes),
    transform_hints: strings(args.transform_hints)?.flatMap((value) => {
      const transform = allowedTransform(value);
      return transform ? [transform] : [];
    }),
    event_overlay: strings(args.event_overlay)?.flatMap((value) => {
      const overlay = allowedOverlay(value);
      return overlay ? [overlay] : [];
    }),
    preferred_form: allowedViewType(args.preferred_form),
    title_hint: stringOrNull(args.title_hint),
    metric_label_hint: stringOrNull(args.metric_label_hint),
    group_label_hint: stringOrNull(args.group_label_hint),
    series_label_hints: labels,
  };
}

function normalizeSeriesLabelHints(
  value: unknown,
  includeScopes: string[] | undefined,
): VisualizationIntent["series_label_hints"] {
  if (!Array.isArray(value)) return undefined;
  const objectHints = value.flatMap((item) => {
    if (!isRecord(item) || typeof item.source !== "string" || typeof item.label !== "string") return [];
    return [{ source: item.source, label: item.label }];
  });
  if (objectHints.length > 0) return objectHints;
  const bareLabels = value.filter((item): item is string => typeof item === "string");
  if (bareLabels.length !== value.length || !includeScopes || includeScopes.length !== bareLabels.length) return undefined;
  return bareLabels.map((label, index) => ({ source: includeScopes[index]!, label }));
}

function stringOrNull(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : undefined;
}

function allowedRelationship(value: unknown): VisualizationIntent["relationship"] {
  return isOneOf(value, ["auto", "trend", "comparison", "composition", "composition_snapshot", "relationship", "decomposition", "bridge", "matrix", "exact_values"]) ? value : undefined;
}

function allowedScopeMode(value: unknown): VisualizationIntent["scope_mode"] {
  return isOneOf(value, ["auto", "total", "breakdown", "explicit"]) ? value : undefined;
}

function allowedTransform(value: string): NonNullable<VisualizationIntent["transform_hints"]>[number] | null {
  return isOneOf(value, ["identity", "yoy_percent", "qoq_percent", "index_to_100", "share_of_total", "cumulative"]) ? value : null;
}

function allowedOverlay(value: string): NonNullable<VisualizationIntent["event_overlay"]>[number] | null {
  return isOneOf(value, ["8-K", "6-K", "filing", "news"]) ? value : null;
}

function allowedViewType(value: unknown): VisualizationIntent["preferred_form"] {
  return isOneOf(value, ["auto", "line", "bar", "stacked_bar", "stacked_100", "area", "scatter", "heatmap", "waterfall", "donut", "pie", "table"]) ? value : undefined;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
