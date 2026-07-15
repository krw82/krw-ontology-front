import { describe, expect, it } from "vitest";
import type { PulseCandidate } from "@/lib/pulse/contract";
import { rankPulseCandidates } from "@/lib/pulse/ranking";
import { buildPulseSummary } from "@/lib/pulse/summary";

function candidate(kind: PulseCandidate["kind"], key: string, overrides: Partial<PulseCandidate> = {}): PulseCandidate {
  return {
    item_key: `${kind}:${key}`,
    kind,
    trigger: kind === "filing" ? "event" : kind === "learning" ? "editorial" : "state",
    source_type: kind,
    source_id: key,
    ticker: kind === "learning" ? null : "AAPL",
    eyebrow: "항목",
    title: key,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-15T00:00:00.000Z",
    available_at: "2026-07-15T00:00:00.000Z",
    expires_at: null,
    read_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: `/${key}` },
    secondary_actions: [],
    metadata: {},
    ...overrides,
  };
}

describe("Pulse summary", () => {
  it("counts only visible actionable work and uses the highest-ranked real action", () => {
    const ranked = rankPulseCandidates([
      candidate("learning", "learning"),
      candidate("analysis", "active", { phase: "active", metadata: { run_status: "running" } }),
      candidate("analysis", "done", { phase: "completed", metadata: { run_status: "completed" } }),
      candidate("filing", "filing", { priority: "urgent" }),
      candidate("question", "reviewed", { reviewed_at: "2026-07-15T01:00:00.000Z", read_at: "2026-07-15T01:00:00.000Z" }),
    ], new Date("2026-07-15T12:00:00.000Z"));

    expect(buildPulseSummary(ranked)).toEqual({
      actionable_count: 2,
      active_analysis_count: 1,
      counts: { filing: 1, analysis: 1, question: 0, resurface: 0 },
      primary_action: { type: "link", label: "열기", href: "/filing" },
    });
  });
});
