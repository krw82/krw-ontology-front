import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { isDevAuthBypassEnabledForHost } from "@/lib/dev-auth-runtime";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth-server";
import { headers } from "next/headers";

describe("dev auth bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("only enables bypass for explicit local development requests", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");

    expect(isDevAuthBypassEnabledForHost("localhost")).toBe(true);
    expect(isDevAuthBypassEnabledForHost("127.0.0.1")).toBe(true);
    expect(isDevAuthBypassEnabledForHost("::1")).toBe(true);
    expect(isDevAuthBypassEnabledForHost("example.com")).toBe(false);
  });

  it("ignores the old public bypass flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS", "1");

    expect(isDevAuthBypassEnabledForHost("localhost")).toBe(false);
  });

  it("does not enable bypass outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");

    expect(isDevAuthBypassEnabledForHost("localhost")).toBe(false);
  });

  it("stays disabled when request headers are unavailable", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    vi.mocked(headers).mockRejectedValueOnce(new Error("outside request"));

    await expect(isDevAuthBypassEnabled()).resolves.toBe(false);
  });
});
