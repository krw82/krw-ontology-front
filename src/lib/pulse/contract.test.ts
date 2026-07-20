import { describe, expect, it } from "vitest";
import { normalizePulseDateTime, pulseItemSchema } from "@/lib/pulse/contract";

const validItem = {
  id: "opaque",
  kind: "filing",
  trigger: "event",
  source_type: "filing",
  source_id: "notification-id",
  ticker: "AAPL",
  coverage_status: "holding",
  judgment: null,
  linked_thesis: null,
  eyebrow: "8-K 새 공시",
  title: "새 공시",
  body: "본문",
  reason_code: "filing_subscription",
  reason_label: "공시 알림을 켰기 때문입니다.",
  priority: "urgent",
  occurred_at: "2026-07-15T00:00:00.000Z",
  available_at: "2026-07-15T00:00:00.000Z",
  expires_at: null,
  reviewed_at: null,
  saved_at: null,
  snoozed_until: null,
  state: "new",
  actionable: true,
  phase: null,
  group_key: null,
  primary_action: { type: "link", label: "열기", href: "/filings/1" },
  secondary_actions: [],
  metadata: {},
};

describe("Pulse item contract", () => {
  it("accepts a complete discriminated item", () => {
    expect(pulseItemSchema.safeParse(validItem).success).toBe(true);
    expect(pulseItemSchema.safeParse({
      ...validItem,
      kind: "analysis",
      source_type: "analysis",
      source_id: "run-id",
    }).success).toBe(true);
  });

  it("rejects mismatched kinds and missing reason/action data", () => {
    expect(pulseItemSchema.safeParse({ ...validItem, source_type: "question" }).success).toBe(false);
    const withoutReason: Partial<typeof validItem> = { ...validItem };
    delete withoutReason.reason_label;
    expect(pulseItemSchema.safeParse(withoutReason).success).toBe(false);
    expect(pulseItemSchema.safeParse({ ...validItem, secondary_actions: Array(4).fill(validItem.primary_action) }).success).toBe(false);
  });

  it("normalizes Supabase timestamptz offsets to the public UTC contract", () => {
    expect(normalizePulseDateTime("2026-07-15T09:00:00+09:00"))
      .toBe("2026-07-15T00:00:00.000Z");
    expect(normalizePulseDateTime(null)).toBeNull();
  });
});
