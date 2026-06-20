import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DesktopAuthorizationRequestRow } from "@/types/database";
import {
  decideDesktopAuthorizationRequest,
  exchangeDesktopAuthorizationCode,
  startDesktopAuthorization,
} from "./authorization";

const now = new Date("2026-06-21T00:00:00.000Z");

function authorization(
  overrides: Partial<DesktopAuthorizationRequestRow> = {},
): DesktopAuthorizationRequestRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    client_id: "krw-desktop-macos",
    redirect_uri: "com.krw.desktop:/oauth/callback",
    state: "s".repeat(43),
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
    installation_id: "22222222-2222-4222-8222-222222222222",
    device_name: "Test Mac",
    platform: "darwin",
    arch: "arm64",
    app_version: "1.0.0",
    protocol_version: "desktop/v1",
    status: "pending",
    user_id: null,
    device_id: null,
    authorization_code_hash: null,
    expires_at: "2026-06-21T00:10:00.000Z",
    approved_at: null,
    consumed_at: null,
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

function queryResult<T>(data: T, error: unknown = null) {
  const query = {
    insert: vi.fn(() => query),
    update: vi.fn(() => query),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    single: vi.fn(async () => ({ data, error })),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  return query;
}

describe("Desktop Authorization Code + PKCE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DESKTOP_AUTH_CLIENT_ID = "krw-desktop-macos";
    process.env.DESKTOP_AUTH_REDIRECT_URI =
      "com.krw.desktop:/oauth/callback";
    process.env.NEXT_PUBLIC_APP_URL = "https://krw.example.com";
  });

  it("creates an allowlisted S256 authorization request", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn(() => queryResult(authorization())),
    } as never);

    const result = await startDesktopAuthorization(
      {
        clientId: "krw-desktop-macos",
        redirectUri: "com.krw.desktop:/oauth/callback",
        codeChallenge: "c".repeat(43),
        codeChallengeMethod: "S256",
        state: "s".repeat(43),
        installationId: "22222222-2222-4222-8222-222222222222",
        deviceName: "Test Mac",
        platform: "darwin",
        arch: "arm64",
        appVersion: "1.0.0",
        protocolVersion: "desktop/v1",
      },
      "http://internal.local",
      now,
    );

    expect(result.authorization_url).toBe(
      "https://krw.example.com/desktop/connect?request=11111111-1111-4111-8111-111111111111",
    );
    expect(result.callback_scheme).toBe("com.krw.desktop");
  });

  it("rejects unregistered native redirect URIs", async () => {
    await expect(
      startDesktopAuthorization(
        {
          clientId: "krw-desktop-macos",
          redirectUri: "https://evil.example/callback",
          codeChallenge: "c".repeat(43),
          codeChallengeMethod: "S256",
          state: "s".repeat(43),
          installationId: "22222222-2222-4222-8222-222222222222",
          deviceName: "Test Mac",
          platform: "darwin",
          arch: "arm64",
          appVersion: "1.0.0",
          protocolVersion: "desktop/v1",
        },
        "https://krw.example.com",
        now,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns a state-bound custom-scheme callback after approval", async () => {
    const pending = authorization();
    const approved = authorization({
      status: "approved",
      user_id: "user-1",
      authorization_code_hash: "stored-hash",
      approved_at: now.toISOString(),
    });
    vi.mocked(getSupabaseAdmin)
      .mockReturnValueOnce({
        from: vi.fn(() => queryResult(pending)),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn(() => queryResult(approved)),
      } as never);

    const result = await decideDesktopAuthorizationRequest({
      requestId: pending.id,
      userId: "user-1",
      approved: true,
      now,
    });
    const callback = new URL(result.redirect_uri);

    expect(callback.protocol).toBe("com.krw.desktop:");
    expect(callback.pathname).toBe("/oauth/callback");
    expect(callback.searchParams.get("state")).toBe(pending.state);
    expect(callback.searchParams.get("code")).toMatch(/^krw_ac_/);
  });

  it("exchanges the code only with the matching PKCE verifier", async () => {
    const verifier = "v".repeat(43);
    const expectedChallenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          exchanged: true,
          user_id: "user-1",
          device_id: "device-1",
          device_name: "Test Mac",
          device_status: "active",
        },
      ],
      error: null,
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      rpc,
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: "user@example.com" } },
            error: null,
          }),
        },
      },
    } as never);

    const result = await exchangeDesktopAuthorizationCode(
      {
        clientId: "krw-desktop-macos",
        redirectUri: "com.krw.desktop:/oauth/callback",
        authorizationCode: "krw_ac_one-time-code",
        codeVerifier: verifier,
      },
      now,
    );

    expect(rpc).toHaveBeenCalledWith(
      "exchange_desktop_authorization_code",
      expect.objectContaining({
        p_code_challenge: expectedChallenge,
        p_client_id: "krw-desktop-macos",
        p_redirect_uri: "com.krw.desktop:/oauth/callback",
      }),
    );
    expect(result.account.email).toBe("user@example.com");
    expect(result.tokens.desktop_access_token).toMatch(/^krw_dt_/);
  });
});
