import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() => Response.json({ error: { code: "unauthorized" } }, { status: 401 })),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  isExpectedMutationOrigin: vi.fn(() => true),
  invalidOriginResponse: vi.fn(() => Response.json({ error: { code: "forbidden" } }, { status: 403 })),
}));
vi.mock("@/lib/onboarding/state", () => ({
  recordOnboardingStateAction: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser } from "@/lib/auth";
import { recordOnboardingStateAction } from "@/lib/onboarding/state";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PATCH } from "./route";

describe("PATCH /api/onboarding/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue({} as never);
    vi.mocked(recordOnboardingStateAction).mockResolvedValue({
      state: { user_id: "user-1", status: "in_progress" },
      changed: true,
    } as never);
  });

  it("records only bounded company context for a question start", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/onboarding/state", {
        method: "PATCH",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({
          action: "question_started",
          ticker: "aapl",
          has_company_context: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(recordOnboardingStateAction).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "question_started",
    );
    expect(recordAnalyticsEventFromRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        eventName: "onboarding_question_started",
        userId: "user-1",
        properties: { ticker: "AAPL", has_company_context: true },
      }),
    );
  });

  it("rejects malformed company context without writing lifecycle state", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/onboarding/state", {
        method: "PATCH",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ action: "company_selected", ticker: "not a ticker" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(recordOnboardingStateAction).not.toHaveBeenCalled();
  });
});
