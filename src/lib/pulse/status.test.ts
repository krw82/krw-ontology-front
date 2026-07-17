import { describe, expect, it } from "vitest";
import { summarizePulseFeedStatus } from "@/lib/pulse/status";

describe("summarizePulseFeedStatus", () => {
  it("keeps active work as current state and counts only terminal analysis work as new", () => {
    const response = summarizePulseFeedStatus({
      now: new Date("2026-07-17T00:00:00.000Z"),
      newFilingCount: 3,
      activeAnalysisCount: 2,
      activeAnalysisUpdatedAt: "2026-07-16T23:59:00.000Z",
      activeAnalysisSessionIds: ["session-2", "session-1", "session-2"],
      completedAnalysisCount: 1,
    });

    expect(response).toEqual({
      generated_at: "2026-07-17T00:00:00.000Z",
      new_item_count: 4,
      active_analysis_count: 2,
      active_analysis_updated_at: "2026-07-16T23:59:00.000Z",
      active_analysis_session_ids: ["session-2", "session-1"],
    });
  });

  it("caps the new-items badge without reducing the active analysis count", () => {
    expect(summarizePulseFeedStatus({
      now: new Date("2026-07-17T00:00:00.000Z"),
      newFilingCount: 99,
      activeAnalysisCount: 123,
      activeAnalysisUpdatedAt: null,
      activeAnalysisSessionIds: [],
      completedAnalysisCount: 10,
    })).toMatchObject({ new_item_count: 99, active_analysis_count: 123 });
  });
});
