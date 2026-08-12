import { describe, expect, it } from "vitest";

import { normalizeMarketIssue } from "@/components/news/news-model";

describe("market issue local-news states", () => {
  it("exposes only Z.ai-verified local-news state", () => {
    const unsupportedStage = normalizeMarketIssue({
      id: "unsupported-stage-issue",
      title: "일반 뉴스",
      summary: "일반 결과",
      local_news_stage: "unsupported",
    });
    const verified = normalizeMarketIssue({
      id: "verified-issue",
      title: "검증 뉴스",
      summary: "검증 결과",
      local_news_stage: "ai_verified",
    });

    expect(unsupportedStage).toMatchObject({ localNewsStage: "standard" });
    expect(verified).toMatchObject({
      localNewsStage: "ai_verified",
    });
  });
});
