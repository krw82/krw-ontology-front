import { describe, expect, it } from "vitest";
import type { KrwVisualizationArtifact } from "./contracts";
import { buildPresentationBlocks, stripLegacyChartTokens } from "./presentation";

function visualization(): KrwVisualizationArtifact {
  return {
    artifact_format: "krw-visualization",
    schema_version: 1,
    artifact_ref: "viz_1_revenue",
    intent: { goal: "매출 추이 확인", measures: ["revenue"] },
    title: "매출 추이",
    views: [{
      view_id: "view_1",
      chart_type: "bar",
      title: "매출 추이",
      unit: "USD",
      series: [{
        series_key: "AAPL|revenue",
        label: "Revenue",
        metric_name: "revenue",
        canonical_metric: "revenue",
        unit: "USD",
        points: [{ period: "CY2025", value: 100, evidence_ref: "metric_observation:1" }],
      }],
    }],
    provenance: {
      source_tool_call_ids: ["tool-1"],
      evidence_refs: ["metric_observation:1"],
      source_kinds: ["ontology"],
    },
    quality: { series_count: 1, point_count: 1, warnings: [] },
  };
}

describe("visualization presentation blocks", () => {
  it("places a compiler artifact after the supporting Markdown block without a model token", () => {
    const blocks = buildPresentationBlocks({
      content: "매출은 최근 3년간 증가했습니다.\n\n영업이익률은 별도로 봐야 합니다.",
      visualizations: [visualization()],
    });

    expect(blocks).toEqual([
      expect.objectContaining({ type: "markdown", content: "매출은 최근 3년간 증가했습니다." }),
      { id: "visualization_viz_1_revenue", type: "visualization", artifact_ref: "viz_1_revenue" },
      expect.objectContaining({ type: "markdown", content: "영업이익률은 별도로 봐야 합니다." }),
    ]);
  });

  it("strips legacy insert tokens before presentation persistence", () => {
    expect(stripLegacyChartTokens("요약\n\n[[krw-chart:chart_1_old]]\n\n후속 설명"))
      .toBe("요약\n\n후속 설명");
  });
});
