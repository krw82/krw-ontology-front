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
    vi.resetAllMocks();
  });

  it("routes clear Korean price-move questions before invoking the SDK router", async () => {
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
      source: "deterministic",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("routes mixed price-move and outlook questions to market move before invoking the SDK router", async () => {
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
      source: "deterministic",
    });
    expect(query).not.toHaveBeenCalled();
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
      content: "이전 답변 기준으로 더 이어서 봐줘",
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
      content: "AAPL에 대해 설명해줘",
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

  it("does not need fallback for clear market-move questions", async () => {
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
      source: "deterministic",
      confidence: "high",
    });
    expect(decision.reason).toContain("stock-price move");
    expect(query).not.toHaveBeenCalled();
  });

  it("routes clear scenario questions before invoking the SDK router", async () => {
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
      source: "deterministic",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("routes explicit recent-news questions before invoking the SDK router", async () => {
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
      source: "deterministic",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps filing-grounded recent-growth questions on company research without invoking the SDK router", async () => {
    const decision = await resolveChatQuestionRoute({
      content:
        "애플의 아이폰, 서비스, 맥, 아이패드, 웨어러블 수익 구조를 공시 기준으로 정리하고 최근 성장 동인을 매출총이익률 중심으로 설명해줘.",
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
      source: "deterministic",
      confidence: "high",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps an explicit recent 8-K source request on company research for filing correlation", async () => {
    const decision = await resolveChatQuestionRoute({
      content: "AAPL 최근 8-K 원문을 뉴스와 함께 확인해줘.",
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
      source: "deterministic",
      confidence: "high",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("corrects sector/cohort macro interpretation away from idea generation", async () => {
    vi.mocked(query).mockReturnValueOnce(
      makeSdkResult("idea_generation") as never,
    );

    const decision = await resolveChatQuestionRoute({
      content: "소비재 기업들을 살펴보고 소비자들 관련 매크로 현황 어떤지 알고싶어",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: [],
      scopeType: "global",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "company",
      runKind: "company_research",
      source: "claude_router",
    });
    expect(decision.reason).toContain("company-cohort research");
    const sdkCall = vi.mocked(query).mock.calls[0]?.[0] as {
      prompt?: string;
    };
    expect(sdkCall.prompt).toContain(
      "sector, industry, or company-cohort interpretation questions",
    );
    expect(sdkCall.prompt).toContain(
      "'소비재 기업들을 살펴보고 소비자들 관련 매크로 현황 어떤지 알고싶어' => {\"run_kind\":\"company_research\"}",
    );
  });

  it("keeps explicit candidate discovery questions on idea generation", async () => {
    const decision = await resolveChatQuestionRoute({
      content: "소비 둔화에도 버틸 소비재 기업 후보 뽑아줘",
      currentAnalysisMode: "company",
      currentRunKind: "company_research",
      defaultTickers: [],
      scopeType: "global",
      hasUserUrls: false,
      responseLocale: "ko",
    });

    expect(decision).toMatchObject({
      analysisMode: "company",
      runKind: "idea_generation",
      source: "deterministic",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("routes scenario follow-up questions to scenario sensitivity", async () => {
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
      source: "deterministic",
    });
    expect(query).not.toHaveBeenCalled();
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
