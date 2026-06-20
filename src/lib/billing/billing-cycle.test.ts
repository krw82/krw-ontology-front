import { describe, expect, it } from "vitest";
import {
  addCalendarMonthsIso,
  calculateProratedUpgradeAmountKrw,
  getFirstWeeklyBoundaryAtOrAfterIso,
  getRenewalGraceUntilIso,
  getRenewalRetryAtIso,
} from "./billing-cycle";

describe("billing cycle helpers", () => {
  it("keeps calendar-month anniversaries at month end", () => {
    expect(addCalendarMonthsIso("2026-01-31T15:00:00.000Z", 1)).toBe(
      "2026-02-28T15:00:00.000Z",
    );
  });

  it("prorates only the remaining upgrade price difference", () => {
    expect(
      calculateProratedUpgradeAmountKrw({
        currentMonthlyPriceKrw: 7_900,
        targetMonthlyPriceKrw: 29_000,
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        now: new Date("2026-06-16T00:00:00.000Z"),
      }),
    ).toBe(10_550);
  });

  it("uses the current boundary when renewal lands exactly on a credit boundary", () => {
    expect(
      getFirstWeeklyBoundaryAtOrAfterIso({
        anchor: "2026-06-01T12:00:00.000Z",
        at: "2026-06-29T12:00:00.000Z",
      }),
    ).toBe("2026-06-29T12:00:00.000Z");
  });

  it("moves a downgrade to the next credit boundary after an off-cycle renewal", () => {
    expect(
      getFirstWeeklyBoundaryAtOrAfterIso({
        anchor: "2026-06-01T12:00:00.000Z",
        at: "2026-07-01T12:00:00.000Z",
      }),
    ).toBe("2026-07-06T12:00:00.000Z");
  });

  it("uses a three-day grace period and bounded retry backoff", () => {
    expect(getRenewalGraceUntilIso("2026-07-01T00:00:00.000Z")).toBe(
      "2026-07-04T00:00:00.000Z",
    );
    expect(
      getRenewalRetryAtIso({
        now: new Date("2026-07-01T00:00:00.000Z"),
        attemptCount: 0,
      }),
    ).toBe("2026-07-01T01:00:00.000Z");
    expect(
      getRenewalRetryAtIso({
        now: new Date("2026-07-01T00:00:00.000Z"),
        attemptCount: 99,
      }),
    ).toBe("2026-07-01T12:00:00.000Z");
  });
});
