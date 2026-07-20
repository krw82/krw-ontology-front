import { describe, expect, it } from "vitest";

import type { FilingBriefSourceEvidence, FilingBriefSourceSection } from "./contract";
import { normalizedContains, validateFilingBriefOutput } from "./validation";

const sections: FilingBriefSourceSection[] = [{
  key: "item:1.01",
  heading: "Item 1.01",
  text: "The Company entered into a definitive agreement with Example Corp on July 15, 2026.",
  documentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/form8k.htm",
}];

const evidence: FilingBriefSourceEvidence[] = [{
  id: "e1",
  sectionKey: "item:1.01",
  text: "The Company entered into a definitive agreement with Example Corp on July 15, 2026.",
}];

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    headline_ko: "회사가 최종 계약 체결을 공시했습니다",
    summary_sentences_ko: ["공시는 Example Corp와의 계약 체결 사실을 설명합니다."],
    facts: [{
      fact_ko: "회사는 Example Corp와 최종 계약을 체결했습니다.",
      evidence_id: "e1",
    }],
    question_suggestions_ko: ["계약의 주요 조건을 원문 기준으로 정리해줘"],
    uncertainty_notes_ko: [],
    ...overrides,
  });
}

describe("filing brief response validation", () => {
  it("attaches the deterministic SEC evidence selected by the model", () => {
    const brief = validateFilingBriefOutput(response(), sections, evidence);

    expect(brief.facts[0]).toMatchObject({
      section_heading: "Item 1.01",
      source_document_url: sections[0]?.documentUrl,
      source_quote: evidence[0]?.text,
    });
  });

  it("allows one code-fence extraction but rejects invented citations and investment advice", () => {
    const fenced = `Here is the JSON:\n\`\`\`json\n${response()}\n\`\`\``;
    expect(validateFilingBriefOutput(fenced, sections, evidence).headlineKo).toContain("계약");

    expect(() => validateFilingBriefOutput(response({ facts: [{
      fact_ko: "근거가 없습니다.",
      section_key: "item:1.01",
      evidence_id: "e404",
    }] }), sections, evidence)).toThrow(/unknown evidence/);

    expect(() => validateFilingBriefOutput(response({
      headline_ko: "매수 의견: 계약 체결",
    }), sections, evidence)).toThrow(/investment advice/);
  });

  it("tolerates SEC HTML punctuation and whitespace normalization without accepting different words", () => {
    expect(normalizedContains(
      "The Company’s Board—of Directors approved the transaction.",
      "Company's Board - of Directors approved",
    )).toBe(true);
    expect(normalizedContains(
      "The Company entered into a definitive agreement.",
      "The Company entered into a different agreement",
    )).toBe(false);
  });

  it("normalizes equivalent single-value JSON shapes before validating their evidence", () => {
    const brief = validateFilingBriefOutput(response({
      summary_sentences_ko: "공시는 Example Corp와의 계약 체결 사실을 설명합니다.",
      facts: {
        fact_ko: "회사는 Example Corp와 최종 계약을 체결했습니다.",
        evidence_id: "e1",
      },
      question_suggestions_ko: "계약의 주요 조건을 원문 기준으로 정리해줘",
      uncertainty_notes_ko: null,
    }), sections, evidence);

    expect(brief.summarySentences).toHaveLength(1);
    expect(brief.facts).toHaveLength(1);
    expect(brief.questionSuggestions).toHaveLength(1);
    expect(brief.uncertaintyNotes).toEqual([]);
  });

  it("drops blank optional strings without accepting blank required content", () => {
    const brief = validateFilingBriefOutput(response({
      question_suggestions_ko: [""],
      uncertainty_notes_ko: " ",
    }), sections, evidence);

    expect(brief.questionSuggestions).toEqual([]);
    expect(brief.uncertaintyNotes).toEqual([]);
    expect(() => validateFilingBriefOutput(response({ headline_ko: " " }), sections, evidence))
      .toThrow(/headline_ko/);
  });

  it("keeps the short product shape when the model returns surplus array items", () => {
    const brief = validateFilingBriefOutput(response({
      summary_sentences_ko: ["첫 번째 요약입니다.", "두 번째 요약입니다.", "세 번째 요약입니다."],
      facts: Array.from({ length: 5 }, () => ({
        fact_ko: "회사는 Example Corp와 최종 계약을 체결했습니다.",
        evidence_id: "e1",
        section_key: "model-provided-but-ignored",
      })),
      question_suggestions_ko: ["질문 1", "질문 2", "질문 3"],
      uncertainty_notes_ko: ["불확실성 1", "불확실성 2", "불확실성 3", "불확실성 4"],
    }), sections, evidence);

    expect(brief.summarySentences).toHaveLength(2);
    expect(brief.facts).toHaveLength(4);
    expect(brief.facts.every((fact) => fact.section_key === "item:1.01")).toBe(true);
    expect(brief.questionSuggestions).toHaveLength(2);
    expect(brief.uncertaintyNotes).toHaveLength(3);
  });
});
