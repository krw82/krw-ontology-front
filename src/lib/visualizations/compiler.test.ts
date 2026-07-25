import { describe, expect, it, vi } from "vitest";
import type { AccumulatedRun } from "@/lib/agent/stream-handler";

vi.mock("server-only", () => ({}));

import { compileVisualization } from "./compiler";
import { VisualizationDatasetRegistry } from "./dataset-registry";

function accumulator(series: Array<Record<string, unknown>>): AccumulatedRun {
  return {
    fullText: "",
    structuredOutput: null,
    researchSynthesisOutput: null,
    researchSynthesisText: null,
    displayPlanOutput: null,
    toolCalls: [{
      id: "ontology-1",
      toolName: "krw_ontology_query_context",
      argumentsJson: "{}",
      resultSummary: null,
      resultJson: {
        research_pack: {
          metric_series_pack: { mode: "chart_series_sidecar", series },
        },
      },
      resultText: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      errorMessage: null,
    }],
    citations: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
  };
}

function metricSeries(params: {
  key: string;
  label: string;
  metric: string;
  unit: string;
  points: Array<[string, number]>;
  scope?: { kind: string; key: string; label?: string };
}) {
  return {
    series_key: params.key,
    label: params.label,
    ticker: params.key.split("|")[0],
    canonical_metric: params.metric,
    unit: params.unit,
    scope: params.scope ?? {
      kind: "company_total",
      key: "company_total",
      label: "Company total",
    },
    points: params.points.map(([period, value]) => ({
      period,
      value,
      object_id: `xbrl:AAPL:${period}:${params.metric}`,
    })),
  };
}

