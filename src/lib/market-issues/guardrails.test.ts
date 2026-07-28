import { describe, expect, it } from "vitest";
import {
  buildReviewOnlyDraft,
  parseMarketIssueGeneratedBrief,
} from "@/lib/market-issues/guardrails";

describe("market issue guardrails", () => {
  it("rejects summaries that turn a source into a trading signal", () => {
    expect(parseMarketIssueGeneratedBrief({
      market_relevant: true,
      event_key: "nvda-demand-update",
      title_ko: "엔비디아 수요 업데이트",
      summary_ko: "지금 매수해야 하는 호재입니다.",
      impact_path: [],
      confirmed_facts: [],
      unconfirmed_facts: [],
      status_labels: ["새 이슈"],
      entities: [],
      risk_level: "low",
    })).toBeNull();
  });

  it("keeps a missing summarizer output in manual-review language", () => {
    const draft = buildReviewOnlyDraft({
      eventKey: "x-company-123",
      displayName: "Company IR",
      originalText: "We announced a product update.",
      sourceTags: ["COMP"],
    });

    expect(draft.statusLabels).toEqual(["추가 확인 필요"]);
    expect(draft.unconfirmedFacts).toContain("한국어 요약과 사건 분류를 검토해야 합니다.");
    expect(draft.titleKo).toContain("검토 대기");
  });
});
