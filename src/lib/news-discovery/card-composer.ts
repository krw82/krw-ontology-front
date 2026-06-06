import "server-only";

import { query } from "@anthropic-ai/claude-agent-sdk";
import { getClaudeAgentModel } from "@/lib/agent/model";
import { estimateCost } from "@/lib/concurrency/cost-estimate";
import type { AtomicNewsEventCard } from "@/types/api-contracts";
import type {
  NewsDiscoveryCardComposition,
  NewsDiscoverySearchResult,
} from "@/lib/news-discovery/types";
import {
  displayableMarketNewsUrl,
  extractPreferredSourceUrls,
  isPreferredMarketNewsSource,
} from "@/lib/news-discovery/source-policy";
import {
  type NewsTextTranslator,
  translateFallbackNewsCards,
} from "@/lib/news-discovery/card-translation";

const MAX_RAW_SEARCH_CHARS = 45_000;

export async function composeNewsDiscoveryCards(
  discovery: NewsDiscoverySearchResult,
  options: {
    translateTexts?: NewsTextTranslator;
    runStructuredComposer?: boolean;
  } = {},
): Promise<NewsDiscoveryCardComposition> {
  if (options.runStructuredComposer ?? shouldRunStructuredCardComposer()) {
    try {
      const result = await runStructuredCardComposer(discovery);
      const cards = normalizeCards(result.cards, discovery);
      if (cards.length > 0) {
        return {
          cards,
          empty_state: isRecord(result.empty_state)
            ? result.empty_state
            : undefined,
          raw_model_output: result,
          usage: result.usage,
        };
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[news-discovery] card composer failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const fallback = await translateFallbackNewsCards(buildFallbackCards(discovery), {
    translateTexts: options.translateTexts,
  });

  return {
    cards: fallback.cards,
    empty_state: {
      reason: fallback.translation.translated
        ? "translated_fallback_cards"
        : "source_language_fallback_cards",
      english_question: discovery.intent.englishQuestion,
      translation: fallback.translation,
    },
    raw_model_output: {
      fallback: true,
      translation: fallback.translation,
    },
  };
}

function shouldRunStructuredCardComposer(): boolean {
  const value = process.env.NEWS_DISCOVERY_CARD_COMPOSER;
  return value === "claude" || value === "1" || value === "true";
}

async function runStructuredCardComposer(
  discovery: NewsDiscoverySearchResult,
): Promise<NewsDiscoveryCardComposition> {
  const model = getClaudeAgentModel();
  const sdkQuery = query({
    prompt: buildPrompt(discovery),
    options: {
      cwd: process.cwd(),
      model,
      maxTurns: 2,
      permissionMode: "dontAsk",
      allowedTools: [],
      outputFormat: {
        type: "json_schema",
        schema: CARD_COMPOSER_SCHEMA,
      },
    },
  });

  for await (const message of sdkQuery) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      throw new Error("Claude card composer failed");
    }
    const structured = isRecord(message.structured_output)
      ? message.structured_output
      : parseJsonRecord(message.result);
    const usage = usageFromResultMessage(message);
    return {
      cards: readRecordArray(structured?.cards) as AtomicNewsEventCard[],
      empty_state: isRecord(structured?.empty_state)
        ? structured.empty_state
        : undefined,
      raw_model_output: structured,
      usage,
    };
  }

  throw new Error("Claude card composer returned no result");
}

function buildPrompt(discovery: NewsDiscoverySearchResult): string {
  const raw = JSON.stringify(discovery.rawSearchResult, null, 2).slice(
    0,
    MAX_RAW_SEARCH_CHARS,
  );
  const allowedDomains = discovery.selectedSourcePolicy.allowed_domains.join(", ");

  return [
    "You are a KRW Ontology market-news card composer.",
    "Do not browse, do not use tools, and do not write a final investment answer.",
    "Transform the supplied raw search result into 3 to 5 Korean market-news event cards.",
    "",
    "Strict rules:",
    "- Use only actual market-news sources present in raw_search_result.",
    `- Allowed source domains: ${allowedDomains}.`,
    "- Exclude SEC filings, investor relations, company IR pages, Form 8-K/10-K/10-Q, TradingView, and Barchart.",
    "- Every card must identify the concrete article headline or article cluster behind it.",
    "- event_title_ko and summary_ko are user-visible Korean fields. They must be natural Korean sentences, not English headlines with a Korean prefix.",
    "- Preserve the exact English source headline only in original_headline and source_previews[].title_original.",
    "- Korean title must say what happened and why it matters, not just a domain name.",
    "- Korean summary must explain the market narrative and why it may matter for the selected ticker.",
    "- ontology_bridge_brief_en must be English and must tell the filing research agent exactly what financial/business axes to check.",
    "- If there are no usable articles, return cards: [] and an empty_state explaining why.",
    "",
    "Discovery intent:",
    JSON.stringify(discovery.intent, null, 2),
    "",
    "raw_search_result:",
    raw,
  ].join("\n");
}

function normalizeCards(
  cards: AtomicNewsEventCard[],
  discovery: NewsDiscoverySearchResult,
): AtomicNewsEventCard[] {
  const seen = new Set<string>();
  const normalized: AtomicNewsEventCard[] = [];

  for (const [index, rawCard] of cards.entries()) {
    if (!isRecord(rawCard)) continue;
    const sourcePreviews = readRecordArray(rawCard.source_previews)
      .filter(isPreferredMarketNewsSource)
      .map((source) => ({
        ...source,
        title: stringValue(source.title),
        title_original: stringValue(source.title_original, source.title),
        title_ko: stringValue(source.title_ko),
        url: displayableMarketNewsUrl(source.url),
        domain: stringValue(source.domain),
        publisher: stringValue(source.publisher),
        published_at: stringValue(source.published_at),
        summary_ko: stringValue(source.summary_ko),
        snippet_summary: stringValue(source.snippet_summary, source.snippet),
      }));
    const sourceUrls = extractPreferredSourceUrls(
      { ...rawCard, source_previews: sourcePreviews },
      3,
    );
    if (sourcePreviews.length === 0 && sourceUrls.length === 0) continue;

    const titleKo = stringValue(
      rawCard.event_title_ko,
      rawCard.event_title,
      rawCard.title_ko,
    );
    const summaryKo = stringValue(
      rawCard.summary_ko,
      rawCard.short_summary,
      rawCard.summary,
    );
    if (!titleKo || !summaryKo) continue;
    if (isEnglishHeavy(titleKo) || isEnglishHeavy(summaryKo)) continue;

    const id =
      stringValue(rawCard.id, rawCard.event_id) ??
      buildStableCardId(titleKo, index);
    if (seen.has(id)) continue;
    seen.add(id);

    normalized.push({
      ...rawCard,
      id,
      ticker: stringValue(rawCard.ticker) ?? discovery.intent.ticker,
      company_name:
        stringValue(rawCard.company_name) ?? discovery.intent.companyName,
      event_title: titleKo,
      event_title_ko: titleKo,
      original_headline: stringValue(
        rawCard.original_headline,
        rawCard.source_headline,
        sourcePreviews[0]?.title_original,
        sourcePreviews[0]?.title,
      ),
      short_summary: summaryKo,
      summary_ko: summaryKo,
      price_impact_direction: normalizeImpact(rawCard.price_impact_direction),
      source_previews: sourcePreviews,
      primary_source: sourcePreviews[0],
      major_news_urls: sourceUrls,
      reader_urls: sourceUrls,
      ontology_bridge_brief_en: isRecord(rawCard.ontology_bridge_brief_en)
        ? {
            ...rawCard.ontology_bridge_brief_en,
            ticker:
              stringValue(rawCard.ontology_bridge_brief_en.ticker) ??
              discovery.intent.ticker,
            company_name:
              stringValue(rawCard.ontology_bridge_brief_en.company_name) ??
              discovery.intent.companyName,
            source_urls: sourceUrls,
          }
        : fallbackBridgeBrief({
            card: rawCard,
            discovery,
            sourceUrls,
            titleKo,
          }),
      ui: {
        button_label_ko: "이 뉴스로 공시 분석",
        badge_ko:
          discovery.intent.direction === "down"
            ? "약세 요인"
            : discovery.intent.direction === "up"
              ? "강세 요인"
              : "시장 뉴스",
        confidence_label_ko: "뉴스 확인",
        ...(isRecord(rawCard.ui) ? rawCard.ui : {}),
      },
    });
  }

  return normalized.slice(0, 5);
}

function buildFallbackCards(
  discovery: NewsDiscoverySearchResult,
): AtomicNewsEventCard[] {
  const articles = readRecordArray(discovery.rawSearchResult.articles)
    .filter(isPreferredMarketNewsSource)
    .slice(0, 5);

  return articles.map((article, index) => {
    const title = stringValue(article.title) ?? "Selected market news";
    const url = displayableMarketNewsUrl(article.url);
    const domain = stringValue(article.source_domain, article.domain);
    const publisher = stringValue(article.source_name, domain);
    const source = {
      title_original: title,
      title: title,
      url,
      domain,
      publisher,
      published_at: stringValue(article.published_at),
      snippet_summary: stringValue(article.snippet),
      source_kind: "market_news",
    };
    const summary =
      stringValue(article.snippet) ??
      "Selected source article for filing-grounded analysis.";
    const sourceUrls = url ? [url] : [];

    return {
      id: buildStableCardId(title, index),
      ticker: discovery.intent.ticker,
      company_name: discovery.intent.companyName,
      event_title: title,
      original_headline: title,
      short_summary: summary,
      price_impact_direction:
        discovery.intent.direction === "down"
          ? "negative"
          : discovery.intent.direction === "up"
            ? "positive"
            : "unclear",
      source_previews: [source],
      primary_source: source,
      major_news_urls: sourceUrls,
      reader_urls: sourceUrls,
      ontology_bridge_brief_en: fallbackBridgeBrief({
        card: {},
        discovery,
        sourceUrls,
        titleKo: title,
      }),
      ui: {
        button_label_ko: "이 뉴스로 공시 분석",
        badge_ko: "원문 뉴스",
        confidence_label_ko: "원문 후보",
      },
    };
  });
}

function fallbackBridgeBrief(params: {
  card: Record<string, unknown>;
  discovery: NewsDiscoverySearchResult;
  sourceUrls: string[];
  titleKo: string;
}) {
  const ticker = params.discovery.intent.ticker;
  const companyName = params.discovery.intent.companyName;
  return {
    ticker,
    company_name: companyName,
    event: [
      ticker,
      companyName,
      params.discovery.intent.direction === "down"
        ? "negative share-price reaction"
        : params.discovery.intent.direction === "up"
          ? "positive share-price reaction"
          : "market-news reaction",
      params.titleKo,
    ]
      .filter(Boolean)
      .join(" - "),
    likely_financial_axes: [
      "revenue",
      "gross_margin",
      "operating_margin",
      "cash_flow",
      "capex",
    ],
    likely_business_axes: ["demand", "pricing", "risk_factors", "guidance"],
    suggested_ontology_questions: [
      `Check filings for ${ticker ?? companyName ?? "the company"} disclosures that support or limit this market-news narrative.`,
      "Compare the news claim against revenue, margin, cash flow, capex, and risk factor disclosures.",
    ],
    source_urls: params.sourceUrls,
  };
}

function usageFromResultMessage(message: {
  usage?: unknown;
  modelUsage?: unknown;
}): NewsDiscoveryCardComposition["usage"] {
  const usage = isRecord(message.usage) ? message.usage : {};
  const inputTokens = numberValue(usage.input_tokens) ?? 0;
  const outputTokens = numberValue(usage.output_tokens) ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimateCost(inputTokens, outputTokens),
  };
}

