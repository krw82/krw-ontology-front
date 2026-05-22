import { describe, expect, it } from "vitest";
import {
  getCurrentMonthlyBillingPeriod,
  isDateWithinPeriod,
} from "./period";

describe("billing period", () => {
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

  it("treats period end as exclusive", () => {
    const period = getCurrentMonthlyBillingPeriod(
      new Date("2026-05-23T18:00:00.000Z"),
    );

    expect(isDateWithinPeriod(new Date("2026-05-31T23:59:59.999Z"), period)).toBe(true);
    expect(isDateWithinPeriod(new Date("2026-06-01T00:00:00.000Z"), period)).toBe(false);
  });
});
