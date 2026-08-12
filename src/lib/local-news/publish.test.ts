import { describe, expect, it } from "vitest";

import { buildLocalNewsPublicIssueRow } from "@/lib/local-news/publish";

describe("buildLocalNewsPublicIssueRow", () => {
  it("contains only the provider-agnostic public projection", () => {
    const row = buildLocalNewsPublicIssueRow({
      environment: "prod",
      eventKey: "local-news-opaque-id",
      publishMode: "publish",
      now: "2026-08-10T10:00:00.000Z",
      issue: {
        titleKo: "회사 실적 발표",
        summaryKo: "확인된 내용을 정리했습니다.",
        impactPath: ["실적 발표", "향후 수익성 검토 필요"],
        confirmedFacts: ["확인된 사실"],
        riskLevel: "medium",
        stage: "ai_verified",
      },
    });

    expect(row).toMatchObject({
      state: "published",
      source_count: 0,
      source_summary: {},
      local_news_stage: "ai_verified",
      impact_path: ["실적 발표", "향후 수익성 검토 필요"],
    });
    const keys = Object.keys(row);
    for (const prohibitedKey of [
      "provider",
      "source_url",
      "canonical_url",
      "article_id",
      "source_article_id",
      "source_hash",
      "content_hash",
      "ingested_at",
      "source_published_at",
    ]) {
      expect(keys).not.toContain(prohibitedKey);
    }
  });
});
