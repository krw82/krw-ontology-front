import { describe, expect, it } from "vitest";
import {
  buildResearchModePrompt,
  DEFAULT_RESEARCH_MODE,
  getAllowedMcpToolsForResearchMode,
  getResearchModeToolBudget,
  normalizeResearchMode,
  RESEARCH_MODE_DESCRIPTIONS,
  RESEARCH_MODE_LABELS,
} from "./research-mode";

describe("research mode", () => {
  it("uses deep as the default and normalizes invalid values", () => {
    expect(DEFAULT_RESEARCH_MODE).toBe("deep");
    expect(normalizeResearchMode("fast")).toBe("fast");
    expect(normalizeResearchMode("standard")).toBe("standard");
    expect(normalizeResearchMode("deep")).toBe("deep");
    expect(normalizeResearchMode("slow")).toBe("deep");
    expect(normalizeResearchMode(undefined)).toBe("deep");
  });

  it("keeps user-facing labels and descriptions product-friendly", () => {
    expect(RESEARCH_MODE_LABELS).toEqual({
      fast: "빠른 답변",
      standard: "표준 분석",
      deep: "깊은 리서치",
    });
    expect(RESEARCH_MODE_DESCRIPTIONS.fast).toContain("깊은 근거 추적은 제한");
    expect(RESEARCH_MODE_DESCRIPTIONS.standard).toContain("기본 분석");
    expect(RESEARCH_MODE_DESCRIPTIONS.deep).toContain("시간이 더 걸릴 수");
    expect(Object.values(RESEARCH_MODE_DESCRIPTIONS).join(" ")).not.toMatch(
      /query_context|trace\/chain/i,
    );
  });

  it("limits fast mode to query_context plus one targeted query", () => {
    expect(getResearchModeToolBudget("fast")).toMatchObject({
      maxToolCalls: 2,
      queryContext: 1,
      query: 1,
      retrieve: 0,
      traceChain: 0,
    });
    expect(getAllowedMcpToolsForResearchMode("fast")).toEqual([
      "krw_ontology_query_context",
      "krw_ontology_query",
    ]);
  });

  it("keeps standard mode narrower than deep mode", () => {
    expect(getResearchModeToolBudget("standard")).toMatchObject({
      maxToolCalls: 6,
      queryContext: 1,
      query: 3,
      retrieve: 0,
      traceChain: 2,
      compare: 1,
    });
    expect(getAllowedMcpToolsForResearchMode("standard")).toContain(
      "krw_ontology_trace",
    );
    expect(getAllowedMcpToolsForResearchMode("standard")).not.toContain(
      "krw_ontology_retrieve",
    );
    expect(getAllowedMcpToolsForResearchMode("deep")).toContain(
      "krw_ontology_retrieve",
    );
    expect(getResearchModeToolBudget("deep").maxToolCalls).toBeGreaterThan(
      getResearchModeToolBudget("standard").maxToolCalls,
    );
  });

  it("keeps response detail guidance in each mode prompt", () => {
    for (const mode of ["fast", "standard", "deep"] as const) {
      const prompt = buildResearchModePrompt(mode);
      expect(prompt).toContain("Never request response_detail: full");
      expect(prompt).toContain(`Research mode: ${mode}.`);
    }
  });
});
