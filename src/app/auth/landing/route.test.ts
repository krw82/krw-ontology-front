import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
}));
vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingState: vi.fn(),
  recordOnboardingStateAction: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import {
  getOnboardingState,
  recordOnboardingStateAction,
} from "@/lib/onboarding/state";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { GET } from "./route";

function mockAdminWithSessionCount(count: number) {
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ count, error: null }),
    }),
  } as never);
}

describe("GET /auth/landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1" } as never);
    mockAdminWithSessionCount(0);
    vi.mocked(recordOnboardingStateAction).mockResolvedValue({
      state: { user_id: "user-1", status: "in_progress" },
      changed: true,
    } as never);
  });

  it("keeps sending a never-researched account to the company directory", async () => {
    vi.mocked(getOnboardingState).mockResolvedValue({
      user_id: "user-1",
      status: "in_progress",
    } as never);

    const response = await GET(new Request("http://localhost/auth/landing"));

    expect(response.headers.get("location")).toBe(
      "http://localhost/ko/companies?tour=1",
    );
    expect(recordOnboardingStateAction).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "started",
    );
  });

  it("lands an account with research history directly in Pulse", async () => {
    mockAdminWithSessionCount(2);
    vi.mocked(getOnboardingState).mockResolvedValue({
      user_id: "user-1",
      status: "in_progress",
    } as never);

    const response = await GET(new Request("http://localhost/auth/landing"));

    expect(response.headers.get("location")).toBe("http://localhost/pulse");
    expect(recordOnboardingStateAction).not.toHaveBeenCalled();
  });

  it("respects an explicit onboarding skip even without research", async () => {
    vi.mocked(getOnboardingState).mockResolvedValue({
      user_id: "user-1",
      status: "skipped",
    } as never);

    const response = await GET(new Request("http://localhost/auth/landing"));

    expect(response.headers.get("location")).toBe("http://localhost/pulse");
    expect(recordOnboardingStateAction).not.toHaveBeenCalled();
  });

  it("falls back to Pulse when the landing lookup fails", async () => {
    vi.mocked(getSupabaseAdmin).mockImplementation(() => {
      throw new Error("database unavailable");
    });
    vi.mocked(getOnboardingState).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/auth/landing"));

    expect(response.headers.get("location")).toBe("http://localhost/pulse");
  });

  it("keeps the locale when resolving a first login", async () => {
    vi.mocked(getOnboardingState).mockResolvedValue({
      user_id: "user-1",
      status: "not_started",
    } as never);

    const response = await GET(
      new Request("http://localhost/auth/landing?locale=en"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/en/companies?tour=1",
    );
  });

  it("asks an unauthenticated visitor to sign in before resolving the landing", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/auth/landing?locale=en"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/login?next=%2Fauth%2Flanding%3Flocale%3Den",
    );
  });
});
