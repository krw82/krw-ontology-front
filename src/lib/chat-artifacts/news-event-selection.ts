import type { AccumulatedRun } from "@/lib/agent/stream-handler";
import type { Json } from "@/types/database";
import type {
  AtomicNewsEventCard,
  ChatArtifact,
  EventPremisePack,
  NewsEventSelectionArtifactPayload,
  SourcePreview,
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
      discovery_policy: isRecord(result.discovery_policy)
        ? result.discovery_policy
        : undefined,
      events,
      cards: events,
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
    result.cards,
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
  const normalizedEvents = events
    .map((event, index) => normalizeEvent(event, index))
    .filter((event): event is AtomicNewsEventCard => event !== null)
    .filter((event) => !isExcludedCard(event))
    .filter(isUsableMarketNewsEvent);

  return dedupeEvents(normalizedEvents).slice(0, 5);
}

function normalizeEvent(
  event: UnknownRecord,
  index: number,
): AtomicNewsEventCard | null {
  const sourcePreviews = readRecordArray(event.source_previews)
    .filter((source) => !isExcludedSourcePreview(source))
    .map(normalizeSourcePreview);
  const primarySource = findPrimarySource(sourcePreviews, event);
  const originalHeadline = firstString(
    event.original_headline,
    event.original_title,
    event.source_headline,
    event.article_title_original,
    event.headline_original,
    primarySource?.title_original,
    primarySource?.title,
  );
  const koreanTitle = firstString(
    event.event_title_ko,
    event.title_ko,
    event.headline_ko,
  );
  const displayKoreanTitle =
    koreanTitle && !isEnglishHeavy(koreanTitle) ? koreanTitle : undefined;
  const eventTitle = firstString(
    displayKoreanTitle,
    event.event_title,
    event.title,
    event.headline,
    event.name,
  );
  if (!eventTitle) return null;

  const id =
    firstString(event.id, event.event_id, event.slug) ??
    buildStableEventId(eventTitle, index);
  const rawSummary = firstString(
    event.summary_ko,
    event.korean_summary,
    event.news_summary_ko,
    event.short_summary,
    event.summary,
    event.description,
    event.snippet,
    primarySource?.summary_ko,
    primarySource?.snippet_summary,
  );
  const koreanSummary = firstKoreanString(
    cleanKoreanNewsSummary(event.summary_ko),
    cleanKoreanNewsSummary(event.korean_summary),
    cleanKoreanNewsSummary(event.news_summary_ko),
    primarySource?.summary_ko,
  );

  return {
    ...event,
    id,
    event_title: eventTitle,
    event_title_ko: displayKoreanTitle,
    original_headline: originalHeadline,
    primary_source: primarySource,
    ticker: firstString(event.ticker, event.symbol),
    company_name: firstString(event.company_name, event.company),
    short_summary: firstString(
      koreanSummary,
      event.short_summary,
      event.summary,
      event.description,
      event.snippet,
      primarySource?.summary_ko,
      primarySource?.snippet_summary,
      rawSummary,
    ),
    summary_ko: koreanSummary,
    price_impact_direction: normalizeImpactDirection(event.price_impact_direction),
    source_summary: isRecord(event.source_summary) ? event.source_summary : undefined,
    investment_axes: readStringArray(event.investment_axes),
    ontology_baseline_questions: readStringArray(
      event.ontology_baseline_questions,
    ),
    source_previews: sourcePreviews,
    reader_urls: readStringArray(event.reader_urls),
    official_source_urls: readStringArray(event.official_source_urls),
    major_news_urls: readStringArray(event.major_news_urls),
    ontology_bridge_brief_en: isRecord(event.ontology_bridge_brief_en)
      ? event.ontology_bridge_brief_en
      : undefined,
    ui: isRecord(event.ui) ? event.ui : undefined,
    ranking: isRecord(event.ranking) ? event.ranking : undefined,
  };
}

