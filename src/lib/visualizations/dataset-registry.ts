import "server-only";

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AccumulatedRun, AccumulatedToolCall } from "@/lib/agent/stream-handler";
import type {
  VisualizationEvent,
  VisualizationSeries,
} from "./contracts";

const MAX_OVERFLOW_TOOL_RESULT_BYTES = 2_000_000;
const TOOL_RESULT_FILE_PATTERN = /(\/[^\s"']+\/tool-results\/[^\s"']+?\.txt)\b/g;

// The model can name a metric in Korean or English, while the Ontology sidecar
// keeps canonical SEC-style names. These are lookup aliases only: no values,
// dimensions, or evidence are inferred here.
const METRIC_ALIAS_GROUPS = [
  {
    keys: ["revenue", "sales", "net revenue", "net sales"],
    aliases: ["매출", "매출액", "revenue", "sales", "net revenue", "net sales"],
  },
  {
    keys: ["operating income", "operating income loss", "ebit"],
    aliases: ["영업이익", "operating income", "ebit"],
  },
  {
    keys: ["operating margin", "ebit margin"],
    aliases: ["영업이익률", "operating margin", "ebit margin"],
  },
  {
    keys: ["gross profit"],
    aliases: ["매출총이익", "gross profit"],
  },
  {
    keys: ["gross margin"],
    aliases: ["매출총이익률", "gross margin"],
  },
  {
    keys: ["net income", "net income loss"],
    aliases: ["순이익", "당기순이익", "net income"],
  },
  {
    keys: ["free cash flow", "fcf"],
    aliases: ["잉여현금흐름", "free cash flow", "fcf"],
  },
  {
    keys: ["operating cash flow", "cash flow from operations"],
    aliases: ["영업현금흐름", "operating cash flow", "cash flow from operations"],
  },
  {
    keys: ["capital expenditure", "capex"],
    aliases: ["설비투자", "자본적지출", "capital expenditure", "capex"],
  },
  {
    keys: ["earnings per share", "eps", "diluted eps"],
    aliases: ["주당순이익", "eps", "earnings per share", "diluted eps"],
  },
  {
    keys: ["ebitda"],
    aliases: ["ebitda", "상각전영업이익"],
  },
] as const;

type UnknownRecord = Record<string, unknown>;

export interface RegisteredVisualizationSeries extends VisualizationSeries {
  source_tool_call_id: string;
  aliases: string[];
}

/**
 * A registry has the lifetime of exactly one agent run. It contains only
 * structured, chart-safe values and provenance, never filing source bodies.
 */
export class VisualizationDatasetRegistry {
  private readonly seriesByKey = new Map<string, RegisteredVisualizationSeries>();
  private readonly events: VisualizationEvent[] = [];

  static fromAccumulatedRun(acc: Pick<AccumulatedRun, "toolCalls">) {
    const registry = new VisualizationDatasetRegistry();
    registry.ingestToolCalls(acc.toolCalls);
    return registry;
  }

  ingestToolCalls(toolCalls: AccumulatedToolCall[]) {
    for (const toolCall of toolCalls) {
      for (const result of toolCallPayloads(toolCall)) {
        for (const pack of findMetricSeriesPacks(result)) {
          this.ingestMetricSeriesPack(pack, toolCall.id);
        }
        this.ingestEvents(result, sourceHintForToolName(toolCall.toolName));
      }
    }
  }

  allSeries(): RegisteredVisualizationSeries[] {
    return Array.from(new Set(this.seriesByKey.values()));
  }

  allEvents(): VisualizationEvent[] {
    return dedupeEvents(this.events);
  }

  findSeries(query: string): RegisteredVisualizationSeries[] {
    const normalized = normalizeSearch(query);
    if (!normalized) return [];

    const exact = this.allSeries().filter((series) =>
      series.aliases.some((alias) => normalizeSearch(alias) === normalized),
    );
    if (exact.length > 0) return exact;

    return this.allSeries().filter((series) =>
      series.aliases.some((alias) => {
        const candidate = normalizeSearch(alias);
        return candidate.includes(normalized) || normalized.includes(candidate);
      }),
    );
  }

  private ingestMetricSeriesPack(pack: UnknownRecord, sourceToolCallId: string) {
    const rawSeries = Array.isArray(pack.series) ? pack.series : [];
    for (const item of rawSeries) {
      if (!isRecord(item)) continue;
      const series = normalizeMetricSeries(item, sourceToolCallId);
      if (!series) continue;
      this.seriesByKey.set(series.series_key, series);
    }
  }

  private ingestEvents(value: unknown, sourceHint: EventSourceHint) {
    for (const record of findEventRecords(value, sourceHint)) {
      const event = normalizeEvent(record, sourceHint);
      if (event) this.events.push(event);
    }
  }
}

function normalizeMetricSeries(
  item: UnknownRecord,
  sourceToolCallId: string,
): RegisteredVisualizationSeries | null {
  const seriesKey = stringValue(item.series_key);
  if (!seriesKey) return null;
  const points = Array.isArray(item.points)
    ? item.points
        .map(normalizePoint)
        .filter((point): point is VisualizationSeries["points"][number] => Boolean(point))
        .sort((left, right) => left.period.localeCompare(right.period))
    : [];
  if (points.length === 0) return null;

  const metricName = stringValue(item.metric_name);
  const canonicalMetric =
    stringValue(item.canonical_metric) ?? stringValue(item.metric) ?? metricName;
  const label =
    stringValue(item.label) ??
    metricName ??
    canonicalMetric ??
    seriesKey.split("|").at(-1) ??
    seriesKey;
  const aliases = Array.from(
    new Set(
      [
        seriesKey,
        label,
        metricName,
        canonicalMetric,
        ...metricAliases(canonicalMetric, metricName),
        ...seriesKey.split("|"),
      ].filter((value): value is string => Boolean(value?.trim())),
    ),
  );

  return {
    source_tool_call_id: sourceToolCallId,
    series_key: seriesKey,
    label,
    metric_name: metricName,
    canonical_metric: canonicalMetric,
    unit: stringValue(item.unit),
    currency: stringValue(item.currency),
    points,
    aliases,
  };
}

function metricAliases(
  canonicalMetric: string | null,
  metricName: string | null,
): string[] {
  const metricKeys = [canonicalMetric, metricName]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSearch);
  if (metricKeys.length === 0) return [];

  return METRIC_ALIAS_GROUPS.flatMap((group) => {
    const matches = group.keys.some((key) => {
      const normalizedKey = normalizeSearch(key);
      return metricKeys.some(
        (metricKey) => metricKey === normalizedKey || metricKey.includes(normalizedKey),
      );
    });
    return matches ? group.aliases : [];
  });
}

function normalizePoint(value: unknown): VisualizationSeries["points"][number] | null {
  if (!isRecord(value)) return null;
  const period = stringValue(value.period);
  const numericValue = numberValue(value.value);
  const objectId = stringValue(value.object_id) ?? stringValue(value.evidence_ref);
  if (!period || numericValue === null || !objectId) return null;
  return {
    period,
    value: numericValue,
    formatted_value: stringValue(value.formatted_value),
    evidence_ref: normalizeEvidenceRef(objectId),
  };
}

function toolCallPayloads(toolCall: AccumulatedToolCall): unknown[] {
  const payloads: unknown[] = [];
  if (toolCall.resultJson !== null) payloads.push(toolCall.resultJson);
  payloads.push(...parseToolResultPayloads(toolCall.resultText));
  payloads.push(...readOverflowToolResultPayloads(toolCall.resultText));
  return payloads;
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
      stack.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    if (isRecord(current.metric_series_pack)) packs.push(current.metric_series_pack);
    if (Array.isArray(current.series) && current.mode) packs.push(current);
    for (const item of Object.values(current)) {
      if (isRecord(item) || Array.isArray(item)) stack.push(item);
    }
  }
  return packs;
}

