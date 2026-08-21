import { describe, expect, it } from "vitest";
import { sampleAnswerCtaHref, estimatedReadMinutes } from "./sample-answer-display";

describe("sample answer display", () => {
  it("builds a chat starter href with the original question", () => {
    expect(sampleAnswerCtaHref({ id: "x", ticker: "aapl", question: "애플 매출이 궁금해", askedAtLabel: "", sections: [], sourceRunLabel: "" }))
      .toBe("/chat/new?query=" + encodeURIComponent("애플 매출이 궁금해") + "&ticker=AAPL");
  });
  it("estimates read minutes from section bodies", () => {
    const body = "가".repeat(1800); // ~900자/분 가정
    expect(estimatedReadMinutes({ sections: [{ heading: "h", body }] })).toBeGreaterThanOrEqual(2);
  });
});
