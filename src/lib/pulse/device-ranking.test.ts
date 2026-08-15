import { describe, expect, it } from "vitest";
import {
  advancePulseDeviceRefresh,
  applyPulseDeviceSignal,
  bindPulseDeviceProfileToDevice,
  createPulseDeviceProfile,
  selectDevicePulseSlate,
} from "@/lib/pulse/device-ranking";
import { buildPulseFeedDisplayEntries } from "@/lib/pulse/insider-trade-stack";
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

function companyStory(id: string, serverRank: number): PulseItem {
  return item(id, "learning", serverRank, {
    kind: "learning",
    source_type: "learning",
    ticker: id.toUpperCase(),
    metadata: {
      editorial_placement: "early",
      editorial_priority: 5,
      editorial_series_id: `series-${id}`,
    },
  });
}

function form4(id: string, serverRank: number): PulseItem {
  return item(id, "discovery", serverRank, {
    kind: "filing",
    source_type: "filing",
    metadata: {
      form_type: "4",
      form4_has_reported_open_market_trade: true,
    },
  });
}

function feed(
  candidateItems: PulseItem[],
  activeAnalysisItems: PulseItem[] = [],
): Pick<PulseFeedResponse, "candidate_items" | "active_analysis_items" | "visible_limit"> {
  return { candidate_items: candidateItems, active_analysis_items: activeAnalysisItems, visible_limit: 12 };
}