export function buildNewsEventSelectionUserMessage(
  event: AtomicNewsEventCard,
): string {
  const source = event.primary_source ?? findPrimarySource(
    event.source_previews ?? [],
    event,
  );
  const sourceLabel = firstString(source?.publisher, source?.domain);
  const sourceDate = firstString(source?.published_at, event.source_date, event.event_date);
  const display = buildNewsEventDisplayText(event);
  const lines = [
    "선택 뉴스:",
    display.title,
  ];

  if (sourceLabel || sourceDate) {
    lines.push(
      "",
      `출처: ${[sourceLabel, sourceDate].filter(Boolean).join(" · ")}`,
    );
  }

  if (display.originalHeadline) {
    lines.push("", "원문 기사:", display.originalHeadline);
  }

  if (display.summary) {
    lines.push("", "내용 요약:", display.summary);
  }

  lines.push(
    "",
    "이 뉴스가 사실이라고 가정하고, 회사에 미칠 영향과 확인해야 할 공시 근거를 분석해줘.",
    "뉴스 자체의 진위를 따지는 것이 아니라 전제에서 출발해 영향·전파경로·확인 신호를 설명해줘.",
  );
  return lines.join("\n");
}

/** Build the bounded event premise persisted with a chat-room selection. */
export function buildEventPremisePack(
  event: AtomicNewsEventCard,
  mode: EventPremisePack["mode"] = "assume_event_true",
): EventPremisePack {
  const source = event.primary_source ?? findPrimarySource(
    event.source_previews ?? [],
    event,
  );
  return {
    version: "event-premise/v1",
    mode,
    selected_event_id: event.id,
    ticker: event.ticker,
    company_name: event.company_name,
    event_title: event.event_title_ko ?? event.event_title,
    original_headline: event.original_headline,
    summary: event.summary_ko ?? event.short_summary,
    source_urls: uniqueStrings([
      source?.url,
      ...(event.official_source_urls ?? []),
      ...(event.major_news_urls ?? []),
      ...(event.reader_urls ?? []),
    ]).slice(0, 4),
    source_published_at: source?.published_at ?? event.source_date ?? event.event_date ?? null,
    impact_axes: uniqueStrings([
      ...(event.investment_axes ?? []),
      ...(event.ontology_bridge_brief_en?.likely_financial_axes ?? []),
      ...(event.ontology_bridge_brief_en?.likely_business_axes ?? []),
    ]).slice(0, 8),
    baseline_questions: uniqueStrings([
      ...(event.ontology_baseline_questions ?? []),
      ...(event.ontology_bridge_brief_en?.suggested_ontology_questions ?? []),
    ]).slice(0, 8),
  };
}

