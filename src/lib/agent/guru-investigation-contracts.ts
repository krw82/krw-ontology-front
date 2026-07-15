import type { GuruLensKey } from "@/lib/guru-lenses";

export const GURU_INVESTIGATION_BRIEF_FORMAT =
  "krw-guru-investigation-brief/v1";
export const MAX_GURU_INVESTIGATION_QUESTIONS = 1;
export const MAX_SEARCH_PLAN_CLAUSES = 3;
export const MAX_SEARCH_PLAN_CLAUSES_PER_QUESTION = 3;

export type GuruDecisionRole = "main_tension";

export type GuruEvidenceVerdict = "supported" | "mixed" | "unresolved";

export interface GuruInvestigationQuestionDraft {
  question: string;
  guruPrincipleIds: readonly string[];
  companyContextAnchorIds: readonly string[];
  hypothesis: string;
  counterHypothesis: string;
  evidenceNeeded: readonly string[];
  strengthensIf: string;
  weakensIf: string;
  whyMaterial: string;
  decisionRole: GuruDecisionRole;
}

export interface GuruInvestigationQuestion
  extends GuruInvestigationQuestionDraft {
  questionId: string;
}

export interface GuruInvestigationBrief {
  format: typeof GURU_INVESTIGATION_BRIEF_FORMAT;
  briefHash: string;
  researchPackId: string;
  authorKey: GuruLensKey;
  ticker: string;
  companyContextHash: string;
  questions: readonly GuruInvestigationQuestion[];
}

export interface GuruQuestionClauseMap {
  questionId: string;
  clauseIds: readonly string[];
}

export interface ValidatedGuruQuestionClauseMap {
  briefHash: string;
  mappings: readonly GuruQuestionClauseMap[];
  totalClauseCount: number;
}

export interface GuruEvidenceAssessment {
  questionId: string;
  evidenceObjectIds: readonly string[];
  verdict: GuruEvidenceVerdict;
  reasoning: string;
}

export interface GuruAgentEvidenceAnalysis {
  assessments: readonly GuruEvidenceAssessment[];
  overallJudgment: string;
}

declare const validatedGuruAgentEvidenceAnalysis: unique symbol;

/**
 * A company-agent analysis that has passed the sealed-brief and verified
 * evidence checks. This nominal marker prevents an unvalidated wire payload
 * from being supplied where a validated analysis is required.
 */
export type ValidatedGuruAgentEvidenceAnalysis =
  GuruAgentEvidenceAnalysis & {
    readonly [validatedGuruAgentEvidenceAnalysis]: true;
  };

export type GuruInvestigationContractErrorCode =
  | "invalid_brief"
  | "invalid_question_clause_map"
  | "invalid_evidence_analysis";

export class GuruInvestigationContractError extends Error {
  constructor(
    readonly code: GuruInvestigationContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuruInvestigationContractError";
  }
}

/**
 * Frontend-side contract checks mirror the backend sealing boundary. They are
 * deliberately strict so runner integration cannot accidentally pass a stale
 * or malformed brief to the company evidence subagent.
 */
export function validateGuruInvestigationBrief(
  brief: GuruInvestigationBrief,
): GuruInvestigationBrief {
  requireText(brief.briefHash, "briefHash");
  requireText(brief.researchPackId, "researchPackId");
  requireText(brief.companyContextHash, "companyContextHash");
  requireTicker(brief.ticker);

  if (brief.format !== GURU_INVESTIGATION_BRIEF_FORMAT) {
    fail("invalid_brief", "unexpected Guru investigation brief format");
  }
  if (brief.questions.length !== MAX_GURU_INVESTIGATION_QUESTIONS) {
    fail(
      "invalid_brief",
      "a Guru investigation brief must contain exactly one key question",
    );
  }

  const questionIds = new Set<string>();
  for (const question of brief.questions) {
    requireIdentifier(question.questionId, "questionId");
    if (questionIds.has(question.questionId)) {
      fail("invalid_brief", `duplicate questionId: ${question.questionId}`);
    }
    questionIds.add(question.questionId);
    requireText(question.question, "question");
    requireText(question.hypothesis, "hypothesis");
    requireText(question.counterHypothesis, "counterHypothesis");
    requireText(question.strengthensIf, "strengthensIf");
    requireText(question.weakensIf, "weakensIf");
    requireText(question.whyMaterial, "whyMaterial");
    if (question.decisionRole !== "main_tension") {
      fail("invalid_brief", "the sole Guru key question must be main_tension");
    }
    requireNonEmptyUniqueStrings(question.guruPrincipleIds, "guruPrincipleIds");
    requireNonEmptyUniqueStrings(
      question.companyContextAnchorIds,
      "companyContextAnchorIds",
    );
    requireNonEmptyUniqueStrings(question.evidenceNeeded, "evidenceNeeded");
  }

  return brief;
}

