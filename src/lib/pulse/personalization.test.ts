import { describe, expect, it } from "vitest";
import type { PulseCandidate } from "@/lib/pulse/contract";
import {
  applyPulseUserTickerSignals,
  emptyPulseUserTickerSignals,
} from "@/lib/pulse/personalization";

function filing(ticker: string): PulseCandidate {
  return {
    item_key: `filing:${ticker}`,
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: ticker,
    ticker,
    eyebrow: "새 공시",
    title: ticker,
    body: "body",
    reason_code: "catalog_sec_filing",
    reason_label: "카탈로그 공시",
    priority: "normal",
    occurred_at: "2026-07-15T00:00:00.000Z",
    available_at: "2026-07-15T00:00:00.000Z",
    expires_at: null,
    read_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "공시 보기", href: "/filings" },
    secondary_actions: [],
    metadata: {},
  };
}

describe("Pulse user ticker signals", () => {
  it("adds transparent holding and recent-research reasons without changing the source item", () => {
    const signals = emptyPulseUserTickerSignals();
    signals.holdingTickers.add("AAPL");
    signals.recentResearchTickers.add("AAPL");

    const [item] = applyPulseUserTickerSignals([filing("aapl")], signals);

    expect(item).toMatchObject({
      is_holding: true,
      is_watchlisted: false,
      has_recent_research: true,
      reason_code: "holding_research_followup",
      reason_label: "AAPL은 보유 기업이며 최근 이 기업을 리서치했습니다.",
    });
    expect(item.source_id).toBe("aapl");
  });
});
