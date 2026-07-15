import { describe, expect, it } from "vitest";
import { isFilingInboxEligible, shouldBatchFilingPush, shouldQueueImmediateFilingPush } from "./notification-policy";

const subscribedAt = "2026-07-15T09:00:00.000Z";

describe("filing notification policy", () => {
  it("keeps first-sync history out of notifications", () => {
    expect(isFilingInboxEligible({
      formType: "8-K",
      isAmendment: false,
      acceptedAt: "2026-07-14T09:00:00.000Z",
      firstSeenAt: "2026-07-15T09:00:10.000Z",
      subscribedAt,
      baselineCompletedAt: null,
      preference: undefined,
    })).toBe(false);
  });

  it("allows a filing accepted after explicit subscription even during initial sync", () => {
    expect(isFilingInboxEligible({
      formType: "8-K",
      isAmendment: false,
      acceptedAt: "2026-07-15T09:01:00.000Z",
      firstSeenAt: "2026-07-15T09:01:10.000Z",
      subscribedAt,
      baselineCompletedAt: null,
      preference: undefined,
    })).toBe(true);
  });

  it("keeps enabled amendments in the inbox but leaves their default push off", () => {
    const preference = {
      enabled: true,
      notify_8k: true,
      notify_6k: false,
      include_amendments: false,
    } as never;
    expect(isFilingInboxEligible({ formType: "8-K/A", isAmendment: true, acceptedAt: "2026-07-15T10:00:00.000Z", firstSeenAt: "2026-07-15T10:00:00.000Z", subscribedAt, baselineCompletedAt: subscribedAt, preference })).toBe(true);
    expect(shouldQueueImmediateFilingPush({ isAmendment: true, priority: "normal", preference })).toBe(false);
    expect(isFilingInboxEligible({ formType: "6-K", isAmendment: false, acceptedAt: "2026-07-15T10:00:00.000Z", firstSeenAt: "2026-07-15T10:00:00.000Z", subscribedAt, baselineCompletedAt: subscribedAt, preference })).toBe(false);
  });

  it("uses priority and delivery mode for immediate push", () => {
    const preference = {
      enabled: true,
      notify_8k: true,
      notify_6k: true,
      include_amendments: true,
      delivery_mode: "important_immediate",
    } as never;
    expect(shouldQueueImmediateFilingPush({ isAmendment: false, priority: "urgent", preference })).toBe(true);
    expect(shouldQueueImmediateFilingPush({ isAmendment: false, priority: "digest", preference })).toBe(false);
    expect(shouldQueueImmediateFilingPush({ isAmendment: false, priority: "digest", preference, deliveryMode: "all_immediate" })).toBe(true);
  });

  it("keeps urgent filings out of the short ticker batching window", () => {
    expect(shouldBatchFilingPush("urgent")).toBe(false);
    expect(shouldBatchFilingPush("normal")).toBe(true);
  });
});
