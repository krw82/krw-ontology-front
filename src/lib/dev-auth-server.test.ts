import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { isDevAuthBypassEnabledForHost } from "@/lib/dev-auth-runtime";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth-server";
import { headers } from "next/headers";

describe("dev auth bypass", () => {
  const e2eToken = "a".repeat(64);

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

  it("allows an explicit production E2E bypass only on loopback hosts", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_PRODUCTION_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_SERVER_BIND", "127.0.0.1");
    vi.stubEnv("KRW_E2E_AUTH_TOKEN", e2eToken);

    expect(isDevAuthBypassEnabledForHost("localhost", e2eToken)).toBe(true);
    expect(isDevAuthBypassEnabledForHost("127.0.0.1", e2eToken)).toBe(true);
    expect(isDevAuthBypassEnabledForHost("krwontology.com", e2eToken)).toBe(false);
    expect(isDevAuthBypassEnabledForHost("localhost", "wrong-token")).toBe(false);
  });

  it("does not allow the production E2E flag without the private bypass flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "0");
    vi.stubEnv("KRW_E2E_PRODUCTION_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_SERVER_BIND", "127.0.0.1");
    vi.stubEnv("KRW_E2E_AUTH_TOKEN", e2eToken);

    expect(isDevAuthBypassEnabledForHost("localhost", e2eToken)).toBe(false);
  });

  it("fails closed when production E2E has no nonce or loopback bind", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_PRODUCTION_AUTH_BYPASS", "1");
    vi.stubEnv("KRW_E2E_SERVER_BIND", "0.0.0.0");

    expect(isDevAuthBypassEnabledForHost("localhost", e2eToken)).toBe(false);
  });

  it("stays disabled when request headers are unavailable", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    vi.mocked(headers).mockRejectedValueOnce(new Error("outside request"));

    await expect(isDevAuthBypassEnabled()).resolves.toBe(false);
  });
});