describe("Pulse V8 hybrid device refresh ranking", () => {
  it("keeps a viewed company story fixed until an intentional refresh", () => {
    const candidates = [
      item("signal", "signal", 0, { ticker: "MSFT" }),
      companyStory("story-a", 1),
      companyStory("story-b", 2),
      item("later", "continue", 3, { kind: "question", source_type: "question", ticker: "NVDA" }),
    ];
    const now = new Date("2026-07-20T12:00:00.000Z");
    let profile = createPulseDeviceProfile(now, "device-a");
    const initial = selectDevicePulseSlate(feed(candidates), profile, now);
    const firstStory = initial.items.find((candidate) => candidate.kind === "learning");
    expect(firstStory).toBeTruthy();
    expect(initial.items.findIndex((candidate) => candidate.id === firstStory?.id)).toBeGreaterThanOrEqual(1);
    expect(initial.items.findIndex((candidate) => candidate.id === firstStory?.id)).toBeLessThanOrEqual(2);

    profile = applyPulseDeviceSignal(profile, firstStory!, "view", now);
    const afterView = selectDevicePulseSlate(feed(candidates), profile, now);
    expect(afterView.items.find((candidate) => candidate.kind === "learning")?.id).toBe(firstStory?.id);

    profile = advancePulseDeviceRefresh(profile, new Date("2026-07-20T12:05:00.000Z"));
    const afterRefresh = selectDevicePulseSlate(feed(candidates), profile, new Date("2026-07-20T12:05:00.000Z"));
    expect(afterRefresh.items.find((candidate) => candidate.kind === "learning")?.id).not.toBe(firstStory?.id);
  });

  it("uses distinct stories across the first few explicit refreshes when alternatives exist", () => {
    const candidates = Array.from({ length: 5 }, (_, index) => companyStory(`story-${index}`, index));
    let profile = createPulseDeviceProfile(new Date("2026-07-20T12:00:00.000Z"), "device-a");
    const selected: string[] = [];

    for (let generation = 0; generation < 3; generation += 1) {
      const now = new Date(`2026-07-20T12:0${generation}:00.000Z`);
      const story = selectDevicePulseSlate(feed(candidates), profile, now)
        .items.find((candidate) => candidate.kind === "learning");
      expect(story).toBeTruthy();
      selected.push(story!.id);
      profile = applyPulseDeviceSignal(profile, story!, "view", now);
      profile = advancePulseDeviceRefresh(profile, new Date(now.getTime() + 30_000));
    }

    expect(new Set(selected)).toHaveLength(3);
  });

  it("boosts a featured company story without locking every new device to it", () => {
    const featured = companyStory("featured", 0);
    featured.metadata.editorial_priority = 10;
    const ordinaryStories = Array.from({ length: 5 }, (_, index) => companyStory(`ordinary-${index}`, index + 1));
    const selected = Array.from({ length: 40 }, (_, index) => {
      const profile = createPulseDeviceProfile(
        new Date("2026-07-20T12:00:00.000Z"),
        `device-${index}`,
      );
      return selectDevicePulseSlate(feed([featured, ...ordinaryStories]), profile)
        .items.find((candidate) => candidate.kind === "learning")?.id;
    });

    const featuredCount = selected.filter((id) => id === "featured").length;
    expect(featuredCount).toBeGreaterThan(0);
    expect(featuredCount).toBeLessThan(selected.length);
    expect(selected.some((id) => id?.startsWith("ordinary-"))).toBe(true);
  });

  it("counts repeated views only across intentional refresh generations without hiding the only card", () => {
    const candidate = item("ignored", "signal", 0);
    let profile = createPulseDeviceProfile(new Date("2026-07-20T00:00:00.000Z"), "device-a");
    profile = applyPulseDeviceSignal(profile, candidate, "view", new Date("2026-07-20T00:01:00.000Z"));
    profile = applyPulseDeviceSignal(profile, candidate, "view", new Date("2026-07-20T00:02:00.000Z"));
    expect(profile.item_exposures[candidate.id]?.impression_count).toBe(1);
    expect(selectDevicePulseSlate(feed([candidate]), profile, new Date("2026-07-20T00:03:00.000Z")).items).toHaveLength(1);

    profile = advancePulseDeviceRefresh(profile, new Date("2026-07-20T01:00:00.000Z"));
    profile = applyPulseDeviceSignal(profile, candidate, "view", new Date("2026-07-20T01:01:00.000Z"));
    profile = advancePulseDeviceRefresh(profile, new Date("2026-07-20T02:00:00.000Z"));
    profile = applyPulseDeviceSignal(profile, candidate, "view", new Date("2026-07-20T02:01:00.000Z"));
    expect(profile.item_exposures[candidate.id]?.impression_count).toBe(3);
    expect(selectDevicePulseSlate(feed([candidate]), profile, new Date("2026-07-20T02:02:00.000Z")).items)
      .toHaveLength(1);
  });

  it("replaces exactly three ordinary cards after each successful manual refresh", () => {
    const candidates = Array.from({ length: 24 }, (_, index) => item(
      `ordinary-${index}`,
      index % 3 === 0 ? "signal" : "continue",
      index,
      { ticker: `T${index}` },
    ));
    const now = new Date("2026-07-20T12:00:00.000Z");
    let profile = createPulseDeviceProfile(now, "device-a");
    const initial = selectDevicePulseSlate(feed(candidates), profile, now);
    const initialIds = new Set(initial.refreshable_item_ids);

    profile = advancePulseDeviceRefresh(
      profile,
      initial.refreshable_item_ids,
      new Date("2026-07-20T12:01:00.000Z"),
    );
    const afterFirstRefresh = selectDevicePulseSlate(
      feed(candidates),
      profile,
      new Date("2026-07-20T12:01:00.000Z"),
    );
    const firstRefreshIds = new Set(afterFirstRefresh.refreshable_item_ids);

    expect(initial.refreshable_item_ids).toHaveLength(12);
    expect(afterFirstRefresh.refreshable_item_ids).toHaveLength(12);
    expect([...firstRefreshIds].filter((id) => initialIds.has(id))).toHaveLength(9);
    expect(afterFirstRefresh.refresh).toMatchObject({
      ordinary_visible_count: 12,
      retained_ordinary_count: 9,
      replacement_ordinary_count: 3,
      cooldown_relaxed_count: 0,
    });

    profile = advancePulseDeviceRefresh(
      profile,
      afterFirstRefresh.refreshable_item_ids,
      new Date("2026-07-20T12:02:00.000Z"),
    );
    const afterSecondRefresh = selectDevicePulseSlate(
      feed(candidates),
      profile,
      new Date("2026-07-20T12:02:00.000Z"),
    );
    const secondRefreshIds = new Set(afterSecondRefresh.refreshable_item_ids);

    expect([...secondRefreshIds].filter((id) => firstRefreshIds.has(id))).toHaveLength(9);
    expect(afterSecondRefresh.refresh.replacement_ordinary_count).toBe(3);
  });

  it("re-evaluates regular anchors on every fourth manual refresh", () => {
    const candidates = Array.from({ length: 36 }, (_, index) => item(
      `ordinary-${index}`,
      index % 3 === 0 ? "signal" : "continue",
      index,
      { ticker: `T${index}` },
    ));
    const now = new Date("2026-07-20T12:00:00.000Z");
    let profile = createPulseDeviceProfile(now, "device-a");
    let previous = selectDevicePulseSlate(feed(candidates), profile, now);

    for (let refresh = 1; refresh <= 4; refresh += 1) {
      profile = advancePulseDeviceRefresh(
        profile,
        previous.refreshable_item_ids,
        new Date(now.getTime() + refresh * 60_000),
      );
      const current = selectDevicePulseSlate(
        feed(candidates),
        profile,
        new Date(now.getTime() + refresh * 60_000),
      );
      const overlap = current.refreshable_item_ids.filter((id) =>
        previous.refreshable_item_ids.includes(id));

      if (refresh < 4) {
        expect(current.refresh).toMatchObject({
          mode: "steady",
          anchor_rebased: false,
          replacement_ordinary_count: 3,
        });
        expect(overlap).toHaveLength(9);
      } else {
        expect(current.refresh).toMatchObject({
          mode: "rebase",
          anchor_rebased: true,
          replacement_ordinary_count: 5,
        });
        // A three-card rotation can only remove its three rotating cards.
        // Seven retained cards proves that at least two former anchors also
        // left the first screen during the V8 rebase.
        expect(overlap).toHaveLength(7);
      }

      previous = current;
    }
  });

  it("exposes only an aggregate personal context for a selected company story", () => {
    const personal = companyStory("personal-story", 0);
    personal.metadata.editorial_candidate_role = "personal";
    const slate = selectDevicePulseSlate(
      feed([personal]),
      createPulseDeviceProfile(new Date("2026-07-20T12:00:00.000Z"), "device-a"),
    );

    expect(slate.story_context).toBe("personal");
  });

  it("backfills an exhausted refresh reservoir instead of leaving ordinary cards blank", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => item(
      `ordinary-${index}`,
      "signal",
      index,
      { ticker: `T${index}` },
    ));
    const now = new Date("2026-07-20T12:00:00.000Z");
    let profile = createPulseDeviceProfile(now, "device-a");
    const initial = selectDevicePulseSlate(feed(candidates), profile, now);
    profile = advancePulseDeviceRefresh(
      profile,
      initial.refreshable_item_ids,
      new Date("2026-07-20T12:01:00.000Z"),
    );

    const refreshed = selectDevicePulseSlate(
      feed(candidates),
      profile,
      new Date("2026-07-20T12:01:00.000Z"),
    );

    expect(refreshed.refreshable_item_ids).toHaveLength(12);
    expect(refreshed.refresh).toMatchObject({
      retained_ordinary_count: 12,
      replacement_ordinary_count: 0,
      cooldown_relaxed_count: 3,
    });
  });

  it("keeps active research in its rail without consuming an ordinary refresh slot", () => {
    const active = item("active-run", "continue", 0, {
      kind: "analysis",
      source_type: "analysis",
      phase: "active",
      priority: "urgent",
    });
    const ordinary = Array.from({ length: 12 }, (_, index) => item(
      `ordinary-${index}`,
      "signal",
      index + 1,
      { ticker: `T${index}` },
    ));

    const slate = selectDevicePulseSlate(
      feed([active, ...ordinary], [active]),
      createPulseDeviceProfile(new Date("2026-07-20T12:00:00.000Z"), "device-a"),
    );

    expect(slate.items.some((item) => item.id === active.id)).toBe(false);
    expect(slate.refreshable_item_ids).toHaveLength(12);
  });

  it("suppresses a consumed company story for a week but not merely a viewed one", () => {
    const storyA = companyStory("story-a", 0);
    const storyB = companyStory("story-b", 1);
    const now = new Date("2026-07-20T00:00:00.000Z");
    let profile = createPulseDeviceProfile(now, "device-a");
    profile = applyPulseDeviceSignal(profile, storyA, "open", now);

    const duringCooldown = selectDevicePulseSlate(feed([storyA, storyB]), profile, new Date("2026-07-21T00:00:00.000Z"));
    expect(duringCooldown.items.find((candidate) => candidate.kind === "learning")?.id).toBe("story-b");

    const afterCooldown = selectDevicePulseSlate(feed([storyA]), profile, new Date("2026-07-28T00:00:01.000Z"));
    expect(afterCooldown.items.some((candidate) => candidate.id === "story-a")).toBe(true);
  });

  it("uses a local cookie identity as a device boundary", () => {
    let initial = createPulseDeviceProfile(new Date("2026-07-20T00:00:00.000Z"), "device-a");
    initial = applyPulseDeviceSignal(initial, item("remembered", "signal", 0), "open");
    const sameDevice = bindPulseDeviceProfileToDevice(initial, "device-a");
    const otherDevice = bindPulseDeviceProfileToDevice(initial, "device-b");
    const anonymousDevice = bindPulseDeviceProfileToDevice(initial, null);

    expect(sameDevice.device_id).toBe("device-a");
    expect(otherDevice.device_id).toBe("device-b");
    expect(otherDevice.sequence).toBe(0);
    expect(anonymousDevice.device_id).toBeNull();
    expect(anonymousDevice.sequence).toBe(0);
    expect(anonymousDevice.item_exposures).toEqual({});
  });

  it("turns many regular Form 4 filings into one visual entry instead of a one-card feed", () => {
    const candidates = [
      item("filing-a", "signal", 0, { ticker: "AAPL" }),
      item("filing-b", "continue", 1, { ticker: "MSFT" }),
      item("filing-c", "discovery", 2, { ticker: "NVDA" }),
      form4("form4-a", 3),
      form4("form4-b", 4),
      form4("form4-c", 5),
      item("filing-d", "continue", 6, { ticker: "AMZN" }),
    ];
    const slate = selectDevicePulseSlate(feed(candidates), createPulseDeviceProfile());
    const entries = buildPulseFeedDisplayEntries(slate.items, "Asia/Seoul", 12);

    expect(entries.filter((entry) => entry.type === "insider_trade_stack")).toHaveLength(1);
    expect(entries.map((entry) => entry.type)).toEqual([
      "item",
      "item",
      "item",
      "insider_trade_stack",
      "item",
    ]);
  });

  it("turns the current production Form 4-heavy reservoir into a varied first scroll", () => {
    // The pre-fix production RPC on 2026-07-27 returned 52 Form 4, 1 Form
    // 4/A, and 7 8-K candidates. The server now bounds that reservoir, but
    // the device still needs to render a varied first screen for an older
    // cached or temporarily skewed response.
    const filings = Array.from({ length: 7 }, (_, index) => item(
      `8k-${index}`,
      "signal",
      index,
      { ticker: `EIGHT${index}`, metadata: { form_type: "8-K" } },
    ));
    const trades = Array.from({ length: 12 }, (_, index) => form4(`form4-${index}`, index + 7));
    const stories = Array.from({ length: 16 }, (_, index) => companyStory(`story-${index}`, index + 19));
    stories[0]!.metadata.editorial_priority = 10;

    const slate = selectDevicePulseSlate(
      feed([...filings, ...trades, ...stories]),
      createPulseDeviceProfile(new Date("2026-07-27T12:00:00.000Z"), "device-a"),
    );
    const entries = buildPulseFeedDisplayEntries(slate.items, "Asia/Seoul", 12);

    expect(entries).toHaveLength(9);
    expect(entries[3]?.type).toBe("insider_trade_stack");
    expect(entries.filter((entry) => entry.type === "insider_trade_stack")).toHaveLength(1);
    expect(entries.filter((entry) => entry.type === "item" && entry.item.kind === "learning")).toHaveLength(1);
    expect(entries.filter((entry) => entry.type === "item" && entry.item.kind === "filing")).toHaveLength(7);
  });

  it("keeps urgent work ahead of local affinity", () => {
    const urgent = item("urgent", "continue", 5, {
      // Active research runs have their own rail and are intentionally
      // removed from the ordinary slate. Use an urgent filing here so this
      // test exercises the ordinary-feed priority contract.
      kind: "filing",
      source_type: "filing",
      ticker: "URG",
      priority: "urgent",
    });
    const baseline = item("baseline", "signal", 0, { ticker: "BASE" });
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

    const slate = selectDevicePulseSlate(feed([baseline, preferred, urgent]), profile);
    expect(slate.items[0]?.id).toBe("urgent");
  });
});
