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

function newsItem(id: string, serverRank: number, now: Date, ageHours: number): PulseItem {
  const occurredAt = new Date(now.getTime() - ageHours * 60 * 60 * 1_000).toISOString();
  return {
    ...item(id, "news", serverRank),
    occurred_at: occurredAt,
    available_at: occurredAt,
  };
}

describe("Pulse V9 news mixing", () => {
  it("puts four news cards into the first twelve without making a news block", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const regular = Array.from({ length: 12 }, (_, index) => item(`filing-${index}`, "filing", index));
    const news = Array.from({ length: 5 }, (_, index) => item(`news-${index}`, "news", index + 20));
    const slate = selectDevicePulseSlate(
      feed([...regular, ...news]),
      createPulseDeviceProfile(now, "device-a"),
      now,
    );
    const firstScreen = slate.items.slice(0, 12);

    expect(firstScreen.filter((candidate) => candidate.kind === "news")).toHaveLength(4);
    for (let index = 1; index < firstScreen.length; index += 1) {
      expect([firstScreen[index - 1]?.kind, firstScreen[index]?.kind]).not.toEqual(["news", "news"]);
    }
  });

  it("uses five news cards when the candidate reservoir is abundant", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const regular = Array.from({ length: 12 }, (_, index) => item(`filing-${index}`, "filing", index));
    const news = Array.from({ length: 8 }, (_, index) => item(`news-${index}`, "news", index + 20));
    const slate = selectDevicePulseSlate(feed([...regular, ...news]), createPulseDeviceProfile(now), now);

    expect(slate.items.slice(0, 12).filter((candidate) => candidate.kind === "news")).toHaveLength(5);
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

    expect(refreshedNews).toHaveLength(5);
    // With five visible slots and an eight-item reservoir, reuse the two
    // least-recently selected cards only after the three unseen alternatives
    // are exhausted. This keeps the first screen full while still rotating.
    expect(refreshedNews.filter((candidate) => initialNews.some((previous) => previous.id === candidate.id))).toHaveLength(2);
  });

  it("keeps news older than 48 hours out of the first screen when timely news exists", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const regular = Array.from({ length: 12 }, (_, index) => item(`filing-${index}`, "filing", index));
    const timelyNews = Array.from({ length: 8 }, (_, index) => newsItem(`fresh-${index}`, index + 20, now, index + 1));
    const staleNews = Array.from({ length: 10 }, (_, index) => newsItem(`stale-${index}`, index + 28, now, 96 + index));

    const slate = selectDevicePulseSlate(
      feed([...regular, ...timelyNews, ...staleNews]),
      createPulseDeviceProfile(now, "device-a"),
      now,
    );
    const visibleNews = slate.items.slice(0, 12).filter((candidate) => candidate.kind === "news");

    expect(visibleNews).toHaveLength(5);
    expect(visibleNews.every((candidate) => candidate.id.startsWith("fresh-"))).toBe(true);
  });

  it("does not fill first-screen news slots with stale news", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const regular = Array.from({ length: 12 }, (_, index) => item(`filing-${index}`, "filing", index));
    const staleNews = Array.from({ length: 8 }, (_, index) => newsItem(`stale-${index}`, index + 20, now, 49 + index));

    const slate = selectDevicePulseSlate(
      feed([...regular, ...staleNews]),
      createPulseDeviceProfile(now, "device-a"),
      now,
    );

    expect(slate.items.slice(0, 12).filter((candidate) => candidate.kind === "news")).toHaveLength(0);
  });
});
