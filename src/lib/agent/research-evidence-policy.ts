import type { AccumulatedRun, AccumulatedToolCall } from "./stream-handler";

export const RESEARCH_ANSWER_ENVELOPE_FORMAT =
  "krw-research-answer-envelope/v1";

export type ResearchAnswerability =
  | "answerable"
  | "partial"
  | "not_answerable"
  | "supporting_context_only"
  | "unknown";

export type ResearchClaimKind =
  "fact" | "calculation" | "inference" | "scenario";

export type ResearchGapKind =
  | "disclosure_gap"
  | "retrieval_gap"
  | "conflict"
  | "truncation"
  | "scope_limit";

export interface ResearchEvidenceLedger {
  answerability: ResearchAnswerability;
  strongClaimAllowed: boolean | null;
  hasDirectEvidence: boolean;
  hasComputedValues: boolean;
  hasConflicts: boolean;
  wasTruncated: boolean;
  hasMore: boolean;
  evidenceObjectIds: readonly string[];
  directEvidenceObjectIds: readonly string[];
  computedValueObjectIds: readonly string[];
  missingParts: readonly string[];
  warnings: readonly string[];
}

export interface ResearchAnswerClaim {
  claim_id: string;
  kind: ResearchClaimKind;
  statement: string;
  premise_object_ids: string[];
  assumptions: string[];
  counter_signals: string[];
}

export interface ResearchAnswerGap {
  kind: ResearchGapKind;
  bounded_statement: string;
  alternative_signal: string;
  monitor: string;
}

export interface ResearchAnswerEnvelope {
  format: typeof RESEARCH_ANSWER_ENVELOPE_FORMAT;
  final_answer: string;
  claims: ResearchAnswerClaim[];
  gaps: ResearchAnswerGap[];
}

export interface ResearchAnswerInspection {
  requiresRewrite: boolean;
  reasons: string[];
}

type UnknownRecord = Record<string, unknown>;

/**
 * This schema is deliberately shallow. The SDK has historically been less
 * reliable with deeply nested output schemas, while the evidence contract is
 * enforced again by parseResearchAnswerEnvelope below.
 */
export function buildResearchAnswerEnvelopeSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["format", "final_answer", "claims", "gaps"],
    properties: {
      format: {
        type: "string",
        enum: [RESEARCH_ANSWER_ENVELOPE_FORMAT],
      },
      final_answer: { type: "string", minLength: 1, maxLength: 30_000 },
      claims: {
        type: "array",
        maxItems: 32,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "claim_id",
            "kind",
            "statement",
            "premise_object_ids",
            "assumptions",
            "counter_signals",
          ],
          properties: {
            claim_id: { type: "string", minLength: 1, maxLength: 80 },
            kind: {
              type: "string",
              enum: ["fact", "calculation", "inference", "scenario"],
            },
            statement: { type: "string", minLength: 1, maxLength: 2_000 },
            premise_object_ids: {
              type: "array",
              maxItems: 16,
              items: { type: "string", minLength: 1, maxLength: 240 },
            },
            assumptions: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 800 },
            },
            counter_signals: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 800 },
            },
          },
        },
      },
      gaps: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "kind",
            "bounded_statement",
            "alternative_signal",
            "monitor",
          ],
          properties: {
            kind: {
              type: "string",
              enum: [
                "disclosure_gap",
                "retrieval_gap",
                "conflict",
                "truncation",
                "scope_limit",
              ],
            },
            bounded_statement: {
              type: "string",
              minLength: 1,
              maxLength: 1_200,
            },
            alternative_signal: {
              type: "string",
              minLength: 1,
              maxLength: 1_200,
            },
            monitor: { type: "string", minLength: 1, maxLength: 1_200 },
          },
        },
      },
    },
  };
}

