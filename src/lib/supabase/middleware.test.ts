import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "./middleware";

const ORIGINAL_DEV_AUTH_BYPASS = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS;

describe("updateSession dev auth redirects", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "1";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = ORIGINAL_DEV_AUTH_BYPASS;
  });

  it("redirects login to a normalized next path without preserving recursive next query", async () => {
    const response = await updateSession(
      new NextRequest(
        "http://localhost/login?next=%2Fcompanies%3Fnext%3D%252Fcompanies",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/companies");
  });
});
