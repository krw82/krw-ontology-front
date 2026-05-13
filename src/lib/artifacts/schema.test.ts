import { describe, expect, it } from "vitest";
import {
  parseResearchAgentOutput,
  parseResearchAgentOutputText,
} from "./schema";

const validRichAnswer = {
  answer_blocks: [
    {
      type: "markdown",
      content: "AMZN은 AWS와 capex가 핵심입니다.",
    },
    {
      type: "metric_grid",
      title: "Key metrics",
      metrics: [
        {
          label: "Net sales",
          value: "$716.9B",
          period: "FY2025",
          source_label: "AMZN FY2025 10-K",
        },
      ],
    },
  ],
  quality: {
    overall: "high",
    warnings: [],
  },
};

const legacyArtifact = {
  artifact_version: "krw-artifact/v1",
  artifact_type: "financial_snapshot",
  title: "AMZN financial snapshot",
  summary: "AWS profit and infrastructure investment are the main read-throughs.",
  tickers: ["AMZN"],
  blocks: [
    {
      type: "metric_grid",
      title: "Key metrics",
      metrics: [
        {
          label: "Net sales",
          value: "$716.9B",
          period: "FY2025",
          source_label: "AMZN FY2025 10-K",
        },
      ],
    },
  ],
  quality: {
    overall: "high",
    warnings: [],
  },
};

describe("rich answer schema", () => {
  it("parses answer blocks and canonical rich blocks", () => {
    const output = parseResearchAgentOutput(validRichAnswer);

    expect(output?.answer_blocks[0]?.type).toBe("markdown");
    expect(output?.answer_blocks[1]?.type).toBe("metric_grid");
    expect(output?.quality.overall).toBe("high");
  });

  it("drops invalid rich blocks and keeps valid markdown", () => {
    const output = parseResearchAgentOutput({
      answer_blocks: [
        { type: "markdown", content: "짧은 답변" },
        { type: "tool_timeline", title: "Debug", items: [] },
      ],
      quality: { overall: "medium", warnings: [] },
    });

    expect(output?.answer_blocks).toEqual([
      { type: "markdown", content: "짧은 답변", evidence_refs: [] },
    ]);
  });

  it("does not require a fixed block combination", () => {
    const output = parseResearchAgentOutput({
      answer_blocks: [
        {
          type: "timeline",
          title: "일정",
          events: [
            {
              label: "10-K filing",
              date_or_period: "FY2025",
              text: "연간 공시 기준 이벤트입니다.",
            },
          ],
        },
      ],
      quality: { overall: "medium", warnings: [] },
    });

    expect(output?.answer_blocks).toHaveLength(1);
    expect(output?.answer_blocks[0]?.type).toBe("timeline");
  });

  it("normalizes legacy comparison and caveat block names", () => {
    const output = parseResearchAgentOutput({
      answer_blocks: [
        {
          type: "comparison",
          title: "비교",
          columns: ["A", "B"],
          rows: [{ label: "매출", values: ["1", "2"] }],
        },
        {
          type: "caveats",
          title: "주의",
          items: [{ text: "근거가 제한적입니다.", severity: "warning" }],
        },
      ],
      quality: { overall: "medium", warnings: [] },
    });

    expect(output?.answer_blocks.map((block) => block.type)).toEqual([
      "comparison_table",
      "caveat_list",
    ]);
  });

  it("parses fenced JSON fallback text", () => {
    const output = parseResearchAgentOutputText(
      `\`\`\`json\n${JSON.stringify(validRichAnswer)}\n\`\`\``,
    );

    expect(output?.answer_blocks[0]?.type).toBe("markdown");
  });

  it("keeps legacy visible_answer plus artifact output readable", () => {
    const output = parseResearchAgentOutput({
      visible_answer: "AMZN은 AWS와 capex가 핵심입니다.",
      artifact: legacyArtifact,
    });

    expect(output?.answer_blocks[0]).toMatchObject({
      type: "markdown",
      content: "AMZN은 AWS와 capex가 핵심입니다.",
    });
    expect(output?.answer_blocks[1]?.type).toBe("metric_grid");
  });
});
