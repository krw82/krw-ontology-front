import { createHash } from "node:crypto";

export type LocalNewsArticle = {
  ticker: string;
  articleId: string;
  headline: string;
  summary: string;
  url: string;
  publishedAt: string;
  contentHash: string;
};

type FinnhubCompanyNewsItem = {
  id?: unknown;
  headline?: unknown;
  summary?: unknown;
  url?: unknown;
  datetime?: unknown;
};

export type FinnhubNewsErrorKind = "rate_limited" | "timeout" | "http" | "network" | "invalid_response";

export class FinnhubNewsProviderError extends Error {
  readonly kind: FinnhubNewsErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(input: {
    kind: FinnhubNewsErrorKind;
    message: string;
    status?: number;
    retryAfterMs?: number | null;
  }) {
    super(input.message);
    this.name = "FinnhubNewsProviderError";
    this.kind = input.kind;
    this.status = input.status ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }
}

export class FinnhubNewsProvider {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(input: { apiKey: string; fetchImpl?: typeof fetch }) {
    this.#apiKey = input.apiKey;
    this.#fetch = input.fetchImpl || fetch;
  }

  async fetchCompanyNews(input: {
    ticker: string;
    from: Date;
    to: Date;
    timeoutMs: number;
    maxItems: number;
  }): Promise<LocalNewsArticle[]> {
    const ticker = input.ticker.trim().toUpperCase();
    const url = new URL("https://finnhub.io/api/v1/company-news");
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("from", dateOnly(input.from));
    url.searchParams.set("to", dateOnly(input.to));
    url.searchParams.set("token", this.#apiKey);

    let response: Response;
    try {
      response = await this.#fetch(url, { signal: AbortSignal.timeout(input.timeoutMs) });
    } catch (error) {
      if (isTimeout(error)) {
        throw new FinnhubNewsProviderError({ kind: "timeout", message: "finnhub_company_news_timeout" });
      }
      throw new FinnhubNewsProviderError({ kind: "network", message: "finnhub_company_news_network_failed" });
    }
    if (!response.ok) {
      const rateLimited = response.status === 429;
      throw new FinnhubNewsProviderError({
        kind: rateLimited ? "rate_limited" : "http",
        message: "finnhub_company_news_failed_" + response.status,
        status: response.status,
        retryAfterMs: rateLimited ? retryAfterMs(response.headers) : null,
      });
    }
    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new FinnhubNewsProviderError({ kind: "invalid_response", message: "finnhub_company_news_invalid_json" });
    }
    if (!Array.isArray(payload)) {
      throw new FinnhubNewsProviderError({ kind: "invalid_response", message: "finnhub_company_news_invalid_response" });
    }

    const seen = new Set<string>();
    const articles: LocalNewsArticle[] = [];
    for (const item of payload) {
      const article = toLocalNewsArticle(ticker, item);
      if (!article || !withinRange(article.publishedAt, input.from, input.to) || seen.has(article.contentHash)) continue;
      seen.add(article.contentHash);
      articles.push(article);
    }
    return articles
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
      .slice(0, input.maxItems);
  }
}

function withinRange(publishedAt: string, from: Date, to: Date): boolean {
  const timestamp = Date.parse(publishedAt);
  return Number.isFinite(timestamp) && timestamp >= from.getTime() && timestamp <= to.getTime();
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
    || error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function retryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds * 1_000), 300_000);
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.min(Math.max(0, timestamp - Date.now()), 300_000);
  }
  const resetEpochSeconds = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
    return Math.min(Math.max(0, resetEpochSeconds * 1_000 - Date.now() + 250), 300_000);
  }
  return null;
}

export function toLocalNewsArticle(
  ticker: string,
  value: unknown,
): LocalNewsArticle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as FinnhubCompanyNewsItem;
  const articleId = identifier(item.id);
  const headline = text(item.headline, 500);
  const summary = text(item.summary, 2_000);
  const url = text(item.url, 2_000);
  const publishedAt = toPublishedAt(item.datetime);
  if (!articleId || !headline || !summary || !url || !publishedAt || !/^https:\/\//i.test(url)) {
    return null;
  }
  const normalizedTicker = ticker.trim().toUpperCase();
  const contentHash = createHash("sha256")
    .update(JSON.stringify({ normalizedTicker, articleId, url, headline, summary }))
    .digest("hex");
  return { ticker: normalizedTicker, articleId, headline, summary, url, publishedAt, contentHash };
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toPublishedAt(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function identifier(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return text(value, 120);
}
