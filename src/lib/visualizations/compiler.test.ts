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
});