export function validateGuruQuestionClauseMap(
  brief: GuruInvestigationBrief,
  mappings: readonly GuruQuestionClauseMap[],
): ValidatedGuruQuestionClauseMap {
  validateGuruInvestigationBrief(brief);
  if (mappings.length !== brief.questions.length) {
    fail(
      "invalid_question_clause_map",
      "every Guru investigation question must have exactly one clause mapping",
    );
  }

  const expectedQuestionIds = new Set(brief.questions.map((question) => question.questionId));
  const mappedQuestionIds = new Set<string>();
  const clauseIds = new Set<string>();

  for (const mapping of mappings) {
    requireIdentifier(
      mapping.questionId,
      "questionId",
      "invalid_question_clause_map",
    );
    if (!expectedQuestionIds.has(mapping.questionId)) {
      fail(
        "invalid_question_clause_map",
        `unknown questionId: ${mapping.questionId}`,
      );
    }
    if (mappedQuestionIds.has(mapping.questionId)) {
      fail(
        "invalid_question_clause_map",
        `duplicate question mapping: ${mapping.questionId}`,
      );
    }
    mappedQuestionIds.add(mapping.questionId);

    if (
      mapping.clauseIds.length < 1 ||
      mapping.clauseIds.length > MAX_SEARCH_PLAN_CLAUSES_PER_QUESTION
    ) {
      fail(
        "invalid_question_clause_map",
        `question ${mapping.questionId} must map to between 1 and ${MAX_SEARCH_PLAN_CLAUSES_PER_QUESTION} SearchPlan clauses`,
      );
    }
    for (const clauseId of mapping.clauseIds) {
      requireIdentifier(
        clauseId,
        "clauseId",
        "invalid_question_clause_map",
      );
      if (clauseIds.has(clauseId)) {
        fail("invalid_question_clause_map", `duplicate clauseId: ${clauseId}`);
      }
      clauseIds.add(clauseId);
    }
  }

  if (clauseIds.size > MAX_SEARCH_PLAN_CLAUSES) {
    fail(
      "invalid_question_clause_map",
      `a Guru investigation may use at most ${MAX_SEARCH_PLAN_CLAUSES} SearchPlan clauses`,
    );
  }

  return {
    briefHash: brief.briefHash,
    mappings,
    totalClauseCount: clauseIds.size,
  };
}

export function validateGuruAgentEvidenceAnalysis(
  brief: GuruInvestigationBrief,
  analysis: GuruAgentEvidenceAnalysis,
  verifiedEvidenceObjectIds: readonly string[],
): ValidatedGuruAgentEvidenceAnalysis {
  validateGuruInvestigationBrief(brief);
  requireText(
    analysis.overallJudgment,
    "overallJudgment",
    "invalid_evidence_analysis",
  );

  const expectedQuestions = new Map(
    brief.questions.map((question) => [question.questionId, question]),
  );
  if (analysis.assessments.length !== expectedQuestions.size) {
    fail(
      "invalid_evidence_analysis",
      "analysis must assess the sealed Guru key question exactly once",
    );
  }

  const seenQuestionIds = new Set<string>();
  const verifiedObjectIdSet = new Set(verifiedEvidenceObjectIds);
  for (const assessment of analysis.assessments) {
    const question = expectedQuestions.get(assessment.questionId);
    if (!question) {
      fail(
        "invalid_evidence_analysis",
        `assessment references unknown questionId: ${assessment.questionId}`,
      );
    }
    if (seenQuestionIds.has(assessment.questionId)) {
      fail(
        "invalid_evidence_analysis",
        `duplicate assessment for questionId: ${assessment.questionId}`,
      );
    }
    seenQuestionIds.add(assessment.questionId);
    requireText(assessment.reasoning, "reasoning", "invalid_evidence_analysis");
    if (
      assessment.verdict === "unresolved" &&
      assessment.evidenceObjectIds.length > 0
    ) {
      fail(
        "invalid_evidence_analysis",
        "unresolved assessments must not cite evidence as a resolved basis",
      );
    }
    if (
      assessment.verdict === "supported" &&
      assessment.evidenceObjectIds.length === 0
    ) {
      fail(
        "invalid_evidence_analysis",
        "supported assessments require at least one verified evidence object id",
      );
    }
    for (const objectId of assessment.evidenceObjectIds) {
      if (!verifiedObjectIdSet.has(objectId)) {
        fail(
          "invalid_evidence_analysis",
          `assessment cites an unverified evidence object id: ${objectId}`,
        );
      }
    }
  }

  return analysis as ValidatedGuruAgentEvidenceAnalysis;
}

function requireNonEmptyUniqueStrings(
  values: readonly string[],
  field: string,
  code: GuruInvestigationContractErrorCode = "invalid_brief",
): void {
  if (values.length === 0) {
    fail(code, `${field} must not be empty`);
  }
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length !== values.length || new Set(normalized).size !== normalized.length) {
    fail(code, `${field} must contain unique non-empty values`);
  }
}

function requireText(
  value: string,
  field: string,
  code: GuruInvestigationContractErrorCode = "invalid_brief",
): void {
  if (!value.trim()) fail(code, `${field} must not be empty`);
}

function requireTicker(ticker: string): void {
  if (!/^[A-Z][A-Z0-9.-]{0,31}$/.test(ticker)) {
    fail("invalid_brief", "ticker must be an uppercase ticker token");
  }
}

function requireIdentifier(
  value: string,
  field: string,
  code: GuruInvestigationContractErrorCode = "invalid_brief",
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    fail(code, `${field} must be a stable identifier`);
  }
}

function fail(
  code: GuruInvestigationContractErrorCode,
  message: string,
): never {
  throw new GuruInvestigationContractError(code, message);
}