export function buildResearchEvidenceLedger(
  acc: Pick<AccumulatedRun, "toolCalls" | "citations">,
): ResearchEvidenceLedger {
  const states = acc.toolCalls
    .map((toolCall) => extractResearchState(toolCall))
    .filter((state): state is UnknownRecord => state !== null);
  const latest = states.at(-1);
  const answerability = isRecord(latest?.answerability)
    ? latest.answerability
    : null;
  const warnings = readTextList(latest?.warnings);
  const missingParts = readTextList(latest?.missing_parts);
  const continuation = isRecord(latest?.continuation)
    ? latest.continuation
    : null;
  const evidenceObjectIds = new Set<string>();
  const directEvidenceObjectIds = new Set<string>();
  const computedValueObjectIds = new Set<string>();

  for (const citation of acc.citations) {
    if (citation.object_id) evidenceObjectIds.add(citation.object_id);
    if (
      citation.object_id &&
      (citation.evidence_grade === "high" ||
        citation.source_quality === "filing_direct")
    ) {
      directEvidenceObjectIds.add(citation.object_id);
    }
  }
  for (const state of states) {
    for (const unit of asRecordArray(state.evidence_units)) {
      collectObjectIds(unit, evidenceObjectIds);
      if (unit.directness === "direct" || unit.evidence_grade === "strong") {
        collectObjectIds(unit, directEvidenceObjectIds);
      }
    }
    for (const value of asRecordArray(state.computed_values)) {
      collectObjectIds(value, evidenceObjectIds);
      if (value.value !== null && value.value !== undefined) {
        collectObjectIds(value, computedValueObjectIds);
      }
    }
    collectObjectIds(state.source_anchors, evidenceObjectIds);
  }

  const answerabilityStatus = normalizeAnswerability(answerability?.status);
  const hasComputedValues = computedValueObjectIds.size > 0;
  const hasDirectEvidence = directEvidenceObjectIds.size > 0;
  const warningText = warnings.join(" ").toLowerCase();
  const missingText = missingParts.join(" ").toLowerCase();

  return {
    answerability: answerabilityStatus,
    strongClaimAllowed:
      typeof answerability?.strong_claim_allowed === "boolean"
        ? answerability.strong_claim_allowed
        : null,
    hasDirectEvidence,
    hasComputedValues,
    hasConflicts:
      /conflict|충돌/.test(warningText) || /conflict|충돌/.test(missingText),
    wasTruncated:
      /truncat|omitted|잘림|생략/.test(warningText) ||
      Number(continuation?.omitted_evidence_count ?? 0) > 0,
    hasMore: continuation?.has_more === true,
    evidenceObjectIds: Array.from(evidenceObjectIds),
    directEvidenceObjectIds: Array.from(directEvidenceObjectIds),
    computedValueObjectIds: Array.from(computedValueObjectIds),
    missingParts,
    warnings,
  };
}

export function parseResearchAnswerEnvelope(
  value: unknown,
): ResearchAnswerEnvelope | null {
  const record = unwrapRecord(value);
  if (!record || record.format !== RESEARCH_ANSWER_ENVELOPE_FORMAT) return null;
  if (typeof record.final_answer !== "string" || !record.final_answer.trim()) {
    return null;
  }
  const claims = parseClaims(record.claims);
  const gaps = parseGaps(record.gaps);
  if (!claims || !gaps) return null;
  return {
    format: RESEARCH_ANSWER_ENVELOPE_FORMAT,
    final_answer: record.final_answer.trim(),
    claims,
    gaps,
  };
}