type EventSourceHint = "filing" | "news" | null;

function findEventRecords(
  value: unknown,
  sourceHint: EventSourceHint,
): UnknownRecord[] {
  const matches: UnknownRecord[] = [];
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  while (stack.length > 0 && seen.size < 800) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    const sourceKind = sourceKindForRecord(current, sourceHint);
    const date = eventDate(current);
    const label = eventLabel(current, sourceKind);
    if (date && label && sourceKind) {
      matches.push(current);
    }
    for (const item of Object.values(current)) {
      if (isRecord(item) || Array.isArray(item)) stack.push(item);
    }
  }
  return matches;
}

function normalizeEvent(
  record: UnknownRecord,
  sourceHint: EventSourceHint,
): VisualizationEvent | null {
  const sourceKind = sourceKindForRecord(record, sourceHint);
  if (!sourceKind) return null;
  const date = eventDate(record);
  const label = eventLabel(record, sourceKind);
  const evidence =
    stringValue(record.evidence_ref) ??
    stringValue(record.filing_event_id) ??
    stringValue(record.accession_number) ??
    stringValue(record.event_id) ??
    stringValue(record.object_id) ??
    stringValue(record.source_id) ??
    stringValue(record.id);
  if (!date || !label || !evidence) return null;
  return {
    date: date.slice(0, 10),
    label: label.slice(0, 180),
    source_kind: sourceKind,
    evidence_ref: normalizeEventEvidenceRef(evidence, sourceKind),
    href:
      stringValue(record.url) ??
      stringValue(record.href) ??
      stringValue(record.link) ??
      stringValue(record.source_url) ??
      stringValue(record.filing_detail_url) ??
      stringValue(record.primary_document_url),
  };
}

