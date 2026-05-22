import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "./middleware";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

const ORIGINAL_DEV_AUTH_BYPASS = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS;

function mockAuthUser(user: { id: string } | null) {
  vi.mocked(createServerClient).mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
  } as unknown as ReturnType<typeof createServerClient>);
}

describe("updateSession auth redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = ORIGINAL_DEV_AUTH_BYPASS;
  });

  it("redirects login to a normalized next path without preserving recursive next query", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "1";

    const response = await updateSession(
      new NextRequest(
        "http://localhost/login?next=%2Fcompanies%3Fnext%3D%252Fcompanies",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/companies");
  });

  it("redirects authenticated login requests to the normalized next path", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "0";
    mockAuthUser({ id: "user-1" });

    const response = await updateSession(
      new NextRequest(
        "http://localhost/login?next=%2Fcompanies%3Fnext%3D%252Fcompanies",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/companies");
  });
});
