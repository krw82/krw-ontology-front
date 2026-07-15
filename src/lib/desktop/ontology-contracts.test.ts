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
        search_plan: {
          question: " Apple iPhone demand weakness ",
          intent: "company_demand",
          clauses: [
            {
              clause_id: "demand",
              retrieval_query: "Apple iPhone demand weakness",
              required_concepts: ["iPhone demand weakness"],
            },
          ],
          tickers: ["aapl", "AAPL", "msft"],
          limit_results: 3,
        },
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
        search_plan: {
          question: "Apple iPhone demand weakness",
          intent: "company_demand",
          clauses: [
            {
              clause_id: "demand",
              retrieval_query: "Apple iPhone demand weakness",
              required_concepts: ["iPhone demand weakness"],
              required_predicates: [],
              required: true,
              tickers: [],
              directness: "direct_preferred",
              object_types: [],
              metrics: [],
              metric_dimensions: [],
              metric_scope: "company_total",
              calculation_window: null,
            },
          ],
          tickers: ["AAPL", "MSFT"],
          document_types: [],
          periods: [],
          universe: null,
          comparison_axes: [],
          answer_scope: "direct",
          uncertainty: "low",
          limit_results: 3,
          limit_tickers: 20,
        },
      },
      desktop_context: {
        app_version: "0.1.0",
        protocol_version: "desktop/v1",
        analysis_mode: "company",
      },
    });
  });

  it("requires v2 plans and explicit qualitative predicates", () => {
    expect(() =>
      validateDesktopOntologyToolCallRequest({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-1",
        tool_name: "krw_ontology_query_context",
        arguments: { question: "legacy request" },
      }),
    ).toThrow(/unsupported fields/);

    expect(() =>
      validateDesktopOntologyToolCallRequest({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-2",
        tool_name: "krw_ontology_query_context",
        arguments: {
          search_plan: {
            question: "AAPL demand causes margin risk",
            intent: "company_relation",
            clauses: [
              {
                clause_id: "relation",
                retrieval_query: "AAPL demand causes margin risk",
                required_concepts: ["demand", "margin risk"],
              },
            ],
            tickers: ["AAPL"],
          },
        },
      }),
    ).toThrow(/require required_predicates/);

    expect(() =>
      validateDesktopOntologyToolCallRequest({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-3",
        tool_name: "krw_ontology_query_context",
        arguments: {
          search_plan: {
            question: "AAPL revenue rose",
            intent: "company_metric",
            clauses: [
              {
                clause_id: "metric",
                retrieval_query: "AAPL revenue rose",
                metrics: ["revenue"],
                required_predicates: ["rose"],
              },
            ],
            tickers: ["AAPL"],
          },
        },
      }),
    ).toThrow(/metric clauses cannot set required_predicates/);
  });

  it("preserves clause ticker scope and temporal calculation windows", () => {
    const request = validateDesktopOntologyToolCallRequest({
      local_session_id: "session-1",
      local_run_id: "run-1",
      tool_call_id: "tool-4",
      tool_name: "krw_ontology_query_context",
      arguments: {
        search_plan: {
          question: "Compare AAPL and MSFT year-over-year capex growth",
          intent: "company_metric",
          clauses: [
            {
              clause_id: "aapl-capex",
              retrieval_query: "AAPL year-over-year capex growth",
              tickers: ["aapl"],
              metrics: ["capital_expenditures"],
              calculation_window: "year_over_year",
            },
          ],
          tickers: ["AAPL", "MSFT"],
          comparison_axes: ["growth_rate"],
        },
      },
    });

    expect(request.arguments).toMatchObject({
      search_plan: {
        clauses: [
          {
            tickers: ["AAPL"],
            metrics: ["capital_expenditures"],
            calculation_window: "year_over_year",
          },
        ],
      },
    });

    expect(() =>
      validateDesktopOntologyToolCallRequest({
        local_session_id: "session-1",
        local_run_id: "run-1",
        tool_call_id: "tool-5",
        tool_name: "krw_ontology_query_context",
        arguments: {
          search_plan: {
            question: "AAPL revenue growth",
            intent: "company_metric",
            clauses: [
              {
                clause_id: "revenue",
                retrieval_query: "AAPL revenue growth",
                tickers: ["MSFT"],
                metrics: ["revenue"],
                calculation_window: "year_over_year",
              },
            ],
            tickers: ["AAPL"],
            comparison_axes: ["growth_rate"],
          },
        },
      }),
    ).toThrow(/subset/);
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
