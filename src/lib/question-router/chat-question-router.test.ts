import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChatQuestionRoute } from "./chat-question-router";
import { query } from "@anthropic-ai/claude-agent-sdk";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

function makeSdkResult(runKind: string) {
  return (async function* () {
    yield {
      type: "result",
      subtype: "success",
      structured_output: { run_kind: runKind },
      result: JSON.stringify({ run_kind: runKind }),
    };
  })();
}

describe("chat question router", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("routes neutral Korean price-move questions through the no-tool SDK router", async () => {
    vi.mocked(query).mockReturnValueOnce(
      makeSdkResult("market_move_research") as never,
    );

    const decision = await resolveChatQuestionRoute({
      content: "오늘 가격 변동이 왜이래?",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["AAPL"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "news",
      runKind: "market_move_research",
      source: "claude_router",
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("오늘 가격 변동이 왜이래?"),
        options: expect.objectContaining({
          maxTurns: 1,
          allowedTools: [],
          settingSources: [],
          outputFormat: expect.objectContaining({ type: "json_schema" }),
        }),
      }),
    );
    const sdkCall = vi.mocked(query).mock.calls[0]?.[0] as {
      options?: Record<string, unknown>;
      prompt?: string;
    };
    expect(sdkCall.prompt).not.toContain("/krw-ontology:krw-ontology-router");
    expect(sdkCall.options).not.toHaveProperty("plugins");
  });

  it("falls back to ordinary company research when the SDK router is unavailable", async () => {
    vi.mocked(query).mockImplementationOnce(() => {
      throw new Error("router unavailable");
    });

    const decision = await resolveChatQuestionRoute({
      content: "AAPL 서비스 매출 구조를 정리해줘",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["AAPL"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "company",
      runKind: "company_research",
      source: "fallback",
    });
  });

  it("routes scenario follow-up questions to scenario sensitivity", async () => {
    vi.mocked(query).mockReturnValueOnce(
      makeSdkResult("scenario_sensitivity") as never,
    );

    const decision = await resolveChatQuestionRoute({
      content: "앞으로의 시나리오 알려줘",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["META"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "company",
      runKind: "scenario_sensitivity",
      source: "claude_router",
    });
  });

  it("preserves explicit news discovery route", async () => {
    const decision = await resolveChatQuestionRoute({
      content: "AAPL 관련 오늘 뉴스 찾아줘",
      currentAnalysisMode: "news",
      currentRunKind: "news_discovery",
      defaultTickers: ["AAPL"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "news",
      runKind: "news_discovery",
      source: "preserve",
    });
    expect(query).not.toHaveBeenCalled();
  });
});