export function inspectResearchAnswerEnvelope(
  envelope: ResearchAnswerEnvelope,
  ledger: ResearchEvidenceLedger,
): ResearchAnswerInspection {
  const reasons: string[] = [];
  const knownObjectIds = new Set(ledger.evidenceObjectIds);
  const directObjectIds = new Set(ledger.directEvidenceObjectIds);
  const computedValueObjectIds = new Set(ledger.computedValueObjectIds);
  const claimIds = new Set<string>();

  for (const claim of envelope.claims) {
    if (claimIds.has(claim.claim_id)) {
      reasons.push(`duplicate claim id: ${claim.claim_id}`);
    }
    claimIds.add(claim.claim_id);

    if (claim.kind !== "scenario" && claim.premise_object_ids.length === 0) {
      reasons.push(`${claim.claim_id} has no evidence premise`);
    }
    for (const objectId of claim.premise_object_ids) {
      if (!knownObjectIds.has(objectId)) {
        reasons.push(
          `${claim.claim_id} references unknown evidence: ${objectId}`,
        );
      }
    }
    if (
      claim.kind === "fact" &&
      !claim.premise_object_ids.some((objectId) =>
        directObjectIds.has(objectId),
      )
    ) {
      reasons.push(`${claim.claim_id} has no direct evidence premise`);
    }
    if (
      claim.kind === "calculation" &&
      !claim.premise_object_ids.some((objectId) =>
        computedValueObjectIds.has(objectId),
      )
    ) {
      reasons.push(
        `${claim.claim_id} presents a calculation without a computed-value premise`,
      );
    }
    if (
      claim.kind === "inference" &&
      isStrongAssertion(claim.statement) &&
      ledger.strongClaimAllowed === false
    ) {
      reasons.push(
        `${claim.claim_id} overstates an inference with partial evidence`,
      );
    }
    if (claim.kind === "inference" && claim.counter_signals.length === 0) {
      reasons.push(`${claim.claim_id} has no disconfirming signal`);
    }
  }

  const needsBoundedPresentation =
    ledger.answerability === "partial" ||
    ledger.answerability === "not_answerable" ||
    ledger.wasTruncated ||
    ledger.hasConflicts;
  if (needsBoundedPresentation && envelope.gaps.length === 0) {
    reasons.push("partial evidence is missing an investor-facing boundary");
  }
  if (
    ledger.wasTruncated &&
    !envelope.gaps.some((gap) => gap.kind === "truncation")
  ) {
    reasons.push("truncated evidence is not disclosed as a bounded analysis");
  }
  if (
    ledger.hasConflicts &&
    !envelope.gaps.some((gap) => gap.kind === "conflict")
  ) {
    reasons.push("conflicting evidence is not represented as competing cases");
  }
  if (containsInternalProcessLanguage(envelope.final_answer)) {
    reasons.push("final answer exposes internal research process");
  }
  if (needsBoundedPresentation && isBareFailureAnswer(envelope.final_answer)) {
    reasons.push("partial evidence degrades to a bare failure message");
  }

  return { requiresRewrite: reasons.length > 0, reasons };
}

export function selectUsableResearchClaims(
  envelope: ResearchAnswerEnvelope,
  ledger: ResearchEvidenceLedger,
): ResearchAnswerClaim[] {
  const knownObjectIds = new Set(ledger.evidenceObjectIds);
  const directObjectIds = new Set(ledger.directEvidenceObjectIds);
  const computedValueObjectIds = new Set(ledger.computedValueObjectIds);
  return envelope.claims.filter((claim) => {
    if (claim.kind !== "scenario" && claim.premise_object_ids.length === 0) {
      return false;
    }
    if (
      claim.premise_object_ids.some((objectId) => !knownObjectIds.has(objectId))
    ) {
      return false;
    }
    if (
      claim.kind === "fact" &&
      !claim.premise_object_ids.some((objectId) =>
        directObjectIds.has(objectId),
      )
    ) {
      return false;
    }
    if (
      claim.kind === "calculation" &&
      !claim.premise_object_ids.some((objectId) =>
        computedValueObjectIds.has(objectId),
      )
    ) {
      return false;
    }
    if (
      claim.kind === "inference" &&
      isStrongAssertion(claim.statement) &&
      ledger.strongClaimAllowed === false
    ) {
      return false;
    }
    if (claim.kind === "inference" && claim.counter_signals.length === 0) {
      return false;
    }
    return true;
  });
}

