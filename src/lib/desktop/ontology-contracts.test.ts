import { describe, expect, it } from "vitest";
import {
  DesktopContractError,
  isDesktopOntologyToolName,
  validateDesktopOntologyToolCallRequest,
} from "./ontology-contracts";

describe("Desktop ontology contracts", () => {
  it("validates and normalizes a compact query_context request", () => {
    const request = validateDesktopOntologyToolCallRequest({
      local_session_id: "session-1",
      local_run_id: "run-1",
      tool_call_id: "tool-1",
      tool_name: "krw_ontology_query_context",
      arguments: {
        question: " Apple iPhone demand weakness ",
        tickers: ["aapl", "AAPL", "msft"],
        limit_results: 3,
      },
      desktop_context: {
        app_version: "0.1.0",
        protocol_version: "desktop/v1",
        analysis_mode: "company",
      },
    });

    expect(request).toMatchObject({
      local_session_id: "session-1",
      local_run_id: "run-1",
      tool_call_id: "tool-1",
      tool_name: "krw_ontology_query_context",
      arguments: {
        question: "Apple iPhone demand weakness",
        tickers: ["AAPL", "MSFT"],
        limit_results: 3,
        response_detail: "compact",
      },
      desktop_context: {
        app_version: "0.1.0",
        protocol_version: "desktop/v1",
        analysis_mode: "company",
      },
    });
  });

  it("rejects full response detail for Desktop tool calls", () => {
    expect(() =>
      validateDesktopOntologyToolCallRequest({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query",
        arguments: {
          topic: "AAPL",
          response_detail: "full",
        },
      }),
    ).toThrow(DesktopContractError);
  });

  it("bounds compare ticker baskets and trace depth", () => {
    expect(() =>
      validateDesktopOntologyToolCallRequest({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_compare",
        arguments: {
          tickers: ["AAPL"],
          question: "compare",
        },
      }),
    ).toThrow(/tickers/);

    expect(() =>
      validateDesktopOntologyToolCallRequest({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-2",
        tool_name: "krw_ontology_trace",
        arguments: {
          root_id: "claim-1",
          depth: 9,
        },
      }),
    ).toThrow(/depth/);
  });

  it("exposes a narrow Desktop tool allowlist", () => {
    expect(isDesktopOntologyToolName("krw_ontology_query_context")).toBe(true);
    expect(isDesktopOntologyToolName("krw_ontology_retrieve")).toBe(false);
    expect(isDesktopOntologyToolName("delete_all")).toBe(false);
  });
});
