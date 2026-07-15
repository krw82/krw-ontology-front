import { describe, expect, it } from "vitest";
import {
  buildResearchEvidenceLedger,
  inspectResearchAnswerEnvelope,
  inspectResearchAnswerText,
  parseResearchAnswerEnvelope,
  selectUsableResearchClaims,
  RESEARCH_ANSWER_ENVELOPE_FORMAT,
} from "./research-evidence-policy";

function partialResearchState() {
  return {
    contract_version: "research-state/v2",
    answerability: {
      status: "partial",
      strong_claim_allowed: false,
    },
    evidence_units: [
      {
        directness: "direct",
        evidence_grade: "strong",
        source: { object_ids: ["claim:AAPL:services"] },
      },
    ],
    computed_values: [
      {
        value: 12.5,
        source_object_ids: ["metric:AAPL:margin"],
      },
    ],
    missing_parts: ["지역별 수요의 직접 지표"],
    warnings: ["planned evidence was truncated"],
    continuation: { has_more: true, omitted_evidence_count: 3 },
  };
}

function partialLedger() {
  return buildResearchEvidenceLedger({
    citations: [],
    toolCalls: [
      {
        id: "tool-1",
        toolName: "krw_ontology_query_context",
        argumentsJson: "{}",
        resultSummary: null,
        resultJson: partialResearchState(),
        resultText: null,
        startedAt: "2026-07-13T00:00:00.000Z",
        finishedAt: "2026-07-13T00:00:01.000Z",
        errorMessage: null,
      },
    ],
  });
}

describe("research evidence policy", () => {
  it("derives the runtime evidence ledger from ResearchState rather than model prose", () => {
    expect(partialLedger()).toMatchObject({
      answerability: "partial",
      strongClaimAllowed: false,
      hasDirectEvidence: true,
      hasComputedValues: true,
      wasTruncated: true,
      hasMore: true,
      evidenceObjectIds: expect.arrayContaining([
        "claim:AAPL:services",
        "metric:AAPL:margin",
      ]),
    });
  });

  it("accepts a bounded inference with verified premises and a monitor", () => {
    const envelope = {
      format: RESEARCH_ANSWER_ENVELOPE_FORMAT,
      final_answer:
        "서비스 관련 근거는 수익성 방어 가능성을 시사합니다. 다만 지역별 수요 확인이 추가로 필요하므로 다음 실적에서 제품 믹스와 지역 매출의 동행 여부를 보겠습니다.",
      claims: [
        {
          claim_id: "fact-services",
          kind: "fact",
          statement: "서비스 관련 근거가 최신 공시에서 직접 확인됩니다.",
          premise_object_ids: ["claim:AAPL:services"],
          assumptions: [],
          counter_signals: [],
        },
        {
          claim_id: "inference-margin",
          kind: "inference",
          statement:
            "서비스 믹스가 유지된다면 수익성 방어에 기여할 가능성이 있습니다.",
          premise_object_ids: ["claim:AAPL:services", "metric:AAPL:margin"],
          assumptions: ["서비스 믹스가 유지된다"],
          counter_signals: ["지역별 수요 둔화 또는 제품 믹스 악화"],
        },
        {
          claim_id: "margin-calculation",
          kind: "calculation",
          statement: "반환된 계산값은 현재 마진 관찰치의 방향을 보여줍니다.",
          premise_object_ids: ["metric:AAPL:margin"],
          assumptions: [],
          counter_signals: [],
        },
      ],
      gaps: [
        {
          kind: "truncation",
          bounded_statement:
            "지역별 수요의 직접 근거는 이번 범위에서 충분하지 않습니다.",
          alternative_signal: "제품 믹스와 서비스 성장의 동행 여부",
          monitor: "다음 실적의 지역별 매출과 제품 믹스",
        },
      ],
    };

    const parsed = parseResearchAnswerEnvelope(envelope);
    expect(parsed).not.toBeNull();
    expect(inspectResearchAnswerEnvelope(parsed!, partialLedger())).toEqual({
      requiresRewrite: false,
      reasons: [],
    });
  });

  it("rejects unsupported certainty and leaves only verified claims usable for repair", () => {
    const envelope = {
      format: RESEARCH_ANSWER_ENVELOPE_FORMAT,
      final_answer: "이제 결론은 확정됐습니다.",
      claims: [
        {
          claim_id: "bad-inference",
          kind: "inference",
          statement: "서비스 성장은 마진 개선을 확정합니다.",
          premise_object_ids: ["claim:AAPL:unknown"],
          assumptions: [],
          counter_signals: [],
        },
        {
          claim_id: "usable-fact",
          kind: "fact",
          statement: "서비스 관련 근거가 최신 공시에서 직접 확인됩니다.",
          premise_object_ids: ["claim:AAPL:services"],
          assumptions: [],
          counter_signals: [],
        },
      ],
      gaps: [],
    };

    const parsed = parseResearchAnswerEnvelope(envelope)!;
    const inspection = inspectResearchAnswerEnvelope(parsed, partialLedger());
    expect(inspection.requiresRewrite).toBe(true);
    expect(inspection.reasons.join(" ")).toContain("unknown evidence");
    expect(inspection.reasons.join(" ")).toContain("overstates");
    expect(inspection.reasons.join(" ")).toContain("disconfirming");
    expect(inspection.reasons.join(" ")).toContain("investor-facing boundary");
    expect(selectUsableResearchClaims(parsed, partialLedger())).toEqual([
      expect.objectContaining({ claim_id: "usable-fact" }),
    ]);
  });

  it("rejects process narration and bare uncertainty in user-facing partial answers", () => {
    const ledger = partialLedger();
    expect(
      inspectResearchAnswerText(
        "ResearchState를 확인했지만 찾지 못했습니다.",
        ledger,
      ),
    ).toMatchObject({ requiresRewrite: true });
    expect(
      inspectResearchAnswerText("현재 결론은 확정입니다.", ledger),
    ).toMatchObject({ requiresRewrite: true });
    expect(
      inspectResearchAnswerText(
        "현재 자료만으로 결론을 확정하지는 않고, 다음 실적의 제품 믹스를 확인하겠습니다.",
        ledger,
      ),
    ).toEqual({ requiresRewrite: false, reasons: [] });
  });
});
