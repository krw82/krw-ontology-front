import { describe, expect, it } from "vitest";
import {
  FIRST_VALUE_ENTRY,
  firstValuePulseHref,
  isFirstValueEntry,
  parseFirstValueIntent,
  withFirstValueEntry,
} from "@/lib/onboarding/first-value";

describe("first value onboarding helpers", () => {
  it("accepts only supported intent values", () => {
    expect(parseFirstValueIntent("earnings")).toBe("earnings");
    expect(parseFirstValueIntent("unknown")).toBeNull();
    expect(parseFirstValueIntent(null)).toBeNull();
  });

  it("keeps an internal destination while adding the first-value entry", () => {
    expect(withFirstValueEntry("/ko/companies/AAPL?ref=search#insight")).toBe(
      `/ko/companies/AAPL?ref=search&entry=${FIRST_VALUE_ENTRY}#insight`,
    );
  });

  it("builds the optional Pulse intent route", () => {
    expect(firstValuePulseHref("risk")).toBe(
      `/pulse?entry=${FIRST_VALUE_ENTRY}&intent=risk`,
    );
    expect(firstValuePulseHref()).toBe(`/pulse?entry=${FIRST_VALUE_ENTRY}`);
    expect(isFirstValueEntry(FIRST_VALUE_ENTRY)).toBe(true);
    expect(isFirstValueEntry("onboarding")).toBe(false);
  });
});
