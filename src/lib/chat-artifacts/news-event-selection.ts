import type { AccumulatedRun } from "@/lib/agent/stream-handler";
import type { Json } from "@/types/database";
import type {
  AtomicNewsEventCard,
  ChatArtifact,
  NewsEventSelectionArtifactPayload,
} from "@/types/api-contracts";

type UnknownRecord = Record<string, unknown>;

const NEWS_EVENT_TOOL_NAMES = new Set([
  "search_company_news_events",
  "search_market_news_events",
  "build_news_timeline",
]);

export interface BuiltNewsEventSelectionArtifact {
  type: "news_event_selection";
  payload: NewsEventSelectionArtifactPayload;
}

export function buildNewsEventSelectionArtifact(params: {
  acc: AccumulatedRun;
  originalQuestion: string;
}): BuiltNewsEventSelectionArtifact | null {
  const result = findLatestNewsEventResult(params.acc);
  if (!result) return null;

  const rawEvents = findEventArray(result);
  const events = normalizeEvents(rawEvents);
  if (events.length === 0) return null;

  return {
    type: "news_event_selection",
    payload: {
      kind: "news_event_selection",
      version: 1,
      original_question: params.originalQuestion,
      resolved_entities: readRecordArray(result.resolved_entities),
      lookback: isRecord(result.lookback) ? result.lookback : undefined,
      events,
      discovery_summary: {
        event_count: events.length,
        source_count: countSourcePreviews(events),
        has_official_candidates: events.some(
          (event) => (event.official_source_urls ?? []).length > 0,
        ),
        has_major_news_candidates: events.some(
          (event) => (event.major_news_urls ?? []).length > 0,
        ),
      },
      raw_result: jsonClone(result) as Record<string, unknown>,
    },
  };
}

export function toPublicChatArtifact(row: {
  id: string;
  session_id: string;
  message_id: string;
  run_id: string;
  type: ChatArtifact["type"];
  payload_json: Json;
  created_at: string;
}): ChatArtifact {
  return {
    id: row.id,
    session_id: row.session_id,
    message_id: row.message_id,
    run_id: row.run_id,
    type: row.type,
    payload_json: row.payload_json as ChatArtifact["payload_json"],
    created_at: row.created_at,
  };
}

function findLatestNewsEventResult(acc: AccumulatedRun): UnknownRecord | null {
  for (let index = acc.toolCalls.length - 1; index >= 0; index--) {
    const toolCall = acc.toolCalls[index];
    if (!NEWS_EVENT_TOOL_NAMES.has(toolCall.toolName)) continue;

    const jsonResult = isRecord(toolCall.resultJson)
      ? toolCall.resultJson
      : parseJsonRecord(toolCall.resultText);
    if (jsonResult && findEventArray(jsonResult).length > 0) {
      return jsonResult;
    }
  }

  return null;
}

function findEventArray(result: UnknownRecord): UnknownRecord[] {
  const directCandidates = [
    result.atomic_events,
    result.events,
    result.event_candidates,
    result.candidates,
  ];

  for (const value of directCandidates) {
    const records = readRecordArray(value);
    if (records.length > 0) return records;
  }

  if (isRecord(result.results)) {
    for (const value of Object.values(result.results)) {
      const records = readRecordArray(value);
      if (records.length > 0) return records;
    }
  }

  return [];
}

function normalizeEvents(events: UnknownRecord[]): AtomicNewsEventCard[] {
  return events
    .map((event, index) => normalizeEvent(event, index))
    .filter((event): event is AtomicNewsEventCard => event !== null)
    .slice(0, 5);
}

function normalizeEvent(
  event: UnknownRecord,
  index: number,
): AtomicNewsEventCard | null {
  const eventTitle = firstString(
    event.event_title,
    event.title,
    event.headline,
    event.name,
  );
  if (!eventTitle) return null;

  const id =
    firstString(event.id, event.event_id, event.slug) ??
    buildStableEventId(eventTitle, index);

  return {
    ...event,
    id,
    event_title: eventTitle,
    ticker: firstString(event.ticker, event.symbol),
    company_name: firstString(event.company_name, event.company),
    short_summary: firstString(
      event.short_summary,
      event.summary,
      event.description,
      event.snippet,
    ),
    investment_axes: readStringArray(event.investment_axes),
    ontology_baseline_questions: readStringArray(
      event.ontology_baseline_questions,
    ),
    source_previews: readRecordArray(event.source_previews),
    reader_urls: readStringArray(event.reader_urls),
    official_source_urls: readStringArray(event.official_source_urls),
    major_news_urls: readStringArray(event.major_news_urls),
  };
}

function countSourcePreviews(events: AtomicNewsEventCard[]): number {
  return events.reduce(
    (count, event) => count + (event.source_previews?.length ?? 0),
    0,
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function readRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string | null): UnknownRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function buildStableEventId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "event"}-${index + 1}`;
}
