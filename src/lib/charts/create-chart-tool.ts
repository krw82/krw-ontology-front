import "server-only";

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { AccumulatedRun, AccumulatedToolCall } from "@/lib/agent/stream-handler";
import type {
  KrwChartPointV1,
  KrwChartSeriesV1,
  KrwChartType,
  KrwChartV1,
} from "@/types/api-contracts";

export const CHART_MCP_SERVER_NAME = "krw_presentation";
export const CREATE_CHART_TOOL_NAME = "create_chart_v1";
export const CREATE_CHART_SDK_TOOL_NAME =
  `mcp__${CHART_MCP_SERVER_NAME}__${CREATE_CHART_TOOL_NAME}`;

const MAX_CHARTS_PER_ANSWER = 5;
const MAX_SERIES_PER_CHART = 4;
const MAX_POINTS_PER_CHART = 48;
const MAX_OVERFLOW_TOOL_RESULT_BYTES = 2_000_000;
const CHART_REF_PREFIX = "chart";
const TOOL_RESULT_FILE_PATTERN = /(\/[^\s"']+\/tool-results\/[^\s"']+?\.txt)\b/g;

type UnknownRecord = Record<string, unknown>;

interface MetricSeriesCandidate {
  sourceToolCallId: string;
  series_key: string;
  label: string;
  metric_name: string | null;
  unit: string | null;
  points: KrwChartPointV1[];
}

interface CreateChartToolOutput {
  kind: "create_chart_v1_result";
  chart_ref: string;
  insert_token: string;
  chart: KrwChartV1;
}

export type CreatedChartToolOutput = CreateChartToolOutput;

export function createChartMcpServer(acc: AccumulatedRun) {
  let chartCount = 0;

  return createSdkMcpServer({
    name: CHART_MCP_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        CREATE_CHART_TOOL_NAME,
        [
          "Create one inline chart from already retrieved KRW Ontology metric_series_pack data.",
          "Do not provide raw numeric values. Pass exact metric_series_pack.series[].series_key strings in series_refs.",
          "The tool validates values, periods, units, and evidence refs, then returns insert_token. Put insert_token exactly where the chart should appear in the final Markdown answer.",
        ].join(" "),
        {
          chart_type: z
            .enum(["line", "bar"])
            .describe("Use line for time series and bar for period/category comparison."),
          title: z.string().min(1).max(90),
          subtitle: z.string().max(140).optional(),
          series_refs: z
            .array(z.string().min(1).max(240))
            .min(1)
            .max(MAX_SERIES_PER_CHART)
            .describe("Exact series_key values from metric_series_pack.series[]."),
        },
        async (args) => {
          if (chartCount >= MAX_CHARTS_PER_ANSWER) {
            return toolError(
              `create_chart_v1 supports at most ${MAX_CHARTS_PER_ANSWER} charts per answer.`,
            );
          }

          const result = buildChartFromMetricSeries({
            acc,
            chartIndex: chartCount + 1,
            chartType: args.chart_type,
            title: args.title,
            subtitle: args.subtitle,
            seriesRefs: args.series_refs,
          });
          if (!result.ok) return toolError(result.message);

          chartCount += 1;
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.output) },
            ],
            structuredContent: result.output as unknown as Record<string, unknown>,
          };
        },
        {
          alwaysLoad: true,
        },
      ),
    ],
  });
}

