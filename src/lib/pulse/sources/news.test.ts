import { describe, expect, it } from "vitest";
import { buildMarketIssuePulseCandidates } from "@/lib/pulse/sources/news";

const now = new Date("2026-07-30T12:00:00.000Z");

function issue(id: string, ticker: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    event_key: `event-${id}`,
    title_ko: `${ticker} 관련 시장 이슈`,
    summary_ko: `${ticker} 공개 출처를 확인했습니다.`,
    status_labels: ["새 이슈"],
    source_summary: { official: 1 },
    source_count: 2,
    market_score: 50,
    risk_level: "medium",
    update_count: 0,
    last_published_at: "2026-07-30T08:00:00.000Z",
    updated_at: "2026-07-30T08:00:00.000Z",
    ...overrides,
  };
}

function entity(issueId: string, ticker: string, relationship = "direct") {
  return {
    issue_id: issueId,
    ticker,
    entity_name: ticker,
    relationship,
    confidence: 0.9,
  };
}

describe("market issue Pulse source", () => {
  it("keeps only fresh, unhidden published projections and prioritizes relevant news", () => {
    const candidates = buildMarketIssuePulseCandidates({
      issues: [
        issue("aapl", "AAPL"),
        issue("market", "XOM", { market_score: 90 }),
        issue("hidden", "MSFT"),
        issue("old", "NVDA", { last_published_at: "2026-07-10T08:00:00.000Z" }),
      ],
      entities: [
        entity("aapl", "AAPL"),
        entity("market", "XOM"),
        entity("hidden", "MSFT"),
        entity("old", "NVDA"),
      ],
      userStates: [{ issue_id: "hidden", is_hidden: true }],
      preferredTickers: ["AAPL"],
      followedTickers: [],
      now,
    });

    expect(candidates.map((candidate) => candidate.source_id)).toEqual(["aapl", "market"]);
    expect(candidates[0]).toMatchObject({
      kind: "news",
      source_type: "news",
      ticker: "AAPL",
      reason_code: "news_personal_match",
      metadata: {
        market_issue_personal_match: true,
        covered_tickers_csv: "AAPL",
      },
    });
    expect(candidates[0]?.primary_action).toMatchObject({ href: "/news/aapl?source=pulse" });
  });

  it("caps the reservoir while retaining personal issues ahead of market breadth", () => {
    const issues = Array.from({ length: 28 }, (_, index) => issue(
      `issue-${index}`,
      `T${index}`,
      { market_score: 100 - index },
    ));
    const candidates = buildMarketIssuePulseCandidates({
      issues,
      entities: issues.map((entry, index) => entity(String(entry.id), `T${index}`)),
      userStates: [],
      preferredTickers: ["T24"],
      followedTickers: [],
      now,
    });

    expect(candidates).toHaveLength(18);
    expect(candidates[0]?.ticker).toBe("T24");
  });
});
