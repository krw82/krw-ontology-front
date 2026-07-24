import { describe, expect, it, vi } from "vitest";
import type { AccumulatedRun } from "@/lib/agent/stream-handler";

vi.mock("server-only", () => ({}));

import {
  extractCreatedVisualizationArtifacts,
  persistCreatedVisualizations,
  persistMessagePresentation,
} from "./db";

function accumulated(resultJson: unknown): AccumulatedRun {
  return {
    fullText: "매출은 증가했습니다.",
    structuredOutput: null,
    researchSynthesisOutput: null,
    researchSynthesisText: null,
    displayPlanOutput: null,
    toolCalls: [{
      id: "visualization-tool-1",
      toolName: "compose_visualization",
      argumentsJson: JSON.stringify({ goal: "매출 추이" }),
      resultSummary: null,
      resultJson,
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

describe("visualization persistence extraction", () => {
  it("persists compiler artifacts without requiring a Markdown insert token", () => {
    const artifact = {
      artifact_format: "krw-visualization",
      schema_version: 1,
      artifact_ref: "viz_1_revenue",
      intent: { goal: "매출 추이" },
      title: "매출 추이",
      views: [{
        view_id: "view_1",
        chart_type: "bar",
        title: "매출 추이",
        series: [{
          series_key: "revenue",
          label: "Revenue",
          points: [{ period: "CY2025", value: 100, evidence_ref: "metric_observation:1" }],
        }],
      }],
      provenance: {
        source_tool_call_ids: ["ontology-tool-1"],
        evidence_refs: ["metric_observation:1"],
        source_kinds: ["ontology"],
      },
      quality: { series_count: 1, point_count: 1, warnings: [] },
    };

    const artifacts = extractCreatedVisualizationArtifacts(accumulated({
      kind: "compose_visualization_result",
      status: "created",
      artifact_ref: "viz_1_revenue",
      artifact,
      warnings: [],
    }));

    expect(artifacts).toEqual([artifact]);
  });

  it("does not persist skipped or malformed tool output", () => {
    expect(extractCreatedVisualizationArtifacts(accumulated({
      kind: "compose_visualization_result",
      status: "skipped",
      reason_code: "no_dataset",
      warnings: [],
    }))).toEqual([]);
    expect(extractCreatedVisualizationArtifacts(accumulated({
      kind: "compose_visualization_result",
      status: "created",
      artifact_ref: "not-a-valid-artifact",
      artifact: { raw_filing_body: "do not persist" },
      warnings: [],
    }))).toEqual([]);
  });

  it("persists compiler artifacts and deterministic presentation blocks separately", async () => {
    const artifact = {
      artifact_format: "krw-visualization" as const,
      schema_version: 1 as const,
      artifact_ref: "viz_1_revenue",
      intent: { goal: "매출 추이" },
      title: "매출 추이",
      views: [{
        view_id: "view_1",
        chart_type: "line" as const,
        title: "매출 추이",
        series: [{
          series_key: "revenue",
          label: "Revenue",
          points: [{ period: "CY2025", value: 100, evidence_ref: "metric_observation:1" }],
        }],
      }],
      provenance: {
        source_tool_call_ids: ["ontology-tool-1"],
        evidence_refs: ["metric_observation:1"],
        source_kinds: ["ontology" as const],
      },
      quality: { series_count: 1, point_count: 1, warnings: [] },
    };
    const calls: Array<{ table: string; payload: unknown; conflict?: string }> = [];
    const admin = {
      from(table: string) {
        return {
          upsert(payload: unknown, options: { onConflict: string }) {
            calls.push({ table, payload, conflict: options.onConflict });
            return {
              select() {
                return {
                  returns: async () => ({
                    data: table === "chat_message_visualizations"
                      ? [{
                          id: "visualization-row-1",
                          session_id: "session-1",
                          message_id: "message-1",
                          run_id: "run-1",
                          artifact_ref: "viz_1_revenue",
                          payload_json: artifact,
                          created_at: "2026-01-01T00:00:02.000Z",
                        }]
                      : null,
                    error: null,
                  }),
                  maybeSingle: async () => ({
                    data: table === "chat_message_presentations"
                      ? {
                          message_id: "message-1",
                          session_id: "session-1",
                          run_id: "run-1",
                          blocks_json: [
                            { id: "markdown_1", type: "markdown", content: "매출은 증가했습니다." },
                            { id: "visualization_viz_1_revenue", type: "visualization", artifact_ref: "viz_1_revenue" },
                          ],
                          created_at: "2026-01-01T00:00:02.000Z",
                          updated_at: "2026-01-01T00:00:02.000Z",
                        }
                      : null,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    } as never;

    const visualizations = await persistCreatedVisualizations({
      admin,
      acc: accumulated({
        kind: "compose_visualization_result",
        status: "created",
        artifact_ref: "viz_1_revenue",
        artifact,
        warnings: [],
      }),
      sessionId: "session-1",
      messageId: "message-1",
      runId: "run-1",
    });
    const presentation = await persistMessagePresentation({
      admin,
      sessionId: "session-1",
      messageId: "message-1",
      runId: "run-1",
      content: "매출은 증가했습니다.",
      visualizations,
    });

    expect(calls).toEqual([
      expect.objectContaining({
        table: "chat_message_visualizations",
        conflict: "message_id,artifact_ref",
      }),
      expect.objectContaining({
        table: "chat_message_presentations",
        conflict: "message_id",
      }),
    ]);
    expect(presentation?.blocks).toEqual([
      { id: "markdown_1", type: "markdown", content: "매출은 증가했습니다." },
      { id: "visualization_viz_1_revenue", type: "visualization", artifact_ref: "viz_1_revenue" },
    ]);
  });
});
