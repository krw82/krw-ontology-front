import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalNewsRuntimeConfig } from "@/lib/local-news/config";
import { FinnhubNewsProviderError, type FinnhubNewsProvider } from "@/lib/local-news/finnhub";
import { LocalNewsVault } from "@/lib/local-news/vault";
import { runLocalNewsCycle } from "@/lib/local-news/worker";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function config(overrides: Partial<LocalNewsRuntimeConfig> = {}): LocalNewsRuntimeConfig {
  return {
    enabled: true,
    environment: "prod",
    workerId: "test-local-news-worker",
    intervalMs: 900_000,
    coverageBatchSize: 45,
    maxArticlesPerTicker: 3,
    lookbackHours: 12,
    finnhubTimeoutMs: 2_000,
    finnhubRequestIntervalMs: 0,
    finnhubApiKey: "finnhub-key",
    zaiApiKey: "zai-key",
    zaiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
    zaiModel: "glm-5.1",
    zaiTimeoutMs: 120_000,
    zaiMaxTokens: 2_048,
    vaultPath: join(tmpdir(), "local-news-worker-test.enc"),
    vaultKey: "a".repeat(64),
    publishMode: "publish",
    marketIssueNotificationsEnabled: false,
    ...overrides,
  };
}

describe("runLocalNewsCycle", () => {
  it("does not call Finnhub until a Z.ai key is configured", async () => {
    const fetchCompanyNews = vi.fn();
    const result = await runLocalNewsCycle({
      config: config({ zaiApiKey: null }),
      provider: { fetchCompanyNews } as unknown as FinnhubNewsProvider,
    });

    expect(result).toMatchObject({ skipped: true, reason: "local_news_zai_api_key_missing" });
    expect(fetchCompanyNews).not.toHaveBeenCalled();
  });

  it("archives a local rejection without writing a public issue", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-news-worker-"));
    directories.push(directory);
    const article = {
      ticker: "AAPL",
      articleId: "private-id",
      headline: "Company reports results",
      summary: "Revenue was $100 million.",
      url: "https://private.example/article",
      publishedAt: "2026-08-10T00:00:00.000Z",
      contentHash: "private-hash",
    };
    const vault = new LocalNewsVault({ path: join(directory, "vault.enc"), key: "a".repeat(64) });
    const result = await runLocalNewsCycle({
      config: config({ vaultPath: join(directory, "vault.enc") }),
      provider: { fetchCompanyNews: vi.fn().mockResolvedValue([article]) } as unknown as FinnhubNewsProvider,
      vault,
      db: {} as never,
      coverage: vi.fn().mockResolvedValue([{ ticker: "AAPL", coverageCount: 1, maxPriority: 0 }]),
      curate: vi.fn().mockResolvedValue({ status: "rejected", reason: "not_market_relevant" }),
    });

    expect(result).toMatchObject({ coverageTickers: 1, fetched: 1, rejected: 1, accepted: 0, published: 0, failed: 0 });
    expect((await vault.reserve(article)).status).toBe("rejected");
  });

  it("reprocesses an older vault item after the Finnhub lookback window", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-news-worker-"));
    directories.push(directory);
    const article = {
      ticker: "AAPL",
      articleId: "private-id",
      headline: "Company reports results",
      summary: "Revenue was $100 million.",
      url: "https://private.example/article",
      publishedAt: "2026-08-01T00:00:00.000Z",
      contentHash: "private-hash",
    };
    const vault = new LocalNewsVault({ path: join(directory, "vault.enc"), key: "a".repeat(64) });
    await vault.reserve(article);
    const publish = vi.fn().mockResolvedValue("public-issue-id");
    const result = await runLocalNewsCycle({
      config: config({ vaultPath: join(directory, "vault.enc") }),
      provider: { fetchCompanyNews: vi.fn().mockResolvedValue([]) } as unknown as FinnhubNewsProvider,
      vault,
      db: {} as never,
      coverage: vi.fn().mockResolvedValue([{ ticker: "AAPL", coverageCount: 1, maxPriority: 0 }]),
      curate: vi.fn().mockResolvedValue({
        status: "accepted",
        issue: {
          titleKo: "회사 실적 발표",
          summaryKo: "회사가 실적을 발표했다.",
          impactPath: ["회사가 실적을 발표했다.", "향후 수익성 관련 정보를 검토할 필요가 있다."],
          confirmedFacts: ["매출이 $100 million으로 발표됐다."],
          riskLevel: "medium",
          stage: "ai_verified",
          claims: [],
        },
      }),
      publish,
    });

    expect(result).toMatchObject({ coverageTickers: 1, fetched: 0, reprocessed: 1, accepted: 1, published: 1, failed: 0 });
    expect(publish).toHaveBeenCalledOnce();
    expect((await vault.reserve(article)).curationVersion).toBe("zai-v2");
  });

  it("fans out only a newly published verified issue when personal market alerts are enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-news-worker-"));
    directories.push(directory);
    const article = {
      ticker: "AAPL",
      articleId: "private-id",
      headline: "Company reports results",
      summary: "Revenue was $100 million.",
      url: "https://private.example/article",
      publishedAt: "2026-08-10T00:00:00.000Z",
      contentHash: "private-hash",
    };
    const fanoutMarketIssueNotifications = vi.fn().mockResolvedValue(2);
    const result = await runLocalNewsCycle({
      config: config({
        vaultPath: join(directory, "vault.enc"),
        marketIssueNotificationsEnabled: true,
      }),
      provider: { fetchCompanyNews: vi.fn().mockResolvedValue([article]) } as unknown as FinnhubNewsProvider,
      vault: new LocalNewsVault({ path: join(directory, "vault.enc"), key: "a".repeat(64) }),
      db: {} as never,
      coverage: vi.fn().mockResolvedValue([{ ticker: "AAPL", coverageCount: 1, maxPriority: 0 }]),
      curate: vi.fn().mockResolvedValue({
        status: "accepted",
        issue: {
          titleKo: "회사 실적 발표",
          summaryKo: "회사가 실적을 발표했다.",
          impactPath: ["회사가 실적을 발표했다."],
          confirmedFacts: ["매출이 $100 million으로 발표됐다."],
          riskLevel: "high",
          stage: "ai_verified",
          claims: [],
        },
      }),
      publish: vi.fn().mockResolvedValue("11111111-1111-4111-8111-111111111111"),
      fanoutMarketIssueNotifications,
    });

    expect(result).toMatchObject({ published: 1, notificationsCreated: 2, notificationFailures: 0 });
    expect(fanoutMarketIssueNotifications).toHaveBeenCalledWith(expect.objectContaining({
      environment: "prod",
      marketIssueId: "11111111-1111-4111-8111-111111111111",
    }));
  });

  it("uses the active catalog universe for the configured environment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-news-worker-"));
    directories.push(directory);
    const fetchCompanyNews = vi.fn().mockResolvedValue([]);
    const inputCoverage = vi.fn().mockResolvedValue([
      { ticker: "MSFT", coverageCount: 1, maxPriority: 0 },
      { ticker: "NVDA", coverageCount: 1, maxPriority: 0 },
    ]);
    const result = await runLocalNewsCycle({
      config: config({ vaultPath: join(directory, "vault.enc") }),
      provider: { fetchCompanyNews } as unknown as FinnhubNewsProvider,
      vault: new LocalNewsVault({ path: join(directory, "vault.enc"), key: "a".repeat(64) }),
      db: {} as never,
      coverage: inputCoverage,
    });

    expect(result).toMatchObject({ coverageTickers: 2, selectedTickers: 2, fetched: 0, failed: 0 });
    expect(inputCoverage).toHaveBeenCalledWith(expect.anything(), "prod");
    expect(fetchCompanyNews).toHaveBeenCalledTimes(2);
    expect(fetchCompanyNews).toHaveBeenNthCalledWith(1, expect.objectContaining({ ticker: "MSFT" }));
    expect(fetchCompanyNews).toHaveBeenNthCalledWith(2, expect.objectContaining({ ticker: "NVDA" }));
  });

  it("rotates the active catalog in bounded batches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-news-worker-"));
    directories.push(directory);
    const vaultPath = join(directory, "vault.enc");
    const vault = new LocalNewsVault({ path: vaultPath, key: "a".repeat(64) });
    const coverage = vi.fn().mockResolvedValue([
      { ticker: "AAPL", coverageCount: 1, maxPriority: 0 },
      { ticker: "MSFT", coverageCount: 1, maxPriority: 0 },
      { ticker: "NVDA", coverageCount: 1, maxPriority: 0 },
    ]);
    const fetchCompanyNews = vi.fn().mockResolvedValue([]);

    const first = await runLocalNewsCycle({
      config: config({ vaultPath, coverageBatchSize: 2 }),
      provider: { fetchCompanyNews } as unknown as FinnhubNewsProvider,
      vault,
      db: {} as never,
      coverage,
    });
    const second = await runLocalNewsCycle({
      config: config({ vaultPath, coverageBatchSize: 2 }),
      provider: { fetchCompanyNews } as unknown as FinnhubNewsProvider,
      vault,
      db: {} as never,
      coverage,
    });

    expect(first).toMatchObject({ coverageTickers: 3, selectedTickers: 2, failed: 0 });
    expect(second).toMatchObject({ coverageTickers: 3, selectedTickers: 2, failed: 0 });
    expect(fetchCompanyNews.mock.calls.map(([input]) => input.ticker)).toEqual(["AAPL", "MSFT", "NVDA", "AAPL"]);
  });

  it("waits for one Finnhub rate-limit reset and retries the same ticker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-news-worker-"));
    directories.push(directory);
    const fetchCompanyNews = vi.fn()
      .mockRejectedValueOnce(new FinnhubNewsProviderError({
        kind: "rate_limited",
        message: "finnhub_company_news_failed_429",
        status: 429,
        retryAfterMs: 1,
      }))
      .mockResolvedValueOnce([]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runLocalNewsCycle({
      config: config({ vaultPath: join(directory, "vault.enc"), finnhubRequestIntervalMs: 0 }),
      provider: { fetchCompanyNews } as unknown as FinnhubNewsProvider,
      vault: new LocalNewsVault({ path: join(directory, "vault.enc"), key: "a".repeat(64) }),
      db: {} as never,
      coverage: vi.fn().mockResolvedValue([{ ticker: "AAPL", coverageCount: 1, maxPriority: 0 }]),
      sleep,
    });

    expect(result).toMatchObject({ fetchRateLimited: 1, fetchFailures: 0, failed: 0 });
    expect(fetchCompanyNews).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });
});
