import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { persistMessagePresentation, toPublicChatVisualization } from "./db";
import type { ChatMessageVisualizationRow } from "@/types/database";

const artifact = {
  artifact_format: "krw-visualization",
  schema_version: 4,
  artifact_ref: "viz_1_revenue",
  semantic_fingerprint: "fingerprint-revenue",
  intent: { goal: "매출 추이" },
  title: "매출 추이",
  views: [{
    view_id: "view-1",
    chart_type: "line",
    title: "매출 추이",
    series: [{
      series_key: "AAPL:revenue",
      label: "Revenue",
      scope: { kind: "company_total", key: "AAPL", label: "Apple" },
      points: [{ period: "FY2025", value: 416.2, evidence_ref: "metric_observation:1" }],
    }],
    dataset: { kind: "series" },
  }],
  provenance: {
    source_tool_call_ids: [],
    evidence_refs: ["metric_observation:1"],
    source_kinds: ["ontology"],
  },
  quality: { series_count: 1, point_count: 1, warnings: [] },
};

function visualizationRow(): ChatMessageVisualizationRow {
  return {
    id: "visualization-row-1",
    session_id: "session-1",
    message_id: "message-1",
    run_id: "run-1",
    artifact_ref: "viz_1_revenue",
    payload_json: artifact,
    created_at: "2026-01-01T00:00:02.000Z",
  };
}

describe("visualization read-model projection", () => {
  it("projects a persisted row into the public chat visualization", () => {
    expect(toPublicChatVisualization(visualizationRow())).toEqual({
      id: "visualization-row-1",
      session_id: "session-1",
      message_id: "message-1",
      run_id: "run-1",
      artifact_ref: "viz_1_revenue",
      payload_json: artifact,
      created_at: "2026-01-01T00:00:02.000Z",
    });
  });

  it("rejects a malformed persisted payload instead of rendering it", () => {
    const row = visualizationRow();
    (row as { payload_json: unknown }).payload_json = { raw_filing_body: "invalid" };
    expect(() => toPublicChatVisualization(row)).toThrow(/Invalid visualization payload/);
  });

  it("rejects markup-shaped optional payloads", () => {
    const row = visualizationRow();
    (row as { payload_json: unknown }).payload_json = {
      ...artifact,
      html: "<svg>do not render this</svg>",
    };
    expect(() => toPublicChatVisualization(row)).toThrow(/Invalid visualization payload/);
  });

  it("rejects unbounded renderer-facing strings", () => {
    const row = visualizationRow();
    (row as { payload_json: unknown }).payload_json = {
      ...artifact,
      views: [{
        ...artifact.views[0],
        series: [{
          ...artifact.views[0].series[0],
          points: [{
            ...artifact.views[0].series[0].points[0],
            formatted_value: "x".repeat(257),
          }],
        }],
      }],
    };
    expect(() => toPublicChatVisualization(row)).toThrow(/Invalid visualization payload/);
  });

  it("persists deterministic presentation blocks separately from the answer text", async () => {
    const calls: Array<{ table: string; payload: unknown; conflict?: string }> = [];
    const admin = {
      from(table: string) {
        return {
          upsert(payload: unknown, options: { onConflict: string }) {
            calls.push({ table, payload, conflict: options.onConflict });
            return {
              select() {
                return {
                  returns: async () => ({ data: null, error: null }),
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

    const presentation = await persistMessagePresentation({
      admin,
      sessionId: "session-1",
      messageId: "message-1",
      runId: "run-1",
      content: "매출은 증가했습니다.",
      visualizations: [toPublicChatVisualization(visualizationRow())],
    });

    expect(calls).toEqual([
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
