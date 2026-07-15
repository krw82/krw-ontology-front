import { describe, expect, it } from "vitest";
import { classifyFiling, filingAlertPriority, filingClassificationReason, normalizeSecItems } from "./classification";

describe("SEC filing classification", () => {
  it("normalizes the comma-separated SEC 8-K item metadata", () => {
    expect(normalizeSecItems("2.02, 9.01; 5.02")).toEqual(["2.02", "9.01", "5.02"]);
  });

  it("keeps all mapped 8-K items and selects a deterministic primary event", () => {
    const result = classifyFiling({
      formType: "8-K",
      secItems: ["1.01", "2.02", "5.02", "9.01"],
      primaryDocDescription: "Current report",
    });
    expect(result).toEqual({
      eventTags: ["important_contract", "earnings_or_financial_results", "leadership_or_board_change", "other_material_event"],
      primaryEventTag: "earnings_or_financial_results",
      source: "sec_items",
      metadataRulePhrases: [],
    });
    expect(filingClassificationReason({ formType: "8-K", secItems: ["1.01", "2.02"], primaryEventTag: result.primaryEventTag })).toBe("SEC Item 1.01, 2.02 감지");
  });

  it("keeps 6-K classification explicitly metadata-based", () => {
    expect(classifyFiling({ formType: "6-K", secItems: [], primaryDocDescription: "Foreign issuer report" })).toEqual({
      eventTags: ["foreign_issuer_report"],
      primaryEventTag: "foreign_issuer_report",
      source: "metadata",
      metadataRulePhrases: [],
    });
  });

  it("uses only explicit 6-K metadata phrases and otherwise stays generic", () => {
    expect(classifyFiling({ formType: "6-K", secItems: [], primaryDocDescription: "Quarterly financial results and outlook" })).toMatchObject({
      eventTags: ["earnings_or_financial_results"], primaryEventTag: "earnings_or_financial_results", source: "metadata", metadataRulePhrases: ["financial results", "outlook"],
    });
    expect(filingClassificationReason({ formType: "6-K", secItems: [], primaryEventTag: "earnings_or_financial_results", metadataRulePhrases: ["outlook"] })).toBe("SEC 제출 설명 규칙: “outlook”");
    expect(classifyFiling({ formType: "6-K", secItems: [], primaryDocDescription: "Shareholder letter" }).primaryEventTag).toBe("foreign_issuer_report");
  });

  it("maps the full MVP 8-K item set and derives delivery priority without investment advice", () => {
    expect(classifyFiling({ formType: "8-K", secItems: ["2.06", "4.01", "5.07", "7.01", "9.01"], primaryDocDescription: null }).eventTags)
      .toEqual(["material_impairment", "auditor_change", "shareholder_vote", "other_material_event"]);
    expect(filingAlertPriority("cybersecurity_incident")).toBe("urgent");
    expect(filingAlertPriority("earnings_or_financial_results")).toBe("normal");
    expect(filingAlertPriority("foreign_issuer_report")).toBe("digest");
    expect(filingAlertPriority("other_material_event", ["8.01"])).toBe("normal");
  });
});
