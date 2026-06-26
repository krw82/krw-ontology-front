import "server-only";

import type { AccumulatedRun } from "@/lib/agent/stream-handler";
import {
  CREATE_CHART_TOOL_NAME,
  insertTokenForChartRef,
  type CreatedChartToolOutput,
} from "@/lib/charts/create-chart-tool";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ChatMessageChart, KrwChartV1 } from "@/types/api-contracts";
import type { ChatMessageChartRow, Json } from "@/types/database";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
type UnknownRecord = Record<string, unknown>;

export function toPublicChatChart(row: ChatMessageChartRow): ChatMessageChart {
  return {
    id: row.id,
    session_id: row.session_id,
    message_id: row.message_id,
    run_id: row.run_id,
    chart_ref: row.chart_ref,
    insert_token: row.insert_token,
    title: row.title,
    chart_type: row.chart_type,
    payload_json: row.payload_json as unknown as KrwChartV1,
    created_at: row.created_at,
  };
}

export async function persistCreatedCharts(params: {
  admin: SupabaseAdmin;
  acc: AccumulatedRun;
  sessionId: string;
  messageId: string;
  runId: string;
  content: string;
}): Promise<ChatMessageChart[]> {
  const outputs = extractCreatedChartOutputs(params.acc, params.content);
  if (outputs.length === 0) return [];

  const rows = outputs.map((output) => ({
    session_id: params.sessionId,
    message_id: params.messageId,
    run_id: params.runId,
    chart_ref: output.chart_ref,
    insert_token: output.insert_token,
    title: output.chart.title,
    chart_type: output.chart.chart_type,
    payload_json: jsonForDb(output.chart) ?? {},
  }));

  const { data, error } = await params.admin
    .from("chat_message_charts")
    .insert(rows)
    .select(
      "id, session_id, message_id, run_id, chart_ref, insert_token, title, chart_type, payload_json, created_at",
    )
    .returns<ChatMessageChartRow[]>();

  if (error || !data) {
    console.warn("[agent-worker] failed to persist chat charts", {
      runId: params.runId,
      error: error?.message,
    });
    return [];
  }

  return data.map(toPublicChatChart);
}

function extractCreatedChartOutputs(
  acc: AccumulatedRun,
  content: string,
): CreatedChartToolOutput[] {
  const referencedTokens = new Set(
    Array.from(content.matchAll(/\[\[krw-chart:([A-Za-z0-9_-]+)\]\]/g)).map(
      (match) => insertTokenForChartRef(match[1] ?? ""),
    ),
  );
  if (referencedTokens.size === 0) return [];

  const outputs: CreatedChartToolOutput[] = [];
  const seenRefs = new Set<string>();

  for (const toolCall of acc.toolCalls) {
    if (toolCall.toolName !== CREATE_CHART_TOOL_NAME) continue;
    const output = parseCreatedChartOutput(toolCall.resultJson) ??
      parseCreatedChartOutput(parseJson(toolCall.resultText));
    if (!output) continue;
    if (!referencedTokens.has(output.insert_token)) continue;
    if (seenRefs.has(output.chart_ref)) continue;
    seenRefs.add(output.chart_ref);
    outputs.push(output);
  }

  return outputs;
}

function parseCreatedChartOutput(value: unknown): CreatedChartToolOutput | null {
  if (!isRecord(value) || value.kind !== "create_chart_v1_result") return null;
  if (
    typeof value.chart_ref !== "string" ||
    typeof value.insert_token !== "string" ||
    !isRecord(value.chart)
  ) {
    return null;
  }
  if (value.insert_token !== insertTokenForChartRef(value.chart_ref)) return null;
  if (
    value.chart.version !== "krw-chart/v1" ||
    (value.chart.chart_type !== "line" && value.chart.chart_type !== "bar") ||
    typeof value.chart.title !== "string" ||
    !Array.isArray(value.chart.series)
  ) {
    return null;
  }

  return value as unknown as CreatedChartToolOutput;
}

function jsonForDb(value: unknown): Json | null {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