export function buildNewsEventDisplayText(
  event: AtomicNewsEventCard,
): {
  title: string;
  summary?: string;
  originalHeadline?: string;
  isSourceLanguageFallback: boolean;
} {
  const source = event.primary_source ?? findPrimarySource(
    event.source_previews ?? [],
    event,
  );
  const originalHeadline = firstString(
    event.original_headline,
    source?.title_original,
    source?.title,
  );
  const koreanTitle = firstString(event.event_title_ko, source?.title_ko);
  const title =
    koreanTitle && !isEnglishHeavy(koreanTitle)
      ? koreanTitle
      : firstString(event.event_title, originalHeadline, source?.title) ??
        "원문 뉴스 후보";
  const koreanSummary = firstString(event.summary_ko, source?.summary_ko);
  const summary =
    koreanSummary && !isEnglishHeavy(koreanSummary)
      ? koreanSummary
      : firstString(event.short_summary, source?.snippet_summary);

  return {
    title,
    summary,
    originalHeadline,
    isSourceLanguageFallback:
      isEnglishHeavy(title) ||
      Boolean(summary && isEnglishHeavy(summary)) ||
      !koreanTitle,
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

function firstKoreanString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const trimmed = value.trim();
    if (!isEnglishHeavy(trimmed)) return trimmed;
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

function normalizeSourcePreview(source: UnknownRecord): SourcePreview {
  return {
    ...source,
    title: firstString(source.title),
    title_original: firstString(source.title_original),
    title_ko: firstString(source.title_ko),
    url: firstString(source.url),
    domain: firstString(source.domain),
    publisher: firstString(source.publisher),
    published_at: firstString(source.published_at, source.date, source.source_date),
    summary_ko: cleanKoreanNewsSummary(source.summary_ko),
    snippet_summary: firstString(source.snippet_summary, source.summary, source.snippet),
  };
}

function normalizeImpactDirection(
  value: unknown,
): AtomicNewsEventCard["price_impact_direction"] | undefined {
  return value === "negative" ||
    value === "positive" ||
    value === "mixed" ||
    value === "unclear"
    ? value
    : undefined;
}

function isExcludedCard(event: AtomicNewsEventCard): boolean {
  const sourceText = (event.source_previews ?? [])
    .map((source) =>
      [
        source.title,
        source.title_original,
        source.title_ko,
        source.url,
        source.domain,
        source.publisher,
      ].join(" "),
    )
    .join(" ");
  const text = [
    event.event_title,
    event.event_title_ko,
    event.short_summary,
    event.summary_ko,
    sourceText,
  ].join(" ");
  return isExcludedDiscoveryText(text);
}

function isUsableMarketNewsEvent(event: AtomicNewsEventCard): boolean {
  const source = event.primary_source ?? findPrimarySource(
    event.source_previews ?? [],
    event,
  );
  const originalHeadline = firstString(
    event.original_headline,
    source?.title_original,
    source?.title,
  );
  const displayTitle = firstString(event.event_title_ko, event.event_title);
  const summary = firstString(event.summary_ko, event.short_summary);

  return Boolean(
    displayTitle &&
      source &&
      originalHeadline &&
      !isLowInformationHeadline(originalHeadline) &&
      summary &&
      !isLowInformationSummary(summary),
  );
}

function findPrimarySource(
  sources: UnknownRecord[],
  event: UnknownRecord,
): SourcePreview | undefined {
  return sources.find((source) => {
    const headline = firstString(source.title_original, source.title);
    const sourceIdentity = firstString(
      source.publisher,
      source.domain,
      source.url,
      event.publisher,
      event.domain,
    );
    if (!headline || !sourceIdentity) return false;
    if (isExcludedSourcePreview(source)) return false;
    return !isLowInformationHeadline(headline);
  }) as SourcePreview | undefined;
}

function dedupeEvents(events: AtomicNewsEventCard[]): AtomicNewsEventCard[] {
  const seen = new Set<string>();
  const deduped: AtomicNewsEventCard[] = [];

  for (const event of events) {
    const key = [
      event.ticker ?? "",
      event.primary_source?.domain ?? event.primary_source?.publisher ?? "",
      (event.original_headline ?? event.event_title).toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

function isExcludedSourcePreview(source: UnknownRecord): boolean {
  if (source.excluded === true) return true;
  return isExcludedDiscoveryText(
    [
      source.title,
      source.title_original,
      source.title_ko,
      source.url,
      source.domain,
      source.publisher,
    ].join(" "),
  );
}

function isExcludedDiscoveryText(text: string): boolean {
  return /\b(sec filings?|form\s+(8-k|10-k|10-q)|investor relations|annual report|quarterly report)\b|sec\.gov|annualreports\.com|\/investor-relations|(^|\s)ir\./i.test(text);
}

function cleanKoreanNewsSummary(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const cleaned = value
    .replace(/공시 기준(?:으로)?\s*분석(?:에서는|은)?.*?(?:확인합니다|분석합니다|설명합니다)\.?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function isLowInformationHeadline(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (/^[a-z0-9.-]+\.(com|net|org|co|io|kr)$/i.test(normalized)) return true;
  if (/보도:\s*(강세|약세|혼재|확인 필요)\s*요인\s*후보/i.test(value)) {
    return true;
  }
  if (/^(market news|source|news|article)$/i.test(normalized)) return true;
  return false;
}

function isLowInformationSummary(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 24) return true;
  if (/최근\s+\S+\s+등\s+시장\s+뉴스는\s+이\s+이슈를/i.test(normalized)) {
    return true;
  }
  if (/공시 기준(?:으로)?\s*분석/i.test(normalized)) return true;
  return false;
}

function isEnglishHeavy(value: string): boolean {
  const latinCount = (value.match(/[A-Za-z]/g) ?? []).length;
  const hangulCount = (value.match(/[가-힣]/g) ?? []).length;
  return latinCount >= 24 && latinCount > Math.max(8, hangulCount * 1.4);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.trim()))];
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
