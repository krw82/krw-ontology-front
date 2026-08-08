import { describe, expect, it } from "vitest";
import {
  advancePulseDeviceRefresh,
  createPulseDeviceProfile,
  selectDevicePulseSlate,
} from "@/lib/pulse/device-ranking";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

function item(id: string, kind: PulseItem["kind"] = "filing", serverRank = 0, metadata: PulseItem["metadata"] = {}): PulseItem {
  return {
    id,
    kind,
    source_type: kind,
    source_id: id,
    feed_slot: kind === "news" ? "news" : "continue",
    server_rank: serverRank,
    trigger: "event",
    ticker: id.toUpperCase(),
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: kind === "news" ? "시장 이슈" : "새 공시",
    title: id,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-30T00:00:00.000Z",
    available_at: "2026-07-30T00:00:00.000Z",
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
    metadata,
  } as PulseItem;
}

function feed(items: PulseItem[]): Pick<PulseFeedResponse, "candidate_items" | "active_analysis_items" | "visible_limit"> {
  return { candidate_items: items, active_analysis_items: [], visible_limit: 12 };
}

describe("Pulse V9 news mixing", () => {
  it("puts three news cards into the first twelve without making a news block", () => {
    const regular = Array.from({ length: 12 }, (_, index) => item(`filing-${index}`, "filing", index));
    const news = Array.from({ length: 5 }, (_, index) => item(`news-${index}`, "news", index + 20));
    const slate = selectDevicePulseSlate(
      feed([...regular, ...news]),
      createPulseDeviceProfile(new Date("2026-07-30T12:00:00.000Z"), "device-a"),
    );
    const firstScreen = slate.items.slice(0, 12);

    expect(firstScreen.filter((candidate) => candidate.kind === "news")).toHaveLength(3);
    for (let index = 1; index < firstScreen.length; index += 1) {
      expect([firstScreen[index - 1]?.kind, firstScreen[index]?.kind]).not.toEqual(["news", "news"]);
    }
  });

  it("uses four news cards only when the candidate reservoir is abundant", () => {
    const regular = Array.from({ length: 12 }, (_, index) => item(`filing-${index}`, "filing", index));
    const news = Array.from({ length: 8 }, (_, index) => item(`news-${index}`, "news", index + 20));
    const slate = selectDevicePulseSlate(feed([...regular, ...news]), createPulseDeviceProfile());

    expect(slate.items.slice(0, 12).filter((candidate) => candidate.kind === "news")).toHaveLength(4);
  });

  it("rotates selected news after a manual refresh and keeps a personal match in the mix", () => {
    const regular = Array.from({ length: 12 }, (_, index) => item(`filing-${index}`, "filing", index));
    const news = Array.from({ length: 8 }, (_, index) => item(`news-${index}`, "news", index + 20, {
      market_issue_personal_match: index === 7,
    }));
    const now = new Date("2026-07-30T12:00:00.000Z");
    let profile = createPulseDeviceProfile(now, "device-a");
    const initial = selectDevicePulseSlate(feed([...regular, ...news]), profile, now);
    const initialNews = initial.items.slice(0, 12).filter((candidate) => candidate.kind === "news");

    expect(initialNews.some((candidate) => candidate.id === "news-7")).toBe(true);
    profile = advancePulseDeviceRefresh(profile, initial.refreshable_item_ids, new Date("2026-07-30T12:01:00.000Z"));
    const refreshed = selectDevicePulseSlate(feed([...regular, ...news]), profile, new Date("2026-07-30T12:01:00.000Z"));
    const refreshedNews = refreshed.items.slice(0, 12).filter((candidate) => candidate.kind === "news");

    expect(refreshedNews).toHaveLength(4);
    expect(refreshedNews.filter((candidate) => initialNews.some((previous) => previous.id === candidate.id))).toHaveLength(0);
  });
});
