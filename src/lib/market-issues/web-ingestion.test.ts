import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assessMarketWebArticleQuality,
  classifyMarketWebFetchFailure,
  extractMarketWebArticle,
  extractMarketWebSourceCandidates,
  fetchMarketWebTextDocument,
  type MarketWebSourceRuntimeConfig,
} from "@/lib/market-issues/web-ingestion";

const config: MarketWebSourceRuntimeConfig = {
  environment: "dev",
  workerId: "test-worker",
  maxQueueJobs: 1,
  visibilitySeconds: 300,
  httpTimeoutMs: 1_000,
  maxResponseBytes: 1_000_000,
  hardMaxResponseBytes: 8_000_000,
  webSources: [],
  newsClassifierEnabled: false,
  zaiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
  zaiApiKey: "",
  zaiModel: "glm-5.1",
  zaiTimeoutMs: 5_000,
  fmpNewsEnabled: false,
  fmpNewsMaxAgeHours: 72,
  fmpNewsSymbolBatchSize: 40,
};

const source = {
  canonical_host: "investor.example.com",
  adapter_type: "html_list",
  source_tags: ["ir"],
  adapter_config: {
    allowed_hosts: ["news.example.com"],
    min_body_chars: 160,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("market web source ingestion", () => {
  it("accepts a successful response without a Location header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<main>valid page</main>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const document = await fetchMarketWebTextDocument("https://investor.example.com/news", source, config);

    expect(document.status).toBe(200);
    expect(document.url).toBe("https://investor.example.com/news");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows an approved redirect and rejects an unapproved one", async () => {
    const approvedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://news.example.com/release" } }))
      .mockResolvedValueOnce(new Response("<main>valid page</main>", { status: 200 }));
    vi.stubGlobal("fetch", approvedFetch);

    await expect(fetchMarketWebTextDocument("https://investor.example.com/news", source, config))
      .resolves.toMatchObject({ url: "https://news.example.com/release", status: 200 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://untrusted.example/release" },
    })));
    await expect(fetchMarketWebTextDocument("https://investor.example.com/news", source, config))
      .rejects.toThrow("market_web_host_not_allowlisted");
  });

  it("uses separate allowlists for discovery and detail URLs", async () => {
    const purposeSource = {
      ...source,
      adapter_config: {
        discovery_allowed_hosts: ["discovery.example.com"],
        detail_allowed_hosts: ["detail.example.com"],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes("investor.example.com")) {
        return Promise.resolve(new Response(null, {
          status: 302,
          headers: { location: "https://discovery.example.com/feed" },
        }));
      }
      return Promise.resolve(new Response("<main>Article body</main>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }));
    }));

    await expect(fetchMarketWebTextDocument("https://investor.example.com/feed", purposeSource, config))
      .resolves.toMatchObject({ url: "https://discovery.example.com/feed", status: 200 });
    await expect(fetchMarketWebTextDocument("https://detail.example.com/article", purposeSource, config))
      .rejects.toThrow("market_web_host_not_allowlisted");
    await expect(fetchMarketWebTextDocument("https://detail.example.com/article", purposeSource, config, {}, "detail"))
      .resolves.toMatchObject({ url: "https://detail.example.com/article", status: 200 });
    expect(extractMarketWebSourceCandidates({
      url: "https://investor.example.com/feed",
      status: 200,
      body: '<a href="https://detail.example.com/article">Article</a>',
      contentType: "text/html",
      etag: null,
      lastModified: null,
    }, purposeSource)).toMatchObject([{ url: "https://detail.example.com/article" }]);
  });

  it("requires an RSS payload only for discovery, not for the linked article", async () => {
    const rssSource = {
      ...source,
      adapter_type: "rss",
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response("<html><main>Article body</main></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }))));

    await expect(fetchMarketWebTextDocument("https://investor.example.com/feed", rssSource, config))
      .rejects.toThrow("market_web_feed_payload_invalid");
    await expect(fetchMarketWebTextDocument("https://investor.example.com/article", rssSource, config, {}, "detail"))
      .resolves.toMatchObject({ status: 200, contentType: "text/html" });
  });

  it("prefers semantic article content over page navigation", () => {
    const article = extractMarketWebArticle({
      url: "https://investor.example.com/news/release",
      status: 200,
      body: `
        <html><head><title>Quarterly Results</title></head>
        <body><nav>${"Navigation ".repeat(200)}</nav>
        <article><p>${"Revenue grew as the company reported its quarterly results. ".repeat(12)}</p></article>
        <footer>${"Footer ".repeat(200)}</footer></body></html>`,
      contentType: "text/html",
      etag: null,
      lastModified: null,
    }, source, { candidate_url: "https://investor.example.com/news/release", title: "Quarterly Results" });

    expect(article.extractionMethod).toBe("semantic_html");
    expect(article.body).toContain("Revenue grew");
    expect(article.body).not.toContain("Navigation");
    expect(assessMarketWebArticleQuality(article, source, config)).toMatchObject({ accepted: true });
  });

  it("rejects short or low-confidence detail before it reaches the issue pipeline", () => {
    expect(assessMarketWebArticleQuality({
      canonicalUrl: "https://investor.example.com/news/short",
      title: "Short update",
      body: "Too short",
      imageUrls: [],
      publishedAt: null,
      publishedAtIsInferred: false,
      extractionMethod: "html_text",
      extractionConfidence: 0.4,
    }, source, config)).toMatchObject({ accepted: false, reason: "body_too_short" });
  });

  it("classifies permanent and retryable failures differently", () => {
    expect(classifyMarketWebFetchFailure(new Error("market_web_http_404"))).toMatchObject({
      healthStatus: "invalid",
      terminal: true,
    });
    expect(classifyMarketWebFetchFailure(new Error("market_web_http_403"))).toMatchObject({
      healthStatus: "blocked",
      terminal: true,
    });
    expect(classifyMarketWebFetchFailure(new Error("This operation was aborted"), 3)).toMatchObject({
      healthStatus: "degraded",
      terminal: false,
      retryAfterSeconds: 240,
    });
  });
});
