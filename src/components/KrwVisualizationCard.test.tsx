import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessageVisualization } from "@/types/api-contracts";

vi.mock("@nivo/bar", () => ({
  ResponsiveBar: ({ keys }: { keys?: string[] }) => (
    <div data-chart={keys?.includes("total") ? "waterfall" : "bar"} />
  ),
}));

vi.mock("@nivo/line", () => ({
  ResponsiveLine: () => <div data-chart="line" />,
}));

vi.mock("@nivo/pie", () => ({
  ResponsivePie: () => <div data-chart="pie" />,
}));

vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlot: () => <div data-chart="scatter" />,
}));

vi.mock("@nivo/heatmap", () => ({
  ResponsiveHeatMap: () => <div data-chart="heatmap" />,
}));

import KrwVisualizationCard from "./KrwVisualizationCard";

function visualization(): ChatMessageVisualization {
  return {
    id: "visualization-1",
    session_id: "session-1",
    message_id: "message-1",
    run_id: "run-1",
    artifact_ref: "viz_a1b2c3d4e5f60708",
    created_at: "2026-07-25T00:00:00.000Z",
    payload_json: {
      artifact_format: "krw-visualization",
      schema_version: 3,
      artifact_ref: "viz_a1b2c3d4e5f60708",
      semantic_fingerprint: "a1b2c3d4e5f60708",
      intent: {
        goal: "애플 지역별 영업이익 추이",
        scope_mode: "breakdown",
        group_by: "지역별",
      },
      title: "애플 지역별 영업이익 추이",
      views: [
        {
          view_id: "amount",
          chart_type: "bar",
          title: "금액",
          subtitle: "USD · CY2024–CY2025",
          unit: "USD",
          series: [
            {
              series_key: "AAPL|operating_income|geography:americas|USD|annual",
              label: "미주",
              source_label: "Americas Segment Operating income",
              scope: { kind: "geography", key: "americas", label: "Americas" },
              points: [
                { period: "CY2024", value: 60, evidence_ref: "metric_observation:1" },
                { period: "CY2025", value: 70, evidence_ref: "metric_observation:2" },
              ],
            },
            {
              series_key: "AAPL|operating_income|geography:europe|USD|annual",
              label: "유럽",
              source_label: "Europe Segment Operating income",
              scope: { kind: "geography", key: "europe", label: "Europe" },
              points: [
                { period: "CY2024", value: 25, evidence_ref: "metric_observation:3" },
                { period: "CY2025", value: 30, evidence_ref: "metric_observation:4" },
              ],
            },
          ],
          dataset: { kind: "series" },
        },
        {
          view_id: "margin",
          chart_type: "line",
          title: "비율",
          subtitle: "% · CY2024–CY2025",
          unit: "%",
          series: [
            {
              series_key: "AAPL|operating_margin|company_total|percent|annual",
              label: "회사 전체",
              scope: { kind: "company_total", key: "company_total" },
              points: [
                { period: "CY2024", value: 30, evidence_ref: "metric_observation:5" },
                { period: "CY2025", value: 31, evidence_ref: "metric_observation:6" },
              ],
            },
          ],
          dataset: { kind: "series" },
        },
      ],
      provenance: {
        source_tool_call_ids: ["ontology-1"],
        evidence_refs: [
          "metric_observation:1",
          "metric_observation:2",
          "metric_observation:3",
          "metric_observation:4",
          "metric_observation:5",
          "metric_observation:6",
        ],
        source_kinds: ["ontology"],
      },
      quality: { series_count: 3, point_count: 6, warnings: [] },
    },
  };
}

describe("KrwVisualizationCard", () => {
  it("renders one Korean title, safe labels, and unit tabs without exposing renderer keys", () => {
    const html = renderToStaticMarkup(
      createElement(KrwVisualizationCard, { visualization: visualization() }),
    );

    expect(html.match(/애플 지역별 영업이익 추이/g)).toHaveLength(1);
    expect(html).toContain("미주");
    expect(html).toContain("유럽");
    expect(html).toContain('role="tablist"');
    expect(html).toContain(">금액<");
    expect(html).toContain(">비율<");
    expect(html).toContain('data-chart="bar"');
    expect(html).not.toContain("Americas Segment Operating income");
    expect(html).not.toContain("AAPL|operating_income|geography:americas|USD|annual");
  });

  it("routes compiler-owned advanced datasets to their matching Nivo renderer", () => {
    const source = visualization();
    const series = source.payload_json.views[0]?.series ?? [];
    const cases = [
      {
        chart: "pie",
        view: {
          view_id: "composition",
          chart_type: "donut" as const,
          title: "지역별 구성",
          unit: "USD",
          series,
          dataset: {
            kind: "composition" as const,
            period: "CY2025",
            slices: [
              { id: "americas", label: "미주", value: 70, evidence_refs: ["metric_observation:2"] },
              { id: "europe", label: "유럽", value: 30, evidence_refs: ["metric_observation:4"] },
            ],
          },
        },
      },
      {
        chart: "scatter",
        view: {
          view_id: "relationship",
          chart_type: "scatter" as const,
          title: "매출과 이익률 관계",
          series,
          dataset: {
            kind: "xy" as const,
            x_label: "매출",
            y_label: "영업이익률",
            x_unit: "USD",
            y_unit: "%",
            points: [
              { id: "2023", label: "CY2023", x: 100, y: 20, evidence_refs: ["metric_observation:1"] },
              { id: "2024", label: "CY2024", x: 120, y: 22, evidence_refs: ["metric_observation:2"] },
              { id: "2025", label: "CY2025", x: 140, y: 24, evidence_refs: ["metric_observation:3"] },
            ],
          },
        },
      },
      {
        chart: "heatmap",
        view: {
          view_id: "matrix",
          chart_type: "heatmap" as const,
          title: "지역별 분포",
          series,
          dataset: {
            kind: "matrix" as const,
            columns: ["CY2024", "CY2025"],
            rows: [
              {
                id: "americas",
                label: "미주",
                cells: [
                  { column: "CY2024", value: 60, evidence_refs: ["metric_observation:1"] },
                  { column: "CY2025", value: 70, evidence_refs: ["metric_observation:2"] },
                ],
              },
              {
                id: "europe",
                label: "유럽",
                cells: [
                  { column: "CY2024", value: 25, evidence_refs: ["metric_observation:3"] },
                  { column: "CY2025", value: 30, evidence_refs: ["metric_observation:4"] },
                ],
              },
            ],
          },
        },
      },
      {
        chart: "waterfall",
        view: {
          view_id: "bridge",
          chart_type: "waterfall" as const,
          title: "매출 증감",
          unit: "USD",
          series,
          dataset: {
            kind: "bridge" as const,
            steps: [
              { id: "start", label: "CY2023", kind: "start" as const, value: 100, evidence_refs: ["metric_observation:1"] },
              { id: "up", label: "CY2024 증감", kind: "increase" as const, delta: 20, evidence_refs: ["metric_observation:1", "metric_observation:2"] },
              { id: "end", label: "CY2024 결과", kind: "end" as const, value: 120, evidence_refs: ["metric_observation:2"] },
            ],
          },
        },
      },
    ];

    for (const item of cases) {
      const visualizationForCase: ChatMessageVisualization = {
        ...source,
        payload_json: { ...source.payload_json, views: [item.view] },
      };
      const html = renderToStaticMarkup(
        createElement(KrwVisualizationCard, { visualization: visualizationForCase }),
      );
      expect(html).toContain(`data-chart="${item.chart}"`);
    }
  });
});
