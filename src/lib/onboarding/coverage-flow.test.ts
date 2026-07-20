import { describe, expect, it } from "vitest";
import {
  companyCoverageOnboardingHref,
  normalizeCoverageContinuePath,
  remainingCoverageCompanies,
  toCoverageOnboardingProgress,
} from "./coverage-flow";

describe("coverage onboarding flow", () => {
  it("passes the coverage onboarding state through the selected company link", () => {
    expect(companyCoverageOnboardingHref("ko", "aapl", true)).toBe(
      "/ko/companies/AAPL?onboarding=coverage",
    );
    expect(companyCoverageOnboardingHref("en", "aapl", true)).toBe(
      "/en/companies/AAPL?onboarding=coverage",
    );
    expect(companyCoverageOnboardingHref("ko", "aapl", false)).toBe(
      "/ko/companies/AAPL",
    );
    expect(
      companyCoverageOnboardingHref(
        "ko",
        "aapl",
        true,
        "/chat/new?ticker=AAPL",
      ),
    ).toBe(
      "/ko/companies/AAPL?onboarding=coverage&continue=%2Fchat%2Fnew%3Fticker%3DAAPL",
    );
  });

  it("keeps only same-origin continuation paths", () => {
    expect(normalizeCoverageContinuePath("/pulse")).toBe("/pulse");
    expect(normalizeCoverageContinuePath(" /pulse?tab=filings#latest ")).toBe(
      "/pulse?tab=filings#latest",
    );
    expect(normalizeCoverageContinuePath("https://evil.example")).toBeNull();
    expect(normalizeCoverageContinuePath("//evil.example")).toBeNull();
    expect(normalizeCoverageContinuePath("/\\evil.example")).toBeNull();
    expect(normalizeCoverageContinuePath("/%5cevil.example")).toBeNull();
    expect(normalizeCoverageContinuePath("/%2fevil.example")).toBeNull();
    expect(normalizeCoverageContinuePath("/pulse\u0000/next")).toBeNull();
    expect(normalizeCoverageContinuePath("/pulse%0a/next")).toBeNull();
    expect(normalizeCoverageContinuePath("/login?next=/pulse")).toBeNull();
    expect(normalizeCoverageContinuePath("/auth/callback?next=/pulse")).toBeNull();
  });

  it("does not infer completion before the server milestone exists", () => {
    const progress = toCoverageOnboardingProgress({
      coverageCount: 3,
      judgmentCount: 1,
      monitoringRuleCount: 1,
      evidenceOpened: true,
      achievedAt: null,
    });

    expect(progress.activated).toBe(false);
    expect(progress.achieved_at).toBeNull();
    expect(remainingCoverageCompanies(progress)).toBe(0);
  });

  it("marks completion only from the persisted coverage_activated milestone", () => {
    const progress = toCoverageOnboardingProgress({
      achievedAt: "2026-07-18T03:00:00.000Z",
      coverageCount: 3,
      judgmentCount: 1,
      monitoringRuleCount: 1,
      evidenceOpened: true,
    });

    expect(progress.activated).toBe(true);
    expect(remainingCoverageCompanies(progress)).toBe(0);
  });
});
