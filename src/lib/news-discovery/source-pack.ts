import "server-only";

import type { AtomicNewsEventCard, SourcePreview } from "@/types/api-contracts";
import type { NewsSourcePack, NewsSourceRead } from "@/lib/news-discovery/types";
import { readNewsSources } from "@/lib/news-discovery/stock-news-client";
import { extractPreferredSourceUrls } from "@/lib/news-discovery/source-policy";

const MAX_SOURCE_TEXT_CHARS = 12_000;
const MAX_SOURCE_COUNT = 2;

export async function buildSelectedNewsSourcePack(
  event: AtomicNewsEventCard,
): Promise<NewsSourcePack> {
  const sourceUrls = extractPreferredSourceUrls(event, MAX_SOURCE_COUNT);
  const sourcePreviews = collectSourcePreviews(event);
  const reads = sourceUrls.length > 0
    ? await readSources(sourceUrls)
    : [];
  const normalizedReads = normalizeReads(reads, sourceUrls);
  const fallbackText = buildFallbackSourceText(event, sourcePreviews);
  const readText = normalizedReads
    .filter((read) => read.ok && read.text)
    .map(formatReadForOntology)
    .join("\n\n");
  const originalTextForOntology = readText || fallbackText;
  const sourceReadStatus =
    normalizedReads.length === 0 || !readText
      ? "fallback"
      : normalizedReads.some((read) => !read.ok)
        ? "partial"
        : "read";

  return {
    version: "news-source-pack/v1",
    selected_event_id: event.id,
    read_at: new Date().toISOString(),
    source_urls: sourceUrls,
    source_previews: sourcePreviews,
    reads: normalizedReads,
    original_text_for_ontology: originalTextForOntology,
    ontology_search_brief_en: buildOntologySourceBrief(event, originalTextForOntology),
    source_read_status: sourceReadStatus,
    claims_ko: buildKoreanClaims(event),
  };
}

function collectSourcePreviews(event: AtomicNewsEventCard): SourcePreview[] {
  const previews = Array.isArray(event.source_previews)
    ? event.source_previews
    : [];
  if (event.primary_source && !previews.includes(event.primary_source)) {
    return [event.primary_source, ...previews].slice(0, MAX_SOURCE_COUNT);
  }
  return previews.slice(0, MAX_SOURCE_COUNT);
}

async function readSources(urls: string[]): Promise<unknown[]> {
  try {
    const result = await readNewsSources({ urls });
    if (Array.isArray(result.reads)) return result.reads;
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[news-discovery] source reader failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return urls.map((url) => ({ url, ok: false, error: "reader_unavailable" }));
}

function normalizeReads(reads: unknown[], sourceUrls: string[]): NewsSourceRead[] {
  const byUrl = new Map<string, NewsSourceRead>();
  for (const raw of reads) {
    if (!isRecord(raw)) continue;
    const url = stringValue(raw.url);
    if (!url) continue;
    const text = stringValue(raw.text, raw.content, raw.markdown);
    const truncatedText = text ? truncateText(text, MAX_SOURCE_TEXT_CHARS) : undefined;
    byUrl.set(url, {
      url,
      ok: raw.ok !== false && Boolean(truncatedText),
      title: stringValue(raw.title),
      text: truncatedText,
      published_at: stringValue(raw.published_at, raw.date) ?? null,
      error: stringValue(raw.error),
      truncated: Boolean(text && truncatedText && text.length > truncatedText.length),
    });
  }

  return sourceUrls.map(
    (url) =>
      byUrl.get(url) ?? {
        url,
        ok: false,
        error: "not_returned_by_reader",
      },
  );
}

function buildFallbackSourceText(
  event: AtomicNewsEventCard,
  previews: SourcePreview[],
): string {
  const parts = [
    `Selected event: ${event.event_title_ko ?? event.event_title}`,
    event.original_headline ? `Original headline: ${event.original_headline}` : "",
    event.summary_ko ? `Korean summary: ${event.summary_ko}` : "",
    event.short_summary ? `Short summary: ${event.short_summary}` : "",
    ...previews.map((source, index) =>
      [
        `Source ${index + 1}: ${source.publisher ?? source.domain ?? "unknown"}`,
        source.title_original ?? source.title ?? "",
        source.url ?? "",
        source.snippet_summary ?? source.summary_ko ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].filter(Boolean);

  return parts.join("\n\n");
}

function formatReadForOntology(read: NewsSourceRead): string {
  return [
    `URL: ${read.url}`,
    read.title ? `Title: ${read.title}` : "",
    read.published_at ? `Published at: ${read.published_at}` : "",
    "Original reader text:",
    read.text ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildOntologySourceBrief(
  event: AtomicNewsEventCard,
  originalTextForOntology: string,
): string {
  const bridge = event.ontology_bridge_brief_en;
  const bridgeEvent =
    typeof bridge?.event === "string" ? bridge.event : event.event_title;
  const axes = [
    ...(Array.isArray(bridge?.likely_financial_axes)
      ? bridge.likely_financial_axes
      : []),
    ...(Array.isArray(bridge?.likely_business_axes)
      ? bridge.likely_business_axes
      : []),
  ];

  return [
    `Selected market-news event for filing-grounded research: ${bridgeEvent}`,
    event.ticker ? `Ticker: ${event.ticker}` : "",
    event.company_name ? `Company: ${event.company_name}` : "",
    axes.length > 0 ? `Ontology axes to anchor: ${axes.join(", ")}` : "",
    "Use the following news reader text as a market hypothesis for investment interpretation:",
    "First consider what would matter for the company if the narrative is directionally true, then anchor it against filing evidence:",
    originalTextForOntology.slice(0, MAX_SOURCE_TEXT_CHARS * MAX_SOURCE_COUNT),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildKoreanClaims(event: AtomicNewsEventCard): string[] {
  return [
    event.event_title_ko ?? event.event_title,
    event.summary_ko,
    event.short_summary,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function truncateText(value: string, limit: number): string {
  const trimmed = value.replace(/\s+\n/g, "\n").trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trim()}\n[truncated]`;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
