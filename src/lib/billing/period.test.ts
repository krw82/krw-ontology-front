import { describe, expect, it } from "vitest";
import {
  getCurrentDailyBillingPeriod,
  getCurrentBillingPeriod,
  getCurrentMonthlyBillingPeriod,
  getCurrentWeeklyBillingPeriod,
  isDateWithinPeriod,
} from "./period";

describe("billing period", () => {
  it("uses UTC calendar day boundaries", () => {
    const period = getCurrentDailyBillingPeriod(
      new Date("2026-05-23T18:00:00.000Z"),
    );

    expect(period).toEqual({
      start: "2026-05-23T00:00:00.000Z",
      end: "2026-05-24T00:00:00.000Z",
      label: "오늘",
    });
  });

  it("uses UTC calendar month boundaries", () => {
    const period = getCurrentMonthlyBillingPeriod(
      new Date("2026-05-23T18:00:00.000Z"),
    );

    expect(period).toEqual({
      start: "2026-05-01T00:00:00.000Z",
      end: "2026-06-01T00:00:00.000Z",
      label: "이번 달",
    });
  });

  it("uses seven-day periods from the subscription credit anchor", () => {
    const period = getCurrentWeeklyBillingPeriod(
      new Date("2026-05-20T12:30:00.000Z"),
      new Date("2026-06-03T12:29:59.999Z"),
    );

    expect(period).toEqual({
      start: "2026-05-27T12:30:00.000Z",
      end: "2026-06-03T12:30:00.000Z",
      label: "이번 주",
    });
  });

  it("selects daily or monthly periods by usage period", () => {
    const now = new Date("2026-05-23T18:00:00.000Z");

    expect(getCurrentBillingPeriod("daily", now).label).toBe("오늘");
    expect(getCurrentBillingPeriod("weekly", now).label).toBe("이번 주");
    expect(getCurrentBillingPeriod("monthly", now).label).toBe("이번 달");
  });

  it("treats period end as exclusive", () => {
    const period = getCurrentMonthlyBillingPeriod(
      new Date("2026-05-23T18:00:00.000Z"),
    );

    expect(isDateWithinPeriod(new Date("2026-05-31T23:59:59.999Z"), period)).toBe(true);
    expect(isDateWithinPeriod(new Date("2026-06-01T00:00:00.000Z"), period)).toBe(false);
  });
});
