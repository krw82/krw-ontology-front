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

describe("GET /auth/landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue({} as never);
    vi.mocked(recordOnboardingStateAction).mockResolvedValue({
      state: { user_id: "user-1", status: "in_progress" },
      changed: true,
    } as never);
  });

  it("sends an untouched new account to the company directory once", async () => {
    vi.mocked(getOnboardingState).mockResolvedValue({
      user_id: "user-1",
      status: "not_started",
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

  it("sends a returning account directly to Pulse", async () => {
    vi.mocked(getOnboardingState).mockResolvedValue({
      user_id: "user-1",
      status: "in_progress",
    } as never);

    const response = await GET(new Request("http://localhost/auth/landing"));

    expect(response.headers.get("location")).toBe("http://localhost/pulse");
    expect(recordOnboardingStateAction).not.toHaveBeenCalled();
  });

  it("keeps the company directory repeatable in local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(getOnboardingState).mockResolvedValue({
      user_id: "user-1",
      status: "completed",
    } as never);

    const response = await GET(new Request("http://localhost/auth/landing"));

    expect(response.headers.get("location")).toBe(
      "http://localhost/ko/companies?tour=1",
    );
    expect(getOnboardingState).not.toHaveBeenCalled();
    expect(recordOnboardingStateAction).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
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
