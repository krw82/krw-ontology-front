import { describe, expect, it } from "vitest";
import type { PulseCandidate } from "@/lib/pulse/contract";
import { selectResurfaceCandidate } from "@/lib/pulse/sources/resurface";

function fixture(index: number): PulseCandidate {
  return {
    item_key: `resurface:note:${index}`, kind: "resurface", trigger: "state", source_type: "resurface",
    source_id: `note:${index}`, ticker: "AAPL", coverage_level: "interest", judgment: null, linked_thesis: null,
    eyebrow: "다시 보기", title: `메모 ${index}`,
    body: "body", reason_code: "resurface", reason_label: "오래된 메모", priority: "low",
    occurred_at: "2026-01-01T00:00:00.000Z", available_at: "2026-01-01T00:00:00.000Z",
    expires_at: null, saved_at: null, snoozed_until: null, group_key: null,
    primary_action: { type: "link", label: "보기", href: "/" }, secondary_actions: [], metadata: {},
  };
}

describe("Pulse resurface selection", () => {
  const candidates = [fixture(1), fixture(2), fixture(3)];

  it("returns one deterministic item per user and week", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    expect(selectResurfaceCandidate(candidates, "user-1", now)).toEqual(selectResurfaceCandidate([...candidates].reverse(), "user-1", now));
    expect(selectResurfaceCandidate(candidates, "user-1", now)).toHaveLength(1);
  });

  it("skips alternating weeks for biweekly cadence", () => {
    const one = selectResurfaceCandidate(candidates, "user-1", new Date("2026-07-15T00:00:00.000Z"), "biweekly");
    const next = selectResurfaceCandidate(candidates, "user-1", new Date("2026-07-22T00:00:00.000Z"), "biweekly");
    expect([one.length, next.length].sort()).toEqual([0, 1]);
  });
});