function buildChartFromMetricSeries(params: {
  acc: AccumulatedRun;
  chartIndex: number;
  chartType: KrwChartType;
  title: string;
  subtitle?: string;
  seriesRefs: string[];
}): { ok: true; output: CreateChartToolOutput } | { ok: false; message: string } {
  const registry = collectMetricSeriesCandidates(params.acc.toolCalls);
  if (registry.size === 0) {
    return {
      ok: false,
      message:
        "No metric_series_pack is available yet. Retrieve KRW Ontology query_context data first.",
    };
  }

  const uniqueRefs = Array.from(new Set(params.seriesRefs.map((ref) => ref.trim())));
  const selected = uniqueRefs
    .map((ref) => registry.get(ref))
    .filter((series): series is MetricSeriesCandidate => Boolean(series));

  if (selected.length === 0) {
    return {
      ok: false,
      message:
        "None of the requested series_refs matched metric_series_pack.series[].series_key.",
    };
  }
  if (selected.length > MAX_SERIES_PER_CHART) {
    return {
      ok: false,
      message: `A chart can include at most ${MAX_SERIES_PER_CHART} series.`,
    };
  }

  const units = new Set(
    selected.map((series) => series.unit).filter((unit): unit is string => Boolean(unit)),
  );
  if (units.size > 1) {
    return {
      ok: false,
      message: "Requested series use different units. Create separate charts instead.",
    };
  }

  const warnings: string[] = [];
  const pointBudget = Math.max(1, Math.floor(MAX_POINTS_PER_CHART / selected.length));
  const chartSeries: KrwChartSeriesV1[] = selected.map((series) => {
    const points =
      series.points.length > pointBudget
        ? series.points.slice(-pointBudget)
        : series.points;
    if (points.length !== series.points.length) {
      warnings.push(
        `${series.label} was truncated to the latest ${pointBudget} points.`,
      );
    }
    return {
      series_key: series.series_key,
      label: series.label,
      metric_name: series.metric_name,
      unit: series.unit,
      points,
    };
  });

  const pointCount = chartSeries.reduce(
    (count, series) => count + series.points.length,
    0,
  );
  const minPoints = params.chartType === "line" ? 2 : 1;
  if (pointCount < minPoints) {
    return {
      ok: false,
      message:
        params.chartType === "line"
          ? "Line charts require at least two supported points."
          : "Bar charts require at least one supported point.",
    };
  }

  const sourceToolCallIds = Array.from(
    new Set(selected.map((series) => series.sourceToolCallId)),
  );
  const chartRef = buildChartRef({
    chartIndex: params.chartIndex,
    chartType: params.chartType,
    title: params.title,
    seriesRefs: uniqueRefs,
  });
  const chart: KrwChartV1 = {
    version: "krw-chart/v1",
    chart_type: params.chartType,
    title: params.title.trim(),
    subtitle: params.subtitle?.trim() || null,
    unit: Array.from(units)[0] ?? chartSeries[0]?.unit ?? null,
    series: chartSeries,
    source: {
      tool: CREATE_CHART_TOOL_NAME,
      source_tool_call_ids: sourceToolCallIds,
    },
    quality: {
      series_count: chartSeries.length,
      point_count: pointCount,
      warnings,
    },
  };

  return {
    ok: true,
    output: {
      kind: "create_chart_v1_result",
      chart_ref: chartRef,
      insert_token: insertTokenForChartRef(chartRef),
      chart,
    },
  };
}

export function insertTokenForChartRef(chartRef: string): string {
  return `[[krw-chart:${chartRef}]]`;
}

function buildChartRef(params: {
  chartIndex: number;
  chartType: KrwChartType;
  title: string;
  seriesRefs: string[];
}): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        chart_type: params.chartType,
        title: params.title,
        series_refs: params.seriesRefs,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return `${CHART_REF_PREFIX}_${params.chartIndex}_${hash}`;
}

function collectMetricSeriesCandidates(
  toolCalls: AccumulatedToolCall[],
): Map<string, MetricSeriesCandidate> {
  const registry = new Map<string, MetricSeriesCandidate>();

  for (const toolCall of toolCalls) {
    for (const pack of findMetricSeriesPacks(toolCall.resultJson)) {
      ingestMetricSeriesPack(registry, pack, toolCall.id);
    }
    if (toolCall.resultJson !== null) continue;
    for (const payload of parseToolResultPayloads(toolCall.resultText)) {
      for (const pack of findMetricSeriesPacks(payload)) {
        ingestMetricSeriesPack(registry, pack, toolCall.id);
      }
    }
    for (const payload of readOverflowToolResultPayloads(toolCall.resultText)) {
      for (const pack of findMetricSeriesPacks(payload)) {
        ingestMetricSeriesPack(registry, pack, toolCall.id);
      }
    }
  }

  return registry;
}

function ingestMetricSeriesPack(
  registry: Map<string, MetricSeriesCandidate>,
  pack: UnknownRecord,
  sourceToolCallId: string,
) {
  const rawSeries = Array.isArray(pack.series) ? pack.series : [];
  for (const item of rawSeries) {
    if (!isRecord(item)) continue;
    const candidate = normalizeMetricSeries(item, sourceToolCallId);
    if (!candidate) continue;
    registerMetricSeriesCandidate(registry, candidate);
  }
}

