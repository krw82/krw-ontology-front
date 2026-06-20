import { describe, expect, it } from "vitest";
import {
  getCreditEnforcementMode,
  shouldBlockAnalysisCreditReservation,
} from "./credit-policy";

describe("credit enforcement policy", () => {
  it("defaults to enforced mode for paid launch", () => {
    expect(getCreditEnforcementMode({})).toBe("enforced");
    expect(
      getCreditEnforcementMode({
        ANALYSIS_CREDIT_ENFORCEMENT_MODE: "invalid",
      }),
    ).toBe("enforced");
  });

  it("parses supported enforcement modes case-insensitively", () => {
    expect(
      getCreditEnforcementMode({
        ANALYSIS_CREDIT_ENFORCEMENT_MODE: "ENFORCED",
      }),
    ).toBe("enforced");
    expect(
      getCreditEnforcementMode({
        ANALYSIS_CREDIT_ENFORCEMENT_MODE: " soft_warning ",
      }),
    ).toBe("soft_warning");
  });

  it("blocks over-limit and failed reservations only in enforced mode", () => {
    expect(
      shouldBlockAnalysisCreditReservation(
        { ok: true, allowed: false },
        "shadow",
      ),
    ).toBe(false);
    expect(
      shouldBlockAnalysisCreditReservation(
        { ok: true, allowed: false },
        "enforced",
      ),
    ).toBe(true);
    expect(
      shouldBlockAnalysisCreditReservation({ ok: false }, "enforced"),
    ).toBe(true);
  });
});
