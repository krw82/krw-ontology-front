import { describe, expect, it } from "vitest";
import type {
  GuruInvestigationBrief,
  ValidatedGuruAgentEvidenceAnalysis,
} from "./guru-investigation-contracts";
import {
  GURU_INVESTIGATION_BRIEF_FORMAT,
  GuruInvestigationContractError,
  MAX_GURU_INVESTIGATION_QUESTIONS,
  MAX_SEARCH_PLAN_CLAUSES,
  MAX_SEARCH_PLAN_CLAUSES_PER_QUESTION,
  validateGuruAgentEvidenceAnalysis,
  validateGuruInvestigationBrief,
  validateGuruQuestionClauseMap,
} from "./guru-investigation-contracts";

function brief(overrides: Partial<GuruInvestigationBrief> = {}): GuruInvestigationBrief {
  return {
    format: GURU_INVESTIGATION_BRIEF_FORMAT,
    briefHash: "brief_hash",
    researchPackId: "research_pack",
    authorKey: "buffett",
    ticker: "AAPL",
    companyContextHash: "company_context_hash",
    questions: [
      {
        questionId: "q_service_dependence",
        decisionRole: "main_tension",
        question: "Does the services business stand independently from the installed hardware base?",
        guruPrincipleIds: ["principle_durable_earnings"],
        companyContextAnchorIds: ["business_description", "segment_services"],
        hypothesis: "Services deepen a durable economic moat.",
        counterHypothesis: "Services remain mainly a monetisation layer on hardware demand.",
        evidenceNeeded: ["segment disclosures", "revenue driver discussion"],
        strengthensIf: "The filing supports recurring economics beyond hardware replacement demand.",
        weakensIf: "The filing ties services economics primarily to hardware unit demand.",
        whyMaterial: "The answer changes whether the business has an independent durable engine.",
      },
    ],
    ...overrides,
  };
}

describe("Guru investigation contracts", () => {
  it("accepts a narrow investigation with one sealed question", () => {
    expect(validateGuruInvestigationBrief(brief())).toEqual(brief());
  });

  it("rejects a brief with more than one key question", () => {
    const question = brief().questions[0]!;
    const candidate = brief({
      questions: [
        { ...question, questionId: "q_one", decisionRole: "main_tension" },
        { ...question, questionId: "q_two", decisionRole: "main_tension" },
      ],
    });

    expect(() => validateGuruInvestigationBrief(candidate)).toThrow(
      GuruInvestigationContractError,
    );
  });

  it("requires every question to have an ontology principle and company anchor", () => {
    const candidate = brief({
      questions: [
        {
          ...brief().questions[0]!,
          guruPrincipleIds: [],
          companyContextAnchorIds: [],
        },
      ],
    });

    expect(() => validateGuruInvestigationBrief(candidate)).toThrow(
      /guruPrincipleIds/,
    );
  });

  it("maps the sealed key question to no more than three atomic SearchPlan clauses", () => {
    const validated = validateGuruQuestionClauseMap(brief(), [
      {
        questionId: "q_service_dependence",
        clauseIds: [
          "service_relation",
          "service_metric",
          "hardware_dependency_metric",
        ],
      },
    ]);

    expect(validated.briefHash).toBe("brief_hash");
    expect(validated.totalClauseCount).toBe(3);
    expect(MAX_SEARCH_PLAN_CLAUSES).toBe(3);
  });

  it("rejects duplicate, unknown, and excess atomic SearchPlan clauses", () => {
    expect(() =>
      validateGuruQuestionClauseMap(brief(), [
        {
          questionId: "q_service_dependence",
          clauseIds: ["one", "one"],
        },
      ]),
    ).toThrow(/duplicate clauseId/);

    expect(() =>
      validateGuruQuestionClauseMap(brief(), [
        {
          questionId: "q_unknown",
          clauseIds: ["one"],
        },
      ]),
    ).toThrow(/unknown questionId/);

    const validated = validateGuruQuestionClauseMap(brief(), [
      {
        questionId: "q_service_dependence",
        clauseIds: ["one", "two", "three"],
      },
    ]);

    expect(validated.totalClauseCount).toBe(MAX_SEARCH_PLAN_CLAUSES);
    expect(
      MAX_GURU_INVESTIGATION_QUESTIONS *
        MAX_SEARCH_PLAN_CLAUSES_PER_QUESTION,
    ).toBe(MAX_SEARCH_PLAN_CLAUSES);
    expect(() =>
      validateGuruQuestionClauseMap(brief(), [
        {
          questionId: "q_service_dependence",
          clauseIds: ["one", "two", "three", "four"],
        },
      ]),
    ).toThrow(/between 1 and 3/);
  });

  it("accepts compact verdicts grounded in verified evidence", () => {
    const candidate = {
      assessments: [
        {
          questionId: "q_service_dependence",
          evidenceObjectIds: ["claim:AAPL:services"],
          verdict: "mixed" as const,
          reasoning: "The cited filing evidence supports recurring service activity but does not establish full independence.",
        },
      ],
      overallJudgment: "The durable-earnings case is mixed because hardware dependence remains material.",
    };

    const validated: ValidatedGuruAgentEvidenceAnalysis =
      validateGuruAgentEvidenceAnalysis(brief(), candidate, [
        "claim:AAPL:services",
      ]);

    expect(validated).toEqual(candidate);
  });

  it("rejects an analysis that cites evidence outside the verified pack", () => {
    const candidate = {
      assessments: [
        {
          questionId: "q_service_dependence",
          evidenceObjectIds: ["claim:AAPL:invented"],
          verdict: "supported" as const,
          reasoning: "This should be rejected.",
        },
      ],
      overallJudgment: "Unsupported.",
    };

    expect(() =>
      validateGuruAgentEvidenceAnalysis(brief(), candidate, [
        "claim:AAPL:services",
      ]),
    ).toThrow(/unverified evidence object id/);
  });
});