export function inspectResearchAnswerText(
  text: string,
  ledger: ResearchEvidenceLedger,
): ResearchAnswerInspection {
  const reasons: string[] = [];
  if (containsInternalProcessLanguage(text)) {
    reasons.push("final answer exposes internal research process");
  }
  if (
    (ledger.answerability === "partial" ||
      ledger.answerability === "not_answerable" ||
      ledger.wasTruncated ||
      ledger.hasConflicts) &&
    isBareFailureAnswer(text)
  ) {
    reasons.push("partial evidence degrades to a bare failure message");
  }
  if (ledger.strongClaimAllowed === false && isStrongAssertion(text)) {
    reasons.push("final answer overstates an unsupported conclusion");
  }
  return { requiresRewrite: reasons.length > 0, reasons };
}

export function buildResearchAnswerEnvelopeInstruction(): string {
  return [
    `Return only a JSON object in the ${RESEARCH_ANSWER_ENVELOPE_FORMAT} format required by the runtime.`,
    "For this pass, this runtime output contract overrides an active skill's Markdown-only output instruction. It changes serialization only; it does not prescribe questions, search order, or investment conclusions.",
    "final_answer is the only user-visible Markdown. Keep it natural and investor-focused; never mention this envelope or its fields.",
    "List every material factual, calculated, inferential, or scenario claim in claims. Facts and calculations must name the retrieved object IDs that support them. Inferences must cite their premises, state the relevant assumptions, and include at least one disconfirming signal. Scenarios may omit premise IDs only when they are explicitly conditional.",
    "Do not turn a gap into a refusal. When evidence is partial, conflicting, or truncated, add a gap with a bounded interpretation, the closest alternative signal, and a concrete monitor that could change the judgment.",
    "Do not call a conclusion proven, confirmed, or sufficient when the returned ResearchState does not allow a strong claim.",
  ].join("\n");
}

export function buildResearchRewriteContext(
  ledger: ResearchEvidenceLedger,
): string {
  const parts = [
    `answerability=${ledger.answerability}`,
    `strong_claim_allowed=${String(ledger.strongClaimAllowed)}`,
    `direct_evidence=${String(ledger.hasDirectEvidence)}`,
    `computed_values=${String(ledger.hasComputedValues)}`,
    `conflicts=${String(ledger.hasConflicts)}`,
    `truncated=${String(ledger.wasTruncated)}`,
  ];
  if (ledger.missingParts.length > 0) {
    parts.push(`missing_parts=${ledger.missingParts.join(" | ")}`);
  }
  if (ledger.warnings.length > 0) {
    parts.push(`warnings=${ledger.warnings.join(" | ")}`);
  }
  return parts.join("\n");
}

function extractResearchState(
  toolCall: AccumulatedToolCall,
): UnknownRecord | null {
  return (
    findResearchState(toolCall.resultJson) ??
    findResearchState(toolCall.resultText)
  );
}

function findResearchState(value: unknown): UnknownRecord | null {
  const record = unwrapRecord(value);
  if (!record) return null;
  if (record.contract_version === "research-state/v2") return record;
  if (isRecord(record.structuredContent)) {
    const nested = findResearchState(record.structuredContent);
    if (nested) return nested;
  }
  if (record.result !== undefined) return findResearchState(record.result);
  return null;
}

