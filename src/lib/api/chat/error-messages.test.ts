import { describe, expect, it } from "vitest";
import { publicErrorMessage } from "./error-messages";

describe("publicErrorMessage", () => {
  it("keeps execution usage exhaustion separate from tool budget limits", () => {
    expect(publicErrorMessage("cost_cap_exceeded")).toContain(
      "주간 분석 한도",
    );
    expect(publicErrorMessage("tool_budget_exceeded")).toBe(
      "답변 생성 중 문제가 발생했습니다. 같은 질문으로 다시 시도하거나 범위를 조금 좁혀주세요.",
    );
  });
});
