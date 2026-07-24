import { describe, expect, it } from "vitest";
import { buildPulseFeedDisplayEntries } from "@/lib/pulse/insider-trade-stack";
import type { PulseItem } from "@/types/api-contracts";

function filing(
  id: string,
  occurredAt: string,
  options: {
    formType?: string;
    state?: PulseItem["state"];
    openMarketTrade?: boolean;
    feedSlot?: PulseItem["feed_slot"];
    priority?: PulseItem["priority"];
    coverageLevel?: PulseItem["coverage_level"];
    purchaseValue?: number | null;
    saleValue?: number | null;
    hasRecentResearch?: boolean;
  } = {},
): PulseItem {
  return {
    id,
    kind: "filing",
    feed_slot: options.feedSlot ?? "signal",
    server_rank: 0,
    trigger: "event",
    source_type: "filing",
    source_id: id,
    ticker: id.toUpperCase(),
    coverage_level: options.coverageLevel ?? "interest",
    judgment: null,
    linked_thesis: null,
    eyebrow: "내부자 거래",
    title: `${id.toUpperCase()} 내부자 거래`,
    body: "SEC Form 4 신고입니다.",
    reason_code: "catalog_sec_filing",
    reason_label: "카탈로그 공시",
    priority: options.priority ?? "normal",
    occurred_at: occurredAt,
    available_at: occurredAt,
    expires_at: null,
    reviewed_at: options.state === "reviewed" ? occurredAt : null,
    saved_at: null,
    snoozed_until: null,
    state: options.state ?? "new",
    actionable: options.state !== "reviewed",
    phase: null,
    group_key: null,
    primary_action: { type: "link", label: "공시 보기", href: `/filings/${id}` },
    secondary_actions: [],
    metadata: {
      form_type: options.formType ?? "4",
      form4_has_reported_open_market_trade: options.openMarketTrade ?? true,
      form4_reported_purchase_value: options.purchaseValue ?? 1_000,
      form4_reported_sale_value: options.saleValue ?? null,
      has_recent_research: options.hasRecentResearch ?? false,
    },
  };
}

