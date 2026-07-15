import { describe, expect, it } from "vitest";
import {
  buildResearchArtifacts,
  deriveVisibleAnswer,
} from "./build-research-artifact";
import type { DisplayPlanOutput, ResearchSynthesis } from "@/types/api-contracts";

describe("buildResearchArtifacts", () => {
  it("does not persist a presentation artifact when both answer and evidence are thin", () => {
    const artifacts = buildResearchArtifacts({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      finalText:
        "Venture Global의 주요 정보를 정리했습니다. 궁금한 특정 주제가 있으면 말씀해 주세요.",
      defaultTickers: ["VG"],
      citations: [],
      toolCalls: [],
      fallbackWhenMissing: true,
    });

    expect(artifacts).toEqual([]);
  });

  it("does not synthesize fallback rich blocks when fallback is disabled", () => {
    const artifacts = buildResearchArtifacts({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      finalText:
        "Venture Global은 LNG 공급망 전반의 자산을 운영하는 기업입니다.",
      defaultTickers: ["VG"],
      citations: [],
      toolCalls: [
        {
          id: "tool-1",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["VG"],
            object_types: ["GrowthDriver"],
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "GrowthDriver",
                  ticker: "VG",
                  document_type: "10-K",
                  period: "FY2025",
                  text: "Evidence-backed claims describe modular_design_cost_advantage themes relevant to capital_expenditures.",
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
      ],
      fallbackWhenMissing: false,
    });

    expect(artifacts).toEqual([]);
  });

  it("uses SearchPlan tickers and ResearchState lineage for fallback artifacts", () => {
    const [artifact] = buildResearchArtifacts({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      finalText:
        "AMZN FY2025 10-K 기준 종합 분석입니다. AWS가 핵심 이익 엔진입니다.",
      defaultTickers: [],
      citations: [],
      toolCalls: [
        {
          id: "tool-1",
          toolName: "krw_ontology_query_context",
          argumentsJson: JSON.stringify({
            search_plan: { tickers: ["AMZN"] },
          }),
          resultSummary: null,
          resultJson: {
            contract_version: "research-state/v2",
            resolved_scope: {
              requested_tickers: ["AMZN"],
              resolved_tickers: ["AMZN"],
            },
            evidence_units: [
              {
                evidence_id: "ev:revenue",
                object_id: "metric:AMZN:revenue",
                object_type: "MetricObservation",
                ticker: "AMZN",
                period: "FY2025",
                document_type: "10-K",
                evidence_grade: "strong",
                source: {
                  object_ids: ["metric:AMZN:revenue"],
                  source_label: "AMZN FY2025 10-K",
                },
              },
            ],
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
      ],
      fallbackWhenMissing: true,
    });

    expect(artifact?.title).toBe("AMZN Research Brief");
    expect(artifact?.tickers).toEqual(["AMZN"]);
    expect(artifact?.blocks_json).toEqual([
      expect.objectContaining({
        type: "markdown",
        content:
          "AMZN FY2025 10-K 기준 종합 분석입니다. AWS가 핵심 이익 엔진입니다.",
      }),
    ]);
    expect(artifact?.evidence_refs).toEqual([
      expect.objectContaining({
        id: "ev:revenue",
        trace_id: "metric:AMZN:revenue",
      }),
    ]);
  });

  it("does not replace a thin final answer with synthesized company-specific content", () => {
    const artifacts = buildResearchArtifacts({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      finalText:
        "아티팩트 생성 완료. AMZN FY2025 10-K 기준 사업 구조와 핵심 재무 포인트를 한국어로 정리했습니다.",
      defaultTickers: [],
      citations: [],
      toolCalls: [
        {
          id: "tool-1",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["AMZN"],
            periods: ["FY2025"],
            document_types: ["10-K"],
            topic: "total net sales increased",
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                ...Array.from({ length: 30 }, (_, index) => ({
                  type: "ResearchClaim",
                  ticker: "AMZN",
                  document_type: "10-K",
                  period: "FY2025",
                  text: `Operational background claim ${index + 1} without a numeric metric.`,
                })),
                {
                  type: "ResearchClaim",
                  ticker: "AMZN",
                  document_type: "10-K",
                  period: "FY2025",
                  text: "Total net sales increased from $574,785 million in 2023 to $637,959 million in 2024 to $716,924 million in 2025.",
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
        {
          id: "tool-2",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["AMZN"],
            periods: ["FY2025"],
            document_types: ["10-K"],
            topic: "operating income segment",
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "ResearchClaim",
                  ticker: "AMZN",
                  document_type: "10-K",
                  period: "FY2025",
                  text: "International segment operating income increased in 2025 compared to the prior year, driven by increased unit sales and cost efficiencies.",
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
      ],
      fallbackWhenMissing: true,
    });

    expect(artifacts).toEqual([]);
  });

  it("does not mine raw query text into answer claims or headline metrics", () => {
    const artifacts = buildResearchArtifacts({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      finalText: "AMZN 관련 리스크를 정리했습니다.",
      defaultTickers: ["AMZN"],
      citations: [],
      toolCalls: [
        {
          id: "tool-1",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["AMZN"],
            periods: ["FY2025Q3"],
            topic: "revenue",
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "ResearchClaim",
                  ticker: "AMZN",
                  document_type: "10-Q",
                  period: "FY2025Q3",
                  text: "Inventory valuation allowance, representing a write-down of inventory, was $3.0 billion as of December 31, 2024 and $2.9 billion as of September 30, 2025.",
                },
                {
                  type: "Headwind",
                  ticker: "AMZN",
                  document_type: "10-Q",
                  period: "FY2025Q3",
                  text: "Evidence-backed claims describe depreciation_useful_life_change_impact themes relevant to depreciation_and_amortization.",
                  evidence: {
                    claims: [
                      {
                        type: "ResearchClaim",
                        ticker: "AMZN",
                        document_type: "10-Q",
                        period: "FY2025Q3",
                        text: "Q3 2025: The change in useful life estimate increased depreciation and amortization expense by $392 million and reduced net income by $298 million, or $0.03 per basic share and $0.03 per diluted share, primarily impacting AWS segment.",
                      },
                    ],
                  },
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
      ],
      fallbackWhenMissing: true,
    });

    expect(artifacts).toEqual([]);
  });

  it("does not supplement canonical/display-plan artifacts with evidence-derived blocks", () => {
    const researchSynthesis: ResearchSynthesis = {
      synthesis_version: "krw-research-synthesis/v1" as const,
      canonical_answer: {
        default_order: ["p1"],
        units: [
          {
            id: "p1",
            type: "paragraph",
            text: "Amazon의 FY2025 핵심 포인트를 정리했습니다.",
            importance: "required",
            display_policy: "show",
          },
        ],
      },
      quality: { overall: "high" as const, warnings: [] },
    };
    const displayPlan: DisplayPlanOutput = {
      display_plan_version: "krw-display-plan/v1" as const,
      source_synthesis_version: "krw-research-synthesis/v1",
      display_plan: [
        {
          block_id: "b1",
          block_type: "markdown" as const,
          source_ids: ["p1"],
        },
      ],
      quality: { overall: "high" as const, warnings: [] },
    };
    const [artifact] = buildResearchArtifacts({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      finalText: "구조화된 답변입니다.",
      defaultTickers: [],
      citations: [],
      structuredAnswer: {
        answer_blocks: [
          {
            type: "markdown",
            content: "Amazon의 FY2025 핵심 포인트를 정리했습니다.",
          },
        ],
        quality: { overall: "high", warnings: [] },
      },
      researchSynthesis,
      displayPlan,
      toolCalls: [
        {
          id: "tool-1",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["AMZN"],
            topic: "total net sales increased",
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "ResearchClaim",
                  ticker: "AMZN",
                  document_type: "10-K",
                  period: "FY2025",
                  text: "Total net sales increased from $574,785 million in 2023 to $637,959 million in 2024 to $716,924 million in 2025.",
                },
                {
                  type: "ResearchClaim",
                  ticker: "AMZN",
                  document_type: "10-K",
                  period: "FY2025",
                  text: "AWS segment operating income increased in 2025 compared to the prior year.",
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
      ],
    });

    expect(artifact?.blocks_json.map((block) => block.type)).toEqual(["markdown"]);
    expect(JSON.stringify(artifact?.blocks_json)).not.toContain("metric_grid");
    expect(JSON.stringify(artifact?.blocks_json)).not.toContain("business_segments");
    expect(artifact?.source_json?.research_synthesis).toMatchObject({
      synthesis_version: "krw-research-synthesis/v1",
    });
    expect(artifact?.source_json?.display_plan).toMatchObject({
      display_plan_version: "krw-display-plan/v1",
    });
  });

  it("does not synthesize domain blocks from non-v2 raw ontology results", () => {
    const artifacts = buildResearchArtifacts({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      finalText:
        "Venture Global의 주요 정보를 정리했습니다. 궁금한 특정 주제가 있으면 말씀해 주세요.",
      defaultTickers: ["VG"],
      citations: [],
      toolCalls: [
        {
          id: "tool-profile",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["VG"],
            object_types: ["CompanyBusinessProfile"],
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "CompanyBusinessProfile",
                  ticker: "VG",
                  document_type: "COMPANY",
                  period: "ALL",
                  text: "Primary activities: Liquefaction project development, Feed gas procurement, LNG sales, Lng Exports, Lng Shipping. Key external factors: project_execution, natural_gas_price, regulatory_approval.",
                  evidence: {
                    claims: [
                      {
                        type: "ResearchClaim",
                        ticker: "VG",
                        document_type: "10-K",
                        period: "FY2025",
                        text: "Venture Global operates assets across the full LNG supply chain, including LNG production, natural gas transport, shipping, and regasification.",
                      },
                    ],
                  },
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
        {
          id: "tool-driver",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["VG"],
            object_types: ["GrowthDriver"],
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "GrowthDriver",
                  ticker: "VG",
                  document_type: "10-K",
                  period: "FY2025",
                  text: "Evidence-backed claims describe modular_design_cost_advantage themes relevant to capital_expenditures.",
                  evidence: {
                    claims: [
                      {
                        type: "ResearchClaim",
                        ticker: "VG",
                        document_type: "10-K",
                        period: "FY2025",
                        text: "Venture Global's modular, scalable \"design-one, build-many\" approach enables faster and more cost-efficient construction and deployment of productive assets compared to traditional LNG projects.",
                      },
                    ],
                  },
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
        {
          id: "tool-risk",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["VG"],
            object_types: ["RiskFactor"],
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "RiskFactor",
                  ticker: "VG",
                  document_type: "10-K",
                  period: "FY2025",
                  text: "Evidence-backed claims describe regulatory_appeals_risk themes relevant to revenue.",
                  evidence: {
                    claims: [
                      {
                        type: "ResearchClaim",
                        ticker: "VG",
                        document_type: "10-K",
                        period: "FY2025",
                        text: "Both the FERC and DOE Non-FTA Nations authorizations for the CP2 Project are subject to ongoing appeals, creating regulatory uncertainty.",
                      },
                    ],
                  },
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
        {
          id: "tool-metrics",
          toolName: "krw_ontology_query",
          argumentsJson: JSON.stringify({
            tickers: ["VG"],
            object_types: ["FinancialMetricValue"],
          }),
          resultSummary: null,
          resultJson: {
            result: JSON.stringify({
              results: [
                {
                  type: "FinancialMetricValue",
                  ticker: "VG",
                  document_type: "10-Q",
                  period: "FY2025Q3",
                  text: "revenue: 3329000000.0 USD",
                },
                {
                  type: "FinancialMetricValue",
                  ticker: "VG",
                  document_type: "10-Q",
                  period: "FY2025Q3",
                  text: "revenue: 9324000000.0 USD",
                },
                {
                  type: "FinancialMetricValue",
                  ticker: "VG",
                  document_type: "10-Q",
                  period: "FY2025Q3",
                  text: "operating_income: 3438000000.0 USD",
                },
              ],
            }),
          },
          resultText: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          errorMessage: null,
        },
      ],
      fallbackWhenMissing: true,
    });

    expect(artifacts).toEqual([]);
  });
});

describe("deriveVisibleAnswer", () => {
  it("does not repeat summary sentences as bullets", () => {
    expect(
      deriveVisibleAnswer(
        "AMZN FY2025 10-K 기준 종합 분석을 리서치 노트로 정리했습니다. 핵심은 AWS가 전체 영업이익의 57%를 차지하는 최대 이익 엔진입니다.",
        "AMZN Research Brief",
      ),
    ).toBe(
      "**AMZN Research Brief**\nAMZN FY2025 10-K 기준 종합 분석을 리서치 노트로 정리했습니다. 핵심은 AWS가 전체 영업이익의 57%를 차지하는 최대 이익 엔진입니다.",
    );
  });

  it("uses artifact summary when the SDK answer is only a confirmation", () => {
    expect(
      deriveVisibleAnswer(
        "아티팩트 생성 완료.",
        "AMZN Research Brief",
        null,
        "AMZN FY2025 10-K 기준으로 사업 구조와 핵심 재무 포인트를 정리했습니다.",
      ),
    ).toBe(
      "**AMZN Research Brief**\nAMZN FY2025 10-K 기준으로 사업 구조와 핵심 재무 포인트를 정리했습니다.",
    );
  });

  it("compacts long structured visible answers when an artifact is present", () => {
    const visible = deriveVisibleAnswer(
      "",
      "AMZN FY2025 10-K 사업 구조 및 핵심 재무 분석",
      [
        "## AMZN FY2025 10-K 사업 구조 및 핵심 재무 요약",
        "Amazon은 3개 보고 사업부로 구성된 글로벌 기업입니다.",
        "### 핵심 재무 포인트",
        "- 연결 매출 $7,169억",
        "- 연결 영업이익 $800억",
        "- 순이익 $777억",
        "- CAPEX $1,283억",
        "- AWS 영업이익 $456억",
        "### 주요 성장 동력",
        "AWS 클라우드와 광고 서비스",
      ].join("\n\n"),
      "Amazon FY2025 10-K 기준 사업부 구조와 주요 재무 지표를 정리한 리서치 아티팩트입니다.",
    );

    expect(visible).toBe(
      "**AMZN FY2025 10-K 사업 구조 및 핵심 재무 분석**\nAmazon FY2025 10-K 기준 사업부 구조와 주요 재무 지표를 정리한 리서치 아티팩트입니다.\n- 연결 매출 $7,169억\n- 연결 영업이익 $800억\n- 순이익 $777억",
    );
  });
});
