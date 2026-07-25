import "server-only";

import {
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { AccumulatedRun } from "@/lib/agent/stream-handler";
import type { VisualizationIntent, VisualizationToolResult } from "./contracts";
import { compileVisualization } from "./compiler";
import { VisualizationDatasetRegistry } from "./dataset-registry";

export const VISUALIZATION_MCP_SERVER_NAME = "krw_presentation";
export const COMPOSE_VISUALIZATION_TOOL_NAME = "compose_visualization";
export const COMPOSE_VISUALIZATION_SDK_TOOL_NAME =
  `mcp__${VISUALIZATION_MCP_SERVER_NAME}__${COMPOSE_VISUALIZATION_TOOL_NAME}`;

const MAX_VISUALIZATIONS_PER_ANSWER = 3;

const boundedString = (max: number) => z.string().max(max);

/**
 * The model submits semantic intent only. The runtime reads the current run's
 * verified datasets and compiles values, units, evidence, and renderer spec.
 */
export function createVisualizationMcpServer(acc: AccumulatedRun) {
  let visualizationCount = 0;
  const seenFingerprints = new Set<string>();

  return createSdkMcpServer({
    name: VISUALIZATION_MCP_SERVER_NAME,
    version: "2.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        COMPOSE_VISUALIZATION_TOOL_NAME,
        [
          "Create a verified inline visualization from data already retrieved during this KRW run.",
          "Give only semantic intent in ordinary Korean or English: the analytical goal, metric names, whether to use the company total or a breakdown, optional group/scope filters, and optional Korean display text. All number values, source ids, units, calculations, chart selection, and placement are runtime-owned.",
          "Never provide raw chart values, an ECharts/Nivo/Vega spec, evidence ids, or a Markdown insert token.",
          "The display title and series label hints are editorial only and must be short. The runtime validates them against selected verified series. A skipped or duplicate result is normal; continue the answer without retrying the same visualization.",
        ].join(" "),
        {
          // All fields are optional and normalized in the handler. This avoids
          // wasting a low-capability model turn on a formatting-only retry.
          goal: boundedString(300).optional(),
          measures: z.union([boundedString(160), z.array(boundedString(160)).max(8)]).optional(),
          time_scope: boundedString(120).optional(),
          relationship: boundedString(32).optional(),
          scope_mode: boundedString(32).optional(),
          group_by: boundedString(120).optional(),
          include_scopes: z.array(boundedString(160)).max(8).optional(),
          exclude_scopes: z.array(boundedString(160)).max(8).optional(),
          transform_hints: z.array(boundedString(32)).max(4).optional(),
          event_overlay: z.array(boundedString(32)).max(4).optional(),
          preferred_form: boundedString(32).optional(),
          title_hint: boundedString(120).optional(),
          metric_label_hint: boundedString(60).optional(),
          group_label_hint: boundedString(60).optional(),
          series_label_hints: z.array(z.unknown()).max(8).optional(),
        },
        async (args) => {
          if (visualizationCount >= MAX_VISUALIZATIONS_PER_ANSWER) {
            return success({
              kind: "compose_visualization_result",
              status: "skipped",
              reason_code: "visualization_limit",
              explanation: `한 답변에는 최대 ${MAX_VISUALIZATIONS_PER_ANSWER}개의 시각화만 표시합니다.`,
              warnings: [],
            });
          }

          // Build at call time, after preceding MCP results have reached acc.
          const registry = VisualizationDatasetRegistry.fromAccumulatedRun(acc);
          const result = compileVisualization({
            intent: normalizeToolIntent(args),
            registry,
            artifactIndex: visualizationCount + 1,
          });
          if (result.artifact && seenFingerprints.has(result.artifact.semantic_fingerprint)) {
            return success({
              kind: "compose_visualization_result",
              status: "skipped",
              reason_code: "duplicate_visualization",
              explanation: "같은 검증 데이터와 분석 목적의 시각화가 이미 만들어졌습니다.",
              warnings: [],
            });
          }
          if (result.artifact) {
            seenFingerprints.add(result.artifact.semantic_fingerprint);
            visualizationCount += 1;
          }
          return success(result);
        },
        { alwaysLoad: true },
      ),
    ],
  });
}

function normalizeToolIntent(args: Record<string, unknown>): VisualizationIntent {
  const measures = typeof args.measures === "string"
    ? [args.measures]
    : Array.isArray(args.measures)
      ? args.measures.filter((value): value is string => typeof value === "string")
      : undefined;
  const strings = (value: unknown): string[] | undefined => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
  const labels = Array.isArray(args.series_label_hints)
    ? args.series_label_hints.flatMap((value) => {
      if (!isRecord(value) || typeof value.source !== "string" || typeof value.label !== "string") {
        return [];
      }
      return [{ source: value.source, label: value.label }];
    })
    : undefined;
  return {
    goal: typeof args.goal === "string" ? args.goal : "",
    measures,
    time_scope: stringOrNull(args.time_scope),
    relationship: allowedRelationship(args.relationship),
    scope_mode: allowedScopeMode(args.scope_mode),
    group_by: stringOrNull(args.group_by),
    include_scopes: strings(args.include_scopes),
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

function stringOrNull(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : undefined;
}

function allowedRelationship(value: unknown): VisualizationIntent["relationship"] {
  return isOneOf(value, ["auto", "trend", "comparison", "composition", "relationship", "decomposition", "exact_values"])
    ? value
    : undefined;
}

function allowedScopeMode(value: unknown): VisualizationIntent["scope_mode"] {
  return isOneOf(value, ["auto", "total", "breakdown", "explicit"]) ? value : undefined;
}

function allowedTransform(value: string): NonNullable<VisualizationIntent["transform_hints"]>[number] | null {
  return isOneOf(value, ["identity", "yoy_percent", "qoq_percent", "index_to_100", "share_of_total", "cumulative"])
    ? value
    : null;
}

function allowedOverlay(value: string): NonNullable<VisualizationIntent["event_overlay"]>[number] | null {
  return isOneOf(value, ["8-K", "6-K", "filing", "news"]) ? value : null;
}

function allowedViewType(value: unknown): VisualizationIntent["preferred_form"] {
  return isOneOf(value, ["auto", "line", "area", "bar", "stacked_bar", "stacked_100", "scatter", "waterfall", "table"])
    ? value
    : undefined;
}

function isOneOf<const T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function success(result: VisualizationToolResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

export const __test__ = {
  compileVisualization,
};
