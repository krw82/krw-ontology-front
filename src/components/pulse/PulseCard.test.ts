import { describe, expect, it } from "vitest";
import { filingChanges } from "@/components/pulse/PulseCard";

describe("Pulse filing change summary", () => {
  it("keeps at most two scan-friendly source summary sentences", () => {
    expect(
      filingChanges(
        "매출 계약 조건이 변경됐습니다. 최소 구매 약정이 새로 추가됐습니다. 세 번째 설명은 카드에서 숨깁니다.",
      ),
    ).toEqual([
      "매출 계약 조건이 변경됐습니다.",
      "최소 구매 약정이 새로 추가됐습니다.",
    ]);
  });

  it("preserves a single summary without inventing a second change", () => {
    expect(filingChanges("SEC Item 8.01 제출입니다.")).toEqual([
      "SEC Item 8.01 제출입니다.",
    ]);
  });
});
