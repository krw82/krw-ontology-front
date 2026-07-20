import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticatePersonalFilingsMcpHeader,
  createInternalPersonalFilingsMcpHeader,
  PersonalFilingsMcpAuthError,
} from "./personal-auth";

const AUTH = {
  userId: "user-1",
  userEmail: "investor@example.test",
  deviceId: "device-1",
  authMethod: "desktop_access_token" as const,
};

afterEach(() => vi.unstubAllEnvs());

describe("personal filings MCP authentication", () => {
  it("keeps personal tools disabled when no user credential is supplied", async () => {
    const authenticate = vi.fn();
    await expect(authenticatePersonalFilingsMcpHeader(undefined, authenticate)).resolves.toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("resolves a valid short-lived Desktop credential to one user", async () => {
    const authenticate = vi.fn().mockResolvedValue(AUTH);
    const token = "krw_dt_abcdefghijklmnopqrstuvwxyz012345";

    await expect(authenticatePersonalFilingsMcpHeader(`Bearer ${token}`, authenticate)).resolves.toEqual(AUTH);
    expect(authenticate).toHaveBeenCalledWith(token);
  });

  it("authenticates a short-lived server-signed web-session identity", async () => {
    vi.stubEnv("FILINGS_MCP_PERSONAL_SIGNING_SECRET", "test-personal-secret-with-enough-entropy");
    const now = 1_800_000_000_000;
    const userId = "123e4567-e89b-42d3-a456-426614174000";
    const header = createInternalPersonalFilingsMcpHeader(userId, now);

    await expect(authenticatePersonalFilingsMcpHeader(header, vi.fn(), now + 10 * 60_000)).resolves.toMatchObject({
      userId,
      authMethod: "internal_web_session",
    });
    await expect(authenticatePersonalFilingsMcpHeader(header, vi.fn(), now + 12 * 60_000 + 1_000)).rejects.toBeInstanceOf(
      PersonalFilingsMcpAuthError,
    );
  });

  it("rejects tampered internal identities", async () => {
    vi.stubEnv("FILINGS_MCP_PERSONAL_SIGNING_SECRET", "test-personal-secret-with-enough-entropy");
    const header = createInternalPersonalFilingsMcpHeader(
      "123e4567-e89b-42d3-a456-426614174000",
      1_800_000_000_000,
    );
    await expect(
      authenticatePersonalFilingsMcpHeader(`${header.slice(0, -1)}x`, vi.fn(), 1_800_000_030_000),
    ).rejects.toBeInstanceOf(PersonalFilingsMcpAuthError);
  });

  it.each([
    "bearer krw_dt_abcdefghijklmnopqrstuvwxyz012345",
    "Bearer shared-service-token",
    "Bearer krw_dt_too_short",
    "Bearer krw_dt_token with spaces",
  ])("rejects malformed or wrong-purpose credentials: %s", async (value) => {
    const authenticate = vi.fn();
    await expect(authenticatePersonalFilingsMcpHeader(value, authenticate)).rejects.toBeInstanceOf(
      PersonalFilingsMcpAuthError,
    );
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects duplicated headers and invalid or expired credentials", async () => {
    const token = "Bearer krw_dt_abcdefghijklmnopqrstuvwxyz012345";
    await expect(authenticatePersonalFilingsMcpHeader([token, token], vi.fn())).rejects.toBeInstanceOf(
      PersonalFilingsMcpAuthError,
    );
    await expect(authenticatePersonalFilingsMcpHeader(token, vi.fn().mockResolvedValue(null))).rejects.toBeInstanceOf(
      PersonalFilingsMcpAuthError,
    );
    await expect(authenticatePersonalFilingsMcpHeader(token, vi.fn().mockRejectedValue(new Error("expired")))).rejects.toBeInstanceOf(
      PersonalFilingsMcpAuthError,
    );
  });
});
