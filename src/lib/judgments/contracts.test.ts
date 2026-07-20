import { describe, expect, it } from "vitest";
import { saveFilingJudgmentSchema } from "./contracts";

const baseInput = {
  client_mutation_id: "mutation-123",
  context_ticker: "googl",
  impact: "positive",
  next_action: "update_thesis",
  summary: "가격 인상 효과가 기존 논거를 강화했다.",
};

describe("saveFilingJudgmentSchema", () => {
  it("accepts a full replacement with thesis and deterministic monitoring rules", () => {
    const parsed = saveFilingJudgmentSchema.parse({
      ...baseInput,
      thesis_links: [
        {
          thesis_id: "00000000-0000-4000-8000-000000000001",
          impact: "positive",
        },
      ],
      monitoring_rules: [
        { rule_type: "filing_item", operator: "matches", value: "2.02" },
        {
          rule_type: "scheduled_review",
          operator: "on_or_after",
          next_review_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    expect(parsed.monitoring_rules).toHaveLength(2);
    expect(parsed.context_ticker).toBe("GOOGL");
    expect(parsed.expected_revision_number).toBeUndefined();
  });

  it("rejects schedule operators on keyword rules", () => {
    const parsed = saveFilingJudgmentSchema.safeParse({
      ...baseInput,
      monitoring_rules: [
        {
          rule_type: "keyword",
          operator: "on_or_after",
          value: "margin",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
