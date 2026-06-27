import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChatQuestionRoute } from "./chat-question-router";
import { getSessionInfo, query } from "@anthropic-ai/claude-agent-sdk";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionInfo: vi.fn(),
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
          maxTurns: 3,
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
    expect(sdkCall.options).not.toHaveProperty("resume");
  });

  it("tells the SDK router that mixed price-move and outlook questions belong to market move", async () => {
    vi.mocked(query).mockReturnValueOnce(
      makeSdkResult("market_move_research") as never,
    );

    const decision = await resolveChatQuestionRoute({
      content: "오늘 가격이 왜이러고 향후전망",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["ADBE"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "news",
      runKind: "market_move_research",
      source: "claude_router",
    });
    const sdkCall = vi.mocked(query).mock.calls[0]?.[0] as {
      prompt?: string;
    };
    expect(sdkCall.prompt).toContain(
      "Mixed price-move + outlook questions still route to market_move_research",
    );
    expect(sdkCall.prompt).toContain(
      "'오늘 가격이 왜이러고 향후전망' => {\"run_kind\":\"market_move_research\"}",
    );
  });

  it("resumes an existing SDK session through a forked router session", async () => {
    vi.mocked(getSessionInfo).mockResolvedValueOnce({
      sessionId: "11111111-1111-4111-8111-111111111111",
      title: "AAPL chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 4,
      cwd: "/tmp/project",
      summary: "AAPL discussion",
    } as never);
    vi.mocked(query).mockReturnValueOnce(
      makeSdkResult("scenario_sensitivity") as never,
    );

    const decision = await resolveChatQuestionRoute({
      sessionId: "11111111-1111-4111-8111-111111111111",
      content: "이거에 대한 시나리오를 분석해줘",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["AAPL"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision.runKind).toBe("scenario_sensitivity");
    expect(getSessionInfo).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ dir: expect.any(String) }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: "11111111-1111-4111-8111-111111111111",
          forkSession: true,
        }),
      }),
    );
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

  it("uses an obvious market-move fallback when the SDK router fails on a price question", async () => {
    vi.mocked(query).mockImplementationOnce(() => {
      throw new Error("Reached maximum number of turns (3)");
    });

    const decision = await resolveChatQuestionRoute({
      content: "오늘 가격이 왜이러고 향후전망",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["ADBE"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "news",
      runKind: "market_move_research",
      source: "fallback",
      confidence: "low",
    });
    expect(decision.reason).toContain("stock-price move");
  });

  it("uses an obvious scenario fallback when the SDK router fails on a scenario question", async () => {
    vi.mocked(query).mockImplementationOnce(() => {
      throw new Error("router unavailable");
    });

    const decision = await resolveChatQuestionRoute({
      content: "향후 전망만 시나리오로 나눠줘",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["ADBE"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "company",
      runKind: "scenario_sensitivity",
      source: "fallback",
    });
  });

  it("uses an obvious news fallback when the SDK router fails on a recent-news question", async () => {
    vi.mocked(query).mockImplementationOnce(() => {
      throw new Error("router unavailable");
    });

    const decision = await resolveChatQuestionRoute({
      content: "최근 뉴스랑 앞으로 전망 알려줘",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: ["ADBE"],
      scopeType: "company",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "news",
      runKind: "news_discovery",
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

  it("re-routes follow-up questions after an idea generation run", async () => {
    vi.mocked(query).mockReturnValueOnce(
      makeSdkResult("scenario_sensitivity") as never,
    );

    const decision = await resolveChatQuestionRoute({
      content: "그럼 앞으로의 시나리오를 알려줘",
      currentAnalysisMode: "company",
      currentRunKind: "idea_generation",
      defaultTickers: [],
      scopeType: "global",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "company",
      runKind: "scenario_sensitivity",
      source: "claude_router",
    });
    expect(query).toHaveBeenCalled();
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