describe("visualization compiler", () => {
  it("compiles a verified five-period metric request without model-supplied values", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|operating_income|USD|annual",
        label: "Operating income",
        metric: "operating_income",
        unit: "USD",
        points: [["CY2021", 100], ["CY2022", 110], ["CY2023", 120], ["CY2024", 130], ["CY2025", 140]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "AAPL 최근 5개 회계연도의 영업이익 변화를 보여준다",
        measures: ["operating income"],
        relationship: "trend",
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.status).toBe("created");
    expect(result.artifact?.artifact_ref).toMatch(/^viz_[a-f0-9]{16}$/);
    expect(result.artifact?.views).toHaveLength(1);
    expect(result.artifact?.views[0]?.chart_type).toBe("line");
    expect(result.artifact?.provenance.evidence_refs).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain("[[krw-chart:");
  });

  it("resolves Korean metric intent through runtime aliases instead of model-supplied keys", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|operating_income|USD|annual",
        label: "Operating income",
        metric: "operating_income",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 120], ["CY2025", 140]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "AAPL 영업이익 추이를 보여준다",
        measures: ["영업이익"],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.status).toBe("created");
    expect(result.artifact?.views[0]?.series[0]?.canonical_metric).toBe(
      "operating_income",
    );
  });

  it("applies a concrete recent-period request before rendering the view", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [
          ["CY2020", 80],
          ["CY2021", 90],
          ["CY2022", 100],
          ["CY2023", 110],
          ["CY2024", 120],
          ["CY2025", 130],
        ],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "AAPL 최근 3년 매출 추이",
        measures: ["revenue"],
        time_scope: "최근 3년",
        relationship: "trend",
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views[0]?.series[0]?.points.map((point) => point.period))
      .toEqual(["CY2023", "CY2024", "CY2025"]);
    expect(result.artifact?.views[0]?.subtitle).toContain("최근 3년");
  });

  it("splits mixed units into aligned views instead of a dual axis", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 120], ["CY2025", 140]],
      }),
      metricSeries({
        key: "AAPL|operating_margin|percent|annual",
        label: "Operating margin",
        metric: "operating_margin",
        unit: "%",
        points: [["CY2023", 20], ["CY2024", 22], ["CY2025", 24]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "매출과 영업이익률 추이를 비교한다",
        measures: ["revenue", "operating margin"],
        relationship: "trend",
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.status).toBe("partial");
    expect(result.artifact?.views).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("서로 다른 단위");
  });

  it("disambiguates duplicate labels for cross-company comparisons", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|company_total:company_total|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2024", 100], ["CY2025", 120]],
      }),
      metricSeries({
        key: "MSFT|revenue|company_total:company_total|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2024", 90], ["CY2025", 130]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "AAPL과 MSFT 매출 비교",
        measures: ["revenue"],
        relationship: "comparison",
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views[0]?.series.map((series) => series.label)).toEqual([
      "AAPL",
      "MSFT",
    ]);
  });

  it("does not guess a metric when no verified series is available", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([]));
    const result = compileVisualization({
      intent: { goal: "이익 추이" },
      registry,
      artifactIndex: 1,
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason_code: "no_dataset",
    });
  });

  it("calculates a deterministic percentage change from source values", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 125], ["CY2025", 100]],
      }),
    ]));
    const result = compileVisualization({
      intent: {
        goal: "매출 YoY",
        measures: ["revenue"],
        transform_hints: ["yoy_percent"],
      },
      registry,
      artifactIndex: 1,
    });

    const points = result.artifact?.views[0]?.series[0]?.points;
    expect(points?.map((point) => point.value)).toEqual([25, -20]);
    expect(result.artifact?.views[0]?.unit).toBe("%");
    expect(result.artifact?.provenance.evidence_refs).toContain(
      "metric_observation:xbrl:AAPL:CY2023:revenue",
    );
  });

  it("uses same-quarter prior-year observations for quarterly YoY", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|quarterly",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [
          ["CY2024 Q1", 100],
          ["CY2024 Q2", 105],
          ["CY2024 Q3", 110],
          ["CY2024 Q4", 120],
          ["CY2025 Q1", 130],
        ],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "분기 매출 YoY",
        measures: ["revenue"],
        transform_hints: ["yoy_percent"],
      },
      registry,
      artifactIndex: 1,
    });

    const points = result.artifact?.views[0]?.series[0]?.points;
    expect(points?.map((point) => [point.period, point.value])).toEqual([
      ["CY2025 Q1", 30],
    ]);
    expect(points?.[0]?.derived_from_evidence_refs).toEqual([
      "metric_observation:xbrl:AAPL:CY2025 Q1:revenue",
      "metric_observation:xbrl:AAPL:CY2024 Q1:revenue",
    ]);
  });

  it("uses the immediately preceding quarter for QoQ and skips annual-only data", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|quarterly",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [
          ["FY2024Q1", 100],
          ["FY2024Q2", 120],
          ["FY2024Q3", 90],
          ["FY2024Q4", 180],
        ],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "분기 매출 QoQ",
        measures: ["revenue"],
        transform_hints: ["qoq_percent"],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views[0]?.series[0]?.points.map((point) => point.value))
      .toEqual([20, -25, 100]);
  });

  it("adds filing and news overlays from structured tool results without reading document bodies", () => {
    const run = accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 120], ["CY2025", 140]],
      }),
    ]);
    run.toolCalls.push(
      {
        id: "filing-1",
        toolName: "get_filing",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: {
          id: "filing-event-1",
          ticker: "AAPL",
          form_type: "8-K",
          filing_date: "2025-02-01",
          filing_detail_url: "https://www.sec.gov/Archives/example",
          // A body must never be retained by the visualization registry.
          document_body: "very long raw filing body that is not event metadata",
        },
        resultText: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        errorMessage: null,
      },
      {
        id: "news-1",
        toolName: "search_company_news_events",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: {
          events: [{
            id: "news-event-1",
            source_kind: "market_news",
            published_at: "2025-03-01T10:00:00Z",
            headline: "AAPL demand update",
            url: "https://example.com/news",
          }],
        },
        resultText: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        errorMessage: null,
      },
    );

    const result = compileVisualization({
      intent: {
        goal: "매출 추이와 관련 공시·뉴스를 함께 본다",
        measures: ["revenue"],
        event_overlay: ["filing", "news"],
      },
      registry: VisualizationDatasetRegistry.fromAccumulatedRun(run),
      artifactIndex: 1,
    });

    const events = result.artifact?.views[0]?.events;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: "filing", evidence_ref: "filing:filing-event-1" }),
      expect.objectContaining({ source_kind: "news", evidence_ref: "news:news-event-1" }),
    ]));
    expect(result.artifact?.provenance.source_kinds).toEqual(
      expect.arrayContaining(["ontology", "filing", "news"]),
    );
    expect(JSON.stringify(result)).not.toContain("very long raw filing body");
  });

  it("includes only the requested event source kinds", () => {
    const run = accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 120]],
      }),
    ]);
    run.toolCalls.push(
      {
        id: "filing-1",
        toolName: "get_filing",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: {
          id: "filing-event-1",
          ticker: "AAPL",
          form_type: "8-K",
          filing_date: "2025-02-01",
        },
        resultText: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        errorMessage: null,
      },
      {
        id: "news-1",
        toolName: "search_company_news_events",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: {
          events: [{
            id: "news-event-1",
            source_kind: "market_news",
            published_at: "2025-03-01T10:00:00Z",
            headline: "AAPL demand update",
          }],
        },
        resultText: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        errorMessage: null,
      },
    );

    const result = compileVisualization({
      intent: {
        goal: "매출 추이와 관련 뉴스를 함께 본다",
        measures: ["revenue"],
        event_overlay: ["news"],
      },
      registry: VisualizationDatasetRegistry.fromAccumulatedRun(run),
      artifactIndex: 1,
    });

    expect(result.artifact?.views[0]?.events).toEqual([
      expect.objectContaining({ source_kind: "news", evidence_ref: "news:news-event-1" }),
    ]);
  });

  it("selects the company total by default instead of mixing it with segment data", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|operating_income|company_total|USD|annual",
        label: "Operating income",
        metric: "operating_income",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 120], ["CY2025", 140]],
      }),
      metricSeries({
        key: "AAPL|operating_income|americas|USD|annual",
        label: "Americas Segment Operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "geography", key: "americas", label: "Americas" },
        points: [["CY2023", 50], ["CY2024", 60], ["CY2025", 70]],
      }),
      metricSeries({
        key: "AAPL|operating_income|europe|USD|annual",
        label: "Europe Segment Operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "geography", key: "europe", label: "Europe" },
        points: [["CY2023", 20], ["CY2024", 25], ["CY2025", 30]],
      }),
    ]));

    const result = compileVisualization({
      intent: { goal: "AAPL 최근 3년 영업이익 추이", measures: ["operating income"] },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views).toHaveLength(1);
    expect(result.artifact?.views[0]?.series).toHaveLength(1);
    expect(result.artifact?.views[0]?.series[0]?.scope.kind).toBe("company_total");
    expect(result.artifact?.title).toBe("AAPL 영업이익 추이");
  });

  it("infers one named metric when total and dimensional variants share the same metric", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|operating_income|company_total|USD|annual",
        label: "Operating income",
        metric: "operating_income",
        unit: "USD",
        points: [["CY2024", 120], ["CY2025", 140]],
      }),
      metricSeries({
        key: "AAPL|operating_income|americas|USD|annual",
        label: "Americas Segment Operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "geography", key: "americas", label: "Americas" },
        points: [["CY2024", 60], ["CY2025", 70]],
      }),
    ]));

    const result = compileVisualization({
      intent: { goal: "AAPL 영업이익 추이를 보여줘" },
      registry,
      artifactIndex: 1,
    });

    expect(result.status).toBe("created");
    expect(result.artifact?.views[0]?.series).toHaveLength(1);
    expect(result.artifact?.views[0]?.series[0]?.scope.kind).toBe("company_total");
  });

  it("uses a requested breakdown and accepts presentation-only Korean legend hints", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|operating_income|company_total|USD|annual",
        label: "Operating income",
        metric: "operating_income",
        unit: "USD",
        points: [["CY2024", 120], ["CY2025", 140]],
      }),
      metricSeries({
        key: "AAPL|operating_income|americas|USD|annual",
        label: "Americas Segment Operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "geography", key: "americas", label: "Americas" },
        points: [["CY2024", 60], ["CY2025", 70]],
      }),
      metricSeries({
        key: "AAPL|operating_income|europe|USD|annual",
        label: "Europe Segment Operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "geography", key: "europe", label: "Europe" },
        points: [["CY2024", 25], ["CY2025", 30]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "AAPL 지역별 영업이익 추이",
        measures: ["operating income"],
        scope_mode: "breakdown",
        group_by: "지역별",
        title_hint: "애플 지역별 영업이익 추이",
        series_label_hints: [
          { source: "americas", label: "미주" },
          { source: "europe", label: "유럽" },
        ],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.title).toBe("애플 지역별 영업이익 추이");
    expect(result.artifact?.views[0]?.series.map((series) => series.label)).toEqual(["미주", "유럽"]);
    expect(result.artifact?.views[0]?.series.every((series) => series.scope.kind === "geography")).toBe(true);
  });

  it("merges cosmetic unit casing and keeps a stable data fingerprint across title changes", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|company_total|usd|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "usd",
        points: [["CY2023", 100], ["CY2024", 120], ["CY2025", 140]],
      }),
      metricSeries({
        key: "AAPL|revenue|company_total|USD|annual|duplicate",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2024", 120], ["CY2025", 140]],
      }),
    ]));
    const first = compileVisualization({
      intent: { goal: "AAPL 매출 추이", measures: ["revenue"], title_hint: "애플 매출 추이" },
      registry,
      artifactIndex: 1,
    });
    const second = compileVisualization({
      intent: {
        goal: "다른 문장",
        measures: ["revenue"],
        relationship: "comparison",
        title_hint: "매출 변화",
      },
      registry,
      artifactIndex: 2,
    });

    expect(first.artifact?.views).toHaveLength(1);
    expect(first.artifact?.views[0]?.unit).toBe("USD");
    expect(first.artifact?.views[0]?.series).toHaveLength(1);
    expect(first.artifact?.semantic_fingerprint).toBe(second.artifact?.semantic_fingerprint);
    expect(first.artifact?.artifact_ref).toBe(second.artifact?.artifact_ref);
  });

  it("compiles a one-period breakdown into a deterministic donut dataset", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|americas|USD|annual",
        label: "Americas segment revenue",
        metric: "revenue",
        unit: "USD",
        scope: { kind: "geography", key: "americas", label: "Americas" },
        points: [["CY2025", 55]],
      }),
      metricSeries({
        key: "AAPL|revenue|europe|USD|annual",
        label: "Europe segment revenue",
        metric: "revenue",
        unit: "USD",
        scope: { kind: "geography", key: "europe", label: "Europe" },
        points: [["CY2025", 45]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "애플 지역별 매출 구성",
        measures: ["revenue"],
        relationship: "composition_snapshot",
        title_hint: "애플 지역별 매출 구성",
        series_label_hints: [
          { source: "Americas", label: "미주" },
          { source: "Europe", label: "유럽" },
        ],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views[0]?.chart_type).toBe("donut");
    const dataset = result.artifact?.views[0]?.dataset;
    expect(dataset).toMatchObject({ kind: "composition", period: "CY2025" });
    if (!dataset || dataset.kind !== "composition") throw new Error("Expected composition dataset");
    expect(dataset.slices.map((slice) => ({
      label: slice.label,
      value: slice.value,
      evidence_refs: slice.evidence_refs,
    }))).toEqual([
      { label: "미주", value: 55, evidence_refs: ["metric_observation:xbrl:AAPL:CY2025:revenue"] },
      { label: "유럽", value: 45, evidence_refs: ["metric_observation:xbrl:AAPL:CY2025:revenue"] },
    ]);
  });

  it("preserves a source scope label when the model supplies no Korean legend hint", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|americas|USD|annual",
        label: "Americas segment revenue",
        metric: "revenue",
        unit: "USD",
        scope: { kind: "geography", key: "americas", label: "Americas" },
        points: [["CY2025", 55]],
      }),
      metricSeries({
        key: "AAPL|revenue|europe|USD|annual",
        label: "Europe segment revenue",
        metric: "revenue",
        unit: "USD",
        scope: { kind: "geography", key: "europe", label: "Europe" },
        points: [["CY2025", 45]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "애플 지역별 매출 구성",
        measures: ["revenue"],
        relationship: "composition_snapshot",
      },
      registry,
      artifactIndex: 1,
    });

    const dataset = result.artifact?.views[0]?.dataset;
    if (!dataset || dataset.kind !== "composition") throw new Error("Expected composition dataset");
    expect(dataset.slices.map((slice) => slice.label)).toEqual(["Americas", "Europe"]);
  });

  it("honors explicit regional scopes when an ontology sidecar calls them segments", () => {
    const regions = [
      ["americas", "Americas Segment", 72.5],
      ["europe", "Europe Segment", 47.7],
      ["greater_china", "Greater China Segment", 26.9],
      ["japan", "Japan Segment", 14],
      ["rest_of_asia_pacific", "Rest of Asia Pacific Segment", 14.6],
    ] as const;
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      ...regions.map(([key, label, value]) => metricSeries({
        key: `AAPL|operating_income|${key}|USD|annual`,
        label,
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "segment", key: `operating_segments:${key}`, label },
        points: [["CY2025", value]],
      })),
      metricSeries({
        key: "AAPL|operating_income|corporate|USD|annual",
        label: "Corporate",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "segment", key: "operating_segments:corporate", label: "Corporate" },
        points: [["CY2025", -42.6]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "애플 CY2025 지역별 영업이익 구성",
        measures: ["operating income"],
        relationship: "composition_snapshot",
        scope_mode: "breakdown",
        group_by: "지역별",
        include_scopes: ["Americas", "Europe", "Greater China", "Japan", "Rest of Asia Pacific"],
        series_label_hints: [
          { source: "Americas", label: "미주" },
          { source: "Europe", label: "유럽" },
          { source: "Greater China", label: "중화권" },
          { source: "Japan", label: "일본" },
          { source: "Rest of Asia Pacific", label: "기타 아시아·태평양" },
        ],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.status).toBe("created");
    expect(result.artifact?.views[0]?.chart_type).toBe("donut");
    const dataset = result.artifact?.views[0]?.dataset;
    if (!dataset || dataset.kind !== "composition") throw new Error("Expected composition dataset");
    expect(dataset.slices.map((slice) => slice.label)).toEqual([
      "미주",
      "유럽",
      "중화권",
      "일본",
      "기타 아시아·태평양",
    ]);
    expect(dataset.slices.map((slice) => slice.value)).toEqual([72.5, 47.7, 26.9, 14, 14.6]);
  });

  it("resolves previously unseen scope names from this run instead of a regional dictionary", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "ZETA|operating_income|northern_arc|USD|annual",
        label: "Northern Arc operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "segment", key: "reported_units:northern_arc", label: "Northern Arc" },
        points: [["CY2025", 41]],
      }),
      metricSeries({
        key: "ZETA|operating_income|coastal_cluster|USD|annual",
        label: "Coastal Cluster operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "segment", key: "reported_units:coastal_cluster", label: "Coastal Cluster" },
        points: [["CY2025", 33]],
      }),
      metricSeries({
        key: "ZETA|operating_income|inland_markets|USD|annual",
        label: "Inland Markets operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "segment", key: "reported_units:inland_markets", label: "Inland Markets" },
        points: [["CY2025", 26]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "Zeta CY2025 지역별 영업이익 구성",
        measures: ["operating income"],
        relationship: "composition_snapshot",
        scope_mode: "breakdown",
        group_by: "지역별",
        include_scopes: ["Northern Arc", "Coastal Cluster", "Inland Markets"],
        series_label_hints: [
          { source: "Northern Arc", label: "북부 권역" },
          { source: "Coastal Cluster", label: "해안 권역" },
          { source: "Inland Markets", label: "내륙 권역" },
        ],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.status).toBe("created");
    const dataset = result.artifact?.views[0]?.dataset;
    if (!dataset || dataset.kind !== "composition") throw new Error("Expected composition dataset");
    expect(dataset.slices.map((slice) => ({ label: slice.label, value: slice.value }))).toEqual([
      { label: "북부 권역", value: 41 },
      { label: "해안 권역", value: 33 },
      { label: "내륙 권역", value: 26 },
    ]);
  });

  it("does not guess when a requested scope text matches multiple verified scopes", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "ZETA|revenue|asia_consumer|USD|annual",
        label: "Asia Consumer revenue",
        metric: "revenue",
        unit: "USD",
        scope: { kind: "segment", key: "business_units:asia_consumer", label: "Asia Consumer" },
        points: [["CY2025", 60]],
      }),
      metricSeries({
        key: "ZETA|revenue|asia_enterprise|USD|annual",
        label: "Asia Enterprise revenue",
        metric: "revenue",
        unit: "USD",
        scope: { kind: "segment", key: "business_units:asia_enterprise", label: "Asia Enterprise" },
        points: [["CY2025", 40]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "Zeta 아시아 매출 구성",
        measures: ["revenue"],
        relationship: "composition_snapshot",
        scope_mode: "breakdown",
        include_scopes: ["Asia"],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result).toMatchObject({ status: "skipped", reason_code: "ambiguous_scope" });
  });

  it("requires every explicitly requested scope to exist in the current run", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "ZETA|revenue|northern_arc|USD|annual",
        label: "Northern Arc revenue",
        metric: "revenue",
        unit: "USD",
        scope: { kind: "segment", key: "reported_units:northern_arc", label: "Northern Arc" },
        points: [["CY2025", 60]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "Zeta 권역별 매출 구성",
        measures: ["revenue"],
        relationship: "composition_snapshot",
        scope_mode: "breakdown",
        include_scopes: ["Northern Arc", "Missing Scope"],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result).toMatchObject({ status: "skipped", reason_code: "no_matching_scope" });
  });

  it("compiles paired verified metrics into a scatter dataset before splitting units", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 120], ["CY2025", 150]],
      }),
      metricSeries({
        key: "AAPL|operating_margin|percent|annual",
        label: "Operating margin",
        metric: "operating_margin",
        unit: "%",
        points: [["CY2023", 20], ["CY2024", 22], ["CY2025", 25]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "애플 매출과 영업이익률의 관계",
        measures: ["revenue", "operating margin"],
        relationship: "relationship",
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views).toHaveLength(1);
    expect(result.artifact?.views[0]).toMatchObject({
      chart_type: "scatter",
      dataset: {
        kind: "xy",
        x_label: "revenue",
        y_label: "operating_margin",
        points: [
          { label: "CY2023", x: 100, y: 20 },
          { label: "CY2024", x: 120, y: 22 },
          { label: "CY2025", x: 150, y: 25 },
        ],
      },
    });
  });

  it("compiles a compact breakdown-by-period matrix into a heatmap dataset", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|operating_income|americas|USD|annual",
        label: "Americas Segment Operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "geography", key: "americas", label: "Americas" },
        points: [["CY2023", 60], ["CY2024", 65], ["CY2025", 70]],
      }),
      metricSeries({
        key: "AAPL|operating_income|europe|USD|annual",
        label: "Europe Segment Operating income",
        metric: "operating_income",
        unit: "USD",
        scope: { kind: "geography", key: "europe", label: "Europe" },
        points: [["CY2023", 25], ["CY2024", 27], ["CY2025", 30]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "애플 지역별 영업이익 분포",
        measures: ["operating income"],
        relationship: "matrix",
        series_label_hints: [
          { source: "Americas", label: "미주" },
          { source: "Europe", label: "유럽" },
        ],
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views[0]?.chart_type).toBe("heatmap");
    const dataset = result.artifact?.views[0]?.dataset;
    expect(dataset).toMatchObject({ kind: "matrix", columns: ["CY2023", "CY2024", "CY2025"] });
    if (!dataset || dataset.kind !== "matrix") throw new Error("Expected matrix dataset");
    expect(dataset.rows.map((row) => ({
      label: row.label,
      cells: row.cells.map((cell) => ({ column: cell.column, value: cell.value })),
    }))).toEqual([
      {
        label: "미주",
        cells: [
          { column: "CY2023", value: 60 },
          { column: "CY2024", value: 65 },
          { column: "CY2025", value: 70 },
        ],
      },
      {
        label: "유럽",
        cells: [
          { column: "CY2023", value: 25 },
          { column: "CY2024", value: 27 },
          { column: "CY2025", value: 30 },
        ],
      },
    ]);
  });

  it("compiles a non-negative verified total series into a waterfall bridge", () => {
    const registry = VisualizationDatasetRegistry.fromAccumulatedRun(accumulator([
      metricSeries({
        key: "AAPL|revenue|USD|annual",
        label: "Revenue",
        metric: "revenue",
        unit: "USD",
        points: [["CY2023", 100], ["CY2024", 130], ["CY2025", 120]],
      }),
    ]));

    const result = compileVisualization({
      intent: {
        goal: "애플 매출 증감",
        measures: ["revenue"],
        relationship: "bridge",
      },
      registry,
      artifactIndex: 1,
    });

    expect(result.artifact?.views[0]).toMatchObject({
      chart_type: "waterfall",
      dataset: {
        kind: "bridge",
        steps: [
          { kind: "start", value: 100 },
          { kind: "increase", delta: 30 },
          { kind: "decrease", delta: -10 },
          { kind: "end", value: 120 },
        ],
      },
    });
  });
});
