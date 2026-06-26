import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AccumulatedRun } from "@/lib/agent/stream-handler";

vi.mock("server-only", () => ({}));

import { __test__ } from "./create-chart-tool";

function makeAccumulator(resultText: string): AccumulatedRun {
  return {
    fullText: "",
    structuredOutput: null,
    researchSynthesisOutput: null,
    researchSynthesisText: null,
    displayPlanOutput: null,
    toolCalls: [
      {
        id: "tool-1",
        toolName: "krw_ontology_query_context",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: null,
        resultText,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        errorMessage: null,
      },
    ],
    citations: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
  };
}

describe("create_chart_v1 metric series recovery", () => {
  it("loads metric_series_pack from overflow tool-result files and accepts evidence refs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "krw-chart-tool-"));
    const toolResultsDir = path.join(dir, "tool-results");
    mkdirSync(toolResultsDir);
    const filePath = path.join(toolResultsDir, "query-context.txt");
    const seriesKey = "AAPL|revenue|i_phone:i_phone|USD|annual|gaap_xbrl|period|xbrl";
    const evidenceRef = "xbrl:AAPL:CY2025:10K:RevenueFromContractWithCustomerExcludingAssessedTax:iphone";
    const payload = {
      research_pack: {
        metric_series_pack: {
          mode: "chart_series_sidecar",
          series: [
            {
              series_key: seriesKey,
              label: "iPhone Revenue",
              canonical_metric: "revenue",
              unit: "USD",
              points: [
                {
                  period: "CY2024",
                  value: 200,
                  object_id: "xbrl:AAPL:CY2024:10K:RevenueFromContractWithCustomerExcludingAssessedTax:iphone",
                },
                {
                  period: "CY2025",
                  value: 210,
                  object_id: evidenceRef,
                },
              ],
            },
          ],
        },
      },
    };
    writeFileSync(
      filePath,
      JSON.stringify({ result: JSON.stringify(payload) }),
      "utf8",
    );
    const acc = makeAccumulator(`Output has been saved to ${filePath}.`);

    const registry = __test__.collectMetricSeriesCandidates(acc.toolCalls);
    expect(registry.get(seriesKey)?.series_key).toBe(seriesKey);
    expect(registry.get(evidenceRef)?.series_key).toBe(seriesKey);

    const chart = __test__.buildChartFromMetricSeries({
      acc,
      chartIndex: 1,
      chartType: "line",
      title: "iPhone revenue",
      seriesRefs: [evidenceRef],
    });
    expect(chart.ok).toBe(true);
    if (chart.ok) {
      expect(chart.output.insert_token).toMatch(/^\[\[krw-chart:/);
      expect(chart.output.chart.series[0]?.series_key).toBe(seriesKey);
    }
  });
});
