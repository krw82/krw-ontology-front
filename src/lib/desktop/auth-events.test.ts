import { afterEach, describe, expect, it, vi } from "vitest";
import {
  desktopAuthIdentifierHash,
  logDesktopAuthEvent,
} from "./auth-events";

describe("desktop auth event logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits bounded identifiers without auth secret fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const event = logDesktopAuthEvent("auth_token_issued", {
      request_id_hash: desktopAuthIdentifierHash("request-secret"),
      attempt_id_hash: desktopAuthIdentifierHash("state-secret"),
      status: "succeeded",
      authorization_code: "krw_ac_secret",
      code_verifier: "verifier-secret",
      desktop_access_token: "krw_dt_secret",
    });

    expect(event).toMatchObject({
      kind: "desktop_auth_event",
      stage: "auth_token_issued",
      status: "succeeded",
    });
    const output = info.mock.calls.flat().join("\n");
    expect(output).not.toContain("request-secret");
    expect(output).not.toContain("state-secret");
    expect(output).not.toContain("krw_ac_secret");
    expect(output).not.toContain("verifier-secret");
    expect(output).not.toContain("krw_dt_secret");
  });
});