describe("buildPulseFeedDisplayEntries", () => {
  it("replaces same-day open Form 4 cards with one stack at the first card position", () => {
    const first = filing("aaa", "2026-07-16T16:00:00.000Z");
    const eightK = filing("event", "2026-07-16T16:15:00.000Z", { formType: "8-K" });
    const second = filing("bbb", "2026-07-16T20:00:00.000Z");

    const entries = buildPulseFeedDisplayEntries([first, eightK, second], "Asia/Seoul");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: "insider_trade_stack",
      position: 1,
      state: "new",
      items: [{ item: { id: "bbb" }, position: 3 }, { item: { id: "aaa" }, position: 1 }],
    });
    expect(entries[1]).toMatchObject({ type: "item", item: { id: "event" }, position: 2 });
  });

  it("keeps all regular Form 4 filings in one feed summary across local dates", () => {
    const sameDayNew = filing("aaa", "2026-07-16T16:00:00.000Z");
    const sameDayReviewed = filing("bbb", "2026-07-16T17:00:00.000Z", { state: "reviewed" });
    const nextDay = filing("ccc", "2026-07-17T16:00:00.000Z");

    const entries = buildPulseFeedDisplayEntries([sameDayNew, sameDayReviewed, nextDay], "Asia/Seoul");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "insider_trade_stack",
      state: "new",
      items: [
        { item: { id: "ccc", state: "new" } },
        { item: { id: "bbb", state: "reviewed" } },
        { item: { id: "aaa", state: "new" } },
      ],
    });
  });

  it("marks a stack reviewed only after every transaction has a judgment", () => {
    const first = filing("aaa", "2026-07-16T16:00:00.000Z", { state: "reviewed" });
    const second = filing("bbb", "2026-07-16T17:00:00.000Z", { state: "reviewed" });

    const [entry] = buildPulseFeedDisplayEntries([first, second], "Asia/Seoul");

    expect(entry).toMatchObject({ type: "insider_trade_stack", state: "reviewed" });
  });

  it("leaves a single Form 4 as an ordinary filing card", () => {
    const only = filing("aaa", "2026-07-16T16:00:00.000Z");

    const entries = buildPulseFeedDisplayEntries([only], "Asia/Seoul");

    expect(entries).toEqual([{ type: "item", id: "aaa", item: only, position: 1, state: "new" }]);
  });

  it("does not render a non-market Form 4 from an older device snapshot", () => {
    const nonMarket = filing("grant", "2026-07-16T16:00:00.000Z", {
      openMarketTrade: false,
    });
    const market = filing("sale", "2026-07-16T17:00:00.000Z");

    const entries = buildPulseFeedDisplayEntries(
      [nonMarket, market],
      "Asia/Seoul",
    );

    expect(entries).toEqual([
      { type: "item", id: "sale", item: market, position: 2, state: "new" },
    ]);
  });

  it("combines personal and discovery Form 4 filings into one feed summary", () => {
    const personal = filing("personal", "2026-07-16T16:00:00.000Z", { feedSlot: "signal" });
    const discovery = filing("discovery", "2026-07-16T17:00:00.000Z", { feedSlot: "discovery" });
    const discoverySecond = filing("discovery-second", "2026-07-16T18:00:00.000Z", { feedSlot: "discovery" });

    const entries = buildPulseFeedDisplayEntries(
      [personal, discovery, discoverySecond],
      "Asia/Seoul",
    );

    expect(entries).toMatchObject([{
      type: "insider_trade_stack",
      feed_slot: "signal",
      items: [
        { item: { id: "discovery-second" } },
        { item: { id: "discovery" } },
        { item: { id: "personal" } },
      ],
    }]);
  });

  it("keeps a long Form 4 set in one summary card before applying the visual limit", () => {
    const trades = Array.from({ length: 7 }, (_, index) => filing(
      `trade-${index + 1}`,
      `2026-07-16T${String(16 + index).padStart(2, "0")}:00:00.000Z`,
      { feedSlot: "discovery" },
    ));

    const entries = buildPulseFeedDisplayEntries(trades, "Asia/Seoul", 2);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "insider_trade_stack",
      items: [
        { item: { id: "trade-7" } },
        { item: { id: "trade-6" } },
        { item: { id: "trade-5" } },
        { item: { id: "trade-4" } },
        { item: { id: "trade-3" } },
        { item: { id: "trade-2" } },
        { item: { id: "trade-1" } },
      ],
    });
  });

  it("leaves an urgent Form 4 outside the regular summary", () => {
    const urgent = filing("urgent", "2026-07-16T20:00:00.000Z", { priority: "urgent" });
    const regularA = filing("regular-a", "2026-07-16T19:00:00.000Z");
    const regularB = filing("regular-b", "2026-07-16T18:00:00.000Z");

    const entries = buildPulseFeedDisplayEntries([urgent, regularA, regularB], "Asia/Seoul");

    expect(entries).toMatchObject([
      { type: "item", item: { id: "urgent" } },
      {
        type: "insider_trade_stack",
        items: [{ item: { id: "regular-a" } }, { item: { id: "regular-b" } }],
      },
    ]);
  });

  it("features research-context and higher-value trades before freshness", () => {
    const recentSmall = filing("recent-small", "2026-07-16T20:00:00.000Z", {
      coverageLevel: null,
      purchaseValue: 10,
    });
    const large = filing("large", "2026-07-16T18:00:00.000Z", {
      coverageLevel: null,
      saleValue: 100_000,
    });
    const research = filing("research", "2026-07-16T16:00:00.000Z", {
      hasRecentResearch: true,
      purchaseValue: 1,
    });

    const [entry] = buildPulseFeedDisplayEntries([recentSmall, large, research], "Asia/Seoul");

    expect(entry).toMatchObject({
      type: "insider_trade_stack",
      items: [
        { item: { id: "research" } },
        { item: { id: "large" } },
        { item: { id: "recent-small" } },
      ],
    });
  });
});
