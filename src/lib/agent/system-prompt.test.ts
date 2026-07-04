import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSystemPrompt,
  MAX_PROMPT_HISTORY_CONTEXT_CHARS,
  MAX_PROMPT_HISTORY_MESSAGE_CHARS,
  MAX_PROMPT_HISTORY_MESSAGES,
  sanitizePromptHistory,
} from "./system-prompt";
import {
  buildResearchPassPrompt,
} from "./workflow";

describe("buildSystemPrompt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the Asia/Seoul calendar date at the UTC date boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T15:30:00.000Z"));

    const prompt = buildSystemPrompt();

    expect(prompt).toContain("Runtime as-of date: 2026-06-23");
    expect(prompt).toContain("Runtime timezone: Asia/Seoul");
  });

  it("keeps orchestration out of the system prompt", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("exact KRW-AI skill command");
    expect(prompt).toMatch(/Runtime as-of date: \d{4}-\d{2}-\d{2}/);
    expect(prompt).toContain("Runtime timezone: Asia/Seoul");
    expect(prompt).toContain("does not prove that a filing");
    expect(prompt).toContain("Never invent an unconfirmed future period label");
    expect(prompt).not.toContain("krw-ontology-web-answer");
    expect(prompt).not.toContain("answer_blocks");
    expect(prompt).not.toContain("Match the user's latest message language");
  });

  it("forbids user-visible progress narration and internal source labels", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("Let me verify");
    expect(prompt).toContain("Now let me");
    expect(prompt).toContain("verified by trace");
    expect(prompt).toContain("query_context");
  });

  it("builds a Markdown-only research skill prompt outside the system prompt", () => {
    const researchPrompt = buildResearchPassPrompt("아마존 알려줘");

    expect(researchPrompt).toContain(
      "/krw-ontology:krw-ontology-research 아마존 알려줘",
    );
    expect(researchPrompt).toContain("Markdown 본문만 작성합니다");
    expect(researchPrompt).toContain("구조화 JSON은 만들지 않습니다");
    expect(researchPrompt).not.toContain("krw-ontology-answer-composer");
  });

  it("uses the news discovery skill command for the first news analysis pass", () => {
    const researchPrompt = buildResearchPassPrompt(
      "AVGO 최근 뉴스까지 반영해줘",
      "news",
    );

    expect(researchPrompt).toContain(
      "/krw-ontology:krw-ontology-news-discovery AVGO 최근 뉴스까지 반영해줘",
    );
    expect(researchPrompt).not.toContain(
      "/krw-ontology:krw-ontology-research AVGO",
    );
  });

  it("uses ordinary KRW ontology research for selected news event analysis", () => {
    const researchPrompt = buildResearchPassPrompt(
      "선택한 뉴스 이벤트를 공시 기준으로 분석해줘",
      "company",
      "company_research",
    );

    expect(researchPrompt).toContain(
      "/krw-ontology:krw-ontology-research 선택한 뉴스 이벤트를 공시 기준으로 분석해줘",
    );
    expect(researchPrompt).not.toContain("krw-ontology-news-research");
  });

  it("uses the idea generation skill with a Markdown-only candidate brief", () => {
    const researchPrompt = buildResearchPassPrompt(
      "AI 데이터센터 전력 수혜 기업을 찾아줘",
      "company",
      "idea_generation",
    );

    expect(researchPrompt).toContain(
      "/krw-ontology:krw-ontology-idea-generation AI 데이터센터 전력 수혜 기업을 찾아줘",
    );
    expect(researchPrompt).toContain("웹앱 종목 발굴 실행");
    expect(researchPrompt).toContain("deep 리서치");
    expect(researchPrompt).toContain("한국어 Markdown 본문만 작성합니다");
    expect(researchPrompt).not.toContain(
      "/krw-ontology:krw-ontology-research AI 데이터센터",
    );
  });

  it("uses the scenario sensitivity skill for scenario run kinds", () => {
    const researchPrompt = buildResearchPassPrompt(
      "앞으로의 시나리오 알려줘",
      "company",
      "scenario_sensitivity",
    );

    expect(researchPrompt).toContain(
      "/krw-ontology:krw-ontology-scenario-sensitivity 앞으로의 시나리오 알려줘",
    );
    expect(researchPrompt).toContain("웹앱 시나리오/민감도 research 실행");
    expect(researchPrompt).toContain("강화 / 유지 / 약화 / 가정 파기 조건");
    expect(researchPrompt).not.toContain(
      "/krw-ontology:krw-ontology-research 앞으로의 시나리오 알려줘",
    );
  });

  it("uses the English research skill and English runtime instructions for English responses", () => {
    const researchPrompt = buildResearchPassPrompt(
      "Analyze AAPL",
      "company",
      "company_research",
      "en",
    );

    expect(researchPrompt).toContain(
      "/krw-ontology:krw-ontology-research-en Analyze AAPL",
    );
    expect(researchPrompt).toContain("English Markdown only");
    expect(researchPrompt).not.toContain(
      "/krw-ontology:krw-ontology-research Analyze AAPL",
    );
  });

  it("keeps current-news search disabled in the prompt unless explicitly enabled", () => {
    const disabledPrompt = buildSystemPrompt();
    expect(disabledPrompt).toContain("Do not perform web searches");
    expect(disabledPrompt).toContain(
      "현재 보유한 공시 데이터 기준으로는 직접 확인되지 않습니다",
    );
    expect(disabledPrompt).toContain(
      "do not imply that the company failed to disclose something",
    );
    expect(disabledPrompt).not.toContain("Stock News MCP");
    expect(disabledPrompt).not.toContain("Yahoo Finance MCP");

    const enabledPrompt = buildSystemPrompt(undefined, [], {
      yahooFinanceNewsEnabled: true,
      yahooFinanceNewsRequired: true,
    });
    expect(enabledPrompt).toContain("Do not use built-in WebSearch or WebFetch");
    expect(enabledPrompt).toContain("current market-news MCP");
    expect(enabledPrompt).toContain("Never mention provider names such as Yahoo Finance");
    expect(enabledPrompt).toContain("market-news-vs-filing provenance internally");
  });

  it("omits chart instructions unless chart generation is explicitly enabled", () => {
    const disabledPrompt = buildSystemPrompt();
    expect(disabledPrompt).not.toContain("Inline chart policy");
    expect(disabledPrompt).not.toContain("create_chart_v1");
    expect(disabledPrompt).not.toContain("[[krw-chart:");

    const enabledPrompt = buildSystemPrompt(undefined, [], {
      chartGenerationEnabled: true,
    });
    expect(enabledPrompt).toContain("Inline chart policy");
    expect(enabledPrompt).toContain("create_chart_v1");
    expect(enabledPrompt).toContain("insert_token");
  });

  it("adds an English-only final answer policy when requested", () => {
    const prompt = buildSystemPrompt(undefined, [], {
      responseLocale: "en",
      yahooFinanceNewsEnabled: true,
    });

    expect(prompt).toContain("English Markdown only");
    expect(prompt).toContain("do not answer in Korean");
    expect(prompt).toContain("English investor interpretation");
  });

  it("injects company filing anchors when catalog documents are available", () => {
    const prompt = buildSystemPrompt({
      scopeType: "company",
      defaultTickers: ["MU"],
      defaultDocumentTypes: [],
      companies: [
        {
          ticker: "MU",
          documentTypes: ["10-K", "10-Q"],
          latestPeriod: "CY2026Q1",
          latestPeriods: ["CY2026Q1", "CY2025", "CY2024"],
          indexedFilingCount: 3,
          filingAnchor: {
            latestAvailable: "CY2026Q1 10-Q",
            currentDriver: "CY2026Q1 10-Q",
            annualBaseline: "CY2025 10-K",
            historicalContext: ["CY2024 10-K"],
          },
        },
      ],
    });

    expect(prompt).toMatch(/Runtime as-of date: \d{4}-\d{2}-\d{2}/);
    expect(prompt).toContain("Company filing anchor");
    expect(prompt).toContain("latest available filing: CY2026Q1 10-Q");
    expect(prompt).toContain("current driver: CY2026Q1 10-Q");
    expect(prompt).toContain("annual baseline: CY2025 10-K");
    expect(prompt).toContain("historical context: CY2024 10-K");
    expect(prompt).toContain(
      "Confirmed recent filing periods: CY2026Q1, CY2025, CY2024",
    );
    expect(prompt).toContain("Do not infer a newer filing or period");
    expect(prompt).toContain("Start current company and investment-decision judgments");
  });

  it("marks Yahoo Finance context as required for enabled news workflows", () => {
    const prompt = buildSystemPrompt(undefined, [], {
      yahooFinanceNewsEnabled: true,
      yahooFinanceNewsRequired: true,
    });

    expect(prompt).toContain("requires current ticker market/news context");
    expect(prompt).toContain("current market-news MCP tools for that current context");
    expect(prompt).toContain("raw provider payloads in the final answer");
    expect(prompt).toContain("If the current market-news tool call fails");
  });

  it("falls back cleanly when news mode is selected but Yahoo Finance MCP is unavailable", () => {
    const prompt = buildSystemPrompt(undefined, [], {
      yahooFinanceNewsUnavailableForNews: true,
    });

    expect(prompt).toContain("selected news mode");
    expect(prompt).toContain("current market-news tools are unavailable");
    expect(prompt).toContain("Do not attempt current-news search");
  });

  it("limits prompt history count and size before adding it to the system prompt", () => {
    const history = Array.from(
      { length: MAX_PROMPT_HISTORY_MESSAGES + 3 },
      (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content:
          index === MAX_PROMPT_HISTORY_MESSAGES + 2
            ? "x".repeat(MAX_PROMPT_HISTORY_MESSAGE_CHARS + 500)
            : `message-${index}`,
      }),
    );

    const sanitized = sanitizePromptHistory(history);
    const prompt = buildSystemPrompt(
      { scopeType: "global", defaultTickers: [], defaultDocumentTypes: [] },
      history,
    );

    expect(sanitized).toHaveLength(MAX_PROMPT_HISTORY_MESSAGES);
    expect(sanitized[0]?.content).toBe("message-3");
    expect(sanitized.at(-1)?.content).toContain("[truncated]");
    expect(sanitized.at(-1)?.content.length).toBeLessThanOrEqual(
      MAX_PROMPT_HISTORY_MESSAGE_CHARS,
    );
    expect(prompt).not.toContain("message-0");
  });

  it("enforces a total prompt history character budget from newest messages first", () => {
    const history = Array.from(
      { length: MAX_PROMPT_HISTORY_MESSAGES },
      (_, index) => ({
        role: "user",
        content: `${index}: ${"x".repeat(MAX_PROMPT_HISTORY_MESSAGE_CHARS)}`,
      }),
    );

    const sanitized = sanitizePromptHistory(history);
    const totalChars = sanitized.reduce(
      (total, message) => total + message.content.length,
      0,
    );

    expect(totalChars).toBeLessThanOrEqual(MAX_PROMPT_HISTORY_CONTEXT_CHARS);
    expect(sanitized[0]?.content.startsWith("0:")).toBe(false);
    expect(sanitized.at(-1)?.content.startsWith("11:")).toBe(true);
  });

  it("removes assistant internal progress narration from prompt history", () => {
    const sanitized = sanitizePromptHistory([
      {
        role: "assistant",
        content:
          "Let me retrieve more evidence.분석 결과를 작성하겠습니다.\n\n---\n\n최종 답변입니다.",
      },
      {
        role: "user",
        content: "Let me retrieve라고 사용자가 직접 쓴 질문은 유지",
      },
    ]);

    expect(sanitized).toEqual([
      { role: "assistant", content: "최종 답변입니다." },
      { role: "user", content: "Let me retrieve라고 사용자가 직접 쓴 질문은 유지" },
    ]);
  });
});
