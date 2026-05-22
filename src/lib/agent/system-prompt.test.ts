import { describe, expect, it } from "vitest";
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
  it("keeps orchestration out of the system prompt", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("exact Claude Code skill command");
    expect(prompt).not.toContain("krw-ontology-web-answer");
    expect(prompt).not.toContain("answer_blocks");
    expect(prompt).not.toContain("Match the user's latest message language");
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
});
