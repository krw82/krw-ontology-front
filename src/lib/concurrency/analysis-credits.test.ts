import { describe, expect, it } from "vitest";
import { getInitialAnalysisCreditReservationRaw } from "./analysis-credits";

describe("analysis credit reservations", () => {
  it("uses a minimal one-credit start reservation for every run type and mode", () => {
    expect(getInitialAnalysisCreditReservationRaw("company_research", "fast")).toBe(
      1_000,
    );
    expect(
      getInitialAnalysisCreditReservationRaw("company_research", "standard"),
    ).toBe(1_000);
    expect(getInitialAnalysisCreditReservationRaw("company_research", "deep")).toBe(
      1_000,
    );
    expect(getInitialAnalysisCreditReservationRaw("news_discovery", "deep")).toBe(
      1_000,
    );
    expect(getInitialAnalysisCreditReservationRaw()).toBe(1_000);
  });
});
