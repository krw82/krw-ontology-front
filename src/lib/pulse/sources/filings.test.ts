import { describe, expect, it } from "vitest";
import { filingGroupKey } from "@/lib/pulse/sources/filings";

describe("Pulse filing grouping", () => {
  const time = Date.parse("2026-07-15T00:04:00.000Z");

  it("groups normal filings for the same CIK in the same ten-minute bucket", () => {
    const event = { cik: "0000320193", alert_priority: "normal" as const };
    expect(filingGroupKey(event, "n1", time)).toBe(filingGroupKey(event, "n2", time + 5 * 60_000));
    expect(filingGroupKey(event, "n1", time)).not.toBe(filingGroupKey(event, "n2", time + 10 * 60_000));
  });

  it("never groups urgent notifications", () => {
    const event = { cik: "0000320193", alert_priority: "urgent" as const };
    expect(filingGroupKey(event, "n1", time)).not.toBe(filingGroupKey(event, "n2", time));
  });
});
