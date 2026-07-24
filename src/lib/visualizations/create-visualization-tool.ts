import "server-only";

import {
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { AccumulatedRun } from "@/lib/agent/stream-handler";
import type {
  VisualizationIntent,
  VisualizationToolResult,
} from "./contracts";
import { compileVisualization } from "./compiler";
import { VisualizationDatasetRegistry } from "./dataset-registry";

export const VISUALIZATION_MCP_SERVER_NAME = "krw_presentation";
export const COMPOSE_VISUALIZATION_TOOL_NAME = "compose_visualization";
export const COMPOSE_VISUALIZATION_SDK_TOOL_NAME =
  `mcp__${VISUALIZATION_MCP_SERVER_NAME}__${COMPOSE_VISUALIZATION_TOOL_NAME}`;

const MAX_VISUALIZATIONS_PER_ANSWER = 3;

const relationshipSchema = z.enum([
  "auto",
  "trend",
  "comparison",
  "composition",
  "relationship",
  "decomposition",
  "exact_values",
]);
const transformSchema = z.enum([
  "identity",
  "yoy_percent",
  "qoq_percent",
  "index_to_100",
  "share_of_total",
  "cumulative",
]);
const viewTypeSchema = z.enum([
  "line",
  "area",
  "bar",
  "stacked_bar",
  "stacked_100",
  "scatter",
  "waterfall",
  "table",
]);

/**
 * The model submits semantic intent only. The runtime reads the current run's
 * verified datasets and compiles values, units, evidence, and renderer spec.
 */
export function createVisualizationMcpServer(acc: AccumulatedRun) {
  let visualizationCount = 0;

  return createSdkMcpServer({
    name: VISUALIZATION_MCP_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        COMPOSE_VISUALIZATION_TOOL_NAME,
        [
          "Create a verified inline visualization from data already retrieved during this KRW run.",
          "Give the analytical goal and metric names in ordinary Korean or English. All number values, source ids, units, calculations, chart selection, and placement are runtime-owned.",
          "Never provide raw chart values, an ECharts/Nivo/Vega spec, evidence ids, or a Markdown insert token.",
          "The tool returns created, partial, or skipped. A skipped result is normal when data is ambiguous or insufficient; continue the answer without retrying the same visualization.",
        ].join(" "),
        {
          goal: z.string().min(1).max(300),
          measures: z.array(z.string().min(1).max(160)).max(8).optional(),
          time_scope: z
            .string()
            .max(120)
            .describe("Optional concrete period such as '최근 5년', 'last 8 quarters', or '2021–2025'.")
            .optional(),
          relationship: relationshipSchema.optional(),
          transform_hints: z.array(transformSchema).max(4).optional(),
          event_overlay: z.array(z.enum(["8-K", "6-K", "filing", "news"])).max(4).optional(),
          preferred_form: z.union([z.literal("auto"), viewTypeSchema]).optional(),
          title_hint: z.string().max(120).optional(),
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
            intent: args as VisualizationIntent,
            registry,
            artifactIndex: visualizationCount + 1,
          });
          if (result.status !== "skipped") visualizationCount += 1;
          return success(result);
        },
        { alwaysLoad: true },
      ),
    ],
  });
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