function unwrapRecord(value: unknown): UnknownRecord | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    const parsed: unknown = JSON.parse(candidate);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseClaims(value: unknown): ResearchAnswerClaim[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const claims: ResearchAnswerClaim[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    if (
      typeof raw.claim_id !== "string" ||
      !raw.claim_id.trim() ||
      !isClaimKind(raw.kind) ||
      typeof raw.statement !== "string" ||
      !raw.statement.trim()
    ) {
      return null;
    }
    const premiseObjectIds = stringArray(raw.premise_object_ids, 16);
    const assumptions = stringArray(raw.assumptions, 8);
    const counterSignals = stringArray(raw.counter_signals, 8);
    if (!premiseObjectIds || !assumptions || !counterSignals) return null;
    claims.push({
      claim_id: raw.claim_id.trim(),
      kind: raw.kind,
      statement: raw.statement.trim(),
      premise_object_ids: premiseObjectIds,
      assumptions,
      counter_signals: counterSignals,
    });
  }
  return claims;
}

function parseGaps(value: unknown): ResearchAnswerGap[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const gaps: ResearchAnswerGap[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !isGapKind(raw.kind)) return null;
    const boundedStatement = requiredText(raw.bounded_statement);
    const alternativeSignal = requiredText(raw.alternative_signal);
    const monitor = requiredText(raw.monitor);
    if (!boundedStatement || !alternativeSignal || !monitor) return null;
    gaps.push({
      kind: raw.kind,
      bounded_statement: boundedStatement,
      alternative_signal: alternativeSignal,
      monitor,
    });
  }
  return gaps;
}

function collectObjectIds(value: unknown, result: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectIds(item, result);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (
      (key === "object_id" || key === "source_object_id") &&
      typeof item === "string" &&
      item.trim()
    ) {
      result.add(item);
      continue;
    }
    if (
      (key === "object_ids" ||
        key === "source_object_ids" ||
        key === "evidence_object_ids") &&
      Array.isArray(item)
    ) {
      for (const objectId of item) {
        if (typeof objectId === "string" && objectId.trim()) {
          result.add(objectId);
        }
      }
      continue;
    }
    collectObjectIds(item, result);
  }
}

function normalizeAnswerability(value: unknown): ResearchAnswerability {
  if (
    value === "answerable" ||
    value === "partial" ||
    value === "not_answerable" ||
    value === "supporting_context_only"
  ) {
    return value;
  }
  return "unknown";
}

function readTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === "string"
            ? item
            : isRecord(item)
              ? JSON.stringify(item)
              : "",
        )
        .filter(Boolean)
    : [];
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result = value.map((item) =>
    typeof item === "string" ? item.trim() : "",
  );
  return result.every(Boolean) ? result : null;
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isClaimKind(value: unknown): value is ResearchClaimKind {
  return ["fact", "calculation", "inference", "scenario"].includes(
    String(value),
  );
}

function isGapKind(value: unknown): value is ResearchGapKind {
  return [
    "disclosure_gap",
    "retrieval_gap",
    "conflict",
    "truncation",
    "scope_limit",
  ].includes(String(value));
}

function isStrongAssertion(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const englishAssertion =
    /\b(?:proves?|confirmed?|certain|definitive(?:ly)?)\b/i.test(normalized) &&
    !/\b(?:not|no|cannot|can't|uncertain|insufficient)\s+(?:prove|proved|proven|confirm|confirmed|certain|definitive)/i.test(
      normalized,
    );
  const koreanAssertion =
    /(?:확정(?:입니다|합니다|됐다|되었|됨|한다|했다|할 수)|입증(?:됩니다|합니다|됐다|되었|됨|했다)|명확히 증명(?:됩니다|합니다|됐다|되었|됨|했다)|충분한 증거(?:가|는)?\s*(?:있|확보|제시|됩니다|됐다))/i.test(
      normalized,
    );
  return englishAssertion || koreanAssertion;
}

function containsInternalProcessLanguage(text: string): boolean {
  return /\b(?:ResearchState|query_context|MCP|object_id|tool call|SearchPlan)\b|(?:도구 호출|검색 계획|근거 커버리지)/i.test(
    text,
  );
}

function isBareFailureAnswer(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    normalized.length < 220 &&
    /(?:찾지 못|알 수 없|모르겠|cannot determine|could not find|not enough information)/i.test(
      normalized,
    )
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
