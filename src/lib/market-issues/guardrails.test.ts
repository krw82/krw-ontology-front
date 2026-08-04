import { describe, expect, it } from "vitest";
import {
  buildReviewOnlyDraft,
  parseMarketIssueGeneratedBrief,
} from "@/lib/market-issues/guardrails";
import { parseMarketIssueResearchPaths } from "@/lib/market-issues/contract";

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

  it("keeps only source-grounded next research questions from the model payload", () => {
    const brief = parseMarketIssueGeneratedBrief({
      market_relevant: true,
      event_key: "nvda-korea-ai-infrastructure",
      title_ko: "엔비디아가 한국 AI 인프라 확장 계획을 공개",
      summary_ko: "엔비디아 공식 계정이 NAVER 및 Brookfield와의 한국 AI 인프라 확장 계획을 공개했습니다.",
      impact_path: ["AI 인프라 구축", "클라우드 컴퓨팅 수요"],
      confirmed_facts: ["엔비디아 공식 계정이 한국 AI 인프라 확장 계획을 공개했습니다."],
      unconfirmed_facts: [],
      research_paths: [
        {
          id: "guidance-check",
          question: "한국 AI 인프라 계획이 데이터센터 매출 가이던스에 반영됐는지 확인할까?",
          evidence_targets: ["엔비디아 실적발표 자료", "경영진 실적콜"],
          related_tickers: ["NVDA"],
          priority: 1,
          chat_query: "엔비디아의 한국 AI 인프라 계획이 데이터센터 매출 가이던스에 반영됐는지 최근 실적발표 자료와 경영진 실적콜을 기준으로 확인해줘.",
        },
      ],
      status_labels: ["회사 발표"],
      entities: [],
      risk_level: "medium",
    });

    expect(brief?.researchPaths).toEqual([
      expect.objectContaining({
        id: "guidance-check",
        relatedTickers: ["NVDA"],
        evidenceTargets: ["엔비디아 실적발표 자료", "경영진 실적콜"],
      }),
    ]);
  });

  it("drops research questions that become an investment recommendation", () => {
    expect(parseMarketIssueResearchPaths([
      {
        id: "buy-nvda",
        question: "이 발표 뒤 엔비디아 주식을 매수해야 하는지 확인할까?",
        evidence_targets: ["엔비디아 실적발표 자료"],
        related_tickers: ["NVDA"],
        priority: 1,
        chat_query: "이 발표 뒤 엔비디아 주식을 매수해야 하는지 최근 실적발표 자료로 확인해줘.",
      },
    ])).toEqual([]);
  });
});
