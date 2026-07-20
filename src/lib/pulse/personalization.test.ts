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
    coverage_status: null,
    judgment: null,
    linked_thesis: null,
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
    signals.coverageByTicker.set("AAPL", "holding");
    signals.recentResearchTickers.add("AAPL");

    const [item] = applyPulseUserTickerSignals([filing("aapl")], signals);

    expect(item).toMatchObject({
      coverage_status: "holding",
      has_recent_research: true,
      reason_code: "holding_research_followup",
      reason_label: "AAPL은 보유 기업이며 최근 이 기업을 리서치했습니다.",
    });
    expect(item.source_id).toBe("aapl");
  });

  it("uses a covered share-class mark as the filing context and rewrites its actions", () => {
    const signals = emptyPulseUserTickerSignals();
    signals.coverageByTicker.set("GOOGL", "holding");
    signals.recentResearchTickers.add("GOOGL");
    const candidate = {
      ...filing("GOOG"),
      primary_action: {
        type: "link" as const,
        label: "공시 보기",
        href: "/filings/11111111-1111-4111-8111-111111111111?source=pulse",
      },
      secondary_actions: [{
        type: "link" as const,
        label: "이 공시로 질문",
        href: "/chat/new?ticker=GOOG&filing_event_id=11111111-1111-4111-8111-111111111111",
      }],
      metadata: { covered_tickers_csv: "GOOG,GOOGL" },
    };

    const [item] = applyPulseUserTickerSignals([candidate], signals);

    expect(item).toMatchObject({
      ticker: "GOOGL",
      coverage_status: "holding",
      has_recent_research: true,
      reason_code: "holding_research_followup",
      reason_label: "GOOGL은 보유 기업이며 최근 이 기업을 리서치했습니다.",
      metadata: { canonical_ticker: "GOOG", covered_tickers_csv: "GOOG,GOOGL" },
    });
    expect(item.primary_action).toMatchObject({
      href: "/filings/11111111-1111-4111-8111-111111111111?source=pulse&ticker=GOOGL",
    });
    expect(item.secondary_actions[0]).toMatchObject({
      href: "/chat/new?ticker=GOOGL&filing_event_id=11111111-1111-4111-8111-111111111111",
    });
  });
});
