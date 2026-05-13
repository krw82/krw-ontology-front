import { describe, expect, it } from "vitest";
import {
  RESEARCH_SYNTHESIS_OUTPUT_SCHEMA,
  compileDisplayPlanAnswer,
  parseDisplayPlanOutput,
  parseDisplayPlanOutputText,
  parseResearchSynthesisOutput,
} from "./display-plan";

const synthesis = {
  synthesis_version: "krw-research-synthesis/v1",
  question: "AMZN 알려줘",
  thesis: "AMZN은 AWS와 AI 투자 부담을 같이 봐야 합니다.",
  canonical_answer: {
    language: "ko",
    default_order: ["p1", "m1", "c1"],
    units: [
      {
        id: "p1",
        type: "paragraph",
        text: "AMZN은 AWS 수익성과 AI 인프라 투자 부담을 함께 봐야 합니다.",
        importance: "required",
        confidence: "direct",
        display_policy: "show",
        evidence_refs: ["ref_1"],
      },
      {
        id: "m1",
        type: "metric",
        label: "AWS operating income",
        value: "$45.6B",
        period: "FY2025",
        unit: "USD",
        source_label: "AMZN FY2025 10-K",
        importance: "supporting",
        confidence: "direct",
        display_policy: "show",
        evidence_refs: ["ref_2"],
      },
      {
        id: "c1",
        type: "caveat",
        text: "AI 투자 효과는 향후 AWS 마진으로 확인해야 합니다.",
        severity: "warning",
        importance: "required",
        confidence: "indirect",
        display_policy: "show",
        evidence_refs: ["ref_3"],
      },
    ],
  },
  evidence_refs: [
    {
      id: "ref_1",
      source_label: "AMZN FY2025 10-K",
      evidence_grade: "direct",
    },
  ],
  quality: {
    overall: "high",
    warnings: [],
  },
};

const displayPlan = {
  display_plan_version: "krw-display-plan/v1",
  source_synthesis_version: "krw-research-synthesis/v1",
  display_plan: [
    {
      block_id: "b1",
      block_type: "markdown",
      source_ids: ["p1"],
      title: null,
      options: {},
    },
    {
      block_id: "b2",
      block_type: "metric_grid",
      source_ids: ["m1"],
      title: "핵심 숫자",
      options: {},
    },
  ],
  quality: {
    overall: "medium",
    warnings: ["display caveat"],
  },
};

describe("display plan compiler", () => {
  it("exposes a research synthesis SDK schema with canonical units", () => {
    expect(RESEARCH_SYNTHESIS_OUTPUT_SCHEMA).toMatchObject({
      required: ["synthesis_version", "canonical_answer", "quality"],
      properties: {
        canonical_answer: {
          required: ["default_order", "units"],
          properties: {
            units: {
              items: {
                properties: {
                  type: {
                    enum: expect.arrayContaining([
                      "paragraph",
                      "metric",
                      "risk_item",
                      "caveat",
                    ]),
                  },
                },
                allOf: [
                  {
                    oneOf: expect.arrayContaining([
                      expect.objectContaining({
                        properties: { type: { const: "metric" } },
                        required: ["label", "value"],
                      }),
                      expect.objectContaining({
                        properties: { type: { const: "paragraph" } },
                        required: ["text"],
                      }),
                    ]),
                  },
                ],
              },
            },
          },
        },
      },
    });
  });

  it("rejects research synthesis units outside the canonical unit enum", () => {
    const parsed = parseResearchSynthesisOutput({
      ...synthesis,
      canonical_answer: {
        ...synthesis.canonical_answer,
        default_order: ["p1"],
        units: [
          {
            id: "p1",
            type: "financial_summary",
            text: "This should not pass the frontend contract.",
          },
        ],
      },
    });

    expect(parsed).toBeNull();
  });

  it("rejects canonical units that have a type but no renderable content", () => {
    const parsed = parseResearchSynthesisOutput({
      ...synthesis,
      canonical_answer: {
        ...synthesis.canonical_answer,
        default_order: ["m1"],
        units: [
          {
            id: "m1",
            type: "metric",
            importance: "required",
            confidence: "direct",
          },
        ],
      },
    });

    expect(parsed).toBeNull();
  });

  it("rejects heading and paragraph units without customer-facing text", () => {
    const parsed = parseResearchSynthesisOutput({
      ...synthesis,
      canonical_answer: {
        ...synthesis.canonical_answer,
        default_order: ["h1", "p1"],
        units: [
          {
            id: "h1",
            type: "heading",
            title: "This used to render only through a fallback title.",
          },
          {
            id: "p1",
            type: "paragraph",
            analysis: "Paragraph units must carry text, not only analysis.",
          },
        ],
      },
    });

    expect(parsed).toBeNull();
  });

  it("rejects research synthesis default_order values that do not resolve to units", () => {
    const parsed = parseResearchSynthesisOutput({
      ...synthesis,
      canonical_answer: {
        ...synthesis.canonical_answer,
        default_order: ["missing"],
      },
    });

    expect(parsed).toBeNull();
  });

  it("compiles canonical answer units and a display plan into renderable blocks", () => {
    const output = compileDisplayPlanAnswer(
      parseResearchSynthesisOutput(synthesis),
      parseDisplayPlanOutput(displayPlan),
    );

    expect(output?.answer_blocks.map((block) => block.type)).toEqual([
      "markdown",
      "metric_grid",
      "markdown",
    ]);
    expect(output?.answer_blocks[0]).toMatchObject({
      type: "markdown",
      content: "AMZN은 AWS 수익성과 AI 인프라 투자 부담을 함께 봐야 합니다.",
    });
    expect(output?.answer_blocks[1]).toMatchObject({
      type: "metric_grid",
      metrics: [
        expect.objectContaining({
          label: "AWS operating income",
          value: "$45.6B",
        }),
      ],
    });
    expect(JSON.stringify(output)).not.toContain("display_plan");
    expect(output?.quality).toEqual({
      overall: "medium",
      warnings: ["display caveat"],
    });
  });

  it("rejects display plans that carry content fields", () => {
    const invalidPlan = parseDisplayPlanOutput({
      ...displayPlan,
      display_plan: [
        {
          block_id: "b1",
          block_type: "metric_grid",
          source_ids: ["m1"],
          metrics: [{ label: "Bad", value: "$1" }],
        },
      ],
    });

    const output = compileDisplayPlanAnswer(
      parseResearchSynthesisOutput(synthesis),
      invalidPlan,
    );

    expect(invalidPlan).toBeNull();
    expect(output?.answer_blocks).toHaveLength(1);
    expect(output?.answer_blocks[0]).toMatchObject({
      type: "markdown",
    });
    expect(JSON.stringify(output?.answer_blocks)).toContain("$45.6B");
  });

  it("parses fenced display plan JSON", () => {
    const parsed = parseDisplayPlanOutputText(
      `\`\`\`json\n${JSON.stringify(displayPlan)}\n\`\`\``,
    );

    expect(parsed?.display_plan[0]?.block_type).toBe("markdown");
  });
});
