import { describe, expect, it } from "vitest";
import {
  canPublishGuruFinalOutput,
  inspectGuruFinalOutput,
  inspectGuruFinalOutputRewrite,
} from "./guru-final-output-policy";

describe("Guru final output policy", () => {
  it("permits qualitative consultation prose", () => {
    const inspection = inspectGuruFinalOutput(
      "사업의 현금창출력은 여전히 강하지만, 핵심 제품 의존도가 쉽게 낮아졌다고 보기는 어렵습니다.",
    );

    expect(inspection.requiresRewrite).toBe(false);
    expect(canPublishGuruFinalOutput("최근 공시를 보면 의존도 완화는 아직 입증되지 않았습니다.")).toBe(true);
  });

  it("rejects exact numeric claims, dates, and ordered lists", () => {
    const inspection = inspectGuruFinalOutput(
      [
        "매출은 14% 늘었고 현금흐름은 1,000억입니다.",
        "2026년 최근 분기에도 같은 흐름입니다.",
        "1. 먼저 수요를 봐야 합니다.",
      ].join("\n"),
    );

    expect(inspection.requiresRewrite).toBe(true);
    expect(inspection.violations.map((violation) => violation.code)).toContain(
      "numeric_literal",
    );
    expect(inspection.violations.map((violation) => violation.code)).toContain(
      "numbered_list",
    );
  });

  it("rejects exact quantity words even without Arabic digits", () => {
    const inspection = inspectGuruFinalOutput(
      "수익성이 두 배가 됐고 절반의 비용 절감이 있었다고 단정하기는 어렵습니다.",
    );

    expect(inspection.requiresRewrite).toBe(true);
    expect(inspection.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "quantitative_word", match: "두 배" }),
        expect.objectContaining({ code: "quantitative_word", match: "절반" }),
      ]),
    );
  });

  it("allows proper names and tickers that contain digits", () => {
    const content = "3M(MMM)은 산업 수요의 방향이 사업 내구성에 더 중요합니다.";

    expect(
      canPublishGuruFinalOutput(content, {
        allowedIdentifiers: ["3M", "MMM"],
      }),
    ).toBe(true);
  });

  it("inspects visible Markdown labels but ignores link destinations", () => {
    const safeLink = "[최근 공시](https://example.test/filings/2026/10-q) 기준으로는 방향이 유지됩니다.";
    const numericLabel = "[2026년 공시](https://example.test/filings/2026/10-q)를 확인했습니다.";

    expect(canPublishGuruFinalOutput(safeLink)).toBe(true);
    expect(canPublishGuruFinalOutput(numericLabel)).toBe(false);
  });

  it("re-inspects a rewrite before publication", () => {
    const result = inspectGuruFinalOutputRewrite(
      "현금흐름은 82.6B로 늘었습니다.",
      "현금창출력은 개선됐지만, 그것만으로 사업의 내구성이 증명되지는 않습니다.",
    );

    expect(result.before.requiresRewrite).toBe(true);
    expect(result.after.requiresRewrite).toBe(false);
    expect(result.accepted).toBe(true);
  });

  it("does not accept a rewrite that still contains a quantitative claim", () => {
    const result = inspectGuruFinalOutputRewrite(
      "마진은 14%입니다.",
      "마진은 두 배로 개선됐습니다.",
    );

    expect(result.accepted).toBe(false);
    expect(result.after.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "quantitative_word" }),
      ]),
    );
  });
});
