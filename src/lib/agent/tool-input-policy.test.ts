import { describe, expect, it } from "vitest";
import { normalizeKrwOntologyToolInput } from "./tool-input-policy";

describe("KRW ontology tool input policy", () => {
  it("keeps Korean research text unchanged", () => {
    const input = {
      question: "소비재 기업들을 보고 소비 매크로 환경이 어떤지 찾아봐줘",
      limit_results: 10,
      limit_tickers: 20,
    };

    const result = normalizeKrwOntologyToolInput(
      "krw_ontology_query_context",
      input,
    );

    expect(result).toEqual({
      input,
      changed: false,
    });
  });

  it("only downgrades full response detail on query inputs", () => {
    const result = normalizeKrwOntologyToolInput("krw_ontology_query", {
      query: "반도체 업종에서 AI 수혜를 받는 기업들을 찾아줘",
      response_detail: "full",
      limit: 9,
      limit_groups: 12,
      limit_per_group: 8,
    });

    expect(result.changed).toBe(true);
    expect(result.input).toEqual({
      query: "반도체 업종에서 AI 수혜를 받는 기업들을 찾아줘",
      response_detail: "compact",
      limit: 9,
      limit_groups: 12,
      limit_per_group: 8,
    });
  });

  it("downgrades full response detail without changing other inputs", () => {
    const result = normalizeKrwOntologyToolInput("krw_ontology_compare", {
      tickers: ["AAPL", "MSFT"],
      response_detail: "full",
    });

    expect(result).toEqual({
      changed: true,
      input: {
        tickers: ["AAPL", "MSFT"],
        response_detail: "compact",
      },
    });
  });
});
