import { describe, expect, it } from "vitest";
import {
  filingDecisionContextCopy,
  filingDecisionDestinationPath,
  filingNotificationCopy,
  isAmendedFilingForm,
  isFilingFormType,
  safeInternalDestinationPath,
} from "./contract";

describe("filing notification contract", () => {
  it("accepts only 8-K and 6-K variants", () => {
    expect(isFilingFormType("8-K")).toBe(true);
    expect(isFilingFormType("6-K/A")).toBe(true);
    expect(isFilingFormType("10-Q")).toBe(false);
    expect(isAmendedFilingForm("8-K/A")).toBe(true);
  });

  it("uses deterministic event labels without pretending to analyze a filing", () => {
    expect(filingNotificationCopy({ ticker: "AAPL", formType: "8-K", isAmendment: false })).toEqual({
      title: "AAPL 새 8-K 공시",
      body: "SEC에 새 공시가 제출됐습니다. 원문과 제출 정보를 확인하세요.",
    });
    expect(filingNotificationCopy({ ticker: "AAPL", formType: "8-K", isAmendment: false, primaryEventTag: "earnings_or_financial_results" }).title).toBe("AAPL · 8-K · 실적·재무");
  });

  it("never permits an external push click destination", () => {
    expect(safeInternalDestinationPath("/filings?event=abc")).toBe("/filings?event=abc");
    expect(safeInternalDestinationPath("//attacker.example")).toBe("/filings");
    expect(safeInternalDestinationPath("/\\attacker.example")).toBe("/filings");
    expect(safeInternalDestinationPath("https://attacker.example")).toBe("/filings");
  });

  it("connects a filing to prior decisions without accepting personal prose", () => {
    const copy = filingDecisionContextCopy(
      { title: "AAPL 새 8-K 공시", body: "SEC에 새 공시가 제출됐습니다." },
      { hasPreviousJudgment: true, activeMonitoringRuleCount: 2 },
    );

    expect(copy).toEqual({
      title: "AAPL 새 8-K 공시",
      body: "SEC에 새 공시가 제출됐습니다. 이전 판단과 활성 모니터링 규칙 2개에 연결됩니다.",
    });
    expect(JSON.stringify(copy)).not.toContain("판단 원문");
  });

  it("uses a bounded, internal decision-context deep link", () => {
    const filingEventId = "123e4567-e89b-42d3-a456-426614174000";
    expect(filingDecisionDestinationPath(filingEventId, {
      hasPreviousJudgment: true,
      activeMonitoringRuleCount: 0,
    })).toBe(`/filings/${filingEventId}?context=decision`);
    expect(filingDecisionDestinationPath("//attacker.example", {
      hasPreviousJudgment: true,
      activeMonitoringRuleCount: 1,
    })).toBe("/filings");
  });
});
