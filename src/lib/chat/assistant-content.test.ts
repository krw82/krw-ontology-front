import { describe, expect, it } from "vitest";
import {
  sanitizeAssistantContent,
  sanitizeAssistantPreviewContent,
} from "./assistant-content";

describe("sanitizeAssistantContent", () => {
  it("removes leading internal research narration before the final answer", () => {
    const content = [
      "Let me read the full query_context output and run targeted queries for the key risk areas.Let me retrieve the full query_context output and run targeted follow-up queries for GenAI and competition.Let me trace key metric observations and get specific competition/GovTech-related evidence.Let me get additional data on the competitive risk, GenAI investment, and sales cycle specifics.이제 충분한 증거를 확보했습니다. 분석 결과를 작성하겠습니다.",
      "",
      "---",
      "",
      "ServiceNow (NOW) — GenAI 투자, 대형 계약 사이클, 경쟁 압박이 성장과 마진에 미치는 리스크",
      "",
      "투자 결론",
    ].join("\n");

    expect(sanitizeAssistantContent(content)).toBe(
      [
        "ServiceNow (NOW) — GenAI 투자, 대형 계약 사이클, 경쟁 압박이 성장과 마진에 미치는 리스크",
        "",
        "투자 결론",
      ].join("\n"),
    );
  });

  it("removes leading tool XML blocks", () => {
    const content = [
      '<function_calls><invoke name="query_context"><parameter name="ticker">PWR</parameter></invoke></function_calls>',
      "",
      "Quanta Services(PWR) 분석",
    ].join("\n");

    expect(sanitizeAssistantContent(content)).toBe("Quanta Services(PWR) 분석");
  });

  it("does not rewrite normal answer text", () => {
    const content = [
      "Broadcom(AVGO) 주문 변화와 재무 영향 분석",
      "",
      "AI networking 주문 증가는 성장성에는 긍정적입니다.",
    ].join("\n");

    expect(sanitizeAssistantContent(content)).toBe(content);
  });

  it("collapses truncated internal preview text to empty", () => {
    expect(
      sanitizeAssistantPreviewContent(
        "Let me retrieve the full query_context output and run targeted follow-up queries",
      ),
    ).toBe("");
  });

  it("strips cramped leading English progress narration before the answer", () => {
    expect(
      sanitizeAssistantContent(
        "Now let me verify the key MD&A quotes from the CY2025 10-K and get the CY2026Q1 10-Q segment details.Based on Micron's latest filing, the answer is cautious.",
      ),
    ).toBe("Based on Micron's latest filing, the answer is cautious.");
  });

  it("removes internal trace verification labels from user-facing source text", () => {
    expect(
      sanitizeAssistantContent(
        "Based on the filing, margins improved. *(Source: CY2025 10-K, Item 7 MD&A, verified by trace)*",
      ),
    ).toBe(
      "Based on the filing, margins improved. *(Source: CY2025 10-K, Item 7 MD&A)*",
    );
  });
});