function registerMetricSeriesCandidate(
  registry: Map<string, MetricSeriesCandidate>,
  candidate: MetricSeriesCandidate,
) {
  registry.set(candidate.series_key, candidate);
  for (const point of candidate.points) {
    for (const ref of metricSeriesRefAliases(point.evidence_ref)) {
      if (!registry.has(ref)) registry.set(ref, candidate);
    }
  }
}

function metricSeriesRefAliases(value: string | null | undefined): string[] {
  const ref = stringValue(value);
  if (!ref) return [];
  const aliases = new Set<string>([ref]);
  for (const prefix of ["metric_observation:", "numeric_evidence:"]) {
    if (ref.startsWith(prefix)) aliases.add(ref.slice(prefix.length));
  }
  return Array.from(aliases).filter(Boolean);
}

function normalizeMetricSeries(
  item: UnknownRecord,
  sourceToolCallId: string,
): MetricSeriesCandidate | null {
  const seriesKey = stringValue(item.series_key);
  if (!seriesKey) return null;

  const points = Array.isArray(item.points)
    ? item.points
        .map(normalizeMetricPoint)
        .filter((point): point is KrwChartPointV1 => Boolean(point))
        .sort((left, right) => left.period.localeCompare(right.period))
    : [];
  if (points.length === 0) return null;

  return {
    sourceToolCallId,
    series_key: seriesKey,
    label:
      stringValue(item.label) ||
      stringValue(item.metric_name) ||
      seriesKey.split("|").at(-1) ||
      seriesKey,
    metric_name: stringValue(item.metric_name) || stringValue(item.canonical_metric),
    unit: stringValue(item.unit),
    points,
  };
}

function normalizeMetricPoint(point: unknown): KrwChartPointV1 | null {
  if (!isRecord(point)) return null;
  const period = stringValue(point.period);
  const value = numberValue(point.value);
  const objectId = stringValue(point.object_id) || stringValue(point.evidence_ref);
  if (!period || value === null || !objectId) return null;

  return {
    period,
    value,
    formatted_value: stringValue(point.formatted_value),
    evidence_ref: normalizeEvidenceRef(objectId),
  };
}

function normalizeEvidenceRef(value: string): string {
  if (value.startsWith("metric_observation:") || value.startsWith("numeric_evidence:")) {
    return value;
  }
  return `metric_observation:${value}`;
}

function findMetricSeriesPacks(value: unknown): UnknownRecord[] {
  const packs: UnknownRecord[] = [];
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();

  while (stack.length > 0 && seen.size < 800) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (!isRecord(current)) continue;

    if (isRecord(current.metric_series_pack)) {
      packs.push(current.metric_series_pack);
    }
    if (Array.isArray(current.series) && current.mode) {
      packs.push(current);
    }

    for (const value of Object.values(current)) {
      if (isRecord(value) || Array.isArray(value)) stack.push(value);
    }
  }

  return packs;
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseToolResultPayloads(value: string | null | undefined): unknown[] {
  const parsed = parseJson(value);
  if (!parsed) return [];
  const payloads: unknown[] = [parsed];
  if (isRecord(parsed) && typeof parsed.result === "string") {
    const nested = parseJson(parsed.result);
    if (nested) payloads.push(nested);
  }
  return payloads;
}

function readOverflowToolResultPayloads(value: string | null | undefined): unknown[] {
  if (!value) return [];
  const payloads: unknown[] = [];
  for (const filePath of overflowToolResultPaths(value)) {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_OVERFLOW_TOOL_RESULT_BYTES) continue;
      payloads.push(...parseToolResultPayloads(readFileSync(filePath, "utf8")));
    } catch {
      continue;
    }
  }
  return payloads;
}

function overflowToolResultPaths(value: string): string[] {
  const paths = new Set<string>();
  for (const match of value.matchAll(TOOL_RESULT_FILE_PATTERN)) {
    const rawPath = match[1]?.trim();
    if (!rawPath) continue;
    const normalized = path.normalize(rawPath);
    if (!path.isAbsolute(normalized)) continue;
    if (!normalized.endsWith(".txt")) continue;
    if (!normalized.split(path.sep).includes("tool-results")) continue;
    paths.add(normalized);
  }
  return Array.from(paths);
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export const __test__ = {
  buildChartFromMetricSeries,
  collectMetricSeriesCandidates,
  overflowToolResultPaths,
};
