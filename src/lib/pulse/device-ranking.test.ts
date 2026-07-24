import { describe, expect, it } from "vitest";
import {
  applyPulseDeviceSignal,
  createPulseDeviceProfile,
  selectDevicePulseSlate,
} from "@/lib/pulse/device-ranking";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

function item(
  id: string,
  feedSlot: PulseItem["feed_slot"],
  serverRank: number,
  overrides: Partial<PulseItem> = {},
): PulseItem {
  const kind = overrides.kind ?? "filing";
  return {
    id,
    kind,
    feed_slot: feedSlot,
    server_rank: serverRank,
    trigger: "event",
    source_type: kind,
    source_id: id,
    ticker: id.toUpperCase(),
    coverage_level: feedSlot === "signal" ? "interest" : null,
    judgment: null,
    linked_thesis: null,
    eyebrow: "새 공시",
    title: id,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-20T00:00:00.000Z",
    available_at: "2026-07-20T00:00:00.000Z",
    expires_at: null,
    reviewed_at: null,
    saved_at: null,
    snoozed_until: null,
    state: "new",
    actionable: true,
    phase: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" },
    secondary_actions: [],
    metadata: {},
    ...overrides,
  } as PulseItem;
}

function feed(candidateItems: PulseItem[]): Pick<PulseFeedResponse, "candidate_items" | "active_analysis_items" | "visible_limit"> {
  return { candidate_items: candidateItems, active_analysis_items: [], visible_limit: 12 };
}

describe("Pulse V5 device ranking", () => {
  it("keeps the first six cards diverse without visible sections", () => {
    const candidates = [
      item("aapl-1", "signal", 0, { ticker: "AAPL" }),
      item("aapl-analysis", "continue", 1, { kind: "analysis", source_type: "analysis", phase: "completed", ticker: "AAPL" }),
      item("aapl-question", "continue", 2, { kind: "question", source_type: "question", ticker: "AAPL" }),
      item("question", "continue", 3, { kind: "question", source_type: "question", ticker: "QQQ" }),
      item("resurface", "resurface", 4, { kind: "resurface", source_type: "resurface", ticker: "RRR" }),
      item("discovery-1", "discovery", 5, { ticker: "DDD" }),
      item("discovery-2", "discovery", 6, { ticker: "EEE" }),
      item("learning", "learning", 7, { kind: "learning", source_type: "learning", ticker: null }),
      item("checkup", "continue", 8, { kind: "checkup", source_type: "checkup", ticker: "CCC" }),
    ];
    const slate = selectDevicePulseSlate(feed(candidates), createPulseDeviceProfile(), new Date("2026-07-20T12:00:00.000Z"));
    const topSix = slate.items.slice(0, 6);

    expect(topSix.filter((candidate) => candidate.ticker === "AAPL")).toHaveLength(2);
    expect(topSix.filter((candidate) => candidate.feed_slot === "discovery")).toHaveLength(1);
    expect(topSix.some((candidate) => candidate.feed_slot === "learning")).toBe(false);
  });

  it("suppresses an opened completed analysis but keeps a newer run eligible", () => {
    const completed = item("analysis-run-1", "continue", 0, {
      kind: "analysis",
      source_type: "analysis",
      phase: "completed",
    });
    const newer = item("analysis-run-2", "continue", 1, {
      kind: "analysis",
      source_type: "analysis",
      phase: "completed",
    });
    let profile = createPulseDeviceProfile(new Date("2026-07-20T00:00:00.000Z"));
    profile = applyPulseDeviceSignal(profile, completed, "open", new Date("2026-07-20T01:00:00.000Z"));

    const slate = selectDevicePulseSlate(feed([completed, newer]), profile, new Date("2026-07-20T02:00:00.000Z"));

    expect(slate.items.map((candidate) => candidate.id)).toEqual(["analysis-run-2"]);
  });

  it("pauses a card after three unopened impressions, then allows it back after a week", () => {
    const ignored = item("ignored", "signal", 0);
    let profile = createPulseDeviceProfile(new Date("2026-07-20T00:00:00.000Z"));
    for (let index = 0; index < 3; index += 1) {
      profile = applyPulseDeviceSignal(
        profile,
        ignored,
        "impression",
        new Date(`2026-07-20T0${index}:00:00.000Z`),
      );
    }

    expect(selectDevicePulseSlate(feed([ignored]), profile, new Date("2026-07-20T12:00:00.000Z")).items).toEqual([]);
    expect(selectDevicePulseSlate(feed([ignored]), profile, new Date("2026-07-28T12:00:00.000Z")).items.map((candidate) => candidate.id)).toEqual(["ignored"]);
  });

  it("does not mistake an explicit save for an ignored card", () => {
    const saved = item("saved", "signal", 0);
    let profile = createPulseDeviceProfile(new Date("2026-07-20T00:00:00.000Z"));
    for (let index = 0; index < 3; index += 1) {
      profile = applyPulseDeviceSignal(
        profile,
        saved,
        "impression",
        new Date(`2026-07-20T0${index}:00:00.000Z`),
      );
    }
    profile = applyPulseDeviceSignal(
      profile,
      saved,
      "save",
      new Date("2026-07-20T03:00:00.000Z"),
    );

    expect(selectDevicePulseSlate(feed([saved]), profile, new Date("2026-07-20T12:00:00.000Z")).items.map((candidate) => candidate.id)).toEqual(["saved"]);
  });

  it("keeps an authorized buffer beyond the visual-card limit for display grouping", () => {
    const candidates = Array.from({ length: 15 }, (_, index) => item(
      `candidate-${index}`,
      index < 3 ? "signal" : "discovery",
      index,
      { ticker: `T${index}` },
    ));

    const slate = selectDevicePulseSlate(feed(candidates), createPulseDeviceProfile());

    expect(slate.items).toHaveLength(15);
  });

  it("lets device affinity move a card about one place but never above urgent work", () => {
    const urgent = item("urgent", "continue", 5, {
      kind: "analysis",
      source_type: "analysis",
      phase: "active",
      ticker: "URG",
      priority: "urgent",
    });
    const baseline = item("baseline", "signal", 0, { ticker: "BASE" });
    const middle = item("middle", "resurface", 1, { kind: "resurface", source_type: "resurface", ticker: "MID" });
    const preferred = item("preferred", "continue", 2, { kind: "question", source_type: "question", ticker: "PREF" });
    let profile = createPulseDeviceProfile(new Date("2026-07-20T00:00:00.000Z"));
    for (let index = 0; index < 10; index += 1) {
      profile = applyPulseDeviceSignal(
        profile,
        preferred,
        "open",
        new Date(`2026-07-20T${String(index).padStart(2, "0")}:00:00.000Z`),
      );
    }

    const slate = selectDevicePulseSlate(
      feed([baseline, middle, preferred, urgent]),
      profile,
      new Date("2026-07-20T12:00:00.000Z"),
    );

    expect(slate.items.map((candidate) => candidate.id)).toEqual(["urgent", "baseline", "preferred", "middle"]);
  });
});
