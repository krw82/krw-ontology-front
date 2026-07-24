import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  isPendingOnboardingState,
  patchForOnboardingAction,
} from "./state";

describe("onboarding state", () => {
  it("only routes unfinished new-user state into onboarding", () => {
    expect(isPendingOnboardingState({ status: "not_started" })).toBe(true);
    expect(isPendingOnboardingState({ status: "in_progress" })).toBe(true);
    expect(isPendingOnboardingState({ status: "completed" })).toBe(false);
    expect(isPendingOnboardingState(null)).toBe(false);
  });

  it("makes evidence opening the durable completion boundary", () => {
    expect(patchForOnboardingAction("evidence_opened", "2026-07-22T00:00:00.000Z")).toMatchObject({
      status: "completed",
      first_evidence_opened_at: "2026-07-22T00:00:00.000Z",
      completed_at: "2026-07-22T00:00:00.000Z",
    });
  });
});