function eventDate(record: UnknownRecord): string | null {
  return (
    stringValue(record.date) ??
    stringValue(record.filing_date) ??
    stringValue(record.published_at) ??
    stringValue(record.accepted_at) ??
    stringValue(record.event_date) ??
    stringValue(record.source_date) ??
    stringValue(record.occurred_at)
  );
}

function sourceHintForToolName(toolName: string): EventSourceHint {
  if (
    toolName.includes("filing") ||
    toolName.includes("form4") ||
    toolName.includes("insider")
  ) {
    return "filing";
  }
  if (toolName.includes("news") || toolName === "get_stock_info") return "news";
  return null;
}

function sourceKindForRecord(
  record: UnknownRecord,
  sourceHint: EventSourceHint,
): EventSourceHint {
  const raw = (
    stringValue(record.source_kind) ??
    stringValue(record.kind) ??
    stringValue(record.source_type) ??
    ""
  ).toLocaleLowerCase("en-US");
  if (raw === "filing" || raw.includes("filing") || raw === "8-k" || raw === "6-k") {
    return "filing";
  }
  if (raw === "news" || raw.includes("news")) return "news";
  if (stringValue(record.filing_date) || stringValue(record.accession_number)) {
    return "filing";
  }
  if (stringValue(record.published_at) && sourceHint === "news") return "news";
  return sourceHint;
}

function eventLabel(
  record: UnknownRecord,
  sourceKind: EventSourceHint,
): string | null {
  const explicit =
    stringValue(record.label) ??
    stringValue(record.title) ??
    stringValue(record.headline) ??
    stringValue(record.event_title) ??
    stringValue(record.original_headline) ??
    stringValue(record.source_headline) ??
    stringValue(record.headline_ko) ??
    stringValue(record.name);
  if (explicit) return explicit;
  if (sourceKind !== "filing") return null;
  const form = stringValue(record.form_type) ?? stringValue(record.form);
  const ticker = stringValue(record.ticker) ?? stringValue(record.display_ticker);
  if (!form) return null;
  return [ticker, form].filter(Boolean).join(" · ");
}

function dedupeEvents(events: VisualizationEvent[]): VisualizationEvent[] {
  const seen = new Set<string>();
  return events
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .filter((event) => {
      const key = `${event.source_kind}:${event.date}:${event.evidence_ref}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
      // Tool overflow data is optional. A missing transient file must not fail the answer.
    }
  }
  return payloads;
}

function overflowToolResultPaths(value: string): string[] {
  const filePaths = new Set<string>();
  for (const match of value.matchAll(TOOL_RESULT_FILE_PATTERN)) {
    const rawPath = match[1]?.trim();
    if (!rawPath) continue;
    const normalized = path.normalize(rawPath);
    if (!path.isAbsolute(normalized)) continue;
    if (!normalized.endsWith(".txt")) continue;
    if (!normalized.split(path.sep).includes("tool-results")) continue;
    filePaths.add(normalized);
  }
  return Array.from(filePaths);
}

function normalizeEvidenceRef(value: string): string {
  return value.startsWith("metric_observation:") || value.startsWith("numeric_evidence:")
    ? value
    : `metric_observation:${value}`;
}

function normalizeEventEvidenceRef(
  value: string,
  sourceKind: "filing" | "news",
): string {
  if (/^(?:filing|news|metric_observation|numeric_evidence):/.test(value)) {
    return value;
  }
  return `${sourceKind}:${value}`;
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[\s_\-|/()[\]{}.,:;]+/g, "")
    .trim();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
