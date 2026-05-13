import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt";
import {
  buildComposerPassPrompt,
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

  it("builds explicit two-pass skill prompts outside the system prompt", () => {
    expect(buildResearchPassPrompt("아마존 알려줘")).toBe(
      "/krw-ontology:krw-ontology-research 아마존 알려줘",
    );
    const composerPrompt = buildComposerPassPrompt({
      question: "아마존 알려줘",
      research_synthesis: { synthesis_version: "krw-research-synthesis/v1" },
      runtime: { supports_structured_output: true, language: "ko" },
    });

    expect(composerPrompt).toContain("/krw-ontology:krw-ontology-answer-composer ");
    expect(JSON.parse(composerPrompt.split(" ").slice(1).join(" "))).toEqual({
      question: "아마존 알려줘",
      research_synthesis: { synthesis_version: "krw-research-synthesis/v1" },
      runtime: { supports_structured_output: true, language: "ko" },
    });
  });
});
