import { describe, expect, it } from "vitest";

import {
  buildMarketIssueSafeFallback,
  validateMarketIssueClaims,
  validateMarketIssuePublicDraftNumbers,
} from "@/lib/market-issues/claims";

const evidence = [
  {
    evidenceId: "x:microsoft-q4",
    text: "We just reported our FY26 Q4 earnings. A strong quarter with $90 billion in revenue. Azure and other cloud services revenue grew 43%.",
  },
];

const claims = [
  {
    id: "revenue",
    claim_ko: "FY26 Q4 매출은 $90 billion이다.",
    source_quote: "$90 billion in revenue",
    raw_value: "$90 billion",
    evidence_ids: ["x:microsoft-q4"],
  },
  {
    id: "azure-growth",
    claim_ko: "Azure 및 기타 클라우드 서비스 매출은 43% 성장했다.",
    source_quote: "revenue grew 43%",
    raw_value: "43%",
    evidence_ids: ["x:microsoft-q4"],
  },
];

describe("market issue claims", () => {
  it("accepts verbatim source-grounded claims", () => {
    const result = validateMarketIssueClaims(claims, evidence);
    expect(result.valid).toBe(true);
    expect(result.claims).toHaveLength(2);
  });

  it("rejects a Korean unit conversion that is absent from the source", () => {
    const claimResult = validateMarketIssueClaims(claims, evidence);
    const result = validateMarketIssuePublicDraftNumbers({
      titleKo: "마이크로소프트 FY26 Q4 실적 발표: 매출 90억 달러, Azure 43% 성장",
      summaryKo: "공식 게시물 기준으로 실적을 정리합니다.",
      impactPath: [],
      confirmedFacts: [],
      unconfirmedFacts: [],
    }, claimResult.claims, evidence);
    expect(result.valid).toBe(false);
    expect(result.unsupportedReferences).toContain("90억");
  });

  it("accepts the source unit without conversion", () => {
    const claimResult = validateMarketIssueClaims(claims, evidence);
    const result = validateMarketIssuePublicDraftNumbers({
      titleKo: "마이크로소프트 FY26 Q4 실적 발표: 매출 $90 billion, Azure 43% 성장",
      summaryKo: "공식 게시물에서 확인된 수치입니다.",
      impactPath: [],
      confirmedFacts: [],
      unconfirmedFacts: [],
    }, claimResult.claims, evidence);
    expect(result.valid).toBe(true);
  });

  it("accepts a Korean quarter ordinal only when the English source says that quarter", () => {
    const quarterEvidence = [{
      evidenceId: "x:nasdaq-q2",
      text: "Today, Nasdaq reported second quarter 2026 results.",
    }];
    const quarterClaims = validateMarketIssueClaims([{
      id: "quarter-results",
      claim_ko: "Nasdaq이 2026년 제2분기 실적을 발표했다.",
      source_quote: "reported second quarter 2026 results",
      raw_value: "second quarter 2026",
      evidence_ids: ["x:nasdaq-q2"],
    }], quarterEvidence);
    const result = validateMarketIssuePublicDraftNumbers({
      titleKo: "Nasdaq, 실적 발표",
      summaryKo: "Nasdaq이 2026년 제2분기 실적을 발표했다.",
      impactPath: [],
      confirmedFacts: [],
      unconfirmedFacts: [],
    }, quarterClaims.claims, quarterEvidence);
    expect(result.valid).toBe(true);
  });

  it("builds a meaningful deterministic fallback instead of a test placeholder", () => {
    const fallback = buildMarketIssueSafeFallback({
      publisher: "NVIDIA",
      sourceText: "We're introducing the Open Secure AI Alliance with industry leaders.",
    });
    expect(fallback.titleKo).toBe("NVIDIA, 공식 발표 게시물");
    expect(fallback.titleKo).not.toContain("품질 검증");
  });
});
