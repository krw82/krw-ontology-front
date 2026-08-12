import { describe, expect, it, vi } from "vitest";

import { curateLocalNewsArticle, parseLocalNewsCandidate } from "@/lib/local-news/curator";
import type { LocalNewsRuntimeConfig } from "@/lib/local-news/config";

const article = {
  headline: "Company reports results",
  summary: "Revenue was $100 million. The company did not provide a forecast.",
};

const runtimeConfig: LocalNewsRuntimeConfig = {
  enabled: true,
  environment: "prod",
  workerId: "test-local-news-worker",
  intervalMs: 900_000,
  coverageBatchSize: 45,
  maxArticlesPerTicker: 3,
  lookbackHours: 12,
  finnhubTimeoutMs: 2_000,
  finnhubRequestIntervalMs: 1_250,
  finnhubApiKey: "finnhub-key",
  zaiApiKey: "zai-key",
  zaiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
  zaiModel: "glm-5.1",
  zaiTimeoutMs: 120_000,
  zaiMaxTokens: 2_048,
  vaultPath: "/tmp/local-news-test.enc",
  vaultKey: "a".repeat(64),
  publishMode: "publish",
  marketIssueNotificationsEnabled: false,
};

describe("parseLocalNewsCandidate", () => {
  it("keeps only claims whose quote is an exact source substring", () => {
    const candidate = parseLocalNewsCandidate({
      title_ko: "회사 실적 발표",
      summary_ko: "회사는 실적을 발표했고 전망은 제시하지 않았다고 밝혔다.",
      impact_path: [
        "회사가 실적을 발표했다.",
        "향후 실적 기대와 비용 구조를 추가로 검토할 필요가 있다.",
      ],
      claims: [{
        id: "revenue",
        claim_ko: "매출이 $100 million으로 발표됐다.",
        source_quote: "Revenue was $100 million.",
        raw_value: "$100 million",
        evidence_ids: ["article"],
      }],
    }, article);

    expect(candidate?.confirmedFacts).toEqual(["매출이 $100 million으로 발표됐다."]);
    expect(candidate?.impactPath).toHaveLength(2);
  });

  it("rejects a directional price prediction in an impact path", () => {
    const candidate = parseLocalNewsCandidate({
      title_ko: "회사 실적 발표",
      summary_ko: "회사가 실적을 발표했다.",
      impact_path: [
        "회사가 실적을 발표했다.",
        "주가 상승으로 이어질 수 있다.",
      ],
      claims: [{
        id: "revenue",
        claim_ko: "매출이 $100 million으로 발표됐다.",
        source_quote: "Revenue was $100 million.",
        raw_value: "$100 million",
        evidence_ids: ["article"],
      }],
    }, article);

    expect(candidate).toBeNull();
  });

  it("rejects investment language even when a source quote exists", () => {
    const candidate = parseLocalNewsCandidate({
      title_ko: "매수해야 할 실적 발표",
      summary_ko: "회사가 실적을 발표했다.",
      impact_path: ["회사가 실적을 발표했다.", "비용 구조를 검토할 필요가 있다."],
      claims: [{
        id: "revenue",
        claim_ko: "매출이 $100 million으로 발표됐다.",
        source_quote: "Revenue was $100 million.",
        raw_value: "$100 million",
        evidence_ids: ["article"],
      }],
    }, article);

    expect(candidate).toBeNull();
  });

  it("requires the verifier to explicitly approve the impact path", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        market_relevant: true,
        title_ko: "회사 실적 발표",
        summary_ko: "회사가 실적을 발표했다.",
        impact_path: ["회사가 실적을 발표했다.", "향후 수익성 관련 정보를 검토할 필요가 있다."],
        claims: [{
          id: "revenue",
          claim_ko: "매출이 $100 million으로 발표됐다.",
          source_quote: "Revenue was $100 million.",
          raw_value: "$100 million",
          evidence_ids: ["article"],
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ approved: true, impact_path_verified: true }));

    const result = await curateLocalNewsArticle({
      article: { ...article, ticker: "AAPL", articleId: "private-id", url: "https://private.example/article", publishedAt: "2026-08-10T00:00:00.000Z", contentHash: "private-hash" },
      config: runtimeConfig,
      fetchImpl,
    });

    expect(result).toMatchObject({ status: "accepted" });
    expect(result.status === "accepted" && result.issue.impactPath).toEqual([
      "회사가 실적을 발표했다.",
      "향후 수익성 관련 정보를 검토할 필요가 있다.",
    ]);
  });

  it("rejects a candidate when the verifier does not validate its impact path", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        market_relevant: true,
        title_ko: "회사 실적 발표",
        summary_ko: "회사가 실적을 발표했다.",
        impact_path: ["회사가 실적을 발표했다.", "향후 수익성 관련 정보를 검토할 필요가 있다."],
        claims: [{
          id: "revenue",
          claim_ko: "매출이 $100 million으로 발표됐다.",
          source_quote: "Revenue was $100 million.",
          raw_value: "$100 million",
          evidence_ids: ["article"],
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ approved: true, impact_path_verified: false }));

    const result = await curateLocalNewsArticle({
      article: { ...article, ticker: "AAPL", articleId: "private-id", url: "https://private.example/article", publishedAt: "2026-08-10T00:00:00.000Z", contentHash: "private-hash" },
      config: runtimeConfig,
      fetchImpl,
    });

    expect(result).toEqual({ status: "rejected", reason: "second_pass_rejected" });
  });
});

function jsonResponse(content: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
