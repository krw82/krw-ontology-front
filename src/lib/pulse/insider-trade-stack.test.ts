import { describe, expect, it } from "vitest";
import { buildPulseFeedDisplayEntries } from "@/lib/pulse/insider-trade-stack";
import type { PulseItem } from "@/types/api-contracts";

function filing(
  id: string,
  occurredAt: string,
  options: { formType?: string; state?: PulseItem["state"] } = {},
): PulseItem {
  return {
    id,
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: id,
    ticker: id.toUpperCase(),
    coverage_status: "watching",
    judgment: null,
    linked_thesis: null,
    eyebrow: "내부자 거래",
    title: `${id.toUpperCase()} 내부자 거래`,
    body: "SEC Form 4 신고입니다.",
    reason_code: "catalog_sec_filing",
    reason_label: "카탈로그 공시",
    priority: "normal",
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
      form4_reported_purchase_value: 1_000,
      form4_reported_sale_value: null,
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
      items: [{ item: { id: "aaa" }, position: 1 }, { item: { id: "bbb" }, position: 3 }],
    });
    expect(entries[1]).toMatchObject({ type: "item", item: { id: "event" }, position: 2 });
  });

  it("keeps mixed judgment states in one same-day stack and separates local dates", () => {
    const sameDayNew = filing("aaa", "2026-07-16T16:00:00.000Z");
    const sameDayReviewed = filing("bbb", "2026-07-16T17:00:00.000Z", { state: "reviewed" });
    const nextDay = filing("ccc", "2026-07-17T16:00:00.000Z");

    const entries = buildPulseFeedDisplayEntries([sameDayNew, sameDayReviewed, nextDay], "Asia/Seoul");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: "insider_trade_stack",
      state: "new",
      items: [
        { item: { id: "aaa", state: "new" } },
        { item: { id: "bbb", state: "reviewed" } },
      ],
    });
    expect(entries[1]).toMatchObject({
      type: "item",
      item: { id: "ccc" },
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
});