function normalizeImpact(value: unknown): AtomicNewsEventCard["price_impact_direction"] {
  if (
    value === "negative" ||
    value === "positive" ||
    value === "mixed" ||
    value === "unclear"
  ) {
    return value;
  }
  return "unclear";
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isEnglishHeavy(value: string): boolean {
  const latinCount = (value.match(/[A-Za-z]/g) ?? []).length;
  const hangulCount = (value.match(/[가-힣]/g) ?? []).length;
  return latinCount >= 24 && latinCount > Math.max(8, hangulCount * 1.4);
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildStableCardId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "news-event"}-${index + 1}`;
}

const CARD_COMPOSER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: true,
        required: [
          "id",
          "event_title_ko",
          "summary_ko",
          "source_previews",
          "ontology_bridge_brief_en",
        ],
        properties: {
          id: { type: "string" },
          ticker: { type: "string" },
          company_name: { type: "string" },
          event_title: { type: "string" },
          event_title_ko: { type: "string" },
          original_headline: { type: "string" },
          summary_ko: { type: "string" },
          short_summary: { type: "string" },
          price_impact_direction: {
            type: "string",
            enum: ["negative", "positive", "mixed", "unclear"],
          },
          event_type: { type: "string" },
          source_previews: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["title_original", "url", "domain", "publisher"],
              properties: {
                title_original: { type: "string" },
                title_ko: { type: "string" },
                url: { type: "string" },
                domain: { type: "string" },
                publisher: { type: "string" },
                published_at: { type: ["string", "null"] },
                summary_ko: { type: "string" },
                snippet_summary: { type: "string" },
                source_kind: { type: "string" },
              },
            },
          },
          ontology_bridge_brief_en: {
            type: "object",
            additionalProperties: true,
            required: [
              "event",
              "likely_financial_axes",
              "likely_business_axes",
              "suggested_ontology_questions",
              "source_urls",
            ],
            properties: {
              ticker: { type: "string" },
              company_name: { type: "string" },
              event: { type: "string" },
              likely_financial_axes: {
                type: "array",
                items: { type: "string" },
              },
              likely_business_axes: {
                type: "array",
                items: { type: "string" },
              },
              suggested_ontology_questions: {
                type: "array",
                items: { type: "string" },
              },
              source_urls: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
          ui: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    empty_state: {
      type: "object",
      additionalProperties: true,
    },
  },
  required: ["cards"],
} as const;
