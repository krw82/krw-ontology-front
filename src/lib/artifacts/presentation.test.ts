import { describe, expect, it } from "vitest";
import { getArtifactEvidenceStatus } from "./presentation";

describe("artifact presentation", () => {
  it("does not expose raw high/medium quality as the user-facing status", () => {
    const status = getArtifactEvidenceStatus({
      artifact_type: "company_overview",
      quality: { overall: "high", warnings: [] },
      evidence_refs: [],
      blocks: [
        {
          type: "markdown",
          content: "근거 없는 요약은 제한 상태로 보여야 합니다.",
        },
      ],
      source_json: null,
    });

    expect(status).toMatchObject({
      label: "근거 제한",
      tone: "limited",
    });
  });

  it("uses stored tool evidence as medium evidence instead of overclaiming", () => {
    const status = getArtifactEvidenceStatus({
      artifact_type: "company_overview",
      quality: { overall: "high", warnings: [] },
      evidence_refs: [],
      blocks: [
        {
          type: "metric_grid",
          title: "숫자",
          metrics: [{ label: "매출", value: "$9.3B" }],
        },
      ],
      source_json: {
        tool_calls: [
          {
            tool_name: "krw_ontology_query",
            has_result_json: true,
          },
        ],
      },
    });

    expect(status).toMatchObject({
      label: "근거 보통",
      tone: "medium",
    });
  });
});
