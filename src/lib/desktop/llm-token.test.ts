import { describe, expect, it } from "vitest";
import {
  createLlmJobToken,
  hashLlmJobToken,
  verifyLlmJobToken,
} from "./llm-token";

const SECRET = "test-secret-that-is-long-enough-for-hmac-validation";
const ISSUED_AT = new Date("2026-06-21T00:00:00.000Z");
const EXPIRES_AT = new Date("2026-06-21T00:10:00.000Z");

function createToken() {
  return createLlmJobToken({
    secret: SECRET,
    jobId: "job-1",
    userId: "user-1",
    deviceId: "device-1",
    localRunId: "run-1",
    localSessionId: "session-1",
    provider: "deepseek",
    modelProfile: "deepseek-v4-flash",
    sdkModel: "deepseek-v4-flash",
    upstreamModel: "deepseek-v4-flash",
    maxRequestCount: 128,
    maxBudgetUsd: 1,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    jti: "jti-1",
  });
}

describe("Desktop LLM job token", () => {
  it("signs and verifies run-scoped claims", () => {
    const created = createToken();
    const payload = verifyLlmJobToken(
      created.token,
      SECRET,
      new Date("2026-06-21T00:05:00.000Z"),
    );

    expect(payload).toMatchObject({
      job_id: "job-1",
      user_id: "user-1",
      device_id: "device-1",
      local_run_id: "run-1",
      runtime: "claude-sdk",
      provider: "deepseek",
      sdk_model: "deepseek-v4-flash",
      upstream_model: "deepseek-v4-flash",
      max_request_count: 128,
    });
    expect(created.tokenHash).toBe(hashLlmJobToken(created.token));
  });

  it("rejects token tampering", () => {
    const created = createToken();
    const tampered = `${created.token.slice(0, -1)}x`;
    expect(() => verifyLlmJobToken(tampered, SECRET, ISSUED_AT)).toThrow(
      /signature/i,
    );
  });

  it("rejects expired tokens", () => {
    const created = createToken();
    expect(() =>
      verifyLlmJobToken(
        created.token,
        SECRET,
        new Date("2026-06-21T00:10:01.000Z"),
      ),
    ).toThrow(/expired/i);
  });
});
